/* views/delivery · 一页式交付报告工作台
   左侧纸张 + 右侧常驻控制区：后端一次取回事实，控制区只改「怎么投影」，不重新请求；
   人工层（交付对象 / 支持联系 / 验收补充 / 改写后的叙述 / 确认状态）防抖自动保存，带修订号 CAS。
   导出即锁定：任何格式的导出都先落一条不可变快照，再用冻结后的载荷产出文件，
   保证接收人看到的文字与编制人导出时完全一致。 */

import { API } from "../core/api.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { reqSetId, rt, setSortOf, setNameById } from "../core/state.js";
import { UI, copyToClipboard, esc, toast } from "../core/ui.js";
import { DD } from "../lib/delivery-doc.js";
import { PD } from "../lib/plan-doc.js";
import { assocLinkHTML, planStatusName } from "../lib/format.js";
import { printDeliveryPaper, registerDeliveryPrintSource, triggerDownload } from "../lib/download.js";
import { openTaskById } from "../core/task-actions.js";

var host = null;
var data = null;
var versionId = null;
var planId = null;
var loadSeq = 0;
var editMode = false, editingField = null;
var risksExpanded = false;
var dirty = false, saving = false, saveQueued = false, saveTimer = null;
var saveState = "idle";
var pickerDim = "version", pickerRows = null, pickerQuery = "";
var planRows = null, planQuery = "", planStatusFilter = "all";
var exportFmt = "pdf";
var busyAction = false;

function $(sel, root) { return (root || host || document).querySelector(sel); }
/* 版本 / 计划两套文档渲染器同一方法面：其余交互（确认、导出、快照、分享）只认这个入口 */
function isPlanData(d) { return !!(d && d.scopeType === "plan"); }
function isPlan() { return isPlanData(data) || (!data && !!planId); }
function D() { return isPlanData(data) ? PD : DD; }
function opts() { return data ? D().options(data) : DD.DEFAULTS; }
function view() { return { editMode: editMode, editingField: editingField, risksExpanded: risksExpanded, readonly: D().locked(data) }; }
function base() {
  if (isPlan()) return "/api/release-plans/" + encodeURIComponent(planId) + "/delivery-note";
  return "/api/versions/" + encodeURIComponent(versionId) + "/delivery-note";
}
function scopeKey() { return isPlanData(data) ? (planId || data.scopeId) : versionId; }
function resetDocState() {
  editMode = false; editingField = null; dirty = false; saveState = "idle"; risksExpanded = false;
  saveQueued = false;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

/* ==================== 入口 ==================== */

/* 深链：#/delivery?versionId=…&releaseId=…（版本）或 #/delivery?planId=…（发布计划），刷新与转发都能落回同一份说明 */
function hashParams() {
  var raw = String(location.hash || "");
  var q = raw.indexOf("?");
  var out = {};
  if (q < 0) return out;
  raw.substring(q + 1).split("&").forEach(function (p) {
    if (!p) return;
    var i = p.indexOf("=");
    try {
      out[decodeURIComponent(i < 0 ? p : p.substring(0, i))] = i < 0 ? "" : decodeURIComponent(p.substring(i + 1));
    } catch (e) { /* 非法转义直接跳过 */ }
  });
  return out;
}
function setDeliveryHash(kind, id, extra, replace) {
  var h = !id ? "#/delivery"
    : kind === "plan" ? "#/delivery?planId=" + encodeURIComponent(id)
    : "#/delivery?versionId=" + encodeURIComponent(id) + (extra ? "&releaseId=" + encodeURIComponent(extra) : "");
  if (location.hash === h) return;
  try { replace ? history.replaceState(null, "", h) : history.pushState(null, "", h); }
  catch (e) { try { location.hash = h; } catch (e2) { /* 受限环境忽略 */ } }
}

function enterDeliveryView() {
  host = document.getElementById("deliveryBody");
  if (!host) return;
  wire();
  var hp = hashParams();
  if (hp.planId) { loadPlan(hp.planId); return; }
  var want = hp.versionId || rt.deliveryVersionId || versionId;
  if (want) { load(want, hp.releaseId || ""); return; }
  renderPicker();
}
/* 从版本卡 / 发布记录进入：带上版本（可选带上发布记录）直接落到工作台 */
function openDeliveryNote(id, releaseId) {
  rt.deliveryVersionId = id;
  rt.deliveryReleaseId = releaseId || "";
  versionId = null;
  planId = null;
  setDeliveryHash("version", id, releaseId || "", false);
  showView("delivery");
}
/* 从发布计划列表 / 交付报告选择器进入：一份计划 = 一份跨版本汇总报告 */
function openPlanDeliveryNote(id) {
  if (!id) return;
  versionId = null;
  planId = id;
  setDeliveryHash("plan", id, "", false);
  showView("delivery");
}
/* 浏览器前进/后退落在另一个对象：跟着 hash 重新聚合，不整页重进 */
function refreshFromHash() {
  if (!host || activeView !== "delivery") return;
  var hp = hashParams();
  if (hp.planId) { if (!isPlanData(data) || hp.planId !== planId) loadPlan(hp.planId); return; }
  if (hp.versionId) { if (isPlanData(data) || hp.versionId !== versionId) load(hp.versionId, hp.releaseId || ""); return; }
  if (versionId || planId) {
    data = null; versionId = null; planId = null;
    rt.deliveryVersionId = "";
    renderPicker();
  }
}

function dimTab(kind, label) {
  return '<button type="button" data-dl-act="pick-dim" data-dl-val="' + kind + '"'
    + ' class="' + (pickerDim === kind ? "on" : "") + '" aria-pressed="' + (pickerDim === kind ? "true" : "false") + '">'
    + esc(label) + "</button>";
}
function renderPicker() {
  var isPlanPick = pickerDim === "plan";
  host.innerHTML = '<div class="dl-head"><div>'
    + '<div class="dl-title-row"><h2 class="dl-pick-title">选择要生成交付报告的对象</h2></div>'
    + '<div class="dl-facts"><span>' + icon("note", 12) + (isPlanPick
      ? "发布计划可跨项目、跨版本，生成一份逐版本分章的汇总报告"
      : "版本交付针对单个版本；需要跨版本时切到「发布计划」") + "</span></div>"
    + "</div>"
    + '<div class="dl-acts"><div class="dl-fmt-tabs" role="group" aria-label="交付报告维度">'
    + dimTab("version", "按版本") + dimTab("plan", "按发布计划") + "</div></div></div>"
    + '<div id="dlPickerList">' + UI.skeletonRows(4) + "</div>";
  if (isPlanPick) { loadPlanPicker(); return; }
  if (pickerRows) { paintPicker(); return; }
  API.get("/api/versions/cross-project").then(function (rows) {
    pickerRows = rows || [];
    if (activeView === "delivery" && !data && pickerDim === "version") paintPicker();
  }).catch(function (ex) {
    var box = document.getElementById("dlPickerList");
    if (box) box.innerHTML = UI.errorState(ex.message || "版本清单加载失败");
  });
}
/* 计划选择器：跨项目计划按未完成优先、时间倒序；已完成/已取消默认收在筛选里 */
function loadPlanPicker() {
  if (planRows) { paintPlanPicker(); return; }
  API.get("/api/release-plans", { status: "all" }).then(function (rows) {
    planRows = rows || [];
    if (activeView === "delivery" && !data && pickerDim === "plan") paintPlanPicker();
  }).catch(function (ex) {
    var box = document.getElementById("dlPickerList");
    if (box) box.innerHTML = UI.errorState(ex.message || "发布计划清单加载失败");
  });
}
function planStatusBadge(st) {
  /* 与 PLAN_STATUS_META 同源：草稿/已取消都是中性灰，只有就绪与完成各自着色 */
  var cls = st === "completed" ? "ok" : st === "ready" ? "pri" : "";
  return '<span class="dl-badge ' + cls + '">' + esc(planStatusName(st)) + "</span>";
}
function planTimeText(iso) {
  if (!iso) return "未定时间";
  return DD.timeText(iso);
}
function planMatches(q, r) {
  if (!q) return true;
  return [r.projectNames, r.versionNames, r.projectName, r.versionName, planStatusName(r.status), r.ownerName]
    .join(" ").toLowerCase().indexOf(q) !== -1;
}
function paintPlanPicker() {
  var box = document.getElementById("dlPickerList");
  if (!box) return;
  var q = planQuery.trim().toLowerCase();
  var rows = (planRows || []).filter(function (r) {
    if (planStatusFilter === "open" && (r.status === "completed" || r.status === "canceled")) return false;
    if (planStatusFilter === "done" && r.status !== "completed") return false;
    return planMatches(q, r);
  }).sort(function (a, b) {
    var ao = a.status === "completed" || a.status === "canceled" ? 1 : 0;
    var bo = b.status === "completed" || b.status === "canceled" ? 1 : 0;
    if (ao !== bo) return ao - bo;
    return String(b.plannedAt || "").localeCompare(String(a.plannedAt || ""));
  });
  var filters = '<div class="dl-fmt-tabs" role="group" aria-label="计划状态筛选">'
    + [["all", "全部"], ["open", "未完成"], ["done", "已完成"]].map(function (f) {
      return '<button type="button" data-dl-act="plan-status" data-dl-val="' + f[0] + '"'
        + (planStatusFilter === f[0] ? ' class="on"' : "") + ' aria-pressed="' + (planStatusFilter === f[0] ? "true" : "false") + '">'
        + f[1] + "</button>";
    }).join("") + "</div>";
  if (!rows.length) {
    box.innerHTML = '<div class="dl-rfield" style="max-width:340px;margin:12px 0">'
      + '<input class="input" type="search" id="dlPlanQuery" placeholder="搜索计划、项目或版本" value="' + esc(planQuery) + '" aria-label="搜索发布计划">'
      + "</div>" + filters
      + UI.emptyState({
        icon: "layers", title: planQuery || planStatusFilter !== "all" ? "没有匹配的发布计划" : "还没有发布计划",
        text: planQuery || planStatusFilter !== "all" ? "换个关键词或切回「全部」。" : "先在「发布计划」里创建计划并选择版本，这里就能生成汇总报告。"
      });
    wirePlanQuery();
    return;
  }
  box.innerHTML = '<div class="dl-rfield" style="max-width:340px;margin:12px 0">'
    + '<input class="input" type="search" id="dlPlanQuery" placeholder="搜索计划、项目或版本" value="' + esc(planQuery) + '" aria-label="搜索发布计划">'
    + "</div>" + filters
    + '<div class="dl-rows" style="margin-top:12px">' + rows.map(function (r) {
      var sub = [r.projectNames, r.versionCount ? r.versionCount + " 个版本" : "",
        planTimeText(r.plannedAt), r.environment === "production" ? "生产" : r.environment === "staging" ? "预发" : "测试",
        r.ownerName ? "负责人 " + r.ownerName : "", r.plannedTaskCount != null ? "范围 " + r.plannedTaskCount + " 项" : ""]
        .filter(Boolean).join(" · ");
      return '<div class="dl-row body" style="grid-template-columns:96px minmax(0,1fr) 120px">'
        + "<span>" + planStatusBadge(r.status) + "</span>"
        + '<span class="tt"><b>' + esc(r.versionNames || r.versionName || "未命名计划") + "</b><span>" + esc(sub) + "</span></span>"
        + '<span><button class="btn sm soft" type="button" data-dl-open-plan="' + esc(r.id) + '">'
        + icon("note", 13) + "生成报告</button></span></div>";
    }).join("") + "</div>";
  wirePlanQuery();
}
function wirePlanQuery() {
  var input = document.getElementById("dlPlanQuery");
  if (!input) return;
  input.addEventListener("input", function () {
    planQuery = input.value;
    var pos = input.selectionStart;
    paintPlanPicker();
    var next = document.getElementById("dlPlanQuery");
    if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) { /* search 类型部分浏览器不支持 */ } }
  });
}
function pickerSetOf(reqId){
  var sid = reqSetId(reqId);
  var color = "";
  for(var i = 0; sid && i < (rt.projectSets || []).length; i++){
    if(rt.projectSets[i].id === sid) color = rt.projectSets[i].color || "";
  }
  return { id:sid || "", name:sid ? setNameById(sid) : "", sort:sid ? setSortOf(sid) : 9999, color:color };
}
function paintPicker() {
  var box = document.getElementById("dlPickerList");
  if (!box) return;
  var q = pickerQuery.trim().toLowerCase();
  var rows = (pickerRows || []).map(function (r) {
    return { row:r, set:pickerSetOf(r.reqId) };
  }).filter(function (it) {
    return !q || (it.row.projectName + " " + it.row.versionName + " " + it.set.name).toLowerCase().indexOf(q) !== -1;
  });
  if (!rows.length) {
    box.innerHTML = UI.emptyState({
      icon: "note", title: pickerQuery ? "没有匹配的版本" : "还没有版本",
      text: pickerQuery ? "换个关键词，或清空搜索。" : "先在「版本」里为项目建版本并绑定工作项，这里就能生成交付报告。"
    });
    return;
  }
  /* 三层：项目集 → 项目 → 版本；项目集按 sortOrder，未分组垫底 */
  var setMap = {}, setIds = [];
  rows.forEach(function (it) {
    var sid = it.set.id || "";
    if (!setMap[sid]) {
      setMap[sid] = { info:it.set, projects:{}, projectIds:[] };
      setIds.push(sid);
    }
    var sm = setMap[sid], pid = it.row.reqId;
    if (!sm.projects[pid]) {
      sm.projects[pid] = { name: it.row.projectName, list: [] };
      sm.projectIds.push(pid);
    }
    sm.projects[pid].list.push(it.row);
  });
  setIds.sort(function (a, b) { return setMap[a].info.sort - setMap[b].info.sort; });
  var body = setIds.map(function (sid) {
    var sm = setMap[sid];
    var projectHTML = sm.projectIds.map(function (pid) {
      var g = sm.projects[pid];
      return '<div class="dl-modgroup"><div class="dl-modgroup-head"><span class="dl-mod">' + esc(g.name)
        + '</span><span class="cnt">' + g.list.length + " 个版本</span></div>"
        + '<div class="dl-rows">' + g.list.map(function (r) {
          /* 徽标只说版本生命周期，生产发布事实放 sub，避免「有发布记录」与「无生产发布记录」同排矛盾 */
          var versionReleased = r.versionStatus === "released";
          var sub = [r.versionId, r.targetDate ? "目标 " + DD.dateText(r.targetDate) : "未设目标日",
            r.latestReleaseDate ? "生产发布 " + DD.dateText(r.latestReleaseDate) : "生产发布 无"].join(" · ");
          return '<div class="dl-row body" style="grid-template-columns:96px minmax(0,1fr) 120px">'
            + "<span>" + (versionReleased ? '<span class="dl-badge ok">版本已发布</span>' : '<span class="dl-badge warn">版本未发布</span>') + "</span>"
            + '<span class="tt"><b>' + assocLinkHTML("version", r.versionId, r.versionName, { req:pid }) + "</b><span>" + esc(sub) + "</span></span>"
            + '<span><button class="btn sm soft" type="button" data-dl-open="' + esc(r.versionId) + '">'
            + icon("note", 13) + "生成报告</button></span></div>";
        }).join("") + "</div></div>";
    }).join("");
    return '<div class="dl-setgroup"><div class="dl-setgroup-head">'
      + (sm.info.color ? '<i class="cdot" style="background:' + esc(sm.info.color) + '"></i>' : "")
      + '<span class="dl-setname">' + esc(sm.info.name || "未分组") + '</span>'
      + '<span class="cnt">' + sm.projectIds.length + " 个项目</span></div>" + projectHTML + "</div>";
  }).join("");
  box.innerHTML = '<div class="dl-rfield" style="max-width:340px;margin:12px 0">'
    + '<input class="input" type="search" id="dlPickerQuery" placeholder="搜索项目集、项目或版本" value="' + esc(pickerQuery) + '" aria-label="搜索版本">'
    + "</div>" + body;
  var input = document.getElementById("dlPickerQuery");
  if (input) input.addEventListener("input", function () {
    pickerQuery = input.value;
    var pos = input.selectionStart;
    paintPicker();
    var next = document.getElementById("dlPickerQuery");
    if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) { /* search 类型部分浏览器不支持 */ } }
  });
}

function load(id, releaseId) {
  var current = ++loadSeq;
  versionId = id;
  planId = null;
  rt.deliveryVersionId = id;
  data = null;
  resetDocState();
  host.innerHTML = UI.skeletonRows(6);
  var want = releaseId || rt.deliveryReleaseId || "";
  rt.deliveryReleaseId = "";
  setDeliveryHash("version", id, want, true);
  return API.get(base(), want ? { releaseId: want } : null).then(function (resp) {
    if (current !== loadSeq || activeView !== "delivery") return;
    data = resp;
    renderAll();
  }).catch(function (ex) {
    if (current !== loadSeq) return;
    host.innerHTML = UI.errorState(ex.message || "交付报告加载失败");
    var btn = host.querySelector("[data-empty-action]");
    if (btn) btn.addEventListener("click", function () { load(id, want); });
  });
}

function loadPlan(id) {
  var current = ++loadSeq;
  planId = id;
  versionId = null;
  data = null;
  resetDocState();
  host.innerHTML = UI.skeletonRows(6);
  setDeliveryHash("plan", id, "", true);
  return API.get(base()).then(function (resp) {
    if (current !== loadSeq || activeView !== "delivery") return;
    data = resp;
    renderAll();
  }).catch(function (ex) {
    if (current !== loadSeq) return;
    host.innerHTML = UI.errorState(ex.message || "发布计划交付报告加载失败");
    var btn = host.querySelector("[data-empty-action]");
    if (btn) btn.addEventListener("click", function () { loadPlan(id); });
  });
}

/* ==================== 渲染 ==================== */

function renderAll() {
  if (!data) return;
  var doc = D(), o = opts(), g = doc.gates(data), isLocked = doc.locked(data), plan = isPlanData(data);
  /* 只读权限不靠点击后 toast：保存 / 导出 / 分享按钮直接禁用并写明原因 */
  var noSnapshotRight = !data.canSnapshot && !isLocked;
  var noShare = noSnapshotRight && !data.snapshotId;
  var readWhy = plan ? "你对该计划覆盖的项目只有查看权限" : "你对该项目只有查看权限";
  var chs = plan ? (data.versionChapters || []) : [];
  var relCount = plan ? chs.filter(function (x) { return x.released; }).length : 0;
  /* 页面标题已在顶栏，正文不再重复 h1；这里直接给对象与口径 chip */
  host.innerHTML = '<div class="dl-head"><div>'
    + '<div class="dl-title-row">'
    + '<span class="dl-chip pri">' + esc(doc.toneName(o.tone)) + "</span>"
    + (plan
      ? '<span class="dl-chip">' + icon("layers", 11) + esc(data.scopeName || "发布计划")
        + (data.plan && data.plan.statusName ? " · " + esc(data.plan.statusName) : "") + "</span>"
      : '<span class="dl-chip">' + esc(data.projectName || "未归属项目") + " · " + assocLinkHTML("version", data.versionId, data.versionName || "", { req:data.projectId, plain:"" }) + "</span>")
    + (isLocked ? '<span class="dl-chip plum">' + icon("lock", 11) + "快照 " + esc(data.docNo || "") + "</span>" : "")
    + "</div>"
    + '<div class="dl-facts">'
    + (plan
      ? "<span>" + icon("layers", 12) + "计划版本 <b>" + relCount + " / " + chs.length + "</b> 已发布</span>"
        + "<span>" + icon("board", 12) + "涉及项目 <b>" + (data.plan && data.plan.projectNames ? data.plan.projectNames.length : 0) + "</b> 个</span>"
      : "<span>" + icon("layers", 12) + "承诺 <b>" + (data.counts ? data.counts.planned || 0 : 0) + "</b> 项</span>")
    + "<span>" + icon("note", 12) + "编号 <b>" + esc(data.docNo || "未编号") + "</b></span>"
    + "<span>" + icon("clock", 12) + "生成 <b>" + esc(doc.timeText(data.generatedAt)) + "</b></span>"
    + "<span>" + icon("shield", 12) + "编制 <b>" + esc(data.ownerName || "未记录") + "</b></span>"
    + "</div></div>"
    + '<div class="dl-acts">'
    + '<button class="btn sm ghost" type="button" data-dl-act="pick">' + icon("layers", 13) + (plan ? "切换计划" : "切换版本") + "</button>"
    + '<button class="btn sm ghost" type="button" data-dl-act="snapshots">' + icon("layers", 13) + "快照记录"
    + ((data.revisions || []).length ? " (" + data.revisions.length + ")" : "") + "</button>"
    + '<button class="btn sm" type="button" data-dl-act="save"' + (isLocked || !data.canEdit ? " disabled" : "")
    + (isLocked ? ' title="快照已锁定，不能保存草稿"' : !data.canEdit ? ' title="' + readWhy + '，不能保存草稿"' : "") + ">"
    + icon("check", 13) + '保存草稿<span id="dlSaveState"></span></button>'
    + '<button class="btn sm" type="button" data-dl-act="share"' + (noShare ? ' disabled title="' + readWhy + '，不能生成分享链接"' : "") + ">" + icon("share", 13) + "分享链接</button>"
    + '<button class="btn sm primary" type="button" data-dl-act="export"' + (noSnapshotRight ? ' disabled title="' + readWhy + '，不能导出快照"' : "") + ">" + icon("download", 13) + "导出报告</button>"
    + "</div></div>"
    + '<div id="dlBanner"></div>'
    + '<div class="dl-work"><div class="dl-main">'
    /* 区块导航改纵向目录（原型 DEL-3）：与纸面并排，列头带 ✓/! 门禁状态，滚动高亮当前节 */
    + '<aside class="dl-sidenav" aria-label="文档区块目录">'
    + '<div class="dl-sidenav-head" id="dlNavHead"></div>'
    + '<nav class="dl-secnav" id="dlSecnav" aria-label="文档区块导航"></nav>'
    + '<div class="dl-sidenav-foot">数字来自系统记录，只读且可点回原始记录；文字由系统草拟，逐段确认后导出。</div>'
    + "</aside>"
    + '<div class="dl-paper-col">'
    + '<div id="dlSheetHost"></div>'
    + '<p class="dl-page-foot">按 A4 纵向排版估算页数；导出 PDF 时以打印对话框的实际分页为准。</p>'
    + "</div></div>" + railHTML() + "</div>";
  renderDoc();
  paintSaveState();
}

function bannerHTML() {
  if (isPlanData(data)) return planBannerHTML();
  var g = DD.gates(data), isLocked = DD.locked(data);
  var kind, ic, title, desc, acts = "";
  if (isLocked) {
    kind = "lock"; ic = "lock"; title = "正在查看不可变快照 " + (data.docNo || "");
    desc = "内容已冻结，不随系统记录变化；控制区与文字编辑均已锁定。";
    acts = '<button class="btn sm" type="button" data-dl-act="back-draft">回到当前草稿</button>';
  } else if (!data.canSnapshot) {
    /* 与页面右上角禁用态同源：只读用户不再看到「可导出」的乐观提示 */
    kind = "lock"; ic = "lock"; title = "只读查看";
    desc = "你对该项目只有查看权限，可阅读但不能改写、导出或分享；需要时请联系项目负责人。";
  } else if (g.customerBlocked) {
    kind = "bad"; ic = "alertCircle"; title = "未确认成功的生产发布，客户版不可导出";
    desc = "实际交付以成功的生产发布记录为准，完成数量不代表已交付。可切到管理版 / 内部版先看内部草稿。";
    acts = '<button class="btn sm" type="button" data-dl-act="tone" data-dl-tone="manager">切到管理版</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto" data-dl-view="phase">去记录发布</button>';
  } else if (!g.production) {
    kind = "warn"; ic = "alert"; title = "选中的记录不是成功的生产部署";
    desc = "测试环境发布、失败与回滚都不构成对外交付依据；请在控制区换一条成功的生产发布记录。";
  } else if (g.pending.length) {
    kind = "warn"; ic = "edit"; title = g.pending.length + " 处对外表述待确认";
    desc = "系统按事实草拟了这些段落，核对无误后点「确认这段」；也可以改写。全部确认后才能导出与分享，确认后可撤回。";
    acts = '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
  } else {
    kind = "ok"; ic = "checkCircle"; title = "事实与文字均已就绪";
    desc = "可导出不可变快照并生成只读分享链接；导出后系统记录再变化也不影响已发出的这一份。";
  }
  /* 「不是生产发布」与「文字待确认」会同时成立：前一条横幅不能把后一条的下一步吞掉，
     否则管理版草稿被待确认闸门拦住，页面上却找不到确认入口。 */
  if (!isLocked && data.canEdit && !g.customerBlocked && g.pending.length && acts.indexOf("accept-all") < 0) {
    acts += '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
    desc += "另有 " + g.pending.length + " 处对外表述待确认，核对后才能导出。";
  }
  return '<div class="dl-banner ' + kind + '"><span class="bi">' + icon(ic, 15) + "</span>"
    + "<div><div class=\"bt\">" + esc(title) + "</div><div class=\"bp\">" + esc(desc) + "</div></div>"
    + (acts ? '<div class="ba">' + acts + "</div>" : "") + "</div>";
}

/* 计划维度门禁：只有计划内每个版本都有本计划的成功生产发布（非回滚），才可对外 */
function planBannerHTML() {
  var g = PD.gates(data), isLocked = PD.locked(data);
  var kind, ic, title, desc, acts = "";
  if (isLocked) {
    kind = "lock"; ic = "lock"; title = "正在查看不可变快照 " + (data.docNo || "");
    desc = "内容已冻结，不随系统记录变化；控制区与文字编辑均已锁定。";
    acts = '<button class="btn sm" type="button" data-dl-act="back-draft">回到当前草稿</button>';
  } else if (!data.canSnapshot) {
    kind = "lock"; ic = "lock"; title = "只读查看";
    desc = "你对该计划覆盖的项目只有查看权限，可阅读但不能改写、导出或分享；需要时请联系项目负责人。";
  } else if (g.customerBlocked) {
    kind = "bad"; ic = "alertCircle"; title = "计划内仍有版本未完成本计划的生产发布，客户版不可导出";
    desc = "各版本都要有发布记录指向本计划、环境为生产、结果成功且非回滚；实际交付以这些记录为准，完成数量不代表已交付。可切到管理版先看内部草稿。";
    acts = '<button class="btn sm" type="button" data-dl-act="tone" data-dl-tone="manager">切到管理版</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-plan-release">去发布计划</button>';
  } else if (!g.production) {
    kind = "warn"; ic = "alert"; title = "计划内仍有版本未完成本计划的生产发布";
    desc = "本说明目前是内部草稿；各版本都确认本计划的成功生产发布后，才能作为对外交付依据。";
    acts = '<button class="btn sm ghost" type="button" data-dl-act="goto-plan-release">去发布计划</button>';
  } else if (g.pending.length) {
    kind = "warn"; ic = "edit"; title = g.pending.length + " 处对外表述待确认";
    desc = "系统按各版本事实草拟了这些段落，核对无误后点「确认这段」；也可以改写。全部确认后才能导出与分享。";
    acts = '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
  } else {
    kind = "ok"; ic = "checkCircle"; title = "事实与文字均已就绪";
    desc = "可导出不可变快照并生成只读分享链接；导出后各版本记录再变化也不影响已发出的这一份。";
  }
  if (!isLocked && data.canEdit && !g.customerBlocked && g.pending.length && acts.indexOf("accept-all") < 0) {
    acts += '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
    desc += "另有 " + g.pending.length + " 处对外表述待确认，核对后才能导出。";
  }
  return '<div class="dl-banner ' + kind + '"><span class="bi">' + icon(ic, 15) + "</span>"
    + "<div><div class=\"bt\">" + esc(title) + "</div><div class=\"bp\">" + esc(desc) + "</div></div>"
    + (acts ? '<div class="ba">' + acts + "</div>" : "") + "</div>";
}

/* 哪些区块有「对外表述」、对应哪个确认字段：目录上的 ✓/! 与正文确认按钮同一口径 */
var NAV_CONFIRM_SECTION = { summary: "summary", change: "changes", issue: "defects", acceptance: "acceptance" };
function navConfirmField(sectionKey) {
  for (var f in NAV_CONFIRM_SECTION) if (NAV_CONFIRM_SECTION[f] === sectionKey) return f;
  return "";
}
function secnavHTML() {
  var doc = D();
  var pend = doc.pendingFields(data).map(function (f) { return NAV_CONFIRM_SECTION[f]; });
  var done = data.confirmed || [];
  return doc.sectionList(data).map(function (s, i) {
    var isPend = pend.indexOf(s.k) !== -1;
    var field = navConfirmField(s.k);
    var mark = isPend
      ? '<span class="sv-mark warn" aria-label="待确认">!</span>'
      : (field && done.indexOf(field) !== -1
        ? '<span class="sv-mark ok" aria-label="已确认">✓</span>'
        : '<span class="sv-mark neutral" aria-hidden="true"></span>');
    return '<button type="button" data-dl-jump="' + s.k + '"' + (isPend ? ' data-pending="1"' : "") + ">"
      + mark + '<span class="nv">' + esc(s.title) + "</span>"
      + '<span class="n">' + (i < 9 ? "0" : "") + (i + 1) + "</span></button>";
  }).join("");
}

function renderDoc() {
  if (!data) return;
  var doc = D();
  var sheetHost = document.getElementById("dlSheetHost");
  var nav = document.getElementById("dlSecnav");
  var banner = document.getElementById("dlBanner");
  if (banner) banner.innerHTML = bannerHTML();
  if (nav) nav.innerHTML = secnavHTML();
  var navHead = document.getElementById("dlNavHead");
  if (navHead) {
    var secTotal = doc.sectionList(data).length, pendTotal = doc.pendingFields(data).length;
    navHead.textContent = secTotal + " 个区块" + (pendTotal ? " · " + pendTotal + " 处待确认" : "");
  }
  if (sheetHost) sheetHost.innerHTML = doc.sheetMarkup(data, view());
  updateMeter();
  /* 重排会把横向滚动位置清零，重新把当前节带回视野 */
  secnavCurrent = null;
  syncSecnav();
}

/* A4 纵向去掉 14mm/12mm 页边距后的内容盒，单位 CSS px（96dpi） */
var PAPER_W = 703, PAPER_H = 1017;

/* 区块设了 break-inside:avoid，整节放不下时会整节挪到下一页，
   所以页数不是总高除以页高那么简单，要按同样的规则走一遍页光标。
   比一页还高的区块也一样先挪页：Chrome 会把它挪到下一页再拆，剩页空间不会留残段。 */
function countPages(sheet) {
  var y = 0, parts = sheet.children;
  for (var i = 0; i < parts.length; i++) {
    /* offsetHeight 是布局高度：预览纸带 scale 变换，getBoundingClientRect 会把缩放算进去，页数就虚高了 */
    var h = parts[i].offsetHeight;
    if (parts[i].classList.contains("dl-sec") && y % PAPER_H + h > PAPER_H) {
      y = Math.ceil(y / PAPER_H) * PAPER_H;
    }
    y += h;
  }
  return Math.max(1, Math.ceil(y / PAPER_H));
}

/* 屏幕上的纸随视口变宽，直接拿它估页数会少算三分之一：离屏按 A4 几何量一份 */
function measurePages() {
  var sheet = $("#dlSheetHost .dl-sheet");
  if (!sheet) return 1;
  var box = document.getElementById("dlMeasure");
  if (!box) {
    box = document.createElement("div");
    box.id = "dlMeasure";
    box.setAttribute("aria-hidden", "true");
    document.body.appendChild(box);
  }
  var clone = sheet.cloneNode(true);
  clone.classList.add("dl-a4");
  clone.removeAttribute("id");
  /* 离屏副本不能带着区块 id，否则 getElementById 会撞上它，导航跳转就定位错了 */
  clone.querySelectorAll("[id]").forEach(function (n) { n.removeAttribute("id"); });
  box.innerHTML = "";
  box.appendChild(clone);
  return countPages(clone);
}

function updateMeter() {
  var pages = measurePages();
  var doc = D(), g = doc.gates(data);
  var el = document.getElementById("dlMeterPages");
  if (el) {
    el.textContent = String(pages);
    el.parentNode.className = pages > 1 ? "m-warn" : "m-ok";
  }
  var p = document.getElementById("dlMeterPending");
  if (p) {
    p.textContent = String(g.pending.length);
    p.parentNode.className = g.pending.length ? "m-warn" : "m-ok";
  }
  var s = document.getElementById("dlMeterSecs");
  if (s) s.textContent = String(doc.sectionList(data).length);
}

/* 滚动时标出当前区块：纸张很长，左侧目录要能告诉读者「现在在哪一节」 */
var secnavCurrent = null;
function syncSecnav() {
  var nav = document.getElementById("dlSecnav");
  if (!nav) return;
  var scroller = document.getElementById("view-delivery");
  var top = scroller ? scroller.getBoundingClientRect().top : 0;
  var secs = D().sectionList(data), current = null;
  secs.forEach(function (s) {
    var el = document.getElementById("dl-sec-" + s.k);
    if (el && el.getBoundingClientRect().top - top <= 88) current = s.k;
  });
  /* 末节比视口短，滚到底时它的标题仍到不了顶：不补这一条，点最后一节永远高亮在倒数第二节 */
  if (scroller && secs.length && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
    current = secs[secs.length - 1].k;
  }
  /* 还没滚过第一节：直接高亮第一节，目录从打开就有落点 */
  if (!current && secs.length) current = secs[0].k;
  var active = null;
  nav.querySelectorAll("[data-dl-jump]").forEach(function (b) {
    if (b.dataset.dlJump === current) { b.setAttribute("aria-current", "true"); active = b; }
    else b.removeAttribute("aria-current");
  });
  /* 目录自身也可能超出视口：当前项被纵向裁掉时把它带进视野 */
  if (active && current !== secnavCurrent) {
    var t = active.offsetTop, btm = t + active.offsetHeight;
    if (t < nav.scrollTop + 4 || btm > nav.scrollTop + nav.clientHeight - 4) {
      nav.scrollTop = Math.max(0, t - (nav.clientHeight - active.offsetHeight) / 2);
    }
  }
  secnavCurrent = current;
}

/* ==================== 控制区 ==================== */

function seg(act, items, value, label) {
  return '<div class="seg mini" role="group" aria-label="' + esc(label) + '">'
    + items.map(function (it) {
      var on = String(it[0]) === String(value);
      return '<button type="button" data-dl-act="' + act + '" data-dl-val="' + esc(it[0]) + '"'
        + ' aria-pressed="' + (on ? "true" : "false") + '">' + esc(it[1]) + "</button>";
    }).join("") + "</div>";
}
function switchRow(key, title, hint, checked, disabled) {
  return '<label class="dl-switch"><input type="checkbox" data-dl-opt="' + key + '"'
    + (checked ? " checked" : "") + (disabled ? " disabled" : "") + '><span class="track"></span>'
    + '<span class="sw-t">' + esc(title) + (hint ? '<span class="sw-h">' + esc(hint) + "</span>" : "") + "</span></label>";
}
function rfield(label, inner) {
  return '<div class="dl-rfield"><span class="rl">' + esc(label) + "</span>" + inner + "</div>";
}
function railHTML() {
  var doc = D(), o = opts(), isLocked = doc.locked(data), readOnly = isLocked || !data.canEdit, plan = isPlanData(data);
  var dis = readOnly ? " disabled" : "";
  var releases = [["", "自动取最近一次成功生产发布"]].concat((data.releaseOptions || []).map(function (r) {
    return [r.id, (r.deliveryEvidence ? "✓ " : "· ") + r.label];
  }));
  var chs = plan ? (data.versionChapters || []) : [];
  var relCount = chs.filter(function (x) { return x.released; }).length;
  /* 计划维度不选单条发布记录：每个版本各取本计划自己的成功生产发布 */
  var basisHTML = plan
    ? '<div class="dl-kvbox wide"><span>发布依据</span><strong>' + relCount + " / " + chs.length
      + " 个版本已完成本计划的生产发布</strong></div>"
    : '<select class="select" data-dl-release' + dis + ' aria-label="发布依据">'
      + releases.map(function (r) {
        return '<option value="' + esc(r[0]) + '"' + (String(r[0]) === String(o.releaseId || "") ? " selected" : "") + ">" + esc(r[1]) + "</option>";
      }).join("") + "</select>";
  var groups = '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("users", 12) + "读者与依据</div>"
    + rfield("语气版本", seg("tone", [["customer", "客户"], ["manager", "管理"], ["internal", "内部"]], o.tone, "语气版本"))
    + rfield("发布依据", basisHTML)
    + rfield("交付对象", '<input class="input" type="text" maxlength="120" data-dl-text="audience" value="'
      + esc(data.audience || "") + '" placeholder="如 某公司 · 清算业务部"' + dis + ">")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("board", 12) + "范围与明细</div>"
    + rfield("内容分组", seg("group", [["demand", "按需求"], ["project", "按项目"], ["type", "按类型"]], o.groupBy, "内容分组"))
    + switchRow("includeUnreleased", "附列未上线清单", "未完成、顺延与已完成未纳入", o.includeUnreleased, readOnly)
    + switchRow("showChanges", "变更说明", "基线对照与变更台账", o.showChanges, readOnly)
    + switchRow("showDemands", "需求兑现", "按需求看兑现率", o.showDemands, readOnly)
    + switchRow("showDefects", "缺陷与已知问题", "已修复与遗留清单", o.showDefects, readOnly)
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("stats", 12) + "投入与证据</div>"
    + switchRow("showEffort", "投入与负载", "客户版默认不含成员明细", o.showEffort, readOnly)
    + rfield("投入维度", '<select class="select" data-dl-opt-select="effortDim"' + (readOnly || !o.showEffort ? " disabled" : "")
      + ' aria-label="投入维度"><option value="module"' + (o.effortDim === "module" ? " selected" : "") + ">按分类</option>"
      + '<option value="member"' + (o.effortDim === "member" ? " selected" : "") + ">按成员</option></select>")
    + rfield("证据详细度", seg("evidence", [[0, "关键"], [1, "完整"], [2, "校验值"]], o.evidence, "证据详细度"))
    + switchRow("showRelease", "发布与运行信息", "环境、目标、制品与执行人", o.showRelease, readOnly)
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("shield", 12) + "验收与支持</div>"
    + switchRow("showAcceptance", "验收与结论", "依据、条件与阻塞项", o.showAcceptance, readOnly)
    + switchRow("showSupport", "支持与联系", "接收人找谁", o.showSupport, readOnly)
    + rfield("支持联系人", '<input class="input" type="text" maxlength="200" data-dl-text="supportContact" value="'
      + esc(data.supportContact || "") + '" placeholder="姓名 · 邮箱 / 电话"' + dis + ">")
    + rfield("验收补充", '<textarea class="dl-ta" maxlength="1000" data-dl-text="acceptanceNote" placeholder="双方约定的验收口径与差异说明"' + dis + ">"
      + esc(data.acceptanceNote || "") + "</textarea>")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("edit", 12) + "叙述与排版</div>"
    + rfield("叙述详略", '<input type="range" min="0" max="2" step="1" data-dl-verbosity value="' + o.verbosity + '"' + dis
      + ' aria-label="叙述详略"><div class="dl-range-lab"><span>精简</span><span>标准</span><span>详细</span></div>')
    + rfield("排版密度", seg("density", [["cozy", "宽松"], ["compact", "紧凑"]], o.density, "排版密度"))
    + switchRow("brand", "信头与编号", "沙漏信头 + 文档编号", o.brand, readOnly)
    + switchRow("watermark", "草稿水印", "未确认发布时强制显示", o.watermark, readOnly)
    + rfield("补充说明", '<textarea class="dl-ta" maxlength="4000" data-dl-narr="note" placeholder="要额外告知接收人的事项（会单独成节）"' + dis + ">"
      + esc(doc.narrative(data, "note") || "") + "</textarea>")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("table", 12) + "附录</div>"
    + switchRow("showCaliber", "统计口径", "每个数字的定义与分母", o.showCaliber, readOnly)
    + switchRow("showRevisions", "修订记录", "本版本已导出的快照", o.showRevisions, readOnly)
    + "</div>";
  var g = doc.gates(data);
  return '<aside class="dl-rail' + (readOnly ? " locked" : "") + '" aria-label="生成控制区">'
    + '<div class="dl-rail-head"><h3>' + icon("settings", 13) + "生成控制</h3>"
    + '<div class="dl-rh-sub">实时生效，不改变任何事实' + (readOnly ? " · 当前只读" : "") + "</div>"
    + '<div class="dl-meter"><div class="m-ok"><b id="dlMeterPages">1</b><span>A4 页数</span></div>'
    + '<div class="' + (g.pending.length ? "m-warn" : "m-ok") + '"><b id="dlMeterPending">' + g.pending.length + "</b><span>待确认</span></div>"
    + '<div><b id="dlMeterSecs">' + doc.sectionList(data).length + "</b><span>区块</span></div></div></div>"
    + (isLocked ? '<div class="dl-lockbar">' + icon("lock", 12) + " 快照已锁定，控制区不可改。"
      + '<button class="btn sm" type="button" data-dl-act="back-draft">回到当前草稿</button></div>'
      : !data.canEdit ? '<div class="dl-lockbar">' + icon("lock", 12) + " "
        + (plan ? "你对该计划覆盖的项目只有查看权限" : "你对该项目只有查看权限") + "，可阅读但不能改写或导出。</div>" : "")
    + '<div class="dl-rail-body">' + groups + "</div>"
    + '<div class="dl-rail-foot">'
    + '<button class="btn sm ghost" type="button" data-dl-act="reset"' + dis + ">重置默认</button>"
    + '<button class="btn sm ghost" type="button" data-dl-act="lean"' + dis + ">压到一页</button>"
    + "</div>"
    + '<div class="dl-rail-note">口径：已发布只取发布快照中「已发布」的项；通过率 = 通过 /（已执行 − 跳过）；'
    + "投入为计时 + 补记，不用于计费。任何一段没有记录就标「未记录」，不推断。</div>"
    + "</aside>";
}
function renderRail() {
  var old = $(".dl-rail");
  if (!old) return;
  var wrap = document.createElement("div");
  wrap.innerHTML = railHTML();
  old.parentNode.replaceChild(wrap.firstChild, old);
  updateMeter();
}

/* ==================== 人工层保存 ==================== */

function paintSaveState() {
  var el = document.getElementById("dlSaveState");
  if (!el) return;
  el.textContent = saveState === "saving" ? " · 保存中" : dirty ? " · 未保存" : saveState === "saved" ? " · 已保存" : "";
}
function markDirty() {
  dirty = true;
  saveState = "dirty";
  paintSaveState();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { saveTimer = null; saveNow(true); }, 900);
}
function saveBody() {
  return {
    revision: data.revision == null ? 0 : data.revision,
    audience: data.audience || "",
    supportContact: data.supportContact || "",
    acceptanceNote: data.acceptanceNote || "",
    options: data.options,
    narratives: data.narratives || {},
    confirmed: data.confirmed || []
  };
}
function saveNow(silent) {
  if (!data || D().locked(data) || !data.canEdit) return Promise.resolve(null);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (saving) { saveQueued = true; return Promise.resolve(null); }
  saving = true;
  saveState = "saving";
  paintSaveState();
  return API.put(base(), saveBody()).then(function (resp) {
    /* 保存期间又切了对象：这份响应属于旧对象，丢弃 */
    if (resp && resp.scopeId === scopeKey()) {
      resp.options = resp.options || data.options;
      data = resp;
      dirty = false;
      saveState = "saved";
      var banner = document.getElementById("dlBanner");
      if (banner) banner.innerHTML = bannerHTML();
      updateMeter();
    }
    if (!silent) toast("草稿已保存", "fs");
    return resp;
  }).catch(function (ex) {
    saveState = "error";
    dirty = true;
    var msg = String(ex && ex.message || "保存失败");
    toast(msg, "bad");
    if (/409|已被他人修改/.test(msg)) { if (isPlanData(data)) loadPlan(planId); else load(versionId); }
    return null;
  }).then(function (r) {
    saving = false;
    paintSaveState();
    if (saveQueued) { saveQueued = false; return saveNow(true); }
    return r;
  });
}
/* 改写中的段落先落到 data，再重绘，避免控制区一动就丢掉正在输入的文字 */
function harvestEditing() {
  var el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.dlField || el.getAttribute("contenteditable") !== "true") return;
  setNarrative(el.dataset.dlField, el.textContent);
}
function setNarrative(field, text) {
  var value = String(text == null ? "" : text).replace(/\u00a0/g, " ").trim();
  data.narratives = data.narratives || {};
  if (!value || (field !== "internal" && field !== "note" && value === D().autoText(data, field))) {
    delete data.narratives[field];
  } else {
    data.narratives[field] = value.slice(0, 4000);
  }
}
function confirmField(field) {
  data.confirmed = data.confirmed || [];
  if (data.confirmed.indexOf(field) === -1) data.confirmed.push(field);
}
function unconfirmField(field) {
  data.confirmed = (data.confirmed || []).filter(function (k) { return k !== field; });
}

/* ==================== 选项变更 ==================== */

function applyOption(key, value) {
  if (!data || D().locked(data) || !data.canEdit) return;
  data.options = data.options || {};
  data.options[key] = value;
  if (key === "tone") {
    data.options.showEffort = value !== "customer";
    if (value === "internal") data.options.evidence = 2;
    else if (data.options.evidence === 2) data.options.evidence = 1;
  }
  harvestEditing();
  markDirty();
  if (key === "tone" || key === "showEffort" || key === "showRevisions") { renderAll(); return; }
  renderDoc();
  syncRailControls();
}
/* 只同步依赖联动的控件，不整块重绘控制区（否则正在拖的滑块会断） */
function syncRailControls() {
  var o = opts();
  var dim = $('[data-dl-opt-select="effortDim"]');
  if (dim) dim.disabled = D().locked(data) || !data.canEdit || !o.showEffort;
}

/* ==================== 事件 ==================== */

var wired = false;
function wire() {
  if (wired || !host) return;
  wired = true;
  /* 原生 Ctrl+P 与「导出 PDF」印同一份只读投影；离开本视图或还没选版本时不接管打印 */
  registerDeliveryPrintSource(function () {
    return data && activeView === "delivery"
      ? D().sheetMarkup(data, { readonly: true, clean: true, a4: true, plainLinks: isPlanData(data) }) : null;
  });
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  host.addEventListener("input", onInput);
  host.addEventListener("focusout", onFocusOut);
  var scroller = document.getElementById("view-delivery");
  if (scroller) scroller.addEventListener("scroll", function () {
    if (activeView === "delivery" && data) syncSecnav();
  }, { passive: true });
  window.addEventListener("resize", function () {
    if (activeView === "delivery" && data) { updateMeter(); syncSecnav(); }
  });
  window.addEventListener("ds:before-route", function () {
    if (dirty && data && !D().locked(data)) saveNow(true);
  });
}

function onChange(e) {
  var t = e.target;
  if (t.dataset.dlOpt !== undefined) { applyOption(t.dataset.dlOpt, t.checked); return; }
  if (t.dataset.dlOptSelect) { applyOption(t.dataset.dlOptSelect, t.value); return; }
  if (t.dataset.dlRelease !== undefined) {
    if (isPlanData(data) || D().locked(data) || !data.canEdit) return;
    data.options.releaseId = t.value;
    dirty = true;
    /* 发布依据要重新聚合事实：保存后后端按持久化的 releaseId 返回同一条记录 */
    saveNow(true).then(function (resp) { if (resp) renderAll(); });
    return;
  }
}
function onInput(e) {
  var t = e.target;
  if (t.dataset.dlVerbosity !== undefined) { applyOption("verbosity", Number(t.value)); return; }
  if (t.dataset.dlText) {
    if (!data || D().locked(data) || !data.canEdit) return;
    data[t.dataset.dlText] = t.value;
    markDirty();
    renderDoc();
    return;
  }
  if (t.dataset.dlNarr) {
    if (!data || D().locked(data) || !data.canEdit) return;
    setNarrative(t.dataset.dlNarr, t.value);
    markDirty();
    renderDoc();
  }
}
function onFocusOut(e) {
  var t = e.target;
  if (!t.dataset || !t.dataset.dlField || t.getAttribute("contenteditable") !== "true") return;
  if (!data || D().locked(data)) return;
  var field = t.dataset.dlField;
  setNarrative(field, t.textContent);
  if (field !== "internal" && field !== "note") confirmField(field);
  editingField = null;
  markDirty();
  renderDoc();
}

function onClick(e) {
  var open = e.target.closest("[data-dl-open]");
  if (open) { load(open.dataset.dlOpen); return; }
  var openPlan = e.target.closest("[data-dl-open-plan]");
  if (openPlan) { openPlanDeliveryNote(openPlan.dataset.dlOpenPlan); return; }
  var jump = e.target.closest("[data-dl-jump]");
  if (jump) {
    var sec = document.getElementById("dl-sec-" + jump.dataset.dlJump);
    if (sec) sec.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  var btn = e.target.closest("[data-dl-act]");
  if (!btn || btn.disabled) return;
  var act = btn.dataset.dlAct;
  if (act === "tone") { applyOption("tone", btn.dataset.dlTone || btn.dataset.dlVal); return; }
  if (act === "group") { applyOption("groupBy", btn.dataset.dlVal); return; }
  if (act === "risks") { risksExpanded = !risksExpanded; renderDoc(); return; }
  if (act === "density") { applyOption("density", btn.dataset.dlVal); return; }
  if (act === "evidence") { applyOption("evidence", Number(btn.dataset.dlVal)); return; }
  if (act === "evidence-level") { applyOption("evidence", Number(btn.dataset.dlLv)); return; }
  if (act === "pick-dim") {
    if (btn.dataset.dlVal === pickerDim) return;
    pickerDim = btn.dataset.dlVal === "plan" ? "plan" : "version";
    pickerQuery = "";
    renderPicker();
    return;
  }
  if (act === "plan-status") { planStatusFilter = btn.dataset.dlVal || "all"; paintPlanPicker(); return; }
  if (act === "pick") {
    var wasPlan = isPlan();
    data = null; versionId = null; planId = null; rt.deliveryVersionId = "";
    pickerDim = wasPlan ? "plan" : "version";
    setDeliveryHash("", "", "", true);
    renderPicker();
    return;
  }
  if (act === "save") { saveNow(false); return; }
  if (act === "reset") { resetOptions(); return; }
  if (act === "lean") { leanOptions(); return; }
  if (act === "back-draft") { if (isPlanData(data)) loadPlan(planId || data.scopeId); else load(versionId); return; }
  if (act === "goto-plan-release") { openPlanRelease(); return; }
  if (act === "edit-mode") { editMode = !editMode; editingField = null; harvestEditing(); renderDoc(); return; }
  if (act === "edit-one") { startEditOne(btn.dataset.dlField); return; }
  if (act === "accept") { confirmField(btn.dataset.dlKey); markDirty(); renderDoc(); return; }
  if (act === "unconfirm") {
    unconfirmField(btn.dataset.dlKey);
    markDirty();
    renderDoc();
    toast("已撤回该段确认，导出前需要重新确认", "fs");
    return;
  }
  if (act === "goto-pending") {
    var target = document.getElementById("dl-sec-" + D().pendingSection(data));
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (act === "accept-all") {
    D().pendingFields(data).forEach(confirmField);
    markDirty();
    renderDoc();
    toast("已确认全部对外表述，导出前请再通读一遍", "fs");
    return;
  }
  if (act === "restore") {
    var f = btn.dataset.dlField;
    delete (data.narratives || {})[f];
    unconfirmField(f);
    markDirty();
    renderDoc();
    return;
  }
  if (act === "source") { openSource(btn.dataset.dlSrc); return; }
  if (act === "sources") { openSourcesOverview(); return; }
  if (act === "export") { openExport(); return; }
  if (act === "snapshots") { openSnapshots(); return; }
  if (act === "share") { openShare(); return; }
  if (act === "goto") { gotoView(btn.dataset.dlView, btn.dataset.dlRef); return; }
}
function startEditOne(field) {
  if (!data || D().locked(data) || !data.canEdit) return;
  editingField = field;
  renderDoc();
  var el = $('[data-dl-field="' + field + '"]');
  if (!el) return;
  el.focus();
  try {
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (err) { /* 选区 API 不可用时只聚焦 */ }
}
function resetOptions() {
  if (!data || D().locked(data) || !data.canEdit) return;
  var keepRelease = isPlanData(data) ? "" : ((data.options || {}).releaseId || "");
  data.options = Object.assign({}, D().DEFAULTS, { releaseId: keepRelease });
  markDirty();
  renderAll();
  toast("生成控制已重置为默认", "fs");
}
function leanOptions() {
  if (!data || D().locked(data) || !data.canEdit) return;
  Object.assign(data.options, D().leanPatch());
  markDirty();
  renderAll();
  toast("已压到最简：精简叙述 + 紧凑排版 + 分类汇总", "fs");
}
function gotoView(name, refId) {
  if (!name) { toast("该证据没有可跳转的原始记录", "warn"); return; }
  if (name === "release-plan") { openPlanRelease(refId); return; }
  if (dirty) saveNow(true);
  if (name === "board" && refId) { openTaskById(refId); return; }
  var pid = data && (data.projectId || ((data.versionChapters || [])[0] || {}).reqId);
  /* 目标页的项目定位与页签都在各自模块内部，按需拉模块再落路由，避免把低频视图拉进首屏 */
  import("../core/view-loader.js").then(function (m) {
    if (name === "phase") {
      return m.loadView("phase").then(function (mod) { mod.setPhaseProject(pid, "version"); showView("phase"); });
    }
    if (name === "demands") {
      return m.loadView("demands").then(function (mod) { mod.openDemandsForReq(pid); showView("demands"); });
    }
    if (name === "testcases" || name === "defects") {
      return m.loadView("testcases").then(function (mod) {
        if (name === "testcases" && refId) {
          mod.openPlanInProject(pid, refId);
        } else {
          mod.setTcProject(pid);
          mod.setTcMode(name === "defects" ? "defects" : "plans");
        }
        showView("testcases");
      });
    }
    showView(name);
  }).catch(function (ex) { toast(ex.message || "打开原始记录失败", "bad"); });
}
/* 下钻到版本报告：计划文档里的版本名直接落到该版本，不另开一套页面 */
/* 回到提供事实的发布计划工作台：计划维度的发布记录、范围与门禁都在那里 */
function openPlanRelease(refId) {
  var ch = data && (data.versionChapters || [])[0];
  if (!ch) { toast("计划没有覆盖版本，无法打开发布计划", "warn"); return; }
  var id = refId || (data.plan && data.plan.id) || planId;
  var run = function () {
    import("./release.js").then(function (m) {
      m.openReleasePage({ id: ch.versionId, reqId: ch.reqId, planId: id, tab: "plan" });
    }).catch(function (ex) { toast(ex.message || "打开发布计划失败", "bad"); });
  };
  if (dirty) saveNow(true).then(run); else run();
}

/* ==================== 通用弹层 ==================== */

function modal(html, wide) {
  var layer = document.createElement("div");
  layer.className = "modal-layer dl-dlg";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet ' + (wide || "md") + '">' + html + "</div>";
  /* 关闭即销毁：否则每次开合都留一份含同名 id 的旧弹层在 document 里 */
  layer.__uiOnClose = function () { setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 0); };
  document.body.appendChild(layer);
  UI.openModal(layer);
  layer.addEventListener("click", function (e) {
    if (e.target.closest("[data-dl-close]")) UI.closeModal(layer);
  });
  return layer;
}
function modalHead(title, desc) {
  return '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0"><h2>' + esc(title) + "</h2>"
    + (desc ? '<div class="desc">' + esc(desc) + "</div>" : "") + "</div>"
    + '<button class="icon-btn sm" type="button" data-dl-close aria-label="关闭">' + icon("close", 15) + "</button></div>";
}
function removeModal(layer) {
  UI.closeModal(layer);
  setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 240);
}

/* ==================== 数字来源 ==================== */

function openSource(key) {
  var s = D().sourceInfo(data, key);
  var layer = modal(modalHead(s.title, "数字只读。下面是它的口径与原始记录。")
    + '<div class="sheet-body"><div class="dl-caliber">' + esc(s.caliber) + "</div>"
    + (s.rows.length ? s.rows.map(function (x) {
      return '<div class="dl-srcrec"><span class="si">' + esc(String(x.id).slice(0, 10)) + "</span>"
        + '<div class="sc"><b>' + esc(x.m) + "</b><span>" + esc(x.s) + "</span></div></div>";
    }).join("") : '<div class="dl-missing">' + icon("infoCircle", 15) + "<div>没有可列出的原始记录。</div></div>")
    + "</div>"
    + '<div class="sheet-foot">'
    + '<button class="btn" type="button" data-dl-close>关闭</button>'
    + (s.view ? '<button class="btn primary" type="button" data-dl-src-goto>' + icon("extlink", 13) + "打开原始记录</button>" : "")
    + "</div>");
  var go = layer.querySelector("[data-dl-src-goto]");
  if (go) go.addEventListener("click", function () {
    removeModal(layer);
    gotoView(s.view, s.refId);
  });
}
function openSourcesOverview() {
  var rows = D().sourcesOverview(data);
  modal(modalHead("数据来源总览", (data.scopeName || ((data.projectName || "") + " · " + (data.versionName || ""))) + " · 全部为只读聚合")
    + '<div class="sheet-body"><div class="dl-caliber">生成过程只读：一次取回版本、承诺、发布、需求、测试、缺陷与工时，不写任何业务表；'
    + '只有「导出报告」会落一条不可变快照。</div>'
    + rows.map(function (x) {
      return '<div class="dl-srcrec"><span class="si">' + icon("layers", 12) + "</span>"
        + '<div class="sc"><b>' + esc(x.name) + "</b><span>" + esc(x.from) + "<br>" + esc(x.table) + "</span></div></div>";
    }).join("")
    + '<div class="dl-missing">' + icon("infoCircle", 15)
    + "<div>缺失处理：任何一段没有记录就显示「未记录 / 未验证」，不推断、不补造，也不阻断其余区块生成。</div></div>"
    + "</div>"
    + '<div class="sheet-foot"><span class="hint"></span><button class="btn" type="button" data-dl-close>关闭</button></div>');
}

/* ==================== 导出 ==================== */

function openExport() {
  if (!data) return;
  var doc = D(), g = doc.gates(data);
  var readWhy = isPlanData(data) ? "你对该计划覆盖的项目只有查看权限" : "你对该项目只有查看权限";
  if (!data.canSnapshot && !doc.locked(data)) { toast(readWhy + "，不能导出快照", "warn"); return; }
  if (!doc.locked(data) && !g.canExport) { toast(g.exportBlock, "warn"); return; }
  exportFmt = "pdf";
  var layer = modal(modalHead("导出交付报告", doc.locked(data) ? "当前已是不可变快照，导出不会再生成新快照。" : "导出即锁定：先冻结一份不可变快照，再产出文件。")
    + '<div class="sheet-body"><div class="dl-fmt-tabs" role="group" aria-label="导出格式">'
    + '<button type="button" data-dl-fmt="pdf" class="on">' + icon("print", 13) + " PDF（A4）</button>"
    + '<button type="button" data-dl-fmt="md">' + icon("table", 13) + " Markdown</button>"
    + '<button type="button" data-dl-fmt="html">' + icon("codeBlock", 13) + " 独立 HTML</button>"
    + "</div>"
    + '<div id="dlExportBody"></div></div>'
    + '<div class="sheet-foot"><span class="hint" id="dlExportHint"></span>'
    + '<button class="btn" type="button" data-dl-close>取消</button>'
    + '<button class="btn primary" type="button" id="dlExportGo">导出</button></div>', "wide");
  layer.__dlLayer = true;
  var refit = function () { if (exportFmt === "pdf") fitPaper(layer); };
  window.addEventListener("resize", refit);
  var destroy = layer.__uiOnClose;
  layer.__uiOnClose = function () { window.removeEventListener("resize", refit); destroy(); };
  layer.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-dl-fmt]");
    if (tab) {
      exportFmt = tab.dataset.dlFmt;
      layer.querySelectorAll("[data-dl-fmt]").forEach(function (b) { b.classList.toggle("on", b === tab); });
      paintExport(layer);
      return;
    }
    if (e.target.closest("#dlExportGo")) doExport(layer);
  });
  paintExport(layer);
}
function paintExport(layer) {
  var doc = D();
  var body = layer.querySelector("#dlExportBody");
  var hint = layer.querySelector("#dlExportHint");
  var go = layer.querySelector("#dlExportGo");
  if (exportFmt === "pdf") {
    body.innerHTML = '<div class="dl-paper-frame"><div class="dl-paper-holder"><div class="dl-paper" id="dlPaper">'
      + doc.sheetMarkup(data, { readonly: true, clean: true, a4: true, plainLinks: isPlanData(data) }) + "</div></div></div>"
      + '<p class="hint">PDF 由浏览器打印生成：在打印对话框里选「另存为 PDF」，纸张 A4、边距默认。'
      + "预览按缩放显示，实际分页以打印结果为准。</p>";
    hint.textContent = "导出后快照锁定，控制区不可再改";
    go.innerHTML = icon("print", 13) + " 冻结并打开打印";
    fitPaper(layer);
  } else if (exportFmt === "md") {
    body.innerHTML = '<pre class="dl-md-pre">' + esc(doc.markdown(data)) + "</pre>"
      + '<p class="hint">纯文本，可直接贴进邮件、IM 或知识库。</p>';
    hint.textContent = "同时提供「复制」与「下载 .md」";
    go.innerHTML = icon("download", 13) + " 冻结并下载 .md";
  } else {
    body.innerHTML = '<div class="dl-caliber">单文件 HTML：样式内联，双击即可打开，不依赖沙漏服务，也不需要登录。'
      + "适合归档或作为附件发送。</div>"
      + '<div class="dl-paper-frame"><div class="dl-paper-holder"><div class="dl-paper" id="dlPaper">'
      + doc.sheetMarkup(data, { readonly: true, clean: true, a4: true, plainLinks: isPlanData(data) }) + "</div></div></div>";
    hint.textContent = "含浅色主题令牌与打印样式";
    go.innerHTML = icon("download", 13) + " 冻结并下载 .html";
    fitPaper(layer);
  }
}
function fitPaper(layer) {
  requestAnimationFrame(function () {
    var frame = layer.querySelector(".dl-paper-frame");
    var paper = layer.querySelector("#dlPaper");
    var holder = layer.querySelector(".dl-paper-holder");
    if (!frame || !paper || !holder) return;
    /* 按预览框实际宽度缩放并居中：这份预览是导出前逐段校对用的，缩到原始纸宽会小到读不清，
       写死上限更会让宽屏上一半预览区是空白 */
    var scale = Math.min(1.5, Math.max(0.2, (frame.clientWidth - 34) / PAPER_W));
    paper.style.transform = "scale(" + scale + ")";
    holder.style.width = Math.ceil(PAPER_W * scale) + "px";
    holder.style.height = Math.ceil(paper.scrollHeight * scale) + "px";
    var hint = layer.querySelector("#dlExportHint");
    var sheet = paper.querySelector(".dl-sheet");
    /* 预览纸就是 A4 几何，直接数它，比屏幕上那张宽纸准 */
    var pages = sheet ? countPages(sheet) : 1;
    var meter = document.getElementById("dlMeterPages");
    if (meter) {
      meter.textContent = String(pages);
      meter.parentNode.className = pages > 1 ? "m-warn" : "m-ok";
    }
    if (hint) {
      hint.textContent = "约 " + pages + " 页 A4 · "
        + D().toneName(opts().tone) + " · 预览缩放 " + Math.round(scale * 100) + "%";
    }
  });
}
/* 导出统一先冻结：拿到 locked 载荷后再产出文件，接收人与编制人看到同一份 */
function freezeForExport() {
  if (D().locked(data)) return Promise.resolve(data);
  return saveNow(true).then(function () {
    return API.post(base() + "/snapshots", saveBody());
  }).then(function (resp) {
    data = resp;
    editMode = false; editingField = null; dirty = false; saveState = "saved";
    renderAll();
    toast("已冻结快照 " + (resp.docNo || "") + "，内容不再随系统变化", "fs");
    return resp;
  });
}
function doExport(layer) {
  if (busyAction) return;
  busyAction = true;
  var go = layer.querySelector("#dlExportGo");
  if (go) { go.disabled = true; go.textContent = "处理中…"; }
  var fmt = exportFmt;
  freezeForExport().then(function (snapshot) {
    var name = D().exportBaseName(snapshot);
    if (fmt === "md") {
      var md = D().markdown(snapshot);
      triggerDownload(name + ".md", md, "text/markdown;charset=utf-8");
      copyToClipboard(md, "已下载并复制 Markdown", "已下载 .md（复制失败可手动选择）");
      removeModal(layer);
      return;
    }
    if (fmt === "html") {
      return inlineCSS().then(function (css) {
        triggerDownload(name + ".html", D().htmlDocument(snapshot, css), "text/html;charset=utf-8");
        toast("已下载独立 HTML", "fs");
        removeModal(layer);
      });
    }
    removeModal(layer);
    printDeliveryPaper(D().sheetMarkup(snapshot, { readonly: true, clean: true, a4: true, plainLinks: isPlanData(snapshot) }));
    return null;
  }).catch(function (ex) {
    toast(ex && ex.message || "导出失败", "bad");
    if (go) { go.disabled = false; go.textContent = "重试导出"; }
  }).then(function () { busyAction = false; });
}
function inlineCSS() {
  return Promise.all(["css/tokens.css", "css/delivery.css"].map(function (path) {
    return fetch(path).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
  })).then(function (parts) { return parts.join("\n"); });
}

/* ==================== 快照记录 ==================== */

function openSnapshots() {
  var layer = modal(modalHead("快照记录", "每份快照都是不可变副本；系统记录再变化也不影响已发出的那一版。")
    + '<div class="sheet-body" id="dlSnapBody">' + UI.skeletonRows(3) + "</div>"
    + '<div class="sheet-foot"><span class="hint">分享链接挂在快照上，撤销分享不影响快照本身</span>'
    + '<button class="btn" type="button" data-dl-close>关闭</button></div>');
  API.get(base() + "/snapshots").then(function (rows) {
    var body = layer.querySelector("#dlSnapBody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = UI.emptyState({ icon: "layers", title: "还没有导出过快照", text: "点「导出报告」会落第一条不可变快照，并生成正式编号。" });
      return;
    }
    body.innerHTML = rows.map(function (x) {
      return '<div class="dl-snap"><span class="dl-sec-idx">' + esc(x.seq) + "</span>"
        + '<div class="sc"><b>' + esc(x.docNo) + "</b><span>"
        + esc(DD.timeText(x.createdAt) + " · " + (x.createdByName || "未记录") + " · " + DD.toneName(x.tone)
          + " · 校验值 " + String(x.contentHash || "").slice(0, 12)) + "</span></div>"
        + (x.shared ? '<span class="dl-badge pri">已分享</span>' : "")
        + '<button class="btn sm" type="button" data-dl-snap-view="' + esc(x.id) + '">查看</button>'
        + '<button class="btn sm ghost" type="button" data-dl-snap-share="' + esc(x.id) + '"'
        + ' data-dl-snap-no="' + esc(x.docNo || "") + '">' + icon("share", 12) + "分享</button>"
        + "</div>";
    }).join("");
  }).catch(function (ex) {
    var body = layer.querySelector("#dlSnapBody");
    if (body) body.innerHTML = UI.errorState(ex.message || "快照记录加载失败");
  });
  layer.addEventListener("click", function (e) {
    var v = e.target.closest("[data-dl-snap-view]");
    if (v) {
      removeModal(layer);
      API.get("/api/delivery-notes/" + encodeURIComponent(v.dataset.dlSnapView)).then(function (resp) {
        data = resp;
        resetDocState();
        renderAll();
      }).catch(function (ex) { toast(ex.message || "快照打开失败", "bad"); });
      return;
    }
    var s = e.target.closest("[data-dl-snap-share]");
    if (s) { removeModal(layer); openShare(s.dataset.dlSnapShare, s.dataset.dlSnapNo); }
  });
}

/* ==================== 分享 ==================== */

function shareURL(token) {
  var q = "token=" + encodeURIComponent(token) + "&kind=delivery";
  if (location.protocol === "file:") return "share.html?" + q;
  return location.origin + API.appBase + "/share.html?" + q;
}
function openShare(snapshotId, docNo) {
  if (!data) return;
  var doc = D(), g = doc.gates(data);
  var sid = snapshotId || data.snapshotId || "";
  if (!sid && !g.canShare) { toast(g.shareBlock || "当前不可分享", "warn"); return; }
  if (!sid && !data.canSnapshot) { toast((isPlanData(data) ? "你对该计划覆盖的项目只有查看权限" : "你对该项目只有查看权限") + "，不能生成分享链接", "warn"); return; }
  var layer = modal(modalHead("只读分享链接", sid ? "链接指向已冻结的快照，内容不会随系统变化。" : "生成链接会先冻结一份不可变快照，再对外分享。")
    + '<div class="sheet-body" id="dlShareBody">' + UI.skeletonRows(2) + "</div>"
    + '<div class="sheet-foot"><span class="hint">接收人无需登录；内部复盘版永不分享</span>'
    + '<button class="btn" type="button" data-dl-close>关闭</button></div>', "sm");
  var state = { snapshotId: sid, docNo: docNo || (sid && sid === data.snapshotId ? data.docNo : ""),
    info: null, days: 30, allowDownload: true, password: "", domains: "", watermark: "" };
  function paint() {
    var body = layer.querySelector("#dlShareBody");
    if (!body) return;
    var info = state.info;
    var has = !!(info && info.token);
    body.innerHTML = '<div class="dl-kv"><span>语气版本</span><b>' + esc(DD.toneName(opts().tone)) + "</b></div>"
      + (has ? '<div class="dl-rfield"><span class="rl">只读链接</span><div class="dl-share-url">'
        + '<input class="input" type="text" readonly value="' + esc(shareURL(info.token)) + '" aria-label="只读链接">'
        + '<button class="btn sm" type="button" data-dl-share-copy>' + icon("copy", 13) + "复制</button></div></div>"
        + '<div class="dl-kvs"><div class="dl-kvbox"><span>编号</span><strong>' + esc(info.docNo || "") + "</strong></div>"
        + '<div class="dl-kvbox"><span>有效至</span><strong>' + esc(DD.timeText(info.expiresAt)) + "</strong></div>"
        + '<div class="dl-kvbox"><span>访问次数</span><strong>' + (info.viewCount || 0) + "</strong></div>"
        + '<div class="dl-kvbox"><span>近 7 天打开</span><strong>' + (info.visits7d || 0) + "</strong></div>"
        + '<div class="dl-kvbox"><span>最近打开</span><strong>' + esc(info.lastViewedAt ? DD.timeText(info.lastViewedAt) : "—") + "</strong></div>"
        + '<div class="dl-kvbox"><span>访问密码</span><strong>' + (info.passwordRequired ? "已设置" : "无") + "</strong></div>"
        + '<div class="dl-kvbox"><span>水印</span><strong>' + esc(info.watermarkText || "无") + "</strong></div>"
        + '<div class="dl-kvbox"><span>允许下载</span><strong>' + (info.allowDownload ? "是" : "否") + "</strong></div></div>"
        + (info.allowedDomains ? '<div class="dl-caliber">来源域名提示（非访问控制，来源域名可被伪造）：' + esc(info.allowedDomains) + "</div>" : "")
        + '<div class="dl-narr-bar">'
        + '<button class="btn sm" type="button" data-dl-share-open>' + icon("extlink", 13) + "预览接收人页</button>"
        + '<button class="btn sm" type="button" data-dl-share-visits>' + icon("clock", 13) + "访问明细</button>"
        + '<button class="btn sm danger" type="button" data-dl-share-revoke>' + icon("close", 13) + "停止分享</button></div>"
        : '<div class="dl-rfield"><span class="rl">有效期</span>'
        + '<select class="select" data-dl-share-days aria-label="有效期">'
        + [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (state.days === d ? " selected" : "") + ">" + d + " 天</option>"; }).join("")
        + "</select></div>"
        + switchRow("allowDownload", "允许接收人下载 PDF", "关掉只能在线查看", state.allowDownload, false)
        + '<div class="dl-rfield"><span class="rl">访问密码</span>'
        + '<input class="input" type="text" data-dl-share-pwd maxlength="32" autocomplete="new-password"'
        + ' placeholder="留空表示无需密码（6–32 位）" value="' + esc(state.password) + '" aria-label="访问密码"></div>'
        + '<div class="dl-rfield"><span class="rl">来源域名提示</span>'
        + '<input class="input" type="text" data-dl-share-domains maxlength="480"'
        + ' placeholder="example.com, partner.com（需同时设密码；留空不限制）" value="' + esc(state.domains) + '" aria-label="来源域名提示"></div>'
        + '<div class="dl-rfield"><span class="rl">水印文字</span>'
        + '<input class="input" type="text" data-dl-share-wm maxlength="60"'
        + ' placeholder="如：客户名称 / 内部资料（留空不加水印）" value="' + esc(state.watermark) + '" aria-label="水印文字"></div>'
        + '<div class="dl-caliber">'
        + (state.snapshotId ? "将分享快照 " + esc(state.docNo || String(state.snapshotId).slice(0, 10)) + "。"
          : "尚未冻结快照：点下方按钮会先保存草稿并冻结一份不可变快照，再生成链接。")
        + "</div>"
        + '<button class="btn primary block" type="button" data-dl-share-gen>' + icon("share", 13) + "生成只读链接</button>");
  }
  layer.addEventListener("change", function (e) {
    if (e.target.dataset.dlShareDays !== undefined) state.days = Number(e.target.value);
    if (e.target.dataset.dlOpt === "allowDownload") state.allowDownload = e.target.checked;
  });
  /* 三个附加项都以文本输入，change 只在失焦时来：边输边记，避免生成时拿到旧值 */
  layer.addEventListener("input", function (e) {
    if (e.target.dataset.dlSharePwd !== undefined) state.password = e.target.value;
    else if (e.target.dataset.dlShareDomains !== undefined) state.domains = e.target.value;
    else if (e.target.dataset.dlShareWm !== undefined) state.watermark = e.target.value;
  });
  layer.addEventListener("click", function (e) {
    if (e.target.closest("[data-dl-share-copy]")) {
      copyToClipboard(shareURL(state.info.token), "链接已复制", "复制失败，请手动选择链接");
      return;
    }
    if (e.target.closest("[data-dl-share-open]")) {
      window.open(shareURL(state.info.token), "_blank", "noopener");
      return;
    }
    if (e.target.closest("[data-dl-share-visits]")) { openShareVisits(state.snapshotId, state.docNo || state.info.docNo); return; }
    if (e.target.closest("[data-dl-share-revoke]")) {
      UI.showConfirm({
        title: "停止分享", okText: "停止分享",
        msg: "已发出的链接会立即失效，接收人再打开会看到失效提示。快照本身保留。"
      }).then(function (ok) {
        if (!ok) return;
        API.del("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share").then(function () {
          state.info = null;
          toast("已停止分享", "fs");
          paint();
          refreshRevisions();
        }).catch(function (ex) { toast(ex.message || "停止分享失败", "bad"); });
      });
      return;
    }
    if (e.target.closest("[data-dl-share-gen]")) {
      if (busyAction) return;
      var pwd = String(state.password || "").trim();
      if (pwd && (pwd.length < 6 || pwd.length > 32)) { toast("访问密码需 6–32 位", "warn"); return; }
      if (!pwd && String(state.domains || "").trim()) { toast("设置来源域名时必须同时设置访问密码", "warn"); return; }
      busyAction = true;
      var btn = layer.querySelector("[data-dl-share-gen]");
      if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
      var ready = state.snapshotId ? Promise.resolve(null)
        : freezeForExport().then(function (resp) { state.snapshotId = resp.snapshotId; return resp; });
      ready.then(function () {
        return API.post("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share", {
          allowDownload: !!state.allowDownload,
          days: state.days,
          password: pwd,
          domains: String(state.domains || "").trim(),
          watermark: String(state.watermark || "").trim()
        });
      }).then(function (info) {
        state.info = info;
        toast("只读链接已生成", "fs");
        paint();
        refreshRevisions();
      }).catch(function (ex) {
        toast(ex.message || "生成链接失败", "bad");
        paint();
      }).then(function () { busyAction = false; });
    }
  });
  if (state.snapshotId) {
    API.get("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share").then(function (info) {
      state.info = info && info.token ? info : null;
      paint();
    }).catch(function () { paint(); });
  } else { paint(); }
}
/* 访问明细：只给编制方看，记录 IP / 来源域名 / 动作，便于判断链接是否被转发到白名单之外 */
function openShareVisits(snapshotId, docNo) {
  if (!snapshotId) return;
  var layer = modal(modalHead("分享访问明细", "最近 100 次打开与下载；来源域名取自浏览器的 Referer，可能为空。")
    + '<div class="sheet-body" id="dlVisitBody">' + UI.skeletonRows(4) + "</div>"
    + '<div class="sheet-foot"><span class="hint">' + esc(docNo || "") + "</span>"
    + '<button class="btn" type="button" data-dl-close>关闭</button></div>', "wide");
  API.get("/api/delivery-notes/" + encodeURIComponent(snapshotId) + "/share/visits").then(function (rows) {
    var body = layer.querySelector("#dlVisitBody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = UI.emptyState({ icon: "clock", title: "还没有访问记录", text: "接收人打开链接或下载 PDF 后会在这里留痕。" });
      return;
    }
    body.innerHTML = '<div class="dl-visit-row head"><span>时间</span><span>动作</span><span>IP</span><span>来源域名</span><span>浏览器</span></div>'
      + rows.map(function (x) {
        return '<div class="dl-visit-row"><span>' + esc(DD.timeText(x.createdAt)) + "</span>"
          + '<span>' + esc(visitActionName(x.action)) + "</span>"
          + '<span class="mono">' + esc(x.ip || "—") + "</span>"
          + '<span>' + esc(x.domain || "—") + "</span>"
          + '<span class="ua" title="' + esc(x.userAgent || "") + '">' + esc(shortUA(x.userAgent)) + "</span></div>";
      }).join("");
  }).catch(function (ex) {
    var body = layer.querySelector("#dlVisitBody");
    if (body) body.innerHTML = UI.errorState(ex.message || "访问明细加载失败");
  });
}
function visitActionName(a) {
  if (a === "unlock") return "密码打开";
  if (a === "unlock_fail") return "密码错误";
  if (a === "download") return "下载 PDF";
  return "打开";
}
function shortUA(ua) {
  var s = String(ua || "");
  if (!s) return "—";
  var os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : "";
  var br = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : /Firefox\//.test(s) ? "Firefox" : "";
  return [os, br].filter(Boolean).join(" · ") || s.slice(0, 32);
}

function refreshRevisions() {
  if (!versionId && !planId) return;
  API.get(base() + "/snapshots").then(function (rows) {
    if (data) data.revisions = rows || [];
  }).catch(function () { /* 修订记录只是附录，失败不打扰 */ });
}

export { enterDeliveryView, openDeliveryNote, openPlanDeliveryNote, refreshFromHash };