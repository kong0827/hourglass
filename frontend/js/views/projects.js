/* views/projects · 项目视图 */

import { API } from "../core/api.js";
import { $, reqExpanded, reqListEl, searchInput, searchWrap } from "../core/dom.js";
import { loadCategories } from "../core/app.js";
import { reloadFilteredViews } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { showView } from "../core/router.js";
import { canEditReq, canManageProject, reqNameById, roleReadOnly, rt, state, taskCacheExtra } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer, populateReqSelect } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { CAT_DEFAULT_COLOR, colName, docTypeName, fmtMinutesShort, fmtTs, reqStatusName, typeBadgeHTML, taskPublicationHTML } from "../lib/format.js";
import * as activityUI from "../core/activity-ui.js";
import * as listPrefs from "../core/list-preferences.js";
import { loadBoard, loadReqs } from "./board.js";
import { openDemandsForReq } from "./demands.js";
import { loadReqDocs, openNewReqDocDialog, openReqDocAndJump, reqDocList, reqDocStatusLabel, setReqDocProjectFilter } from "./requirements.js";

registerHelp({
  "projects.progress": {
    title:"项目进度",
    rows:[
      ["怎么算", "项目全部工作项完成度的平均值：已完成的工作项按 100% 计，其余按各自的进度值计，没填进度按 0。", "ok"],
      ["不是完成数占比", "和旁边「N 工作项 · M 完成」不是同一口径。例：1 个完成 + 1 个 90%，进度约 95%，而不是 50%。", "warn"],
      ["不加权", "不按预估工时加权，长任务和短任务的权重相同。", "info"]
    ]
  }
});
initCaliberHelp();

var rName = $("rName"), rDesc = $("rDesc"), fReqName = $("fReqName"),
    rObjective = $("rObjective"), rOwner = $("rOwner"), rPlanStart = $("rPlanStart"), rPlanEnd = $("rPlanEnd"),
    segReqStatus = $("segReqStatus"), btnSaveReq = $("btnSaveReq"),
    btnCancelReqEdit = $("btnCancelReqEdit"), reqFormTitle = $("reqFormTitle"),
    rTemplate = $("rTemplate"), rTemplateHint = $("rTemplateHint"), fReqTemplate = $("fReqTemplate"),
    rSet = $("rSet"),
    projMemberSec = $("projMemberSec"), projMemberCfg = $("projMemberCfg"), projMemberList = $("projMemberList"),
    projCatCfg = $("projCatCfg"), projCatList = $("projCatList"),
    projReleasePolicy = $("projReleasePolicy"), rReleasePolicy = $("rReleasePolicy"),
    projCatNewName = $("projCatNewName"), projCatNewColor = $("projCatNewColor"),
    btnProjectSetNew = $("btnProjectSetNew"),
    psName = $("psName"), psDesc = $("psDesc"), psOwner = $("psOwner"), psColor = $("psColor"),
    psPlanStart = $("psPlanStart"), psPlanEnd = $("psPlanEnd"), psStatus = $("psStatus"),
    btnSaveProjectSet = $("btnSaveProjectSet"), projectSetFormTitle = $("projectSetFormTitle");
var showArchived = false;
/* 列表范围 / 分组 / 搜索：与原型 toolbar 一一对应，只影响列表，不改项目数据 */
var projScope = "all", projGroupMode = "set", projKeyword = "";
/* 项目集折叠：只影响本项目列表的展示，不影响筛选与统计 */
var setCollapsed = {};
try{ setCollapsed = JSON.parse(localStorage.getItem("hg.setCollapsed") || "{}") || {}; }catch(e){ setCollapsed = {}; }
function saveSetCollapsed(){
  try{ localStorage.setItem("hg.setCollapsed", JSON.stringify(setCollapsed)); }catch(e){ /* 隐私模式下忽略 */ }
}
var PROJECT_SORT_DEFAULT_DIR = {
  name:"asc", status:"asc", description:"asc", ownerName:"asc", plannedEnd:"asc",
  taskCount:"desc", doneCount:"desc", progress:"desc", docCount:"desc",
  firstReleasedAt:"desc", createdAt:"desc", updatedAt:"desc"
};
var PROJECT_STATUS_ORDER = { active:0, done:1, hold:2 };
var projectSort = { key:"", dir:"asc" };
var policySeq = 0;
function loadReleasePolicy(reqId){
  if(!projReleasePolicy || !rReleasePolicy) return;
  var seq = ++policySeq;
  projReleasePolicy.hidden = false;
  rReleasePolicy.disabled = true;
  API.get("/api/projects/" + encodeURIComponent(reqId) + "/release-policy").then(function(policy){
    if(seq !== policySeq || rt.editingReqId !== reqId) return;
    rReleasePolicy.value = policy || "standard";
    rReleasePolicy.dataset.saved = rReleasePolicy.value;
    rReleasePolicy.disabled = false;
  }).catch(function(){
    if(seq !== policySeq) return;
    projReleasePolicy.hidden = true;
  });
}
function visibleReqs(){
  var kw = String(projKeyword || "").trim().toLowerCase();
  var me = rt.currentUser && rt.currentUser.id;
  return rt.reqList.filter(function(r){
    if(!showArchived && r.archivedAt) return false;
    if(projScope === "mine" && (!me || r.ownerUserId !== me)) return false;
    if(kw && String(r.name || "").toLowerCase().indexOf(kw) === -1) return false;
    return true;
  });
}
function archivedCount(){
  return rt.reqList.filter(function(r){ return !!r.archivedAt; }).length;
}
/* 页头范围：标题右边给出「N 个 · M 组」，与原型保持一致；
   项目集 / 项目入口落在页头右侧，工具栏只保留筛选与视图切换 */
function groupCountOf(list){
  var seen = {}, n = 0, loose = false;
  list.forEach(function(r){
    if(!r.setId){ loose = true; return; }
    if(!seen[r.setId]){ seen[r.setId] = 1; n++; }
  });
  return n + (loose ? 1 : 0);
}
function syncProjectsPageHead(list){
  var t = $("pageTitleText");
  if(t) t.textContent = "项目";
  var pill = $("pagePill");
  if(pill){
    pill.hidden = false;
    pill.textContent = list.length + " 个 · " + groupCountOf(list) + " 组";
  }
  var sub = $("pageSub");
  if(sub) sub.textContent = ((rt.currentWs && rt.currentWs.name) ? rt.currentWs.name + " / " : "") + "项目";
  var acts = $("pageActions");
  if(acts){
    var html = (canManageSets() ? '<button class="btn" type="button" data-proj-new-set>新建项目集</button>' : "")
      + '<button class="btn primary" type="button" data-proj-new>' + icon("plus", 14) + '新建项目</button>';
    if(acts.dataset.projActs !== html){
      acts.dataset.projActs = html;
      acts.innerHTML = html;
    }
    acts.hidden = false;
  }
  var nw = $("newWrap");
  if(nw) nw.hidden = true;
}
function projectSortValue(r, key){
  if(key === "name" || key === "description") return r[key] || null;
  if(key === "status") return Object.prototype.hasOwnProperty.call(PROJECT_STATUS_ORDER, r.status) ? PROJECT_STATUS_ORDER[r.status] : null;
  if(key === "ownerName") return ownerLabelOf(r) || null;
  if(key === "taskCount" || key === "doneCount" || key === "docCount") return Number(r[key]) || 0;
  if(key === "progress") return Number(r.progressPct) || 0;
  if(key === "plannedEnd" || key === "firstReleasedAt" || key === "createdAt" || key === "updatedAt") return r[key] || null;
  return null;
}
function compareProjects(a, b){
  var x = projectSortValue(a, projectSort.key), y = projectSortValue(b, projectSort.key);
  if(x === null && y === null) return 0;
  if(x === null) return 1;
  if(y === null) return -1;
  var result = typeof x === "number" && typeof y === "number"
    ? x - y
    : String(x).localeCompare(String(y), "zh-Hans-CN");
  if(result) return projectSort.dir === "desc" ? -result : result;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
    || String(a.id || "").localeCompare(String(b.id || ""));
}
function sortedProjects(rows){
  return projectSort.key ? rows.slice().sort(compareProjects) : rows;
}
/* 手动排序：空间主/管理员可拖；列排序是临时视图，此时不提供拖拽 */
function canReorderProjects(){
  var role = rt.currentWs && rt.currentWs.myRole;
  return role === "owner" || role === "admin";
}
function reorderEnabled(){
  return canReorderProjects() && !projectSort.key;
}
function reqDragHTML(id){
  return '<button class="req-drag" type="button" draggable="true" data-req-drag="' + esc(id) +
    '" title="拖动调整项目顺序" aria-label="拖动调整项目顺序">' + icon("grip", 14) + '</button>';
}
function setDragHTML(id){
  return '<button class="req-drag set-drag" type="button" draggable="true" data-set-drag="' + esc(id) +
    '" title="拖动调整项目集顺序" aria-label="拖动调整项目集顺序">' + icon("grip", 14) + '</button>';
}
var dragState = null, orderSaving = false;
function listedReqs(){
  return rt.reqList.filter(function(r){ return showArchived || !r.archivedAt; });
}
function clearDropMarks(){
  reqListEl.querySelectorAll(".drop-before,.drop-after,.drop-into").forEach(function(el){
    el.classList.remove("drop-before", "drop-after", "drop-into");
  });
}
function endProjectDrag(){
  dragState = null;
  clearDropMarks();
  reqListEl.querySelectorAll(".dragging").forEach(function(el){ el.classList.remove("dragging"); });
  document.body.classList.remove("proj-reordering");
  document.body.classList.remove("proj-drag-project");
}
/* 只把可见项目按新顺序回填，已归档（当前未显示）的项目保持原位置 */
function mergeVisibleOrder(all, visibleIds){
  var byId = {};
  all.forEach(function(r){ byId[r.id] = r; });
  var out = [], k = 0;
  all.forEach(function(r){
    if(showArchived || !r.archivedAt) out.push(byId[visibleIds[k++]] || r);
    else out.push(r);
  });
  return out;
}
function applyProjectDrop(drag, targetId, after){
  if(!drag || drag.id === targetId || orderSaving) return;
  var ids = drag.order.slice();
  var from = ids.indexOf(drag.id);
  if(from < 0) return;
  ids.splice(from, 1);
  var to = ids.indexOf(targetId);
  if(to < 0) return;
  ids.splice(after ? to + 1 : to, 0, drag.id);
  var before = rt.reqList.slice();
  var next = mergeVisibleOrder(before, ids);
  rt.reqList = next;
  renderReqList();
  orderSaving = true;
  API.put("/api/reqs/order", { ids: next.map(function(r){ return r.id; }) }).then(function(){
    orderSaving = false;
    /* 工作项抽屉、看板筛选等下拉都按 rt.reqList 渲染，保存成功后同步一次 */
    populateReqSelect();
    toast("项目顺序已保存", "fs");
  }).catch(function(ex){
    orderSaving = false;
    rt.reqList = before;
    renderReqList();
    toast("顺序保存失败：" + ((ex && ex.message) || "网络异常"), "bad");
  });
}
function setProjectSort(key){
  if(!Object.prototype.hasOwnProperty.call(PROJECT_SORT_DEFAULT_DIR, key)) return;
  if(projectSort.key !== key){
    projectSort.key = key;
    projectSort.dir = PROJECT_SORT_DEFAULT_DIR[key];
  }else if(projectSort.dir === PROJECT_SORT_DEFAULT_DIR[key]){
    /* 同列再点一次切方向，第三次回到手动顺序（拖拽排序只在手动顺序下可用） */
    projectSort.dir = projectSort.dir === "desc" ? "asc" : "desc";
  }else{
    projectSort.key = "";
    projectSort.dir = "asc";
  }
  renderReqList();
}
function syncArchivedToggle(){
  var btn = $("btnShowArchived");
  if(!btn) return;
  var n = archivedCount();
  if(!n && showArchived) showArchived = false;
  btn.hidden = !n && !showArchived;
  btn.textContent = showArchived ? "隐藏已归档" : "显示已归档" + (n ? "（" + n + "）" : "");
  btn.setAttribute("aria-pressed", showArchived ? "true" : "false");
  btn.classList.toggle("soft", showArchived);
}
function syncOwnerOptions(){
  if(!rOwner) return;
  var current = rOwner.value;
  rOwner.innerHTML = '<option value="">未指定</option>' + (rt.wsMembersCache || []).map(function(m){
    return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
  }).join("");
  rOwner.value = current || "";
}
/* ---------- 新建项目：初始成员（只复用 project_member，不新增字段） ---------- */
var projMemberSeq = 0;
var projMemberSel = {};
/* ready / loading / error：空列表要区分「正在加载」「加载失败」和「空间里确实没有其他人」 */
var projMemberState = "ready";
function memberLabel(m){
  return m.displayName || m.username || m.userId;
}
function syncProjectMembers(createMode){
  projMemberSeq++;
  projMemberSel = {};
  var show = !!createMode && !!(rt.currentWs && rt.currentWs.type === "shared");
  if(projMemberSec) projMemberSec.hidden = !show;
  if(projMemberCfg) projMemberCfg.hidden = !show;
  if(!projMemberList) return;
  if(!show){ projMemberList.innerHTML = ""; projMemberState = "ready"; return; }
  var cached = (rt.wsMembersCache || []).length > 0;
  projMemberState = cached ? "ready" : "loading";
  renderProjectMembers();
  if(cached) return;
  var seq = projMemberSeq, wsId = rt.currentWs.id;
  API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/members").then(function(list){
    if(seq !== projMemberSeq || !rt.currentWs || rt.currentWs.id !== wsId) return;
    rt.wsMembersCache = list || [];
    projMemberState = "ready";
    renderProjectMembers();
  }).catch(function(){
    if(seq !== projMemberSeq) return;
    projMemberState = "error";
    renderProjectMembers();
  });
}
function projectMemberRows(){
  var meId = rt.currentUser && rt.currentUser.id;
  return (rt.wsMembersCache || []).filter(function(m){
    return m && m.userId && m.userId !== meId;
  });
}
function renderProjectMembers(){
  if(!projMemberList) return;
  var rows = projectMemberRows();
  if(!rows.length){
    projMemberList.innerHTML = projMemberState === "loading"
      ? '<p class="foot-note">正在加载空间成员…</p>'
      : '<p class="foot-note">' + (projMemberState === "error"
          ? '成员列表加载失败，可关闭后重试；创建后也可在成员名册里按项目分配。'
          : '空间里还没有其他成员；创建后也可在成员名册里按项目分配。') + '</p>';
    return;
  }
  projMemberList.innerHTML = rows.map(function(m){
    var viewer = m.role === "viewer";
    var picked = Object.prototype.hasOwnProperty.call(projMemberSel, m.userId);
    /* 查看者只能只读：服务端也会把越权提交收敛为 read，这里直接锁死选项，避免界面与保存结果不一致 */
    var access = picked ? (viewer ? "read" : projMemberSel[m.userId]) : (viewer ? "read" : "write");
    return '<div class="proj-member-row" data-member-id="' + esc(m.userId) + '">' +
      '<label class="proj-member-pick">' +
        '<input type="checkbox" data-member-toggle' + (picked ? " checked" : "") + ' />' +
        '<span class="proj-member-name">' + esc(memberLabel(m)) + '</span>' +
        (viewer ? '<span class="proj-member-role">查看者</span>' : '') +
      '</label>' +
      '<select data-member-access aria-label="' + esc(memberLabel(m)) + ' 的项目权限"' +
        (picked && !viewer ? "" : " disabled") + '>' +
        (viewer ? '<option value="read" selected>只读</option>'
                : '<option value="write"' + (access === "write" ? " selected" : "") + '>可参与</option>' +
                  '<option value="read"' + (access === "read" ? " selected" : "") + '>只读</option>') +
      '</select>' +
    '</div>';
  }).join("");
}
function projectMemberPayload(){
  return Object.keys(projMemberSel).map(function(id){
    return { userId: id, access: projMemberSel[id] };
  });
}
function focusMemberToggle(id){
  if(!projMemberList) return;
  var rows = projMemberList.querySelectorAll("[data-member-id]");
  for(var i = 0; i < rows.length; i++){
    if(rows[i].dataset.memberId === id){
      var cb = rows[i].querySelector("[data-member-toggle]");
      if(cb) cb.focus();
      return;
    }
  }
}
if(projMemberList){
  projMemberList.addEventListener("change", function(e){
    var row = e.target.closest("[data-member-id]");
    if(!row) return;
    var id = row.dataset.memberId;
    var hit = projectMemberRows().filter(function(m){ return m.userId === id; })[0];
    if(e.target.matches("[data-member-toggle]")){
      if(e.target.checked) projMemberSel[id] = hit && hit.role === "viewer" ? "read" : "write";
      else delete projMemberSel[id];
      renderProjectMembers();
      /* 勾选会整块重绘：把焦点还给同一行，键盘连续勾选不丢位置 */
      focusMemberToggle(id);
      return;
    }
    if(e.target.matches("[data-member-access]") && Object.prototype.hasOwnProperty.call(projMemberSel, id)){
      projMemberSel[id] = (!hit || hit.role !== "viewer") && e.target.value === "write" ? "write" : "read";
    }
  });
}
function ownerLabelOf(r){
  if(!r.ownerUserId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === r.ownerUserId; })[0];
  return hit ? (hit.displayName || hit.username || r.ownerUserId) : (r.ownerName || r.ownerUserId);
}
/* 项目集负责人只用于展示：优先成员名，查不到时回退后端给的原值 */
function setOwnerLabel(set){
  if(!set || !set.ownerUserId) return "";
  var hit = (rt.wsMembersCache || []).filter(function(m){ return m.userId === set.ownerUserId; })[0];
  return hit ? (hit.displayName || hit.username || set.ownerUserId) : (set.ownerName || set.ownerUserId);
}
function planRange(r){
  if(!r.plannedStart && !r.plannedEnd) return "";
  return (r.plannedStart ? String(r.plannedStart).slice(0, 10) : "未定") + " → " + (r.plannedEnd ? String(r.plannedEnd).slice(0, 10) : "未定");
}
/* ---------- 项目集：可选归组，不改变任何项目权限 ---------- */
function canManageSets(){
  var role = rt.currentWs && rt.currentWs.myRole;
  return role === "owner" || role === "admin";
}
function loadProjectSets(){
  return API.get("/api/project-sets").then(function(list){
    rt.projectSets = list || [];
    syncProjectSetOptions();
    if(btnProjectSetNew) btnProjectSetNew.hidden = !canManageSets();
    renderReqList();
    return rt.projectSets;
  }).catch(function(){
    rt.projectSets = [];
    syncProjectSetOptions();
    if(btnProjectSetNew) btnProjectSetNew.hidden = !canManageSets();
    return rt.projectSets;
  });
}
function syncProjectSetOptions(){
  if(rSet){
    var current = rSet.value;
    rSet.innerHTML = '<option value="">未分组</option>' + (rt.projectSets || []).map(function(s){
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join("");
    rSet.value = current || "";
  }
  if(psOwner){
    var owner = psOwner.value;
    psOwner.innerHTML = '<option value="">未指定</option>' + (rt.wsMembersCache || []).map(function(m){
      return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.username || m.userId) + '</option>';
    }).join("");
    psOwner.value = owner || "";
  }
}
function projectSetById(id){
  if(!id) return null;
  for(var i = 0; i < (rt.projectSets || []).length; i++) if(rt.projectSets[i].id === id) return rt.projectSets[i];
  return null;
}
var SET_COLOR_RE = /^#[0-9a-f]{6}$/i;
function projectSetColor(set){
  return set && SET_COLOR_RE.test(String(set.color || "")) ? String(set.color) : "";
}
/* 方案 B：身份色只投到左条 / 色标图标 / 树线，不铺整行底色 */
function projectSetColorStyle(set){
  var c = projectSetColor(set);
  return c ? ' style="--set:' + c + '"' : "";
}
function projectSetColorStyleOf(setId){
  return projectSetColorStyle(projectSetById(setId));
}
/* 项目集展示顺序：sortOrder 为主，同名兜底，和列表分组、下拉分组保持一致 */
function orderedSets(){
  return (rt.projectSets || []).slice().sort(function(a, b){
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
      || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
  });
}
function projectSetSummary(rows){
  var tasks = 0, done = 0, weighted = 0, mvp = 0, post = 0, onTimeSum = 0, onTimeN = 0, docs = 0, released = null;
  var risk = { overdue:0, blocked:0, stagnant:0 };
  rows.forEach(function(r){
    var t = Number(r.taskCount) || 0;
    tasks += t;
    done += Number(r.doneCount) || 0;
    weighted += (Number(r.progressPct) || 0) * t;
    mvp += Number(r.mvpWorkMinutes) || 0;
    post += Number(r.postWorkMinutes) || 0;
    docs += Number(r.docCount) || 0;
    var rk = projectRiskByReq[r.id];
    if(rk){
      risk.overdue += rk.overdue || 0;
      risk.blocked += rk.blocked || 0;
      risk.stagnant += rk.stagnant || 0;
    }
    /* 集不生成发布记录：首版上线日取集内项目最早的一次，仅作只读汇总 */
    if(r.firstReleasedAt){
      var d = String(r.firstReleasedAt).slice(0, 10);
      if(!released || d < released) released = d;
    }
    if(r.onTimePct !== null && r.onTimePct !== undefined){ onTimeSum += Number(r.onTimePct); onTimeN++; }
  });
  return {
    tasks:tasks, done:done, pct: tasks ? Math.round(weighted / tasks) : 0,
    mvp:mvp, post:post, docs:docs, firstReleasedAt:released,
    onTimePct: onTimeN ? Math.round(onTimeSum / onTimeN) : null,
    risk:risk
  };
}
/* 项目集风险条：与「逾期与阻塞」页同源，只做集级汇总，不改变任何项目状态 */
var projectRiskByReq = {};
var projectRiskWs = "";
var projectRiskAt = 0;
var projectRiskLoading = false;
function loadProjectRisks(){
  var ws = rt.currentWs;
  if(!ws || ws.type !== "shared") return;
  var wsId = ws.id, stale = projectRiskWs !== wsId || Date.now() - projectRiskAt > 60000;
  if(!stale || projectRiskLoading) return;
  projectRiskLoading = true;
  API.get("/api/manager/risks").then(function(data){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    var map = {}, fields = ["overdue", "blocked", "stagnant"];
    fields.forEach(function(kind){
      (data && data[kind] || []).forEach(function(t){
        if(!t || !t.reqId) return;
        var row = map[t.reqId] || (map[t.reqId] = { overdue:0, blocked:0, stagnant:0 });
        row[kind]++;
      });
    });
    projectRiskByReq = map;
    projectRiskWs = wsId;
    projectRiskAt = Date.now();
    renderReqList();
  }).catch(function(){
    /* 无权限或接口异常：不显示风险条，不影响项目列表 */
    projectRiskByReq = {};
    projectRiskWs = wsId;
    projectRiskAt = Date.now();
  }).then(function(){ projectRiskLoading = false; });
}
function riskStripHTML(risk){
  if(!risk || (!risk.overdue && !risk.blocked && !risk.stagnant)) return "";
  var tip = "集内未完成工作项的风险，点击查看逾期与阻塞明细";
  return '<button class="req-set-risk" type="button" data-set-risk title="' + tip + '" aria-label="' + tip + '">' +
    (risk.overdue ? '<span class="risk-chip overdue">逾期 ' + risk.overdue + '</span>' : '') +
    (risk.blocked ? '<span class="risk-chip blocked">阻塞 ' + risk.blocked + '</span>' : '') +
    (risk.stagnant ? '<span class="risk-chip stagnant">停滞 ' + risk.stagnant + '</span>' : '') +
  '</button>';
}
/* 集内顺序沿用全局顺序，但容器项目（拆分后的公共项目）固定排最后并弱化 */
function sortSetRows(rows){
  return rows.slice().sort(function(a, b){
    return (a.containerKind ? 1 : 0) - (b.containerKind ? 1 : 0);
  });
}
function groupedProjects(list){
  /* 平铺：保持同一份卡片结构，只是不插入项目集表头 */
  if(projGroupMode === "flat" || !(rt.projectSets || []).length){
    return [{ set:null, rows:list, ungrouped:true, header:false }];
  }
  var buckets = {};
  list.forEach(function(r){
    var key = r.setId || "";
    (buckets[key] = buckets[key] || []).push(r);
  });
  var groups = [];
  orderedSets().forEach(function(s){
    var rows = buckets[s.id] || [];
    /* 空集也渲染表头：管理员新建后要能马上看到并编辑/删除；非管理员的空集后端已过滤 */
    if(rows.length || canManageSets()) groups.push({ set:s, rows:sortSetRows(rows), ungrouped:false, header:true });
  });
  var ungrouped = buckets[""] || [];
  if(ungrouped.length) groups.push({ set:null, rows:ungrouped, ungrouped:true, header:true });
  return groups;
}
function projectSetHeadHTML(group){
  var set = group.set, rows = group.rows, agg = projectSetSummary(rows);
  var manage = canManageSets() && set;
  var title = set ? esc(set.name) : "未分组";
  var key = set ? set.id : "__un";
  var collapsed = !!setCollapsed[key];
  return '<div class="req-set-head proj-set-head' + (set ? "" : " is-ungrouped") + '"' + projectSetColorStyle(set) +
      ' data-set-key="' + esc(key) + '"' + (set ? ' data-set-id="' + esc(set.id) + '"' : '') + '>' +
    '<button class="icon-btn sm req-set-toggle' + (collapsed ? "" : " on") + '" type="button" data-set-toggle="' + esc(key) + '" aria-expanded="' + (!collapsed) + '" title="' + (collapsed ? "展开" : "收起") + '">' + icon("chevronRight", 14) + '</button>' +
    '<span class="req-set-title"><span class="req-set-ico" aria-hidden="true">' + icon("folder", 14) + '</span><b>' + title + '</b></span>' +
    (set && set.status && set.status !== "active"
      ? '<span class="tag tag-ghost">' + esc(reqStatusName(set.status)) + '</span>' : '') +
    '<span class="req-set-meta">' + rows.length + ' 个项目 · ' + agg.tasks + ' 工作项 · ' + agg.done + ' 完成'
      + (agg.mvp + agg.post ? ' · 首版 ' + fmtMinutesShort(agg.mvp) + ' · 迭代 ' + fmtMinutesShort(agg.post) : '')
      + '</span>' +
    riskStripHTML(agg.risk) +
    '<span class="progress mini req-set-progress" title="集内项目按工作项数加权的完成度"><span class="bar"><i style="width:' + agg.pct + '%"></i></span><span class="pv">' + agg.pct + '%</span></span>' +
    (manage ? '<span class="req-set-acts">' +
      (canReorderSets() ? setDragHTML(set.id) : "") +
      '<button class="icon-btn sm" type="button" data-set-edit="' + esc(set.id) + '" title="编辑项目集" aria-label="编辑项目集">' + icon("edit", 14) + '</button>' +
      '<button class="icon-btn sm danger" type="button" data-set-del="' + esc(set.id) + '" title="删除项目集（项目移回未分组）" aria-label="删除项目集">' + icon("trash", 14) + '</button>' +
    '</span>' : '') +
  '</div>';
}
/* 表格视图：项目集行与项目行共用同一套列网格。
   集自身只存状态、负责人、计划起止；工作项数 / 完成数 / 文档数 / 首版上线日
   是集内项目的只读汇总（首版取最早一次），不生成集级发布记录。 */
function projectSetNameCell(group, agg){
  var set = group.set;
  var key = set ? set.id : "__un";
  var collapsed = !!setCollapsed[key];
  return '<span class="project-name-wrap set-name-cell">' +
    '<span class="set-name-line">' +
      '<button class="icon-btn sm req-set-toggle' + (collapsed ? "" : " on") + '" type="button" data-set-toggle="' + esc(key) + '" aria-expanded="' + (!collapsed) + '" title="' + (collapsed ? "展开" : "收起") + '">' + icon("chevronRight", 14) + '</button>' +
      '<span class="req-set-title"><span class="req-set-ico" aria-hidden="true">' + icon("folder", 14) + '</span><b>' + (set ? esc(set.name) : "未分组") + '</b></span>' +
    '</span>' +
    '<span class="req-set-meta">' + group.rows.length + ' 个项目'
      + (agg.mvp + agg.post ? ' · 首版 ' + fmtMinutesShort(agg.mvp) + ' · 迭代 ' + fmtMinutesShort(agg.post) : '')
      + '</span>' +
    riskStripHTML(agg.risk) +
  '</span>';
}
function projectSetCell(group, key, agg){
  var set = group.set;
  if(key === "name") return projectSetNameCell(group, agg);
  if(key === "description") return '<span class="project-cell" title="' + esc((set && set.description) || "") + '">' + esc((set && set.description) || "—") + '</span>';
  if(key === "status"){
    return set
      ? '<span><span class="tag tag-' + (set.status === "done" ? "success" : (set.status === "hold" ? "ghost" : "info")) + '">' + esc(reqStatusName(set.status || "active")) + '</span></span>'
      : '<span class="project-cell">—</span>';
  }
  if(key === "ownerName"){
    var owner = setOwnerLabel(set);
    return '<span class="project-cell" title="' + esc(owner || "集负责人只用于展示，不据此获得维护权") + '">' + esc(owner || "—") + '</span>';
  }
  if(key === "plannedEnd"){
    var ps = set && set.plannedStart ? String(set.plannedStart).slice(0, 10) : "";
    var pe = set && set.plannedEnd ? String(set.plannedEnd).slice(0, 10) : "";
    var range = (ps || pe) ? (ps || "未定") + " → " + (pe || "未定") : "";
    return '<span class="project-cell"' + (range ? ' title="集计划 ' + esc(range) + '"' : '') + '>' + esc(pe || "—") + '</span>';
  }
  if(key === "taskCount") return '<span class="project-cell">' + agg.tasks + '</span>';
  if(key === "doneCount") return '<span class="project-cell">' + agg.done + '</span>';
  if(key === "progress") return '<span class="progress mini" title="集内项目按工作项数加权的完成度"><span class="bar"><i style="width:' + agg.pct + '%"></i></span><span class="pv">' + agg.pct + '%</span></span>';
  if(key === "docCount") return '<span class="project-cell" title="集内项目文档合计">' + agg.docs + '</span>';
  if(key === "firstReleasedAt") return '<span class="project-cell" title="' + (agg.firstReleasedAt ? "集内项目最早的首版上线日" : "集内项目都还没有首版上线") + '">' + esc(agg.firstReleasedAt || "—") + '</span>';
  if(key === "createdAt" || key === "updatedAt") return '<span class="project-cell">' + (set && set[key] ? esc(fmtTs(set[key])) : "—") + '</span>';
  return '<span class="project-cell">—</span>';
}
function projectSetActions(group){
  var set = group.set;
  if(!set || !canManageSets()) return '<span class="project-row-acts"></span>';
  return '<span class="project-row-acts">' +
    (canReorderSets() ? setDragHTML(set.id) : "") +
    '<button class="icon-btn sm" type="button" data-set-edit="' + esc(set.id) + '" title="编辑项目集" aria-label="编辑项目集">' + icon("edit", 14) + '</button>' +
    '<button class="icon-btn sm danger" type="button" data-set-del="' + esc(set.id) + '" title="删除项目集（项目移回未分组）" aria-label="删除项目集">' + icon("trash", 14) + '</button>' +
  '</span>';
}
function projectSetRowHTML(group, cols){
  var set = group.set, agg = projectSetSummary(group.rows);
  return '<div class="project-table-row project-set-row' + (set ? "" : " is-ungrouped") + '"' + projectSetColorStyle(set) +
      ' data-set-key="' + esc(set ? set.id : "__un") + '"' + (set ? ' data-set-id="' + esc(set.id) + '"' : '') + '>' +
    cols.map(function(key){ return projectSetCell(group, key, agg); }).join("") +
    projectSetActions(group) +
  '</div>';
}
var projectTemplates = null;
function loadProjectTemplates(){
  if(projectTemplates) return Promise.resolve(projectTemplates);
  return API.get("/api/project-templates").then(function(list){
    projectTemplates = list || [];
    if(rTemplate){
      rTemplate.innerHTML = projectTemplates.map(function(t){
        return '<option value="' + esc(t.code) + '">' + esc(t.name) + '</option>';
      }).join("");
      rTemplate.value = "blank";
      syncTemplateHint();
    }
    return projectTemplates;
  }).catch(function(){ projectTemplates = []; return projectTemplates; });
}
function syncTemplateHint(){
  if(!rTemplate || !rTemplateHint) return;
  var hit = (projectTemplates || []).filter(function(t){ return t.code === rTemplate.value; })[0];
  var parts = [];
  if(hit && hit.columns && hit.columns.length) parts.push("列：" + hit.columns.join(" / "));
  if(hit && hit.docs && hit.docs.length) parts.push("文档：" + hit.docs.join(" / "));
  if(hit && hit.modules && hit.modules.length) parts.push("测试分类：" + hit.modules.join(" / "));
  if(hit && hit.versionName) parts.push("默认版本：" + hit.versionName);
  rTemplateHint.textContent = parts.length
    ? "将补充 " + parts.join("；") + "。只补缺失项，不覆盖已有内容。"
    : (hit && hit.description) || "只创建项目本身，后续按需补充";
}
function syncTemplateField(){
  if(!fReqTemplate) return;
  fReqTemplate.hidden = !!rt.editingReqId;
}
var projectTasks = {}, projectTaskErrors = {}, projectTaskSeq = {};
function loadProjectTasks(reqId, force){
  if(!force && projectTasks[reqId]) return Promise.resolve(projectTasks[reqId]);
  var current = (projectTaskSeq[reqId] || 0) + 1;
  projectTaskSeq[reqId] = current;
  projectTasks[reqId] = null;
  delete projectTaskErrors[reqId];
  return API.getAllPages("/api/projects/" + encodeURIComponent(reqId) + "/tasks").then(function(rows){
    if(projectTaskSeq[reqId] !== current) return rows;
    projectTasks[reqId] = rows || [];
    if(reqExpanded[reqId]) renderReqList();
    return rows;
  }).catch(function(ex){
    if(projectTaskSeq[reqId] === current){
      projectTaskErrors[reqId] = ex.message || "工作项加载失败";
      if(reqExpanded[reqId]) renderReqList();
    }
    throw ex;
  });
}
function projectTasksHTML(reqId){
  var rows = projectTasks[reqId], error = projectTaskErrors[reqId];
  if(error) return '<div class="tl-empty">' + esc(error) + ' <button class="link-btn" type="button" data-project-task-retry="' + esc(reqId) + '">重试</button></div>';
  if(!rows) return '<div class="tl-empty">工作项加载中…</div>';
  if(!rows.length) return '<p class="foot-note" style="margin:4px 0">该项目还没有工作项。</p>';
  return rows.map(function(t){
    var status = t.boardColumn === "done" ? "已完成" : colName(t.boardColumn);
    var pub = taskPublicationHTML(t);
    return '<button class="req-expand-doc" type="button" data-project-task-open="' + esc(t.id) + '">'
      + '<span class="rd-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</span>'
      + '<span class="rd-meta">' + esc(status) + ' · ' + esc(t.owner || "未指派")
      + (t.dueDate ? ' · 截止 ' + esc(String(t.dueDate).substring(0, 10)) : '')
      + (pub ? ' ' + pub : '') + '</span></button>';
  }).join("");
}
function refreshExpandedProjectTasks(){
  Object.keys(reqExpanded).forEach(function(reqId){
    if(reqExpanded[reqId]) loadProjectTasks(reqId, true).catch(function(){});
  });
}
function syncReqStatusSeg(){
  segReqStatus.querySelectorAll("[data-rst]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.rst === rt.formReqStatus);
  });
}
var projectFormBaseline = null;
/* 一次打开对应一个序号：关掉 A 再打开 B 后，A 迟到的保存响应不能关闭/清空 B；
   editingReqUpdatedAt 是打开时的版本令牌，服务端据此拒绝覆盖别人刚保存的修改 */
var projectFormSeq = 0, editingReqUpdatedAt = null;
function projectFormSnapshot(){
  return JSON.stringify([
    rName.value, rDesc.value,
    rObjective ? rObjective.value : "",
    rOwner ? rOwner.value : "",
    rPlanStart ? rPlanStart.value : "",
    rPlanEnd ? rPlanEnd.value : "",
    rSet ? rSet.value : "",
    /* 模板列表异步到达后会把空值自动落成 blank；把「未加载」和「默认模板」归一，
       否则打开侧板后模板晚到会被误判成已修改，关闭时莫名弹「放弃修改」 */
    (rTemplate && rTemplate.value) || "blank",
    rt.formReqStatus,
    projectMemberPayload().map(function(g){ return g.userId + ":" + g.access; }).sort().join(",")
  ]);
}
function projectFormDirty(){
  return !!projectFormBaseline && projectFormSnapshot() !== projectFormBaseline;
}
/* X、Esc、遮罩、取消编辑与路由切换都走这里，避免误关闭丢失填写内容 */
function tryCloseProjectDialog(afterClose){
  function finish(){
    resetReqForm();
    if(afterClose) afterClose();
  }
  if(!projectFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: "项目信息还没有保存，关闭后填写的内容会丢失。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) finish(); });
}
function resetReqForm(){
  projectFormBaseline = null;
  projectFormSeq++;
  rt.editingReqId = null;
  editingReqUpdatedAt = null;
  projCatReqId = "";
  btnSaveReq.disabled = false;
  rName.value = ""; rDesc.value = "";
  if(rObjective) rObjective.value = "";
  if(rOwner) rOwner.value = "";
  if(rPlanStart) rPlanStart.value = "";
  if(rPlanEnd) rPlanEnd.value = "";
  if(rSet) rSet.value = "";
  rt.formReqStatus = "active";
  fReqName.classList.remove("invalid");
  if($("fReqPlanStart")) $("fReqPlanStart").classList.remove("invalid");
  if($("fReqPlanEnd")) $("fReqPlanEnd").classList.remove("invalid");
  syncReqStatusSeg();
  reqFormTitle.textContent = "新建项目";
  btnSaveReq.textContent = "新建项目";
  btnCancelReqEdit.hidden = true;
  syncTemplateField();
  syncProjectMembers(false);
  if($("dlgProject")) UI.closeModal($("dlgProject"));
  if(projReleasePolicy) projReleasePolicy.hidden = true;
  policySeq++;
  renderReqList();
}
/* 共享空间里成员 / 只读成员看到空列表，多半是还没被分配项目，而不是空间里真的没有项目 */
function emptyProjectsState(){
  var ws = rt.currentWs;
  var role = ws && ws.type !== "personal" ? ws.myRole : "";
  /* 查看者全局只读、不受项目级范围限制：列表为空只可能是空间里还没有项目 */
  if(role === "viewer"){
    return UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"你在此空间是查看者，空间主或管理员创建项目后会显示在这里。"
    });
  }
  if(role === "member"){
    return UI.emptyState({
      icon:"folder", title:"暂无可见项目",
      text:"你还没有被分配到任何项目，可联系空间主或管理员分配；也可以点右上角「新建项目」自己创建。"
    });
  }
  return UI.emptyState({
    icon:"folder", title:"还没有项目",
    text:"点右上角「新建项目」创建第一个；展开项目可以查看文档与工作项进度。"
  });
}
/* 项目卡：首版上线标记 + 首版 / 迭代投入条，口径与版本页阶段卡一致
   工时构成用阶段色（首版 primary / 迭代 info，蓝色两档）并带「工时」标签，与上面主色的进度条分开，
   避免两条同色细条被读成「两个进度」；某阶段为 0 时图例点收成描边，不占阶段色。 */
function reqReleaseBadgeHTML(r){
  if(!r.firstReleasedAt) return '<span class="tag tag-ghost" title="在版本页标记首版上线后，可查看首版 / 迭代拆分">未标记首版</span>';
  return '<span class="tag tag-info" title="首版上线日">首版 ' + esc(String(r.firstReleasedAt).slice(5, 10).replace("-", "/")) + '</span>';
}
function reqPhaseHTML(r){
  var mvp = Number(r.mvpWorkMinutes) || 0, post = Number(r.postWorkMinutes) || 0, total = mvp + post;
  var onTime = (r.onTimePct === null || r.onTimePct === undefined)
    ? "" : '<span class="req-phase-ontime" title="按带截止日期的已完成工作项统计">准时 <b>' + Number(r.onTimePct) + '%</b></span>';
  if(!total) return onTime ? '<div class="req-phase"><span class="req-phase-k">工时</span><span class="req-phase-none">暂无计时</span>' + onTime + '</div>' : "";
  /* 两段都有工时就让两段都留出像素，否则 1% 的迭代会被四舍五入成 0 而整条是首版色 */
  var mvpPct = Math.min(100 - (post ? 1 : 0), Math.max(mvp ? 1 : 0, Math.round(mvp / total * 100)));
  var postPct = 100 - mvpPct;
  var mvpText = fmtMinutesShort(mvp), postText = post ? fmtMinutesShort(post) : "—";
  return '<div class="req-phase">' +
    '<span class="req-phase-k">工时</span>' +
    '<span class="req-phase-bar" role="img" aria-label="工时构成：首版 ' + esc(mvpText) + '，迭代 ' + esc(postText) + '" title="工时构成 · 首版 ' + esc(mvpText) + ' · 迭代 ' + esc(postText) + '">' +
      '<i class="m" style="width:' + mvpPct + '%"></i>' +
      (post ? '<i class="p" style="width:' + postPct + '%"></i>' : '') +
    '</span>' +
    '<span class="req-phase-lg">' +
      '<span class="k m">首版 <b>' + esc(mvpText) + '</b></span>' +
      '<span class="k p' + (post ? '' : ' zero') + '">迭代 <b>' + esc(postText) + '</b></span>' + onTime +
    '</span>' +
  '</div>';
}
/* 顶部汇总：与原型一致，列表口径的只读汇总 */
function renderReqSumm(list){
  var el = $("reqSumm");
  if(!el) return;
  if(!list.length){
    el.hidden = true; el.innerHTML = "";
    if($("projNoRelBanner")) $("projNoRelBanner").hidden = true;
    return;
  }
  var agg = projectSetSummary(list);
  var noRel = list.filter(function(r){ return !r.firstReleasedAt; }).length;
  var releasedN = list.length - noRel;
  var riskN = list.filter(function(r){
    var rk = projectRiskByReq[r.id];
    return !!(rk && (rk.overdue || rk.blocked || rk.stagnant));
  }).length;
  var banner = $("projNoRelBanner");
  if(banner){
    banner.hidden = !noRel;
    if(noRel) $("projNoRelText").innerHTML = "<b>" + noRel + " 个项目未标记首版</b>，导致首版投入与准时率无法统计。";
  }
  /* 首版未标齐就不给一个看似完整的投入数：写清原因并就地给出口；
     准时率还需要足够的已交付版本才有统计意义，不足 3 个同样留空 */
  var mvpValue = noRel ? "—" : fmtMinutesShort(agg.mvp);
  var mvpFoot = noRel
    ? noRel + ' 个未标记首版 · <button class="link-btn" type="button" data-proj-mark-mvp>去标记</button>'
    : "已全部标记";
  var onTimeValue = (noRel || releasedN < 3 || agg.onTimePct === null) ? "—" : agg.onTimePct + "%";
  var onTimeFoot = (noRel || releasedN < 3) ? "需至少 3 个已交付版本" : "按带截止日期的已完成工作项";
  var cells = [
    { k:"项目", v:esc(String(list.length)), foot:esc(groupCountOf(list) + " 个分组") },
    { k:"首版投入", v:esc(mvpValue), cls:noRel ? "is-zero" : "", foot:mvpFoot },
    { k:"迭代投入", v:esc(fmtMinutesShort(agg.post)), foot:"窗口内 · 近 4 周" },
    { k:"准时完成率", v:esc(onTimeValue), cls:onTimeValue === "—" ? "is-zero" : "", foot:onTimeFoot },
    { k:"风险项目", v:esc(String(riskN)), cls:riskN ? "is-warn" : "", foot:"逾期或超载", title:"逾期 / 阻塞 / 停滞的项目数" }
  ];
  el.hidden = false;
  el.innerHTML = cells.map(function(s){
    return '<div class="stat"><div class="stat-k">' + esc(s.k) + '</div>' +
      '<div class="stat-v' + (s.cls ? " " + s.cls : "") + '"' + (s.title ? ' title="' + esc(s.title) + '"' : '') + '>' + s.v + '</div>' +
      '<div class="stat-sub">' + s.foot + '</div></div>';
  }).join("");
}
/* 拖拽中的「移出项目集」落点：平时隐藏，开始拖动后才出现 */
function ungroupedDropZoneHTML(){
  if(!reorderEnabled() || !(rt.projectSets || []).length) return "";
  return '<div class="proj-set-drop-end" data-set-drop-ungrouped>' +
    icon("folder", 14) + '<span>拖到这里移出项目集（未分组）</span></div>';
}
function renderReqList(){
  var list = sortedProjects(visibleReqs());
  var countEl = $("reqCount");
  if(countEl) countEl.textContent = list.length ? "共 " + list.length + " 个" : "";
  syncProjectsPageHead(list);
  renderReqSumm(list);
  syncArchivedToggle();
  document.querySelectorAll("[data-project-mode]").forEach(function(b){
    var on = b.dataset.projectMode === listPrefs.viewMode("project-list");
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  document.querySelectorAll("[data-proj-scope]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.projScope === projScope ? "true" : "false");
  });
  document.querySelectorAll("[data-proj-group]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.projGroup === projGroupMode ? "true" : "false");
  });
  var searchEl = $("projSearch");
  if(searchEl && document.activeElement !== searchEl) searchEl.value = projKeyword;
  if($("btnProjectColumns")) $("btnProjectColumns").hidden = listPrefs.viewMode("project-list") !== "table";
  if(!list.length){
    reqListEl.className = "req-list";
    reqListEl.innerHTML = (projKeyword.trim() || projScope === "mine")
      ? UI.emptyState({ icon:"search", title:"没有匹配的项目", text:"换个关键词，或把范围切回「全部」。" })
      : (showArchived || !archivedCount()) ? emptyProjectsState() : UI.emptyState({
        icon:"folder", title:"全部项目已归档",
        text:"点上方「显示已归档」查看或恢复已归档项目。"
      });
    return;
  }
  if(listPrefs.viewMode("project-list") === "table"){
    renderProjectTable(list);
    return;
  }
  reqListEl.className = "req-list is-cards";
  /* 卡片对齐原型：名称 / 状态、计划与负责人、进度条、计数与百分比四行；
     描述、工时构成、新建工作项等低频内容收进展开区，避免每张卡都把列表撑高 */
  function reqItemHTML(r){
    var open = !!reqExpanded[r.id];
    var readOnly = r.access === "read";
    var docs = (reqDocList || []).filter(function(d){ return d.reqId === r.id; });
    var docHTML = docs.length ? docs.map(function(d){
      return '<button class="req-expand-doc" type="button" data-reqdoc-open="' + esc(d.id) + '">' +
        '<span class="rd-title">' + esc(d.title) + '</span>' +
        '<span class="rd-meta">' + esc(docTypeName(d.docType)) + ' · ' + esc(reqDocStatusLabel(d.status)) +
          (Number(d.taskCount) ? (" · " + Number(d.doneCount || 0) + "/" + Number(d.taskCount) + " 工作项") : "") +
        '</span></button>';
    }).join("") : '<p class="foot-note" style="margin:4px 0">还没有文档。</p>';
    var rk = projectRiskByReq[r.id] || {};
    var overdue = Number(rk.overdue) || 0;
    var pct = Math.max(0, Math.min(100, Number(r.progressPct) || 0));
    var total = Number(r.taskCount) || 0, done = Number(r.doneCount) || 0;
    var range = planRange(r), owner = ownerLabelOf(r);
    var barColor = r.status === "done" ? "var(--success)" : (overdue ? "var(--warning)" : "");
    return '<div class="req-item' + (rt.editingReqId === r.id ? " editing" : "") +
        (open ? " is-open" : "") +
        (!total ? " is-empty" : "") +
        (r.setId ? " req-item-in-set" : "") +
        (r.containerKind ? " req-item-container" : "") + '" data-req-id="' + esc(r.id) + '" data-set-id="' + esc(r.setId || "") + '"' +
        projectSetColorStyleOf(r.setId) +
        (r.containerKind ? ' title="拆分后的公共容器：承接版本、发布与文档"' : '') + '>' +
      '<div class="req-top">' +
        '<button class="req-name req-name-btn" type="button" data-req-cockpit="' + esc(r.id) + '" title="打开项目驾驶舱">' + esc(r.name) + '</button>' +
        '<span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' +
          reqStatusName(r.status) + '</span>' +
        reqReleaseBadgeHTML(r) +
        (r.archivedAt ? '<span class="tag tag-ghost" title="已归档：默认视图隐藏">已归档</span>' : '') +
        (r.containerKind ? '<span class="tag tag-ghost" title="承接版本、发布与文档的公共容器">公共</span>' : '') +
        (readOnly ? '<span class="tag tag-ghost" title="你对该项目只有查看权限">只读</span>' : '') +
        '<span class="req-acts">' +
          (reorderEnabled() ? reqDragHTML(r.id) : "") +
          '<button class="icon-btn sm req-expand-btn' + (open ? " on" : "") + '" type="button" data-req-expand="' + esc(r.id) + '" aria-expanded="' + open + '" title="展开项目详情">' +
            icon("chevronRight", 14) + '</button>' +
          '<button class="icon-btn sm" type="button" data-project-more="' + esc(r.id) + '" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">' + icon("more", 14) + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="pf-meta-line" title="计划起止 · 项目负责人">' +
        '<span>' + esc(range || "未排期") + '</span><span aria-hidden="true">·</span><span>负责人 ' + esc(owner || "—") + '</span>' +
      '</div>' +
      '<div class="pf-prog" role="img" aria-label="完成度 ' + pct + '%"><i style="width:' + pct + '%' + (barColor ? ";background:" + barColor : "") + '"></i></div>' +
      '<div class="pf-foot"><span>' + done + ' / ' + total + ' 工作项</span>' +
        (overdue ? '<span class="pf-pct over" title="该项目未完成工作项中已逾期 ' + overdue + ' 项">' + overdue + ' 项逾期</span>'
          : '<span class="pf-pct">' + pct + '%</span>') + '</div>' +
      (open ? '<div class="req-expand" data-req-expand-body="' + esc(r.id) + '">' +
        '<section class="req-expand-section pf-expand-summary">' +
          (r.description ? '<div class="req-desc">' + esc(r.description) + '</div>' : '') +
          '<div class="req-meta">' +
            '<span class="req-meta-k">进度</span>' +
            '<span class="progress" style="width:140px"><span class="bar"><i style="width:' + pct +
              '%;background:' + (r.status === "done" ? "var(--success)" : "var(--primary)") + '"></i></span></span>' +
            '<span style="font-weight:600;color:var(--text-2)">' + pct + '%</span>' +
            caliberMarkHTML("projects.progress", false, "查看「项目进度」口径") +
            '<span>' + total + ' 工作项 · ' + done + ' 完成' +
              (Number(r.docCount) ? (' · ' + r.docCount + ' 文档') : '') + '</span>' +
          '</div>' +
          reqPhaseHTML(r) +
          (function(){
            var bits = [];
            if(r.ownerUserId) bits.push('<span class="req-profile-item"><i class="req-profile-label">负责人</i>' + esc(ownerLabelOf(r)) + '</span>');
            if(range) bits.push('<span class="req-profile-item"><i class="req-profile-label">计划</i>' + esc(range) + '</span>');
            if(r.objective) bits.push('<span class="req-profile-item req-profile-goal" title="' + esc(r.objective) + '"><i class="req-profile-label">目标</i>' + esc(r.objective) + '</span>');
            return bits.length ? '<div class="req-profile">' + bits.join("") + '</div>' : '';
          })() +
          (readOnly ? '' : '<div class="req-taskbar">' +
            '<button class="req-quick-trigger" type="button" data-req-quick="' + esc(r.id) + '">＋ 新建工作项</button>' +
            '<input type="text" maxlength="60" data-req-new-input="' + esc(r.id) + '"' +
              ' placeholder="在此项目下新建工作项，回车确认" aria-label="在项目 ' + esc(r.name) + ' 下新建工作项" />' +
          '</div>') +
        '</section>' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>文档</span>' +
            (readOnly ? '' : '<button class="btn sm add" type="button" data-doc-new="' + esc(r.id) + '">+ 新建文档</button>') + '</div>' +
          '<div class="req-expand-docs">' + docHTML + '</div>' +
        '</section>' +
        '<section class="req-expand-section">' +
          '<div class="req-expand-head"><span>工作项</span>' +
            (readOnly ? '' : '<button class="btn sm add" type="button" data-req-open="' + esc(r.id) + '">+ 新建工作项</button>') + '</div>' +
          '<div class="req-expand-tasks">' + projectTasksHTML(r.id) + '</div>' +
        '</section>' +
        '<div class="req-expand-acts">' +
          '<button class="btn sm primary" type="button" data-req-board="' + esc(r.id) + '">在看板中查看</button>' +
          '<button class="btn sm" type="button" data-req-demands="' + esc(r.id) + '">查看需求池</button>' +
          '<button class="btn sm" type="button" data-req-docs="' + esc(r.id) + '">管理文档</button>' +
        '</div>' +
      '</div>' : '') +
    '</div>';
  }
  var groups = groupedProjects(list);
  reqListEl.innerHTML = groups.map(function(g){
    var collapsed = g.header && setCollapsed[g.set ? g.set.id : "__un"];
    return (g.header ? projectSetHeadHTML(g) : "") + (collapsed ? "" : g.rows.map(reqItemHTML).join(""));
  }).join("") + ungroupedDropZoneHTML();
}
var PROJECT_WIDTHS = { name:"minmax(180px,1fr)", status:"90px", description:"minmax(180px,1.2fr)", ownerName:"110px", plannedEnd:"120px", taskCount:"76px", doneCount:"76px", progress:"140px", docCount:"76px", firstReleasedAt:"120px", createdAt:"140px", updatedAt:"140px" };
function projectGrid(el){
  var widths = listPrefs.columns("project-list").map(function(key){ return PROJECT_WIDTHS[key] || "120px"; });
  el.style.gridTemplateColumns = widths.concat(["132px"]).join(" ");
}
function projectCell(r, key){
  if(key === "name"){
    var nameHTML = '<button class="project-cell project-name-cell req-name-btn" type="button" data-req-cockpit="' + esc(r.id) + '" title="打开项目驾驶舱：' + esc(r.name) + '">' + esc(r.name) + '</button>' +
      (r.containerKind ? '<span class="tag tag-ghost" title="承接版本、发布与文档的公共容器">公共</span>' : '');
    return '<span class="project-name-wrap">' + (reorderEnabled() ? reqDragHTML(r.id) : "") + nameHTML + '</span>';
  }
  if(key === "status") return '<span><span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' + esc(reqStatusName(r.status)) + '</span></span>';
  if(key === "description") return '<span class="project-cell" title="' + esc(r.description || "") + '">' + esc(r.description || "—") + '</span>';
  if(key === "ownerName") return '<span class="project-cell" title="' + esc(ownerLabelOf(r) || "") + '">' + esc(ownerLabelOf(r) || "—") + '</span>';
  if(key === "plannedEnd") return '<span class="project-cell">' + (r.plannedEnd ? esc(String(r.plannedEnd).slice(0, 10)) : "—") + '</span>';
  if(key === "taskCount") return '<span class="project-cell">' + (Number(r.taskCount) || 0) + '</span>';
  if(key === "doneCount") return '<span class="project-cell">' + (Number(r.doneCount) || 0) + '</span>';
  if(key === "progress") return '<span class="progress mini" title="工作项完成度：已完成记 100%，其余取记录进度"><span class="bar"><i style="width:' + Math.max(0, Math.min(100, Number(r.progressPct) || 0)) + '%"></i></span><span class="pv">' + (Number(r.progressPct) || 0) + '%</span></span>';
  if(key === "docCount") return '<span class="project-cell">' + (Number(r.docCount) || 0) + '</span>';
  if(key === "firstReleasedAt") return '<span class="project-cell">' + (r.firstReleasedAt ? esc(String(r.firstReleasedAt).slice(0, 10)) : "—") + '</span>';
  if(key === "createdAt" || key === "updatedAt") return '<span class="project-cell">' + (r[key] ? esc(fmtTs(r[key])) : "—") + '</span>';
  return '<span class="project-cell">—</span>';
}
/* 行操作只留三个入口：新建工作项（主）、在看板中查看、更多。
   其余动作收进「更多」菜单并带文字，避免一排图标需要逐个悬停才知道作用。 */
function projectActions(r){
  var readOnly = r.access === "read";
  return '<span class="project-row-acts">' +
    (readOnly ? '' :
      '<button class="icon-btn sm proj-act-primary" type="button" data-req-open="' + esc(r.id) + '" title="新建工作项" aria-label="新建工作项">' + icon("plus", 14) + '</button>') +
    '<button class="icon-btn sm" type="button" data-req-board="' + esc(r.id) + '" title="在看板中查看" aria-label="在看板中查看">' + icon("board", 14) + '</button>' +
    '<button class="icon-btn sm" type="button" data-project-more="' + esc(r.id) + '" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">' + icon("more", 14) + '</button>' +
  '</span>';
}
function closeProjectRowMenu(menu){
  if(menu && menu.parentNode) menu.remove();
  var open = document.querySelector('[data-project-more][aria-expanded="true"]');
  if(open) open.setAttribute("aria-expanded", "false");
}
function openProjectRowMenu(anchor, reqId){
  if(anchor.getAttribute("aria-expanded") === "true"){ UI.closeAllPops(); return; }
  var r = rt.reqList.filter(function(x){ return x.id === reqId; })[0];
  if(!r || !anchor) return;
  var readOnly = r.access === "read", isOwner = rt.currentWs && rt.currentWs.myRole === "owner";
  var menu = document.createElement("div");
  menu.className = "menu proj-row-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "项目操作");
  menu.innerHTML = [
    '<button class="menu-item" type="button" role="menuitem" data-proj-act="board">' + icon("board", 14) + '在看板中查看</button>',
    '<button class="menu-item" type="button" role="menuitem" data-proj-act="demands">' + icon("demand", 14) + '查看需求池</button>',
    '<button class="menu-item" type="button" role="menuitem" data-proj-act="docs">' + icon("folder", 14) + '管理文档</button>',
    readOnly ? '' : '<button class="menu-item" type="button" role="menuitem" data-proj-act="doc-new">' + icon("projects", 14) + '新建文档</button>',
    '<button class="menu-item" type="button" role="menuitem" data-proj-act="activity">' + icon("clock", 14) + '活动轨迹</button>',
    '<div class="menu-sep"></div>',
    readOnly ? '' : '<button class="menu-item" type="button" role="menuitem" data-proj-act="archive">' + icon("inbox", 14) + (r.archivedAt ? "取消归档" : "归档项目") + '</button>',
    readOnly ? '' : '<button class="menu-item" type="button" role="menuitem" data-proj-act="edit">' + icon("edit", 14) + '编辑项目</button>',
    isOwner ? '<button class="menu-item danger" type="button" role="menuitem" data-proj-act="delete">' + icon("trash", 14) + '删除项目</button>' : ''
  ].join("");
  menu.addEventListener("click", function(e){
    var b = e.target.closest("[data-proj-act]");
    if(!b) return;
    e.stopPropagation();
    var act = b.dataset.projAct;
    UI.closeAllPops();
    if(act === "board"){ toBoardForProject(reqId); return; }
    if(act === "demands"){ openDemandsForReq(reqId); showView("demands"); toast("已按项目筛选需求池：" + reqNameById(reqId)); return; }
    if(act === "docs"){ setReqDocProjectFilter(reqId); showView("requirements"); return; }
    if(act === "doc-new"){
      if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
      openNewReqDocDialog(reqId); return;
    }
    if(act === "activity"){
      activityUI.openDialog(r.name || "项目", "/api/projects/" + encodeURIComponent(reqId) + "/activities");
      return;
    }
    if(act === "archive"){ toggleArchive(reqId); return; }
    if(act === "edit"){
      if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
      openProjectDialog(reqId); return;
    }
    if(act === "delete") deleteReq(reqId);
  });
  document.body.appendChild(menu);
  anchor.setAttribute("aria-expanded", "true");
  UI.openPop(menu, anchor, { align:"right", width:176, onClose: function(){ closeProjectRowMenu(menu); } });
}
function toBoardForProject(reqId){
  state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.tags = []; state.types = []; state.columns = []; state.completion = ""; state.due = null; state.focus = false; state.blocked = false;
  searchInput.value = "";
  searchWrap.classList.remove("has");
  state.reqs = [reqId];
  showView("board");
  reloadFilteredViews();
  toast("已按项目筛选看板：" + reqNameById(reqId));
}
function renderProjectTable(list){
  list = list || visibleReqs();
  var cols = listPrefs.columns("project-list"), labels = listPrefs.labels("project-list");
  reqListEl.className = "req-list project-table-wrap";
  reqListEl.innerHTML = '<div class="project-table">' +
    '<div class="project-table-head">' + cols.map(function(key){
      var active = projectSort.key === key;
      var ind = active ? (projectSort.dir === "desc" ? "↓" : "↑") : "";
      var hint = active
        ? (projectSort.dir === PROJECT_SORT_DEFAULT_DIR[key] ? "切换排序方向（再点一次恢复手动顺序）" : "恢复手动顺序")
        : "按「" + labels[key] + "」排序";
      return '<span' + (key === "progress" ? ' class="th-help-wrap"' : "") +
        ' aria-sort="' + (active ? (projectSort.dir === "desc" ? "descending" : "ascending") : "none") + '">' +
        '<button class="lh-sort' + (active ? " on" : "") + '" type="button" data-project-sort="' + esc(key) + '"' +
          ' title="' + esc(hint) + '">' + esc(labels[key]) +
          '<i class="lh-ind" aria-hidden="true">' + ind + '</i></button>' +
          (key === "progress" ? caliberMarkHTML("projects.progress", false, "查看「项目进度」口径") : "") +
        '</span>';
    }).join("") + '<span>操作</span></div>' +
    '<div class="project-table-body">' + groupedProjects(list).map(function(g){
      var collapsed = g.header && setCollapsed[g.set ? g.set.id : "__un"];
      return (g.header ? projectSetRowHTML(g, cols) : "") + (collapsed ? "" : g.rows.map(function(r){
        return '<div class="project-table-row' + (r.setId ? " has-set" : "") + '" data-req-id="' + esc(r.id) + '" data-set-id="' + esc(r.setId || "") + '"' + projectSetColorStyleOf(r.setId) + '>' + cols.map(function(key){ return projectCell(r, key); }).join("") + projectActions(r) + '</div>';
      }).join(""));
    }).join("") + ungroupedDropZoneHTML() + '</div></div>';
  var head = reqListEl.querySelector(".project-table-head");
  if(head) projectGrid(head);
  reqListEl.querySelectorAll(".project-table-row").forEach(projectGrid);
}
function enterProjectsView(){
  loadProjectTemplates();
  syncProjectSetOptions();
  if(btnProjectSetNew) btnProjectSetNew.hidden = !canManageSets();
  syncProjectsPageHead(visibleReqs());
  loadProjectSets();
  if(rt.reqsLoaded) renderReqList();
  else reqListEl.innerHTML = UI.skeletonRows(3);
  listPrefs.load("project-list").then(renderReqList);
  loadReqs();
  loadProjectRisks();
  /* IA-2：项目行展开要显示文档与任务进度 */
  loadReqDocs().then(function(){ renderReqList(); });
  refreshExpandedProjectTasks();
}
function saveReq(){
  if(btnSaveReq.disabled) return;
  var name = rName.value.trim();
  if(!name){
    fReqName.classList.add("invalid");
    try{ rName.focus(); }catch(e){ /* noop */ }
    return;
  }
  if(!validateReqPlanDates()){
    try{ (rPlanEnd || rPlanStart).focus(); }catch(e){ /* noop */ }
    return;
  }
  var body = {
    name: name,
    description: rDesc.value.trim(),
    objective: rObjective ? rObjective.value.trim() : "",
    ownerUserId: rOwner ? (rOwner.value || null) : null,
    plannedStart: rPlanStart && rPlanStart.value ? rPlanStart.value : null,
    plannedEnd: rPlanEnd && rPlanEnd.value ? rPlanEnd.value : null,
    setId: rSet ? (rSet.value || "") : "",
    status: rt.formReqStatus
  };
  var editing = !!rt.editingReqId;
  if(!editing){
    body.template = (rTemplate && rTemplate.value) || "blank";
    /* 初始成员只在新建时提交；编辑项目的成员范围仍走成员名册 */
    body.members = projectMemberPayload();
  }
  else if(editingReqUpdatedAt) body.updatedAt = editingReqUpdatedAt;
  var seq = projectFormSeq;
  var p = editing ? API.put("/api/reqs/" + encodeURIComponent(rt.editingReqId), body) : API.post("/api/reqs", body);
  btnSaveReq.disabled = true;
  p.then(function(){
    toast(editing ? ("已更新项目「" + name + "」") : ("已新建项目「" + name + "」"), "fs");
    if(seq === projectFormSeq) resetReqForm();
    /* 新建项目后端会预置默认分类，分类字典要立即刷新，否则任务抽屉/筛选举不到 */
    if(!editing) loadCategories(true);
    loadReqs().then(function(){
      renderReqList();
      loadBoard({silent:true});
    });
  }).catch(function(ex){
    if(seq === projectFormSeq) btnSaveReq.disabled = false;
    toast(ex.message || "保存失败", "bad");
    /* 409：项目已被别人修改，刷新列表让下次打开拿到最新内容 */
    if(ex.code === 409) loadReqs().then(function(){ renderReqList(); });
  });
}
function toggleArchive(id){
  var r = null;
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
  if(!r) return;
  var archiving = !r.archivedAt;
  function apply(){
    API.put("/api/reqs/" + encodeURIComponent(id) + "/archive?archived=" + archiving).then(function(){
      toast(archiving ? "已归档「" + r.name + "」，可在「显示已归档」中恢复" : "已取消归档「" + r.name + "」", "fs");
      return loadReqs();
    }).then(function(){
      renderReqList();
      loadBoard({silent:true});
    }).catch(function(ex){ toast("操作失败：" + (ex.message || "网络异常"), "bad"); });
  }
  if(!archiving){ apply(); return; }
  UI.showConfirm({
    title: "归档项目",
    msg: "归档「" + esc(r.name) + "」后将从默认项目列表与项目切换器中隐藏，工作项与文档数据完整保留，可随时恢复。",
    danger: false,
    okText: "归档"
  }).then(function(ok){ if(ok) apply(); });
}
function deleteReq(id){
  var r = null;
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
  if(!r) return;
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可删除项目", "warn"); return; }
  /* A5 删除保护：确认文案改用后端 /delete-impact 的准确统计（含测试用例），
     接口失败时退回列表快照数值；服务端还会强制 confirm=项目名 二次校验。 */
  var liveDocs = (reqDocList || []).filter(function(d){ return d.reqId === id; }).length;
  var fallback = {
    unlinked: Number(r.taskCount) || 0,
    docs: Math.max(Number(r.docCount) || 0, liveDocs),
    versions: Number(r.versionCount) || 0,
    demands: Number(r.demandCount) || 0,
    cases: Number(r.caseCount) || 0
  };
  API.get("/api/reqs/" + encodeURIComponent(id) + "/delete-impact").then(function(imp){
    return imp || fallback;
  }).catch(function(){ return fallback; }).then(function(impact){
    var docs = impact.docs, versions = impact.versions, demands = impact.demands, cases = impact.cases;
    var msg = "删除项目「" + esc(r.name) + "」？其下工作项会保留，仅解除关联（回收站中的工作项也会一并解除）。";
    if(docs || versions || demands || cases){
      msg += "<br><br>以下数据会一并删除，<b>不可恢复</b>：";
      var parts = [];
      if(docs) parts.push("<b>" + docs + "</b> 份文档");
      if(versions) parts.push("<b>" + versions + "</b> 个版本");
      if(demands) parts.push("<b>" + demands + "</b> 条需求池记录");
      if(cases) parts.push("<b>" + cases + "</b> 条测试用例（含执行记录与测试计划）");
      msg += parts.join("、") + "。";
    }
    UI.showConfirm({
      title:"删除项目",
      msg: msg,
      okText: (docs || versions || demands || cases) ? "删除项目及关联数据" : "删除项目"
    }).then(function(ok){
      if(!ok) return;
      /* 二次确认：输入项目名才可删，防误点（项目删除不可恢复） */
      UI.showPrompt({
        title: "确认删除项目",
        desc: "此操作不可恢复。请输入项目名「" + r.name + "」以确认删除。",
        label: "项目名",
        okText: "确认删除"
      }).then(function(v){
      if(v === null) return;
      if(v !== r.name){ toast("项目名不匹配，未删除", "warn"); return; }
      API.del("/api/reqs/" + encodeURIComponent(id) + "?confirm=" + encodeURIComponent(r.name)).then(function(res){
        var deletedDocs = res && typeof res.docs === "number" ? res.docs : docs;
        var extras = [];
        if(deletedDocs) extras.push(deletedDocs + " 份文档");
        if(res && res.versions) extras.push(res.versions + " 个版本");
        if(res && res.demands) extras.push(res.demands + " 条需求池记录");
        if(res && res.cases) extras.push(res.cases + " 条测试用例");
        toast("已删除项目「" + r.name + "」，其下工作项已解除关联" +
          (res && res.unlinked ? "（" + res.unlinked + " 项）" : "") +
          (extras.length ? "；同时删除 " + extras.join("、") : ""), "fs");
        if(rt.editingReqId === id) resetReqForm();
        loadReqDocs(true);
        /* 项目的分类清单随删除一并清理，分类字典要立即刷新 */
        loadCategories(true);
        loadReqs().then(function(){
          renderReqList();
          loadBoard({silent:true});
        });
      }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
      });
    });
  });
}
/* ---------- 项目抽屉 · 分类配置（分类按项目配置，仅编辑已有项目时展示） ---------- */
var projCatCache = [];
var projCatReqId = "";
function loadProjCats(reqId){
  var forReq = reqId || "";
  projCatReqId = forReq;
  if(projCatList) projCatList.innerHTML = UI.skeletonRows(2);
  return API.get("/api/categories?project=" + encodeURIComponent(forReq)).then(function(list){
    /* 已切到另一个项目：旧项目的分类不能填进新弹窗（否则排序/新增会写错项目） */
    if(projCatReqId !== forReq) return;
    projCatCache = list || [];
    renderProjCats();
  }).catch(function(ex){
    if(projCatReqId !== forReq) return;
    if(projCatList) projCatList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderProjCats(){
  if(!projCatList) return;
  /* 写成员即可建、改名、排序；删除仍限空间主 / 管理员 / 项目负责人 */
  var canWrite = !!projCatReqId && canEditReq(projCatReqId);
  var readOnly = !canWrite;
  var canDel = !!projCatReqId && canManageProject(projCatReqId);
  projCatList.innerHTML = projCatCache.map(function(c, idx){
    return '<div class="cfg-row" data-proj-cat-id="' + esc(c.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(c.color || CAT_DEFAULT_COLOR) + '" data-pcat-color aria-label="分类颜色"' + (readOnly ? " disabled" : "") + ' />' +
      '<input type="text" value="' + esc(c.name) + '" maxlength="12" data-pcat-name aria-label="分类名称"' + (readOnly ? " disabled" : "") + ' />' +
      '<button class="cc-act" type="button" data-pcat-up title="上移"' + (readOnly || idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-pcat-down title="下移"' + (readOnly || idx === projCatCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
      '<button class="cc-act dan" type="button" data-pcat-del title="' + (canDel ? "删除分类" : "仅空间主、管理员或项目负责人可删除分类") + '"' + (canDel ? "" : " disabled") + '>' + icon("trash", 14) + '</button>' +
    '</div>';
  }).join("");
  ["projCatNewColor", "projCatNewName", "btnProjCatAdd"].forEach(function(id){
    var el = $(id);
    if(el) el.disabled = readOnly;
  });
  /* 能写但不能删时也给出提示，说明删除权限的边界 */
  if($("projCatHint")) $("projCatHint").hidden = canDel;
  UI.wireTooltips(projCatList);
}
function refreshCatDependents(){
  loadCategories(true);
  loadBoard({silent:true});
}
function saveProjCatRow(id){
  if(roleReadOnly()) return;
  var row = projCatList.querySelector('[data-proj-cat-id="' + id + '"]');
  if(!row) return;
  var name = row.querySelector("[data-pcat-name]").value.trim();
  var color = row.querySelector("[data-pcat-color]").value;
  if(!name){
    toast("分类名不能为空", "warn");
    /* 只回填旧值，不整段重绘：重绘会拆掉行，紧接其后的点击（删除/排序）随按钮一起丢失 */
    var old = null;
    for(var i = 0; i < projCatCache.length; i++) if(projCatCache[i].id === id) old = projCatCache[i];
    row.querySelector("[data-pcat-name]").value = old ? old.name : "";
    return;
  }
  API.put("/api/categories/" + encodeURIComponent(id), { name: name, color: color }).then(function(){
    toast("已更新分类「" + name + "」", "fs");
    loadProjCats(projCatReqId);
    refreshCatDependents();
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); loadProjCats(projCatReqId); });
}
projCatList.addEventListener("change", function(e){
  var row = e.target.closest("[data-proj-cat-id]");
  if(!row) return;
  if(e.target.matches("[data-pcat-name]") || e.target.matches("[data-pcat-color]")) saveProjCatRow(row.dataset.projCatId);
});
projCatList.addEventListener("click", function(e){
  if(roleReadOnly()) return;
  var row = e.target.closest("[data-proj-cat-id]");
  if(!row) return;
  var id = row.dataset.projCatId;
  if(e.target.closest("[data-pcat-up]") || e.target.closest("[data-pcat-down]")){
    var idx = -1;
    for(var i = 0; i < projCatCache.length; i++) if(projCatCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-pcat-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= projCatCache.length) return;
    var moved = projCatCache.splice(idx, 1)[0];
    projCatCache.splice(to, 0, moved);
    API.put("/api/categories/order?project=" + encodeURIComponent(projCatReqId), { ids: projCatCache.map(function(c){ return c.id; }) }).then(function(){
      loadProjCats(projCatReqId);
    }).catch(function(ex){ toast(ex.message || "排序失败", "bad"); loadProjCats(projCatReqId); });
    return;
  }
  if(e.target.closest("[data-pcat-del]")){
    var cat = null;
    for(var j = 0; j < projCatCache.length; j++) if(projCatCache[j].id === id) cat = projCatCache[j];
    if(!cat) return;
    var others = projCatCache.filter(function(c){ return c.id !== id; });
    if(!others.length){ toast("至少需要保留一个分类", "warn"); return; }
    var menu = document.createElement("div");
    menu.className = "menu";
    menu.style.minWidth = "200px";
    menu.innerHTML = '<div class="menu-title">迁移到</div>' + others.map(function(c){
      return '<button class="menu-item" type="button" data-pcat-target="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    }).join("");
    UI.openPop(menu, e.target.closest("[data-pcat-del]"), { onClose: function(){ menu.remove(); } });
    menu.addEventListener("click", function(ev){
      var b = ev.target.closest("[data-pcat-target]");
      if(!b) return;
      var target = null;
      for(var k = 0; k < others.length; k++) if(others[k].id === b.dataset.pcatTarget) target = others[k];
      if(!target) return;
      UI.closeAllPops();
      UI.showConfirm({
        title:"删除分类",
        msg:"删除分类「" + esc(cat.name) + "」？其下工作项与需求将改到「" + esc(target.name) + "」。",
        okText:"删除分类"
      }).then(function(ok){
        if(!ok) return;
        API.del("/api/categories/" + encodeURIComponent(id) + "?targetId=" + encodeURIComponent(target.id)).then(function(){
          toast("已删除分类「" + cat.name + "」，工作项与需求已迁到「" + target.name + "」", "fs");
          loadProjCats(projCatReqId);
          refreshCatDependents();
        }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
      });
    });
  }
});
$("btnProjCatAdd").addEventListener("click", function(){
  if(roleReadOnly()) return;
  var name = projCatNewName.value.trim();
  if(!name){ toast("请填写分类名称", "warn"); return; }
  API.post("/api/categories?project=" + encodeURIComponent(projCatReqId), { name: name, color: projCatNewColor.value }).then(function(){
    toast("已添加分类「" + name + "」", "fs");
    projCatNewName.value = "";
    loadProjCats(projCatReqId);
    refreshCatDependents();
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});

/* ---------- 项目集弹窗：名称/负责人/计划只是集自身展示，不改项目权限 ---------- */
var editingProjectSetId = null, projectSetFormSeq = 0;
function refreshProjectSetDependents(){
  loadReqs().then(function(){
    renderReqList();
    loadBoard({silent:true});
  });
}
function openProjectSetDialog(id){
  if(!canManageSets()){ toast("仅空间主或管理员可维护项目集", "warn"); return; }
  editingProjectSetId = id || null;
  projectSetFormSeq++;
  var s = id ? projectSetById(id) : null;
  syncProjectSetOptions();
  psName.value = s ? (s.name || "") : "";
  psDesc.value = s ? (s.description || "") : "";
  psOwner.value = s ? (s.ownerUserId || "") : "";
  psColor.value = s && /^#[0-9a-f]{6}$/i.test(String(s.color || "")) ? s.color : "#8a8578";
  psPlanStart.value = s && s.plannedStart ? String(s.plannedStart).slice(0, 10) : "";
  psPlanEnd.value = s && s.plannedEnd ? String(s.plannedEnd).slice(0, 10) : "";
  psStatus.value = s ? (s.status || "active") : "active";
  projectSetFormTitle.textContent = id ? "编辑项目集" : "新建项目集";
  btnSaveProjectSet.textContent = id ? "保存" : "新建项目集";
  btnSaveProjectSet.disabled = false;
  UI.openModal($("dlgProjectSet"), "input");
  setTimeout(function(){ try{ psName.focus(); }catch(e){ /* noop */ } }, 40);
}
function closeProjectSetDialog(){
  projectSetFormSeq++;
  editingProjectSetId = null;
  if($("dlgProjectSet")) UI.closeModal($("dlgProjectSet"));
}
function saveProjectSet(){
  if(btnSaveProjectSet.disabled) return;
  var name = psName.value.trim();
  if(!name){ toast("请填写项目集名称", "warn"); try{ psName.focus(); }catch(e){ /* noop */ } return; }
  var body = {
    name: name,
    description: psDesc.value.trim(),
    ownerUserId: psOwner.value || null,
    status: psStatus.value || "active",
    plannedStart: psPlanStart.value || null,
    plannedEnd: psPlanEnd.value || null,
    color: psColor.value || "#8a8578"
  };
  var editing = !!editingProjectSetId;
  var old = editing ? projectSetById(editingProjectSetId) : null;
  if(editing && old && old.updatedAt) body.updatedAt = old.updatedAt;
  var seq = projectSetFormSeq;
  var p = editing
    ? API.put("/api/project-sets/" + encodeURIComponent(editingProjectSetId), body)
    : API.post("/api/project-sets", body);
  btnSaveProjectSet.disabled = true;
  p.then(function(){
    toast(editing ? ("已更新项目集「" + name + "」") : ("已新建项目集「" + name + "」"), "fs");
    if(seq === projectSetFormSeq) closeProjectSetDialog();
    return loadProjectSets();
  }).then(function(){
    refreshProjectSetDependents();
  }).catch(function(ex){
    if(seq === projectSetFormSeq) btnSaveProjectSet.disabled = false;
    toast(ex.message || "保存失败", "bad");
    if(ex.code === 409) loadProjectSets();
  });
}
function deleteProjectSet(id){
  var s = projectSetById(id);
  if(!s){ return; }
  var count = (rt.reqList || []).filter(function(r){ return r.setId === id; }).length;
  UI.showConfirm({
    title: "删除项目集",
    msg: "删除项目集「" + esc(s.name) + "」？" + (count ? count + " 个项目会移回「未分组」，" : "") +
      "项目、工作项、需求与成员权限全部保留。",
    danger: false,
    okText: "删除项目集"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/project-sets/" + encodeURIComponent(id)).then(function(){
      toast("已删除项目集「" + s.name + "」，项目已移回未分组", "fs");
      return loadProjectSets();
    }).then(function(){
      refreshProjectSetDependents();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

function openProjectDialog(id){
  projectFormSeq++;
  btnSaveReq.disabled = false;
  rt.editingReqId = id || null;
  editingReqUpdatedAt = null;
  rName.value = "";
  rDesc.value = "";
  if(rObjective) rObjective.value = "";
  if(rOwner) rOwner.value = "";
  if(rPlanStart) rPlanStart.value = "";
  if(rPlanEnd) rPlanEnd.value = "";
  if(rSet) rSet.value = "";
  rt.formReqStatus = "active";
  syncOwnerOptions();
  syncProjectSetOptions();
  fReqName.classList.remove("invalid");
  if($("fReqPlanStart")) $("fReqPlanStart").classList.remove("invalid");
  if($("fReqPlanEnd")) $("fReqPlanEnd").classList.remove("invalid");
  syncTemplateField();
  if(!id){
    loadProjectTemplates().then(function(){
      if(rTemplate) rTemplate.value = "blank";
      syncTemplateHint();
    });
  }
  if(id){
    var r = null;
    for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) r = rt.reqList[i];
    if(r){
      rName.value = r.name || "";
      rDesc.value = r.description || "";
      if(rObjective) rObjective.value = r.objective || "";
      if(rOwner) rOwner.value = r.ownerUserId || "";
      if(rPlanStart) rPlanStart.value = r.plannedStart ? String(r.plannedStart).slice(0, 10) : "";
      if(rPlanEnd) rPlanEnd.value = r.plannedEnd ? String(r.plannedEnd).slice(0, 10) : "";
      if(rSet) rSet.value = r.setId || "";
      rt.formReqStatus = r.status || "active";
      editingReqUpdatedAt = r.updatedAt || null;
    }
  }
  syncReqStatusSeg();
  syncProjectMembers(!id);
  reqFormTitle.textContent = id ? "编辑项目" : "新建项目";
  btnSaveReq.textContent = id ? "保存" : "新建项目";
  btnCancelReqEdit.hidden = !id;
  /* 分类按项目配置：新建时项目尚不存在（首建后后端预置「其他」），仅编辑态展示 */
  if(projCatCfg) projCatCfg.hidden = !id;
  if(id) loadProjCats(id);
  /* 发布检查策略只看项目负责人/管理员；新建时没有可写对象 */
  if(id && canManageProject(id)) loadReleasePolicy(id);
  else {
    policySeq++;
    if(projReleasePolicy) projReleasePolicy.hidden = true;
  }
  projectFormBaseline = projectFormSnapshot();
  UI.openModal($("dlgProject"), "input");
  setTimeout(function(){ try{ rName.focus(); }catch(e){ /* noop */ } }, 40);
}
if($("btnReqNew")) $("btnReqNew").addEventListener("click", function(){ openProjectDialog(null); });
if(btnProjectSetNew) btnProjectSetNew.addEventListener("click", function(){ openProjectSetDialog(null); });
/* 页头两个动作由 router 统一清空，委托在容器上，切页后仍能接管 */
if($("pageActions")) $("pageActions").addEventListener("click", function(e){
  if(e.target.closest("[data-proj-new]")){ openProjectDialog(null); return; }
  if(e.target.closest("[data-proj-new-set]")){ openProjectSetDialog(null); }
});
/* 工具栏：范围 / 分组 / 搜索只改列表视图，不触发服务端请求 */
var projToolbar = document.querySelector("#view-projects .project-toolbar");
if(projToolbar){
  projToolbar.addEventListener("click", function(e){
    var scope = e.target.closest("[data-proj-scope]");
    if(scope){
      if(projScope !== scope.dataset.projScope){ projScope = scope.dataset.projScope; renderReqList(); }
      return;
    }
    var group = e.target.closest("[data-proj-group]");
    if(group){
      if(projGroupMode !== group.dataset.projGroup){ projGroupMode = group.dataset.projGroup; renderReqList(); }
    }
  });
}
if($("projSearch")) $("projSearch").addEventListener("input", function(){
  projKeyword = this.value || "";
  renderReqList();
});
if($("reqSumm")) $("reqSumm").addEventListener("click", function(e){
  if(e.target.closest("[data-proj-mark-mvp]")) showView("phase");
});
if(btnSaveProjectSet) btnSaveProjectSet.addEventListener("click", saveProjectSet);
if($("dlgProjectSetX")) $("dlgProjectSetX").addEventListener("click", closeProjectSetDialog);
if($("psCancel")) $("psCancel").addEventListener("click", closeProjectSetDialog);
if(psName) psName.addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  saveProjectSet();
});
document.querySelectorAll("[data-project-mode]").forEach(function(btn){
  btn.addEventListener("click", function(){
    if(btn.dataset.projectMode === listPrefs.viewMode("project-list")) return;
    btn.disabled = true;
    listPrefs.setViewMode("project-list", btn.dataset.projectMode).then(function(){
      btn.disabled = false;
      renderReqList();
    }).catch(function(ex){
      btn.disabled = false;
      toast(ex.message || "视图切换失败", "bad");
    });
  });
});
if($("btnProjectColumns")) $("btnProjectColumns").addEventListener("click", function(){
  listPrefs.openColumnSettings("project-list", renderReqList);
});
if($("btnShowArchived")) $("btnShowArchived").addEventListener("click", function(){
  showArchived = !showArchived;
  renderReqList();
});
if($("btnProjNoRelGo")) $("btnProjNoRelGo").addEventListener("click", function(){ showView("phase"); });
if($("dlgProjectX")) $("dlgProjectX").addEventListener("click", function(){ tryCloseProjectDialog(); });
btnSaveReq.addEventListener("click", saveReq);
btnCancelReqEdit.addEventListener("click", function(){ tryCloseProjectDialog(); });
rName.addEventListener("input", function(){ fReqName.classList.remove("invalid"); });
/* 失焦即时校验（P-FB-2）：必填项失焦即提示；日期区间在变更 / 失焦时校验，避免长表单填完才报错。
   日期为 ISO YYYY-MM-DD，可直接按字符串比较先后。 */
rName.addEventListener("blur", function(){ fReqName.classList.toggle("invalid", !rName.value.trim()); });
function validateReqPlanDates(){
  var fs = $("fReqPlanStart"), fe = $("fReqPlanEnd");
  var s = rPlanStart && rPlanStart.value ? rPlanStart.value : "";
  var e = rPlanEnd && rPlanEnd.value ? rPlanEnd.value : "";
  var bad = !!(s && e && e < s);
  if(fs) fs.classList.toggle("invalid", bad);
  if(fe) fe.classList.toggle("invalid", bad);
  return !bad;
}
if(rPlanStart){ rPlanStart.addEventListener("change", validateReqPlanDates); rPlanStart.addEventListener("blur", validateReqPlanDates); }
if(rPlanEnd){ rPlanEnd.addEventListener("change", validateReqPlanDates); rPlanEnd.addEventListener("blur", validateReqPlanDates); }
/* 单行输入 Enter 直接提交；CJK 输入法组合期间不触发 */
rName.addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if(!btnSaveReq.disabled) saveReq();
});
if($("dlgProject")){
  UI.setModalCloseGuard($("dlgProject"), function(){ tryCloseProjectDialog(); });
  UI.setModalSubmit($("dlgProject"), function(){ if(!btnSaveReq.disabled) saveReq(); });
}
window.addEventListener("ds:before-route", function(){
  var setDlg = $("dlgProjectSet");
  if(setDlg && setDlg.classList.contains("open")) closeProjectSetDialog();
});
window.addEventListener("ds:before-route", function(e){
  var dlg = $("dlgProject");
  if(!dlg || !dlg.classList.contains("open")) return;
  e.preventDefault();
  var to = e.detail && e.detail.to;
  tryCloseProjectDialog(function(){
    if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
  });
});
if(rTemplate) rTemplate.addEventListener("change", syncTemplateHint);
if(rReleasePolicy) rReleasePolicy.addEventListener("change", function(){
  var reqId = rt.editingReqId;
  if(!reqId || !canManageProject(reqId)) return;
  var next = rReleasePolicy.value, prev = rReleasePolicy.dataset.saved || "standard";
  var seq = ++policySeq;
  rReleasePolicy.disabled = true;
  API.put("/api/projects/" + encodeURIComponent(reqId) + "/release-policy?policy=" + encodeURIComponent(next), null).then(function(saved){
    if(seq !== policySeq || rt.editingReqId !== reqId) return;
    rReleasePolicy.value = saved; rReleasePolicy.dataset.saved = saved; rReleasePolicy.disabled = false;
    toast("发布检查策略已改为「" + ({strict:"严格", loose:"宽松"}[saved] || "标准") + "」，下次检查立即生效", "fs");
  }).catch(function(ex){
    if(seq !== policySeq || rt.editingReqId !== reqId) return;
    rReleasePolicy.value = prev; rReleasePolicy.disabled = false;
    toast(ex.message || "策略保存失败", "bad");
  });
});
segReqStatus.addEventListener("click", function(e){
  var b = e.target.closest("[data-rst]"); if(!b) return;
  rt.formReqStatus = b.dataset.rst; syncReqStatusSeg();
});
reqListEl.addEventListener("click", function(e){
  var cockpit = e.target.closest("[data-req-cockpit]");
  if(cockpit){
    rt.managerProjectId = cockpit.dataset.reqCockpit;
    showView("project");
    return;
  }
  var sort = e.target.closest("[data-project-sort]");
  if(sort){ setProjectSort(sort.dataset.projectSort); return; }
  var projMore = e.target.closest("[data-project-more]");
  if(projMore){ openProjectRowMenu(projMore, projMore.dataset.projectMore); return; }
  var setRisk = e.target.closest("[data-set-risk]");
  if(setRisk){ showView("risks"); return; }
  var setToggle = e.target.closest("[data-set-toggle]");
  if(setToggle){
    var tk = setToggle.dataset.setToggle;
    if(setCollapsed[tk]) delete setCollapsed[tk]; else setCollapsed[tk] = true;
    saveSetCollapsed();
    renderReqList();
    return;
  }
  var setEdit = e.target.closest("[data-set-edit]");
  if(setEdit){ openProjectSetDialog(setEdit.dataset.setEdit); return; }
  var setDel = e.target.closest("[data-set-del]");
  if(setDel){ deleteProjectSet(setDel.dataset.setDel); return; }
  var activity = e.target.closest("[data-req-activity]");
  if(activity){
    var project = rt.reqList.filter(function(r){ return r.id === activity.dataset.reqActivity; })[0];
    activityUI.openDialog(project ? project.name : "项目", "/api/projects/" + encodeURIComponent(activity.dataset.reqActivity) + "/activities");
    return;
  }
  var quick = e.target.closest("[data-req-quick]");
  if(quick){
    var qinp = quick.parentNode.querySelector("[data-req-new-input]");
    if(qinp) qinp.focus();
    return;
  }
  var openNew = e.target.closest("[data-req-open]");
  if(openNew){
    if(!canEditReq(openNew.dataset.reqOpen)){ toast("你对该项目只有查看权限", "warn"); return; }
    openTaskDrawer("backlog", null, { reqId: openNew.dataset.reqOpen });
    return;
  }
  var projectTask = e.target.closest("[data-project-task-open]");
  if(projectTask){ openTaskById(projectTask.dataset.projectTaskOpen); return; }
  var taskRetry = e.target.closest("[data-project-task-retry]");
  if(taskRetry){ loadProjectTasks(taskRetry.dataset.projectTaskRetry, true).catch(function(){}); return; }
  var ed = e.target.closest("[data-edit-req]");
  if(ed){
    if(!canEditReq(ed.dataset.editReq)){ toast("你对该项目只有查看权限", "warn"); return; }
    openProjectDialog(ed.dataset.editReq);
    return;
  }
  var archiveBtn = e.target.closest("[data-archive-req]");
  if(archiveBtn){ toggleArchive(archiveBtn.dataset.archiveReq); return; }
  var ex = e.target.closest("[data-req-expand]");
  if(ex){
    var rid0 = ex.dataset.reqExpand;
    reqExpanded[rid0] = !reqExpanded[rid0];
    renderReqList();
    if(reqExpanded[rid0]) loadProjectTasks(rid0).catch(function(){});
    return;
  }
  var docNew = e.target.closest("[data-doc-new]");
  if(docNew){
    if(!canEditReq(docNew.dataset.docNew)){ toast("你对该项目只有查看权限", "warn"); return; }
    openNewReqDocDialog(docNew.dataset.docNew);
    return;
  }
  var docOpen = e.target.closest("[data-reqdoc-open]");
  if(docOpen){ openReqDocAndJump(docOpen.dataset.reqdocOpen); return; }
  var toBoard = e.target.closest("[data-req-board]");
  if(toBoard){ toBoardForProject(toBoard.dataset.reqBoard); return; }
  var manage = e.target.closest("[data-req-docs]");
  if(manage){
    setReqDocProjectFilter(manage.dataset.reqDocs);
    showView("requirements");
    return;
  }
  var toDemands = e.target.closest("[data-req-demands]");
  if(toDemands){
    openDemandsForReq(toDemands.dataset.reqDemands);
    showView("demands");
    toast("已按项目筛选需求池：" + reqNameById(toDemands.dataset.reqDemands));
    return;
  }
  var dl = e.target.closest("[data-del-req]");
  if(dl) deleteReq(dl.dataset.delReq);
});
/* 项目拖拽排序：只有把手可拖，避免误触按钮/文本选择。
   项目除了同集排序，还可以拖到其他项目集表头 / 集内任意位置换集；
   项目集表头的把手用于调整项目集之间的顺序。 */
function canReorderSets(){
  return canManageSets() && (rt.projectSets || []).length > 1;
}
function projectDragTarget(e){
  var row = e.target.closest("[data-req-id]");
  if(row) return { kind:"row", row:row };
  var head = e.target.closest("[data-set-key]");
  if(head) return { kind:"head", head:head };
  var end = e.target.closest("[data-set-drop-ungrouped]");
  if(end) return { kind:"ungrouped", end:end };
  return null;
}
/* 换集后的可见顺序：按项目集分组重建，再做回填，已归档项目保持原位置 */
function regroupVisibleIds(list, dragId, targetSetId, anchorId, after){
  var seq = [];
  groupedProjects(list).forEach(function(g){
    var key = g.set ? g.set.id : "";
    var ids = g.rows.map(function(r){ return r.id; }).filter(function(id){ return id !== dragId; });
    if(key === targetSetId){
      var at = anchorId ? ids.indexOf(anchorId) : -1;
      if(at >= 0) ids.splice(at + (after ? 1 : 0), 0, dragId);
      else ids.push(dragId);
    }
    seq = seq.concat(ids);
  });
  if(seq.indexOf(dragId) < 0) seq.push(dragId);
  return seq;
}
function applyProjectMove(drag, targetSetId, anchorId, after){
  if(orderSaving) return;
  var moved = (drag.fromSet || "") !== (targetSetId || "");
  if(!moved){
    if(anchorId) applyProjectDrop(drag, anchorId, after);
    return;
  }
  var before = rt.reqList.slice();
  var seq = regroupVisibleIds(listedReqs(), drag.id, targetSetId, anchorId, after);
  var next = mergeVisibleOrder(before, seq);
  next.forEach(function(r){ if(r.id === drag.id) r.setId = targetSetId || null; });
  rt.reqList = next;
  var collapsedKey = targetSetId || "__un";
  if(setCollapsed[collapsedKey]){
    setCollapsed[collapsedKey] = false;
    saveSetCollapsed();
  }
  renderReqList();
  orderSaving = true;
  var setSaved = false;
  API.put("/api/reqs/" + encodeURIComponent(drag.id) + "/set?setId=" + encodeURIComponent(targetSetId || ""))
    .then(function(){
      setSaved = true;
      return API.put("/api/reqs/order", { ids: next.map(function(r){ return r.id; }) });
    })
    .then(function(){
      orderSaving = false;
      populateReqSelect();
      /* 集表头上的项目数 / 工作项汇总是服务端算的，换集后要重新拉一次 */
      return loadProjectSets();
    })
    .then(function(){
      var set = projectSetById(targetSetId);
      toast(set ? ("已移入项目集「" + set.name + "」") : "已移出项目集", "fs");
    })
    .catch(function(ex){
      orderSaving = false;
      var msg = (ex && ex.message) || "网络异常";
      toast(setSaved ? ("项目已换集，但顺序保存失败：" + msg) : ("换项目集失败：" + msg),
        setSaved ? "warn" : "bad");
      /* 服务端可能已完成换集：以服务端为准重新拉一次，避免列表停在错误归属上 */
      loadReqs().then(function(){
        renderReqList();
        loadProjectSets();
      }).catch(function(){
        rt.reqList = before;
        renderReqList();
      });
    });
}
function applySetDrop(drag, targetSetId, after){
  if(orderSaving || !drag || drag.id === targetSetId) return;
  var ids = drag.order.slice();
  var from = ids.indexOf(drag.id);
  if(from < 0) return;
  ids.splice(from, 1);
  var to = ids.indexOf(targetSetId);
  if(to < 0) return;
  ids.splice(after ? to + 1 : to, 0, drag.id);
  var before = (rt.projectSets || []).map(function(s){ return { id:s.id, sortOrder:s.sortOrder }; });
  ids.forEach(function(id, i){
    var s = projectSetById(id);
    if(s) s.sortOrder = i;
  });
  renderReqList();
  orderSaving = true;
  API.put("/api/project-sets/order", { ids: ids }).then(function(){
    orderSaving = false;
    /* 编辑弹窗的项目集下拉与工作项抽屉的分组都按数组顺序渲染，重新拉一次保持一致 */
    return loadProjectSets().then(function(){
      populateReqSelect();
      toast("项目集顺序已保存", "fs");
    });
  }).catch(function(ex){
    orderSaving = false;
    (rt.projectSets || []).forEach(function(s){
      before.forEach(function(b){ if(b.id === s.id) s.sortOrder = b.sortOrder; });
    });
    renderReqList();
    toast("项目集顺序保存失败：" + ((ex && ex.message) || "网络异常"), "bad");
  });
}
reqListEl.addEventListener("dragstart", function(e){
  var projectHandle = e.target.closest("[data-req-drag]");
  var setHandle = !projectHandle && e.target.closest("[data-set-drag]");
  if(!projectHandle && !setHandle){ e.preventDefault(); return; }
  if(orderSaving){ e.preventDefault(); return; }
  var row, head;
  if(projectHandle){
    if(!reorderEnabled()){ e.preventDefault(); return; }
    row = projectHandle.closest("[data-req-id]");
    if(!row){ e.preventDefault(); return; }
    dragState = {
      kind:"project",
      id:row.dataset.reqId,
      fromSet:row.dataset.setId || "",
      order:listedReqs().map(function(r){ return r.id; })
    };
    row.classList.add("dragging");
  }else{
    if(!canReorderSets()){ e.preventDefault(); return; }
    head = setHandle.closest("[data-set-key]");
    if(!head){ e.preventDefault(); return; }
    dragState = { kind:"set", id:setHandle.dataset.setDrag, order:orderedSets().map(function(s){ return s.id; }) };
    head.classList.add("dragging");
  }
  document.body.classList.add("proj-reordering");
  document.body.classList.toggle("proj-drag-project", !!projectHandle);
  if(e.dataTransfer){
    e.dataTransfer.effectAllowed = "move";
    try{ e.dataTransfer.setData("text/plain", dragState.id); }catch(err){ /* 老浏览器 */ }
    try{ e.dataTransfer.setDragImage(row || head, 20, 20); }catch(err){ /* 老浏览器 */ }
  }
});
reqListEl.addEventListener("dragover", function(e){
  if(!dragState) return;
  var t = projectDragTarget(e);
  if(dragState.kind === "set"){
    if(!t || t.kind !== "head" || !t.head.dataset.setId || t.head.classList.contains("dragging")) return;
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    var hb = t.head.getBoundingClientRect();
    t.head.classList.add((e.clientY - hb.top) > hb.height / 2 ? "drop-after" : "drop-before");
    return;
  }
  if(!t) return;
  if(t.kind === "row" && t.row.classList.contains("dragging")) return;
  e.preventDefault();
  if(e.dataTransfer) e.dataTransfer.dropEffect = "move";
  clearDropMarks();
  if(t.kind === "head"){ t.head.classList.add("drop-into"); return; }
  if(t.kind === "ungrouped"){ t.end.classList.add("drop-into"); return; }
  var box = t.row.getBoundingClientRect();
  t.row.classList.add((e.clientY - box.top) > box.height / 2 ? "drop-after" : "drop-before");
});
reqListEl.addEventListener("dragleave", function(e){
  var row = e.target.closest("[data-req-id]");
  if(row && !row.contains(e.relatedTarget)) row.classList.remove("drop-before", "drop-after");
  /* 集表头：拖项目集时是 before/after，拖项目时是 into，离开都要清掉 */
  var head = e.target.closest("[data-set-key]");
  if(head && !head.contains(e.relatedTarget)) head.classList.remove("drop-into", "drop-before", "drop-after");
});
reqListEl.addEventListener("drop", function(e){
  if(!dragState) return;
  var drag = dragState;
  var t = projectDragTarget(e);
  if(drag.kind === "set"){
    if(!t || t.kind !== "head" || !t.head.dataset.setId){ endProjectDrag(); return; }
    e.preventDefault();
    var hb = t.head.getBoundingClientRect();
    var setAfter = (e.clientY - hb.top) > hb.height / 2;
    endProjectDrag();
    applySetDrop(drag, t.head.dataset.setId, setAfter);
    return;
  }
  e.preventDefault();
  if(!t || (t.kind === "row" && t.row.classList.contains("dragging"))){ endProjectDrag(); return; }
  var targetSetId = "", anchorId = null, after = false;
  if(t.kind === "row"){
    targetSetId = t.row.dataset.setId || "";
    var box = t.row.getBoundingClientRect();
    anchorId = t.row.dataset.reqId;
    after = (e.clientY - box.top) > box.height / 2;
  }else if(t.kind === "head"){
    targetSetId = t.head.dataset.setId || "";
  }
  endProjectDrag();
  applyProjectMove(drag, targetSetId, anchorId, after);
});
reqListEl.addEventListener("dragend", endProjectDrag);
reqListEl.addEventListener("keydown", function(e){
  var inp = e.target.closest("[data-req-new-input]");
  if(!inp) return;
  if(e.key !== "Enter") return;
  if(e.isComposing || e.keyCode === 229) return;
  var v = inp.value.trim();
  if(!v) return;
  e.preventDefault();
  var reqId = inp.dataset.reqNewInput;
  if(!canEditReq(reqId)){ toast("你对该项目只有查看权限", "warn"); return; }
  inp.disabled = true;
  API.post("/api/tasks", {
    title: v.slice(0, 60), boardColumn: "backlog", priority: "P2", progress: 0, reqId: reqId
  }).then(function(nt){
    inp.disabled = false;
    inp.value = "";
    taskCacheExtra[nt.id] = nt;
    toast("已在项目中新建「" + nt.title + "」", "fs");
    loadProjectTasks(reqId, true).catch(function(){});
    loadReqs().then(function(){ renderReqList(); loadBoard({silent:true}); });
  }).catch(function(ex){
    inp.disabled = false;
    toast(ex.message || "新建失败", "bad");
  });
});

export { enterProjectsView, openProjectDialog, refreshExpandedProjectTasks, renderReqList };
