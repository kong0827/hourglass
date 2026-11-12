/* views/project · 项目管理总览：单项目看板 + 全部项目透视表 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import * as listPrefs from "../core/list-preferences.js";
import { openTaskById } from "../core/task-actions.js";
import { dueState, rt, statusBucket } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { loadCategories } from "../core/app.js";
import { avatarHTML, fmtMinutesShort, typeBadgeHTML } from "../lib/format.js";
import { companyChipHTML } from "../lib/company.js";
import { DEFAULT_ROLE_TITLES, loadMemberLabelOptions, effectiveMemberRole, memberRoleTitles, labelFilterOption, labelFilterText } from "../lib/member-labels.js";
import { loadReqs } from "./board.js";
import { caliberHTML, downloadCsv, fmtDate, fmtHours, loadBarHTML, openTaskTable, taskStatusName } from "./manager-shared.js";

var VIEW_KEY = "project-view";
var TAB_KEY = "ds.projectTab";
var cache = null, seq = 0;
var pfCache = null, expanded = {};
var moduleUi = { adding:false, deleting:"" };
var deliveryCache = Object.create(null);
/* 版本 / 发布记录有变更时清掉交付资源缓存，避免项目驾驶舱继续显示旧数量 */
window.addEventListener("ds:delivery-changed", function(e){
  var id = e && e.detail && e.detail.reqId;
  if(id) delete deliveryCache[id];
  else deliveryCache = Object.create(null);
  if(document.body.dataset.view === "project" && currentMode() === "board") loadProject({ silent:true });
});
/* 标签变更按空间/项目失效；异步写入完成不能回刷用户已切换到的项目。 */
["ds:project-roles-changed","ds:member-company-changed","ds:member-job-title-changed","ds:member-label-options-changed","ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(e){
    var d = e && e.detail || {};
    var eventWs = d.workspaceId || workspaceId();
    if(rosterCache.key && rosterCache.key.indexOf(eventWs + ":") === 0 && (!d.projectId || rosterCache.key === eventWs + ":" + d.projectId)){
      rosterCache.key = ""; rosterCache.data = null; rosterCache.seq++;
    }
    if(eventWs !== workspaceId() || (d.projectId && d.projectId !== rt.managerProjectId)) return;
    seq++;
    if(document.body.dataset.view === "project"){
      if(projectTab === "roles") paintRoster();
      loadProject({ silent:true });
    }
  });
});
var projectWorkspaceId = "", memberFilter = { companyName:"", roleTitle:"" };
function workspaceId(){ return rt.currentWs && rt.currentWs.id || ""; }
var effectiveMode = null, drillSort = "default", drillOnlyRisk = false, drillInitialized = false;
var projectTab = (function(){
  try{ return localStorage.getItem(TAB_KEY) || "overview"; }catch(e){ return "overview"; }
})();
function setProjectTab(tab){
  if(["overview","epics","members","roles"].indexOf(tab) === -1) return;
  projectTab = tab;
  try{ localStorage.setItem(TAB_KEY, tab); }catch(e){ /* 受限环境忽略 */ }
  if(cache && currentMode() === "board") renderProject();
}
function projectTabBar(){
  var tabs = [["overview","概览"],["epics","史诗"],["members","成员负载"],["roles","成员与角色"]];
  return '<div class="seg mini project-tabs" role="tablist" aria-label="项目详情分区">' + tabs.map(function(t){
    var on = projectTab === t[0];
    return '<button type="button" role="tab" data-project-tab="' + t[0] + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + t[1] + '</button>';
  }).join("") + '</div>';
}
function enterProjectView(){
  effectiveMode = null;
  listPrefs.load(VIEW_KEY).then(function(){
    if(rt.reqsLoaded) loadProject();
    else loadReqs().then(loadProject);
  });
}
/* 临时覆盖只影响本次浏览：点项目名跳看板不改写用户持久化偏好 */
function currentMode(){ return effectiveMode || listPrefs.viewMode(VIEW_KEY); }
function selectableReqs(){
  var visible = rt.reqList.filter(function(r){ return !r.workspaceId || r.workspaceId === workspaceId(); });
  var list = visible.filter(function(r){ return !r.archivedAt || r.id === rt.managerProjectId; });
  return list.length ? list : visible;
}
function selectedProject(){
  var list = selectableReqs();
  if(!list.length) return null;
  var hit = list.filter(function(r){ return r.id === rt.managerProjectId; })[0];
  if(!hit){ hit = list[0]; rt.managerProjectId = hit.id; }
  return hit;
}
function loadProject(opts){
  opts = opts || {};
  var body = $("projectBody");
  if(!body) return;
  if(currentMode() === "drill"){ loadDrill(opts); return; }
  var selected = selectedProject();
  if(!selected){
    seq++; cache = null; rosterCache.seq++; rosterCache.key = ""; rosterCache.data = null;
    body.innerHTML = UI.emptyState({icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目。"});
    return;
  }
  var wsId = workspaceId();
  if(projectWorkspaceId !== wsId || !cache || !cache.project || cache.project.id !== selected.id){
    moduleUi = { adding:false, deleting:"" };
    memberFilter = { companyName:"", roleTitle:"" };
    rosterUi = { companyName:"", roleTitle:"", selected:new Set(), batchRole:"" };
  }
  projectWorkspaceId = wsId;
  var current = ++seq;
  if(!opts.silent) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/projects/" + encodeURIComponent(selected.id)).then(function(data){
    if(current !== seq || wsId !== workspaceId() || selected.id !== rt.managerProjectId) return;
    cache = data; renderProject();
  }).catch(function(ex){ if(current === seq && wsId === workspaceId() && selected.id === rt.managerProjectId) body.innerHTML = UI.errorState(ex.message); });
}
function metric(label, value, foot, kind){
  return '<button class="manager-kpi" type="button" data-project-metric="' + kind + '"><span>' + esc(label) + '</span><b>' + value + '</b><small>' + esc(foot) + '</small></button>';
}
function distRow(label, value, total, kind, cls){
  var pct = total ? Math.round(value / total * 100) : 0;
  return '<button class="manager-dist-row" type="button" data-project-metric="' + kind + '"><span><i class="manager-dot ' + (cls || "") + '"></i>' + label + '</span><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + value + '</b></button>';
}
function weeklyChart(weeks){
  var max = 1;
  weeks.forEach(function(w){ max = Math.max(max, w.created, w.completed); });
  return '<div class="manager-week-chart">' + weeks.map(function(w){
    return '<div class="manager-week" title="' + esc(w.start) + '：新增 ' + w.created + ' / 完成 ' + w.completed + '">'
      + '<span class="manager-week-bars"><i class="created" style="height:' + Math.round(w.created / max * 100) + '%"></i><i class="completed" style="height:' + Math.round(w.completed / max * 100) + '%"></i></span>'
      + '<small>' + esc(fmtDate(w.start)) + '</small></div>';
  }).join("") + '</div><div class="manager-chart-legend"><span><i class="created"></i>新增</span><span><i class="completed"></i>完成</span></div>';
}
function memberRows(members){
  if(!members.length) return '<tr><td colspan="6" class="manager-empty-cell">暂无未完成工作项</td></tr>';
  return members.map(function(m){
    return '<tr data-member-key="' + esc(m.key) + '" tabindex="0" title="查看该成员的项目工作项"><td><span class="manager-person">' + avatarHTML(m.name, "sm") + '<b>' + esc(m.name) + '</b></span><div class="manager-member-labels">' + companyChipHTML(m.companyName) + (m.jobTitle ? '<span class="roster-empty">空间职能：' + esc(m.jobTitle) + '</span>' : '') + memberRoleTitles(m).map(function(r){ return '<span class="tag tag-ghost">' + esc(r) + '</span>'; }).join("") + '</div></td>'
      + '<td class="num">' + m.taskCount + '</td><td class="num">' + fmtHours(m.remainingMinutes) + '</td>'
      + '<td class="num">' + fmtHours(m.actualWeekMinutes) + '</td><td>' + loadBarHTML(m.loadPct) + '</td>'
      + '<td>' + (m.overloaded ? '<span class="mini-tag over">超载</span>' : (m.loadPct >= 85 ? '<span class="mini-tag warn">接近满载</span>' : '<span class="mini-tag ok">正常</span>')) + '</td></tr>';
  }).join("");
}
/* ---------- 成员与角色：空间默认职能 + 项目主角色覆盖 + 兼岗 ---------- */
var rosterCache = { key:"", data:null, loading:false, error:null, seq:0, options:{} };
var rosterUi = { companyName:"", roleTitle:"", selected:new Set(), batchRole:"" };
var rosterWrites = new Set();
function uniqueLabels(values){ return Array.from(new Set(values.filter(Boolean))).sort(function(a,b){ return a.localeCompare(b,"zh-CN"); }); }
function roleCandidates(current){
  return uniqueLabels((rosterCache.options.roleTitles || DEFAULT_ROLE_TITLES).concat(["全栈工程师","产品经理",current === "__custom__" ? "" : current || ""]))
    .filter(function(role){ return role !== "__custom__" && role !== "__unset__"; });
}
function filterLabelOptions(values, selected, all, unset){
  return '<option value="">' + all + '</option><option value="__unset__"' + (selected === "__unset__" ? ' selected' : '') + '>' + unset + '</option>'
    + uniqueLabels(values.concat(selected && selected !== "__unset__" ? [labelFilterText(selected)] : [])).map(function(v){
      var key = labelFilterOption(v);
      return '<option value="' + esc(key) + '"' + (selected === key ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join("");
}
function matchesMemberLabels(m, f){
  var roles = memberRoleTitles(m), company = String(m.companyName || "").trim();
  return (!f.companyName || (f.companyName === "__unset__" ? !company : company === labelFilterText(f.companyName)))
    && (!f.roleTitle || (f.roleTitle === "__unset__" ? !roles.length : roles.indexOf(labelFilterText(f.roleTitle)) !== -1));
}
function memberLabelFilters(list, f, prefix){
  return '<div class="manager-label-filters"><label>公司 <select class="mini-select" data-' + prefix + '-filter="companyName">'
    + filterLabelOptions(list.map(function(m){ return m.companyName; }), f.companyName, "全部公司", "未设公司") + '</select></label>'
    + '<label>角色 <select class="mini-select" data-' + prefix + '-filter="roleTitle">'
    + filterLabelOptions(list.reduce(function(a,m){ return a.concat(memberRoleTitles(m)); }, []), f.roleTitle, "全部角色", "未设角色") + '</select></label>'
    + '<button class="btn sm ghost" type="button" data-' + prefix + '-clear>清除筛选</button></div>';
}
function rosterPanel(){
  return '<section class="manager-panel roster-panel"><div class="manager-panel-head"><b>成员与角色</b><span id="rosterSummary" aria-live="polite">加载中…</span></div>'
    + '<p class="roster-note">公司与默认职能在空间设置中维护；本项目主角色留空时沿用空间默认职能，可另设最多 5 个兼岗。角色只影响展示与筛选，不改变权限；空间查看者不参与项目。</p>'
    + '<div id="rosterTools"></div><div class="tbl-wrap"><table class="manager-tbl roster-tbl"><thead id="rosterHeader"></thead>'
    + '<tbody id="rosterBody"><tr><td colspan="8" class="manager-empty-cell">加载中…</td></tr></tbody></table></div></section>';
}
function roleOptions(role){
  return '<option value=""' + (!role ? ' selected' : '') + '>沿用空间默认职能</option>'
    + roleCandidates(role).map(function(r){ return '<option value="' + esc(r) + '"' + (r === role ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("")
    + '<option value="__custom__"' + (role === "__custom__" ? ' selected' : '') + '>自定义角色…</option>';
}
function rosterRoleSelect(m, canEdit){
  var role = m.roleTitle || "", effective = effectiveMemberRole(m);
  var source = m.roleSource || (role ? "project" : (m.jobTitle ? "workspace" : "unset"));
  return (canEdit ? '<select class="mini-select roster-role" data-roster-role="' + esc(m.userId) + '" aria-label="' + esc(m.displayName || m.username || m.userId) + '的本项目主角色"' + (rosterBusy() ? ' disabled' : '') + '>' + roleOptions(role) + '</select>'
    : '<span class="tag tag-ghost">' + esc(effective || "未设角色") + '</span>')
    + '<small class="roster-role-source">' + esc(source === "project" ? "本项目覆盖 · " + effective : (source === "workspace" ? "空间默认 · " + effective : "未设职能（空间与项目均未设置）")) + '</small>';
}
function rosterBusy(){ return rosterWrites.has(rosterCache.key); }
function filteredRoster(){ return (rosterCache.data && rosterCache.data.members || []).filter(function(m){ return matchesMemberLabels(m, rosterUi); }); }
function rosterContext(){
  var pid = cache && cache.project && (cache.project.reqId || cache.project.id), ws = workspaceId();
  if(!pid || !ws || rosterCache.key !== ws + ":" + pid || !rosterCache.data || !rosterCache.data.canEditRole || rosterCache.loading) return null;
  return { projectId:pid, workspaceId:ws, key:rosterCache.key, revision:rosterCache.seq,
    base:"/api/workspaces/" + encodeURIComponent(ws) + "/projects/" + encodeURIComponent(pid) + "/member-roles" };
}
function sameRoster(ctx){ return !!ctx && ctx.key === rosterCache.key && ctx.workspaceId === workspaceId() && ctx.projectId === rt.managerProjectId; }
/* 候选字典是空间级配置，只有空间主/管理员能维护；项目负责人可改角色但不能改字典。 */
function canManageLabelOptions(){
  var ws = rt.currentWs;
  return !!ws && ws.type === "shared" && ["owner", "admin"].indexOf(ws.myRole) !== -1;
}
function editableRoster(ctx){ return sameRoster(ctx) && ctx.revision === rosterCache.seq && rosterCache.data && rosterCache.data.canEditRole; }
function paintRoster(){
  var body = $("rosterBody"), summary = $("rosterSummary"), tools = $("rosterTools"), header = $("rosterHeader");
  if(!body) return;
  if(tools) tools.innerHTML = "";
  if(header) header.innerHTML = "";
  if(rosterCache.error || rosterCache.loading || !rosterCache.data){
    if(summary) summary.textContent = rosterCache.error ? "加载失败" : "加载中…";
    body.innerHTML = '<tr><td colspan="8" class="manager-empty-cell">' + (rosterCache.error ? '花名册加载失败：' + esc(rosterCache.error.message || "网络异常") + ' <button class="btn sm" type="button" data-roster-retry>重试</button>' : '加载中…') + '</td></tr>';
    return;
  }
  var all = rosterCache.data.members || [], list = filteredRoster(), canEdit = !!rosterCache.data.canEditRole, busy = rosterBusy();
  var disabled = busy ? ' disabled' : '';
  /* 仅对当前过滤结果执行批量操作，隐藏行不保留选中。 */
  var visibleIds = new Set(list.map(function(m){ return m.userId; }));
  rosterUi.selected.forEach(function(id){ if(!visibleIds.has(id)) rosterUi.selected.delete(id); });
  if(summary) summary.textContent = list.length + " / " + all.length + " 位成员 · " + uniqueLabels(all.map(function(m){ return m.companyName; })).length + " 家公司" + (busy ? " · 正在处理…" : "");
  if(tools) tools.innerHTML = memberLabelFilters(all, rosterUi, "roster")
    + (canEdit ? '<div class="roster-actions"><button class="btn sm" type="button" data-roster-copy' + disabled + '>从其他项目复制</button>'
      + (canManageLabelOptions() ? '<button class="btn sm ghost" type="button" data-roster-options' + disabled + '>管理角色候选</button>' : '') + '</div>'
      + '<div class="roster-batch"><span aria-live="polite">已选 ' + rosterUi.selected.size + ' 人</span><label>主角色 <select class="mini-select" data-roster-batch-role' + disabled + '>' + roleOptions(rosterUi.batchRole) + '</select></label>'
      + '<button class="btn sm primary" type="button" data-roster-batch' + (busy || !rosterUi.selected.size ? ' disabled' : '') + '>批量设置</button><button class="btn sm ghost" type="button" data-roster-unselect' + disabled + '>取消选择</button>'
      + '<small>沿用默认只清除主角色覆盖，不清除兼岗。全选仅当前过滤行。</small></div>' : '');
  if(header) header.innerHTML = '<tr>' + (canEdit ? '<th class="roster-check"><label class="roster-check-label"><input type="checkbox" data-roster-all aria-label="全选当前过滤成员"' + (list.length && rosterUi.selected.size === list.length ? ' checked' : '') + (busy || !list.length ? ' disabled' : '') + '><span>全选当前过滤成员</span></label></th>' : '')
    + '<th>成员</th><th>公司</th><th>空间默认职能</th><th>本项目主角色</th><th>兼岗</th><th>项目权限</th><th>可见来源</th></tr>';
  var allBox = header && header.querySelector("[data-roster-all]");
  if(allBox) allBox.indeterminate = rosterUi.selected.size > 0 && rosterUi.selected.size < list.length;
  body.innerHTML = list.map(function(m){
    var name = m.displayName || m.username || m.userId;
    var secondary = m.secondaryRoleTitles || [];
    return '<tr data-roster-user="' + esc(m.userId) + '">'
      + (canEdit ? '<td class="roster-check"><label class="roster-check-label"><input type="checkbox" data-roster-check="' + esc(m.userId) + '" aria-label="选择' + esc(name) + '"' + (rosterUi.selected.has(m.userId) ? ' checked' : '') + disabled + '><span>选择' + esc(name) + '</span></label></td>' : '')
      + '<td data-label="成员"><span class="manager-person">' + avatarHTML(name, "sm") + '<span class="roster-who"><b>' + esc(name) + '</b><small>@' + esc(m.username || m.userId) + '</small></span></span></td>'
      + '<td data-label="公司">' + companyChipHTML(m.companyName) + '</td>'
      + '<td data-label="空间默认职能">' + esc(m.jobTitle || "未设职能") + '</td>'
      + '<td data-label="本项目主角色">' + rosterRoleSelect(m, canEdit) + '</td>'
      + '<td data-label="兼岗"><div class="manager-member-labels">' + secondary.map(function(r){ return '<span class="tag tag-ghost">' + esc(r) + '</span>'; }).join("")
      + (canEdit ? '<button class="btn sm ghost" type="button" data-roster-secondary="' + esc(m.userId) + '" aria-label="编辑' + esc(name) + '的兼岗"' + disabled + '>' + (secondary.length ? "编辑兼岗" : "+ 添加兼岗") + '</button>' : (!secondary.length ? '<span class="roster-empty">无兼岗</span>' : '')) + '</div></td>'
      + '<td data-label="项目权限"><span class="roster-access ' + (m.access === "read" ? "read" : "write") + '">' + (m.access === "read" ? "只读" : "可参与") + '</span></td>'
      + '<td data-label="可见来源"><span class="roster-source">' + esc(m.source || "") + '</span></td></tr>';
  }).join("") || '<tr><td colspan="' + (canEdit ? 8 : 7) + '" class="manager-empty-cell">' + (all.length ? '没有匹配的成员，请清除筛选' : '当前没有可见的项目成员') + '</td></tr>';
}
function loadRoster(reqId, force){
  var ws = workspaceId();
  if(!reqId || !ws) return Promise.resolve(null);
  var key = ws + ":" + reqId;
  if(!force && rosterCache.key === key){ paintRoster(); return Promise.resolve(rosterCache.data); }
  if(rosterCache.key && rosterCache.key !== key) rosterUi = { companyName:"", roleTitle:"", selected:new Set(), batchRole:"" };
  rosterCache = { key:key, data:null, loading:true, error:null, seq:rosterCache.seq + 1, options:{} };
  var my = rosterCache.seq;
  paintRoster();
  return Promise.all([
    API.get("/api/workspaces/" + encodeURIComponent(ws) + "/projects/" + encodeURIComponent(reqId) + "/members"),
    loadMemberLabelOptions(ws, !!force).catch(function(){ return { roleTitles:DEFAULT_ROLE_TITLES }; })
  ]).then(function(values){
    if(my !== rosterCache.seq || key !== rosterCache.key || ws !== workspaceId() || reqId !== rt.managerProjectId) return null;
    rosterCache.data = values[0]; rosterCache.options = values[1] || {}; rosterCache.loading = false;
    paintRoster(); return values[0];
  }).catch(function(ex){
    if(my !== rosterCache.seq || ws !== workspaceId() || reqId !== rt.managerProjectId) return null;
    rosterCache.loading = false; rosterCache.error = ex; paintRoster(); return null;
  });
}
function startRosterWrite(ctx){
  if(!editableRoster(ctx) || rosterWrites.has(ctx.key)) return false;
  rosterWrites.add(ctx.key); paintRoster(); return true;
}
function finishRosterWrite(ctx){ rosterWrites.delete(ctx.key); if(sameRoster(ctx)) paintRoster(); }
function announceRosterChange(ctx, message){
  toast(message, "fs");
  window.dispatchEvent(new CustomEvent("ds:project-roles-changed", { detail:{ projectId:ctx.projectId, workspaceId:ctx.workspaceId } }));
}
function customRole(value, prev){
  if(value !== "__custom__") return Promise.resolve(value || "");
  return UI.showPrompt({ title:"自定义项目主角色", desc:"只设置本项目主角色；不修改空间默认职能或兼岗。", label:"角色名称", value:prev || "", maxLength:32, required:true });
}
function rosterMember(id){ return (rosterCache.data && rosterCache.data.members || []).filter(function(m){ return m.userId === id; })[0]; }
function saveRosterRole(sel){
  var m = rosterMember(sel.dataset.rosterRole), ctx = rosterContext(), value = sel.value;
  if(!m || !startRosterWrite(ctx)) return;
  customRole(value, m.roleTitle).then(function(title){
    if(title === null || !editableRoster(ctx)) return;
    return API.put(ctx.base + "/" + encodeURIComponent(m.userId), { roleTitle:title }).then(function(){
      rosterWrites.delete(ctx.key);
      announceRosterChange(ctx, title ? "已设置项目主角色「" + title + "」" : "已沿用空间默认职能，兼岗保持不变");
    });
  }).catch(function(ex){ toast(ex.message || "角色设置失败，请重试", "bad"); }).finally(function(){ finishRosterWrite(ctx); });
}
function saveRosterSecondary(id){
  var m = rosterMember(id), ctx = rosterContext();
  if(!m || !startRosterWrite(ctx)) return;
  UI.showPrompt({ title:"编辑兼岗", label:"兼岗角色（逗号分隔）", value:(m.secondaryRoleTitles || []).join("，"), required:false, maxLength:164,
    desc:"最多 5 个角色，用中文或英文逗号分隔，每个最多 32 字。重复项自动合并；留空清除兼岗，不改变主角色或空间默认职能。" }).then(function(value){
      if(value === null || !editableRoster(ctx)) return;
      var roles = uniqueLabels(value.split(/[,，]/).map(function(s){ return s.trim(); }));
      if(roles.length > 5 || roles.some(function(r){ return Array.from(r).length > 32; })) throw new Error("最多 5 个兼岗，每个最多 32 字；请重新编辑");
      return API.put(ctx.base + "/" + encodeURIComponent(id), { roleTitle:m.roleTitle || "", secondaryRoleTitles:roles }).then(function(){
        rosterWrites.delete(ctx.key); announceRosterChange(ctx, "已更新兼岗，主角色保持不变");
      });
    }).catch(function(ex){ toast(ex.message || "兼岗设置失败，请重试", "bad"); }).finally(function(){ finishRosterWrite(ctx); });
}
function chooseRosterBatchRole(sel){
  var value = sel.value, ctx = rosterContext();
  if(value !== "__custom__"){ if(ctx && !rosterBusy()) rosterUi.batchRole = value; return; }
  if(!startRosterWrite(ctx)) return;
  customRole(value, rosterUi.batchRole).then(function(title){ if(title !== null && editableRoster(ctx)) rosterUi.batchRole = title; })
    .catch(function(ex){ toast(ex.message || "自定义角色输入失败", "bad"); }).finally(function(){ finishRosterWrite(ctx); });
}
function saveRosterBatch(){
  var ctx = rosterContext(), ids = filteredRoster().filter(function(m){ return rosterUi.selected.has(m.userId); }).map(function(m){ return m.userId; }), value = rosterUi.batchRole;
  if(!ids.length || !startRosterWrite(ctx)) return;
  customRole(value, "").then(function(title){
    if(title === null || !editableRoster(ctx)) return;
    return UI.showConfirm({ title:"批量设置 " + ids.length + " 位成员", danger:false, okText:"确认设置",
      msg:esc(title ? "将主角色设为「" + title + "」。" : "只清除本项目主角色覆盖，沿用各自空间默认职能。") + "<br>不修改兼岗、公司或权限。" }).then(function(ok){
        if(!ok || !editableRoster(ctx)) return;
        return API.put(ctx.base, { userIds:ids, roleTitle:title }).then(function(result){
          rosterWrites.delete(ctx.key);
          if(sameRoster(ctx)){ rosterUi.selected.clear(); rosterUi.batchRole = title; }
          announceRosterChange(ctx, "已批量更新 " + (result.updated || 0) + " 位成员；兼岗保持不变");
        });
      });
  }).catch(function(ex){ toast(ex.message || "批量设置失败，未更新，请重试", "bad"); }).finally(function(){ finishRosterWrite(ctx); });
}
function openRosterCopy(){
  var ctx = rosterContext();
  if(!ctx || rosterBusy()) return;
  var projects = rt.reqList.filter(function(p){ return p.id !== ctx.projectId && (!p.workspaceId || p.workspaceId === ctx.workspaceId); });
  var layer = document.createElement("div");
  layer.className = "modal-layer"; layer.setAttribute("role","dialog"); layer.setAttribute("aria-modal","true"); layer.setAttribute("aria-label","从其他项目复制角色");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); },0); };
  layer.innerHTML = '<form class="sheet roster-copy-sheet"><div class="sheet-head"><h2>从其他项目复制角色</h2><button class="icon-btn sm" type="button" data-copy-close aria-label="关闭">' + icon("close",15) + '</button></div>'
    + '<div class="sheet-body"><p class="roster-note">仅复制同空间、双方都有的成员的有效主角色（含空间继承）与兼岗，形成本项目覆盖快照；不修改公司、空间默认职能或权限。默认跳过目标已有主角色覆盖或兼岗的成员；来源未设角色的不复制。</p>'
    + '<label for="rosterCopyProject">来源项目</label><select id="rosterCopyProject" class="mini-select"' + (!projects.length ? ' disabled' : '') + '>'
    + projects.map(function(p){ return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.archivedAt ? '（已归档）' : '') + '</option>'; }).join("") + '</select>'
    + (!projects.length ? '<p class="roster-note">当前没有可见的同空间其他项目。</p>' : '')
    + '<label class="roster-copy-overwrite"><input type="checkbox" data-copy-overwrite>覆盖目标已有主角色与兼岗（需再次确认）</label>'
    + '<p data-copy-status role="status" aria-live="polite"></p></div><div class="sheet-foot"><button class="btn" type="button" data-copy-close>取消</button><button class="btn primary" type="submit"' + (!projects.length ? ' disabled' : '') + '>复制角色</button></div></form>';
  document.body.appendChild(layer);
  layer.addEventListener("click",function(e){ if(e.target.closest("[data-copy-close]")) UI.closeModal(layer); });
  layer.querySelector("form").addEventListener("submit",function(e){
    e.preventDefault();
    var sourceId = layer.querySelector("select").value, overwrite = layer.querySelector("[data-copy-overwrite]").checked;
    if(!projects.some(function(p){ return p.id === sourceId; }) || !startRosterWrite(ctx)) return;
    var controls = layer.querySelectorAll('select,input,button[type="submit"]');
    controls.forEach(function(el){ el.disabled = true; });
    var status = layer.querySelector("[data-copy-status]"); status.textContent = "正在处理…";
    var confirmation = overwrite ? UI.showConfirm({ title:"覆盖目标角色？", msg:"将覆盖共同成员在本项目已有的主角色与兼岗；此操作无法撤销。", okText:"确认覆盖" }) : Promise.resolve(true);
    confirmation.then(function(ok){
      if(!ok || !layer.classList.contains("open") || !editableRoster(ctx)){ status.textContent = "已取消，未复制"; return; }
      return API.post(ctx.base + "/copy", { sourceProjectId:sourceId, overwrite:overwrite }).then(function(result){
        var message = "已复制 " + (result.copied || 0) + " 位成员，跳过 " + (result.skipped || 0) + " 位成员";
        status.textContent = message; rosterWrites.delete(ctx.key); announceRosterChange(ctx, message);
      });
    }).catch(function(ex){ status.textContent = ex.message || "复制失败，请重试"; status.setAttribute("role","alert"); })
      .finally(function(){ finishRosterWrite(ctx); if(layer.isConnected) controls.forEach(function(el){ el.disabled = !editableRoster(ctx); }); });
  });
  UI.openModal(layer, "select");
}
function filteredProjectMembers(){ return (cache && cache.members || []).filter(function(m){ return matchesMemberLabels(m, memberFilter); }); }
function projectMemberTasks(key){
  return (cache.tasks || []).filter(function(t){ return statusBucket(t) !== "done" && statusBucket(t) !== "ended" && (t.ownerUserId || t.owner || "unassigned") === key; });
}
function exportProjectMembers(){
  if(!cache) return;
  var rows = [["项目成员负载", cache.project.name], ["公司", memberFilter.companyName === "__unset__" ? "未设公司" : labelFilterText(memberFilter.companyName) || "全部公司", "角色", memberFilter.roleTitle === "__unset__" ? "未设角色" : labelFilterText(memberFilter.roleTitle) || "全部角色"], [],
    ["成员","公司","空间默认职能","项目有效角色（主+兼岗）","未完成工作项","剩余预估(小时)","本周已计(小时)","负载"]];
  var members = filteredProjectMembers();
  members.forEach(function(m){ rows.push([m.name,m.companyName || "未设公司",m.jobTitle || "",memberRoleTitles(m).join(" / "),m.taskCount,hoursNum(m.remainingMinutes),hoursNum(m.actualWeekMinutes),m.loadPct + "%"]); });
  rows.push([], ["成员","工作项","状态","截止","预估(小时)","实际(小时)"]);
  members.forEach(function(m){ projectMemberTasks(m.key).forEach(function(t){ rows.push([m.name,t.title,taskStatusName(t),fmtDate(t.dueDate),hoursNum(t.estimateMinutes),hoursNum(t.totalMinutes)]); }); });
  downloadCsv("项目成员负载.csv", rows); toast("已导出当前筛选成员与工作项", "fs");
}
function modeSeg(){
  var mode = currentMode();
  return '<div class="seg mini">'
    + '<button type="button" data-pv-mode="board" aria-pressed="' + (mode === "board") + '">单项目</button>'
    + '<button type="button" data-pv-mode="drill" aria-pressed="' + (mode === "drill") + '">全部项目透视</button>'
    + '</div>';
}
function dayDiff(from, to){
  function utc(s){ var a = String(s).slice(0, 10).split("-"); return Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2])); }
  return Math.round((utc(to) - utc(from)) / 86400000);
}
function projectBrief(p, m, c, members){
  var facts = [];
  facts.push('<span><i>负责人</i><b>' + esc(p.ownerName || "未指定") + '</b></span>');
  facts.push('<span><i>计划周期</i><b>' + (p.plannedStart || p.plannedEnd
    ? esc(fmtDate(p.plannedStart) + " → " + fmtDate(p.plannedEnd))
    : "未设置") + '</b></span>');
  var daysLeft = p.plannedEnd && cache.today ? dayDiff(cache.today, p.plannedEnd) : null;
  if(daysLeft !== null){
    facts.push('<span><i>计划' + (daysLeft < 0 ? "超期" : "剩余") + '</i><b' + (daysLeft < 0 ? ' style="color:var(--danger-fg)"' : "") + '>'
      + Math.abs(daysLeft) + ' 天</b></span>');
  }
  facts.push('<span><i>首版上线</i><b>' + (p.firstReleasedAt ? esc(fmtDate(p.firstReleasedAt)) : "未标记") + '</b></span>');

  var risks = [];
  if(!p.ownerName) risks.push('<span class="mini-tag warn">未指定负责人</span>');
  if(c.overdue) risks.push('<span class="mini-tag over">逾期 ' + c.overdue + ' 项</span>');
  if(c.blocked) risks.push('<span class="mini-tag warn">阻塞 ' + c.blocked + ' 项</span>');
  var overloaded = (members || []).filter(function(x){ return x.overloaded; }).length;
  if(overloaded) risks.push('<span class="mini-tag over">' + overloaded + ' 人超载</span>');
  if(daysLeft !== null && daysLeft < 0 && (m.progressPct || 0) < 100) risks.push('<span class="mini-tag over">已超计划结束 ' + Math.abs(daysLeft) + ' 天</span>');
  if(!risks.length) risks.push('<span class="mini-tag ok">暂无风险信号</span>');

  return (p.archivedAt ? '<div class="project-brief-archived">该项目已归档：默认列表不再展示，数据完整保留。</div>' : '')
    + '<section class="manager-panel project-brief"><div class="project-brief-main">'
    + '<span class="project-brief-label">项目目标</span>'
    + '<p class="project-brief-goal' + (p.objective ? "" : " muted") + '">' + esc(p.objective || p.description || "未填写项目目标，可在「编辑项目」中补充") + '</p>'
    + '<div class="project-brief-facts">' + facts.join("") + '</div></div>'
    + '<div class="project-brief-risk"><span class="project-brief-label">风险信号</span><div>' + risks.join("") + '</div></div>'
    + '</section>';
}
function deliveryPanel(p){
  var data = deliveryCache[p.id] || {};
  function card(kind, label, value, foot){
    return '<button class="project-delivery-card" type="button" data-project-open="' + kind + '">'
      + '<b>' + esc(value) + '</b><span>' + esc(label) + '</span><small>' + esc(foot) + '</small></button>';
  }
  function valueOf(key){
    if(data[key] === undefined) return "—";
    if(data[key] === null) return "—";
    return String(data[key]);
  }
  function footOf(key, loading, failed){
    if(data[key] === undefined) return loading;
    if(data[key] === null) return failed;
    return "";
  }
  function casesFoot(){
    if(data.cases === undefined) return "加载中";
    if(data.cases === null) return "加载失败";
    if(data.plans === undefined || data.plans === null) return "用例库";
    return data.plans + " 个测试计划";
  }
  return '<section class="manager-panel project-delivery"><div class="manager-panel-head"><b>交付资源</b><span>打开时自动按本项目筛选</span></div>'
    + '<div class="project-delivery-grid">'
    + card("docs", "文档", valueOf("docs"), footOf("docs", "加载中", "加载失败") || "需求 / 方案文档")
    + card("tests", "测试用例", valueOf("cases"), casesFoot())
    + card("versions", "版本", valueOf("versions"), footOf("versions", "加载中", "加载失败") || "首版 / 迭代")
    + '</div></section>';
}
function moduleDeviation(value){
  return value === null || value === undefined ? "—" : ((value > 0 ? "+" : "") + value + "%");
}
function moduleRisk(row){
  var tags = [];
  if(row.overdue) tags.push('<span class="mini-tag over">逾期 ' + row.overdue + '</span>');
  if(row.blocked) tags.push('<span class="mini-tag warn">阻塞 ' + row.blocked + '</span>');
  if(!tags.length && row.total && row.done === row.total) tags.push('<span class="mini-tag ok">已完成</span>');
  return tags.length ? tags.join("") : "—";
}
function moduleTasksOf(id){
  var modules = cache.modules || [];
  return (cache.tasks || []).filter(function(t){
    var cid = t.categoryId || "";
    if(id === "__none") return !cid || !modules.some(function(x){ return x.id === cid; });
    return cid === id;
  });
}
function moduleMetricCells(row){
  var pct = Math.max(0, Math.min(100, Math.round(Number(row.progressPct) || 0)));
  return '<td data-label="进度"><span class="project-module-progress"><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></span></td>'
    + '<td class="num" data-label="工作项">' + (Number(row.done) || 0) + ' / ' + (Number(row.total) || 0) + '</td>'
    + '<td class="num" data-label="预估">' + fmtHours(row.estimateMinutes) + '</td>'
    + '<td class="num" data-label="实际工时">' + fmtHours(row.actualMinutes) + '</td>'
    + '<td class="num" data-label="剩余">' + fmtHours(row.remainingMinutes) + '</td>'
    + '<td class="num" data-label="偏差">' + moduleDeviation(row.deviationPct) + '</td>';
}
function moduleDeleteRow(row, colspan){
  var taskCount = Number(row.total) || 0;
  var options = (cache.modules || []).filter(function(x){ return x.id !== row.id; }).map(function(x){
    return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
  }).join("");
  var hint = taskCount
    ? taskCount + ' 个工作项及其需求将迁到目标模块，历史工时随工作项一起迁移，无法恢复。'
    : '该模块暂无工作项，删除后不可恢复。';
  return '<tr class="project-module-editor"><td colspan="' + colspan + '"><div class="project-module-del">'
    + '<span class="project-module-del-icon" aria-hidden="true">' + icon("trash", 14) + '</span>'
    + '<span class="project-module-del-text"><b>删除「' + esc(row.name) + '」？</b><small>' + hint + '</small></span>'
    + (taskCount ? '<label class="project-module-target">迁到 <select data-module-target>' + options + '</select></label>' : '')
    + '<button class="btn sm danger" type="button" data-module-del-confirm="' + esc(row.id) + '">确认删除</button>'
    + '<button class="btn sm ghost" type="button" data-module-del-cancel>取消</button></div></td></tr>';
}
function moduleRowHTML(row, canManage, moduleCount){
  var ops = canManage
    ? '<td class="project-module-ops" data-label="操作"><button class="icon-btn sm danger" type="button" data-module-del="' + esc(row.id) + '" title="删除模块" aria-label="删除模块"' + (moduleCount <= 1 ? " disabled" : "") + '>' + icon("trash", 14) + '</button></td>'
    : "";
  return '<tr class="project-module-row' + (moduleUi.deleting === row.id ? ' is-deleting' : '') + '" data-module-open="' + esc(row.id) + '" tabindex="0" title="查看该模块的工作项">'
    + '<td class="project-module-name"><i class="project-module-dot" style="background:' + esc(row.color || "#8a8578") + '"></i><span>' + esc(row.name) + '</span></td>'
    + moduleMetricCells(row)
    + '<td data-label="风险">' + moduleRisk(row) + '</td>' + ops + '</tr>'
    + (moduleUi.deleting === row.id ? moduleDeleteRow(row, canManage ? 9 : 8) : "");
}
function moduleEmptyRow(colspan, canManage){
  return '<tr><td colspan="' + colspan + '" class="manager-empty-cell">该项目还没有模块'
    + (canManage ? '，点右上角「新增模块」添加第一个' : '') + '</td></tr>';
}
function moduleUnassignedRow(row){
  return '<tr class="project-module-row is-unassigned" data-module-open="__none" tabindex="0" title="查看未归属模块的工作项">'
    + '<td class="project-module-name"><i class="project-module-dot"></i><span>未指定</span><span class="mini-tag">未归类</span></td>'
    + moduleMetricCells(row)
    + '<td data-label="风险">' + moduleRisk(row) + '</td>'
    + (cache.canManageModules ? '<td class="project-module-ops"></td>' : '') + '</tr>';
}
function moduleTotalRow(m, c, total, canManage){
  var pct = Math.max(0, Math.min(100, Math.round(Number(m.progressPct) || 0)));
  return '<tr class="project-modules-total"><td class="project-module-name"><b>合计</b></td>'
    + '<td data-label="进度"><span class="project-module-progress"><span class="progress"><i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></span></td>'
    + '<td class="num" data-label="工作项">' + (c.done || 0) + ' / ' + total + '</td>'
    + '<td class="num" data-label="预估">' + fmtHours(m.estimateMinutes) + '</td>'
    + '<td class="num" data-label="实际工时">' + fmtHours(m.actualMinutes) + '</td>'
    + '<td class="num" data-label="剩余">' + fmtHours(m.remainingMinutes) + '</td>'
    + '<td class="num" data-label="偏差" title="项目整体偏差见上方工时偏差卡片">—</td>'
    + '<td data-label="风险">' + moduleRisk({ overdue:c.overdue, blocked:c.blocked, done:c.done, total:total }) + '</td>'
    + (canManage ? '<td class="project-module-ops"></td>' : '') + '</tr>';
}
function modulePanel(p, m, c){
  var modules = cache.modules || [];
  var unassigned = cache.unassigned || {};
  var canManage = !!cache.canManageModules;
  var colspan = canManage ? 9 : 8;
  var total = (cache.tasks || []).length;
  var body = modules.map(function(row){ return moduleRowHTML(row, canManage, modules.length); }).join("");
  if(!modules.length) body = moduleEmptyRow(colspan, canManage);
  if(Number(unassigned.total)) body += moduleUnassignedRow(unassigned);
  body += moduleTotalRow(m, c, total, canManage);
  if(canManage && moduleUi.adding){
    body += '<tr class="project-module-editor"><td colspan="' + colspan + '"><div class="project-module-inline">'
      + '<b>新增模块</b>'
      + '<input type="color" data-module-new-color value="#8a8578" aria-label="模块颜色" />'
      + '<input type="text" data-module-new-name maxlength="12" placeholder="模块名称，最多 12 个字" aria-label="模块名称" />'
      + '<button class="btn sm primary" type="button" data-module-save>添加</button>'
      + '<button class="btn sm ghost" type="button" data-module-cancel>取消</button>'
      + '<span class="foot-note">名称不可与现有模块重复，新模块排在最后。</span></div></td></tr>';
  }
  return '<section class="manager-panel project-modules">'
    + '<div class="manager-panel-head project-modules-head"><div class="project-modules-title"><b>模块</b><span>'
    + modules.length + ' 个模块 · ' + total + ' 个工作项</span></div>'
    + '<div class="project-modules-tools">'
    + '<details class="manager-caliber project-modules-caliber"><summary>口径</summary><div>'
    + '模块指标与项目驾驶舱同一套公式：进度 = Σ工作项完成度 ÷ 工作项数；预估、实际、剩余按工作项汇总；偏差只取已完成且填了预估的工作项。'
    + 'Σ模块 + 未指定 = 项目合计；项目整体进度仍按全部工作项计算，不是模块百分比的平均。</div></details>'
    + (canManage ? '<button class="btn sm primary" type="button" data-module-add>+ 新增模块</button>' : '')
    + '</div></div>'
    + '<p class="project-modules-note">像项目一样看每个模块的进度、预估与实际；删除模块时，其下工作项与需求迁到目标模块。</p>'
    + '<div class="tbl-wrap"><table class="manager-tbl project-modules-tbl"><thead><tr>'
    + '<th>模块</th><th>进度</th><th class="num">工作项</th><th class="num">预估</th><th class="num">实际工时</th><th class="num">剩余</th><th class="num">偏差</th><th>风险</th>'
    + (canManage ? '<th class="num" aria-label="操作"></th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table></div>'
    + '<p class="project-modules-foot-note"><span class="project-modules-foot-main"><i class="project-modules-foot-info" aria-hidden="true">' + icon("infoCircle", 13) + '</i>'
    + '<span>未指定为没有模块归属的工作项，单独统计；模块合计 + 未指定 = 项目合计。项目整体进度仍按全部工作项计算，不是模块百分比的平均。</span></span>'
    + (canManage ? "" : "<span>仅空间主、管理员或项目负责人可维护模块。</span>") + '</p>'
    + '</section>';
}
function saveModule(){
  var nameEl = document.querySelector("[data-module-new-name]");
  var colorEl = document.querySelector("[data-module-new-color]");
  var name = nameEl ? nameEl.value.trim() : "";
  if(!name){ toast("请填写模块名称", "warn"); if(nameEl) nameEl.focus(); return; }
  var pid = cache && cache.project && cache.project.id;
  if(!pid) return;
  API.post("/api/categories?project=" + encodeURIComponent(pid), { name: name, color: colorEl ? colorEl.value : "" }).then(function(){
    toast("已添加模块「" + name + "」", "fs");
    moduleUi.adding = false;
    loadCategories(true);
    loadProject({ silent:true });
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
}
function deleteModule(id){
  var targetEl = document.querySelector("[data-module-target]");
  var target = targetEl ? targetEl.value : "";
  var query = target ? "?targetId=" + encodeURIComponent(target) : "";
  API.del("/api/categories/" + encodeURIComponent(id) + query).then(function(){
    toast(target ? "模块已删除，工作项与需求已迁移" : "模块已删除", "fs");
    moduleUi.deleting = "";
    loadCategories(true);
    loadProject({ silent:true });
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
}
function loadProjectDelivery(p){  if(!p || !p.id || deliveryCache[p.id]) return;
  deliveryCache[p.id] = {};
  var id = p.id;
  function paint(){
    var box = document.querySelector('[data-project-open="docs"]');
    if(!box || rt.managerProjectId !== id || currentMode() !== "board") return;
    var panel = box.closest(".project-delivery-grid");
    if(!panel) return;
    var data = deliveryCache[id] || {};
    var docsBtn = panel.querySelector('[data-project-open="docs"]');
    var casesBtn = panel.querySelector('[data-project-open="tests"]');
    var verBtn = panel.querySelector('[data-project-open="versions"]');
    if(docsBtn && data.docs !== null && data.docs !== undefined){
      docsBtn.querySelector("b").textContent = data.docs;
      docsBtn.querySelector("small").textContent = "需求 / 方案文档";
    }
    if(casesBtn && data.cases !== null && data.cases !== undefined){
      casesBtn.querySelector("b").textContent = data.cases;
      casesBtn.querySelector("small").textContent = (data.plans || 0) + " 个测试计划";
    }
    if(verBtn && data.versions !== null && data.versions !== undefined){
      verBtn.querySelector("b").textContent = data.versions;
      verBtn.querySelector("small").textContent = "首版 / 迭代";
    }
  }
  function fail(kind, ex){
    deliveryCache[id] = deliveryCache[id] || {};
    deliveryCache[id][kind] = null;
    var panel = document.querySelector(".project-delivery-grid");
    if(!panel) return;
    var btn = panel.querySelector('[data-project-open="' + (kind === "cases" ? "tests" : kind) + '"]');
    if(btn){ btn.querySelector("b").textContent = "—"; btn.querySelector("small").textContent = ex.message || "加载失败"; }
  }
  API.getAllPages("/api/req-docs", {}).then(function(rows){
    var n = rows.filter(function(d){ return d.reqId === id; }).length;
    deliveryCache[id].docs = n; paint();
  }).catch(function(ex){ fail("docs", ex); });
  API.get("/api/test-cases/stats", { reqId: id }).then(function(s){
    deliveryCache[id].cases = (s && s.total) || 0; paint();
  }).catch(function(ex){ fail("cases", ex); });
  API.getAllPages("/api/test-plans", { reqId: id }).then(function(rows){
    deliveryCache[id].plans = rows.length; paint();
  }).catch(function(){ deliveryCache[id].plans = 0; paint(); });
  API.get("/api/versions", { reqId: id }).then(function(rows){
    deliveryCache[id].versions = (rows || []).length; paint();
  }).catch(function(ex){ fail("versions", ex); });
}
function renderProject(){
  var p = cache.project || {}, m = cache.metrics || {}, c = cache.counts || {}, tasks = cache.tasks || [];
  var total = tasks.length, done = c.done || 0, progress = m.progressPct || 0;
  var options = selectableReqs().map(function(r){ return '<option value="' + esc(r.id) + '"' + (r.id === p.reqId ? ' selected' : '') + '>' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>'; }).join("");
  var deviation = m.deviationPct === null || m.deviationPct === undefined ? "—" : ((m.deviationPct > 0 ? "+" : "") + m.deviationPct + "%");
  var epics = cache.epics || [];
  var toolbar = '<div class="manager-toolbar"><div class="manager-project-picker">'
    + '<button class="btn sm ghost" type="button" id="btnProjectBack" title="返回项目列表">← 项目列表</button>'
    + '<b>' + esc(p.name || "项目驾驶舱") + '</b><select id="managerProjectSelect" aria-label="切换项目">' + options + '</select></div>'
    + '<div class="toolbar-right">' + modeSeg() + '<span class="tag tag-primary">整体完成 ' + progress + '%</span>' + fullscreenButtonHTML() + '</div></div>';
  var overview = caliberHTML('整体进度 = Σ工作项完成度 ÷ 工作项数；指标由工作项流转、预估与自动计时汇总，不提供手填项目进度。分布按看板列的处理规则归类：待处理含「等待接续」列，进行中含「正常处理」的自定义列，「执行结束」列单独计数、不计未完成。')
    + projectBrief(p, m, c, cache.members)
    + '<div class="manager-kpis">'
    + metric("计划周期", '<span class="manager-date-value">' + fmtDate(m.startDate) + ' → ' + fmtDate(m.dueDate) + '</span>', total + " 个工作项", "all")
    + metric("预估工时合计", fmtHours(m.estimateMinutes), "剩余 " + fmtHours(m.remainingMinutes), "estimate")
    + metric("实际投入", fmtHours(m.actualMinutes), "含进行中工作项", "actual")
    + metric("工时偏差（已完成工作项口径）", deviation, "（实际−预估）÷预估", "variance") + '</div>'
    + modulePanel(p, m, c)
    + '<div class="manager-two-col"><section class="manager-panel"><div class="manager-panel-head"><b>工作项分布</b><span>' + total + ' 个工作项</span></div>'
    + distRow("待处理", c.backlog || 0, total, "backlog") + distRow("进行中", c.doing || 0, total, "doing", "info")
    + (c.ended ? distRow("执行结束", c.ended, total, "ended") : "")
    + distRow("已完成", done, total, "done", "success") + distRow("逾期", c.overdue || 0, total, "overdue", "danger")
    + distRow("被阻塞", c.blocked || 0, total, "blocked", "warning") + '</section>'
    + '<section class="manager-panel"><div class="manager-panel-head"><b>近 8 周新增 / 完成</b><span>按周汇总</span></div>' + weeklyChart(cache.weekly || []) + '</section></div>'
    + deliveryPanel(p);
  var epicsPanel = '<section class="manager-panel"><div class="manager-panel-head"><b>史诗汇总</b><span>点击史诗查看子项</span></div>'
    + (epics.length ? epics.map(function(ep){
      return '<button class="manager-epic" type="button" data-epic="' + esc(ep.id) + '"><span><i class="tag tag-plum">史诗</i>' + esc(ep.title) + '</span><span class="progress"><i style="width:' + ep.progressPct + '%"></i></span><b>' + ep.done + ' / ' + ep.total + ' 子项 · ' + ep.progressPct + '%</b></button>';
    }).join("") : '<div class="manager-empty-cell">该项目还没有史诗</div>') + '</section>';
  var membersPanel = '<section class="manager-panel"><div class="manager-panel-head"><b>成员负载</b><span>剩余预估 ÷（剩余工作日 × ' + ((Math.round((Number(cache.capacityMinutesPerDay) || 480) / 6) / 10) + 'h') + '）</span></div>'
    + memberLabelFilters(cache.members || [], memberFilter, "project-member")
    + '<p class="roster-note">角色匹配本项目有效主角色或兼岗；下钻与导出使用相同成员范围。</p><button class="btn sm" type="button" data-project-member-export>导出当前成员负载</button>'
    + '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>成员</th><th class="num">未完成工作项</th><th class="num">剩余预估</th><th class="num">本周已计</th><th>负载</th><th>状态</th></tr></thead><tbody>'
    + memberRows(filteredProjectMembers()) + '</tbody></table></div></section>';
  var panel = projectTab === "epics" ? epicsPanel
    : (projectTab === "members" ? membersPanel
    : (projectTab === "roles" ? rosterPanel() : overview));
  $("projectBody").innerHTML = toolbar + projectTabBar() + '<div class="project-tab-panel" role="tabpanel">' + panel + '</div>';
  if(projectTab === "overview"){
    loadProjectDelivery(p);
    var moduleInput = document.querySelector("[data-module-new-name]");
    if(moduleUi.adding && moduleInput) moduleInput.focus();
  } else if(projectTab === "roles"){
    loadRoster(p.reqId || p.id);
  }
}
/* —— 全部项目透视：项目 → Epic → 任务 逐层展开 —— */
function loadDrill(opts){
  opts = opts || {};
  var body = $("projectBody");
  if(!body) return;
  var wsId = workspaceId();
  if(projectWorkspaceId !== wsId){ pfCache = null; expanded = {}; projectWorkspaceId = wsId; }
  var current = ++seq;
  if(!opts.silent && !pfCache) body.innerHTML = UI.skeletonCards(3);
  API.get("/api/manager/portfolio").then(function(data){
    if(current !== seq || wsId !== workspaceId()) return;
    pfCache = data; renderDrill();
  }).catch(function(ex){
    if(current === seq && wsId === workspaceId()) body.innerHTML = UI.errorState(ex.message);
  });
}
function statusName(st){
  return { active:"进行中", done:"已交付", hold:"已搁置" }[st] || st || "—";
}
function miniBar(pct){
  var n = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return '<span class="progress mini"><span class="bar"><i style="width:' + n + '%"></i></span><span class="pv">' + n + '%</span></span>';
}
function drillTasks(){ return (pfCache && pfCache.tasks) || []; }
function plainTasks(reqId){
  return drillTasks().filter(function(t){ return t.reqId === reqId && t.itemType !== "epic"; });
}
function epicTasks(reqId){
  return drillTasks().filter(function(t){ return t.reqId === reqId && t.itemType === "epic"; });
}
function childrenOf(epicId){
  return drillTasks().filter(function(t){ return t.epicId === epicId && t.itemType !== "epic"; });
}
function ungroupedOf(reqId){
  return plainTasks(reqId).filter(function(t){ return !t.epicId; });
}
function isDone(t){ return t.boardColumn === "done"; }
/* 与后端 TaskCalc.progressOf 同口径：已完成记 100，其余取记录进度 */
function taskPct(t){
  return isDone(t) ? 100 : Math.max(0, Math.min(100, Number(t.progress) || 0));
}
function avgPct(tasks){
  if(!tasks.length) return 0;
  var sum = 0;
  tasks.forEach(function(t){ sum += taskPct(t); });
  return Math.round(sum / tasks.length);
}
function countCols(tasks){
  var c = { backlog:0, doing:0, ended:0, done:0, overdue:0 };
  tasks.forEach(function(t){
    c[statusBucket(t)]++;
    if(dueState(t).kind === "over") c.overdue++;
  });
  return c;
}
function maxDue(tasks){
  var best = null;
  tasks.forEach(function(t){
    if(t.dueDate && (!best || String(t.dueDate) > String(best))) best = t.dueDate;
  });
  return best;
}
function sumMinutes(tasks, key){
  var n = 0;
  tasks.forEach(function(t){ n += Number(t[key]) || 0; });
  return n;
}
/** 「执行结束」不计未完成：附在已完成后单独标注，避免与已完成混算 */
function doneCell(done, ended){
  return (done || 0) + (ended ? ' <span class="muted" title="另有 ' + ended + ' 项在「执行结束」列">+' + ended + '</span>' : "");
}
function nums4(c){
  return '<td class="num">' + c.backlog + '</td><td class="num">' + c.doing + '</td><td class="num">' + doneCell(c.done, c.ended) + '</td>'
    + '<td class="num"' + (c.overdue ? ' style="color:var(--danger-fg)"' : "") + '>' + c.overdue + '</td>';
}
function caretBtn(key, open, label){
  return '<button class="manager-drill-caret' + (open ? " open" : "") + '" type="button" data-drill-toggle="' + esc(key)
    + '" aria-label="' + esc(label) + '" aria-expanded="' + open + '">' + icon("chevronRight", 12) + '</button>';
}
function caretPlaceholder(){
  return '<span class="manager-drill-caret" style="visibility:hidden" aria-hidden="true">' + icon("chevronRight", 12) + '</span>';
}
function drillName(level, inner){
  return '<td class="drill-name"><div class="manager-drill-name" style="padding-left:' + (level * 20) + 'px">' + inner + '</div></td>';
}
function emptyCols(n){
  var s = "";
  for(var i = 0; i < n; i++) s += '<td></td>';
  return s;
}
function drillTaskRow(t){
  return '<tr data-open-task="' + esc(t.id) + '" tabindex="0" title="打开工作项详情">'
    + drillName(2, caretPlaceholder() + '<div class="manager-task-title">' + typeBadgeHTML(t.itemType) + esc(t.title) + '</div>')
    + '<td>' + esc(taskStatusName(t)) + '</td>'
    + '<td class="num">' + taskPct(t) + '%</td>'
    + emptyCols(4)
    + '<td><span class="manager-person">' + avatarHTML(t.owner || "未", "sm") + esc(t.owner || "未指派") + '</span></td>'
    + '<td class="num">' + esc(fmtDate(t.dueDate)) + '</td>'
    + '<td class="num drill-cost">' + (t.estimateMinutes ? fmtMinutesShort(t.estimateMinutes) : "—") + '</td>'
    + '<td class="num drill-cost">' + (t.totalMinutes ? fmtMinutesShort(t.totalMinutes) : "—") + '</td></tr>';
}
function drillGroupRow(level, key, open, badge, title, kids, openAttr){
  var c = countCols(kids);
  var head = (kids.length ? caretBtn(key, open, "展开") : caretPlaceholder())
    + (badge || "")
    + (openAttr
      ? '<button class="manager-drill-link" type="button" data-drill-open="' + esc(openAttr) + '" title="查看工作项明细">' + esc(title) + '</button>'
      : '<span class="manager-drill-title">' + esc(title) + '</span>')
    + '<span class="manager-drill-count">' + c.done + ' / ' + kids.length + ' 完成</span>';
  return '<tr class="drill-group">'
    + drillName(level, head)
    + '<td><span class="tag ghost">' + (!kids.length ? "—" : (c.done === kids.length ? "已完成" : "进行中")) + '</span></td>'
    + '<td class="num">' + miniBar(avgPct(kids)) + '</td>'
    + nums4(c)
    + '<td></td>'
    + '<td class="num">' + esc(fmtDate(maxDue(kids))) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(sumMinutes(kids, "estimateMinutes")) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(sumMinutes(kids, "totalMinutes")) + '</td></tr>'
    + (open ? kids.map(drillTaskRow).join("") : "");
}
function drillProjectRow(p){
  var key = "p:" + p.reqId, open = !!expanded[key];
  var epics = epicTasks(p.reqId), un = ungroupedOf(p.reqId);
  var healthName = p.health === "green" ? "正常" : "需关注";
  var name = caretBtn(key, open, "展开项目")
    + '<i class="manager-light ' + esc(p.health) + '" title="' + healthName + '" aria-label="' + healthName + '"></i>'
    + '<button class="manager-project-name" type="button" data-open-project="' + esc(p.reqId) + '" title="打开项目驾驶舱">' + esc(p.name) + '</button>';
  var rows = '<tr class="drill-project">'
    + drillName(0, name)
    + '<td><span class="tag ghost">' + esc(statusName(p.status)) + '</span></td>'
    + '<td class="num">' + miniBar(p.progressPct) + '</td>'
    + '<td class="num">' + (p.backlog || 0) + '</td><td class="num">' + (p.doing || 0) + '</td><td class="num">' + doneCell(p.done, p.ended) + '</td>'
    + '<td class="num"' + (p.overdue ? ' style="color:var(--danger-fg)"' : "") + '>' + (p.overdue || 0) + '</td>'
    + '<td><span class="manager-avatars">' + (p.members || []).slice(0, 4).map(function(n){ return avatarHTML(n, "sm"); }).join("") + '</span></td>'
    + '<td class="num">' + esc(fmtDate(maxDue(plainTasks(p.reqId)))) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(p.estimateMinutes) + '</td>'
    + '<td class="num drill-cost">' + fmtHours(p.actualMinutes) + '</td></tr>';
  if(open){
    if(epics.length || un.length){
      rows += epics.map(function(ep){
        var ek = "e:" + ep.id;
        return drillGroupRow(1, ek, !!expanded[ek], '<i class="tag tag-plum">史诗</i>', ep.title, childrenOf(ep.id), ek);
      }).join("");
      if(un.length) rows += drillGroupRow(1, "g:" + p.reqId, !!expanded["g:" + p.reqId], "", "未归入史诗", un, "g:" + p.reqId);
    }else{
      rows += '<tr class="drill-empty"><td colspan="11" class="manager-empty-cell">该项目还没有工作项</td></tr>';
    }
  }
  return rows;
}
function sortedProjects(){
  var list = ((pfCache && pfCache.projects) || []).slice();
  if(drillOnlyRisk) list = list.filter(function(p){ return p.health !== "green"; });
  if(drillSort === "overdue") list.sort(function(a, b){
    return (b.overdue || 0) - (a.overdue || 0) || (a.progressPct || 0) - (b.progressPct || 0);
  });
  if(drillSort === "progress") list.sort(function(a, b){ return (a.progressPct || 0) - (b.progressPct || 0); });
  return list;
}
function drillControls(){
  function opt(v, label){
    return '<option value="' + v + '"' + (drillSort === v ? " selected" : "") + '>' + label + '</option>';
  }
  return '<select id="drillSort" class="mini-select" aria-label="项目排序">'
    + opt("default", "默认排序") + opt("overdue", "逾期优先") + opt("progress", "进度最低") + '</select>'
    + '<button class="btn sm" type="button" data-drill-risk aria-pressed="' + drillOnlyRisk + '">只看需关注</button>'
    + '<button class="btn sm" type="button" data-drill-expand>全部展开</button>'
    + '<button class="btn sm" type="button" data-drill-collapse>全部收起</button>'
    + '<button class="btn sm" type="button" data-drill-export>导出</button>';
}
function renderDrill(){
  var projects = sortedProjects();
  if(!drillInitialized && projects.length){
    drillInitialized = true;
    var first = projects[0];
    if(epicTasks(first.reqId).length || ungroupedOf(first.reqId).length) expanded["p:" + first.reqId] = true;
  }
  var head = '<tr><th>名称</th><th>状态</th><th class="num">进度</th><th class="num">待处理</th><th class="num">进行中</th>'
    + '<th class="num">已完成</th><th class="num">逾期</th><th>负责人</th><th class="num">截止</th>'
    + '<th class="num drill-cost">预估</th><th class="num drill-cost">实际</th></tr>';
  var body;
  if(projects.length){
    body = '<section class="manager-panel"><div class="tbl-wrap"><table class="manager-tbl manager-drill-tbl"><thead>' + head + '</thead><tbody>'
      + projects.map(drillProjectRow).join("") + '</tbody></table></div></section>';
  }else if(pfCache && (pfCache.projects || []).length){
    body = '<section class="manager-panel"><div class="manager-empty-cell">没有需要关注的项目</div></section>';
  }else{
    body = UI.emptyState({icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目。"});
  }
  $("projectBody").innerHTML = '<div class="manager-toolbar"><div><b>项目全局透视</b><span>逐层展开史诗与工作项</span></div>'
    + '<div class="toolbar-right">' + drillControls() + modeSeg() + fullscreenButtonHTML() + '</div></div>'
    + caliberHTML('进度 = Σ工作项完成度 ÷ 工作项数（与单项目驾驶舱同口径）；项目行统计该项目全部工作项（含史诗本身），史诗行只统计其子工作项，因此子行数字相加不等于项目行。项目名进入项目驾驶舱，史诗名称查看子工作项明细，工作项行打开详情。')
    + body;
}
function expandAllDrill(){
  ((pfCache && pfCache.projects) || []).forEach(function(p){
    var epics = epicTasks(p.reqId), un = ungroupedOf(p.reqId);
    if(epics.length || un.length) expanded["p:" + p.reqId] = true;
    epics.forEach(function(ep){ expanded["e:" + ep.id] = true; });
    if(un.length) expanded["g:" + p.reqId] = true;
  });
  renderDrill();
}
function collapseAllDrill(){
  expanded = {};
  renderDrill();
}
function hoursNum(minutes){
  return (Math.round((Number(minutes) || 0) / 60 * 10) / 10).toFixed(1);
}
function exportDrill(){
  if(!pfCache) return;
  var rows = [["项目透视", pfCache.today], [],
    ["层级","名称","所属项目","状态","健康度","进度","待处理","进行中","执行结束","已完成","逾期","负责人","截止","预估(小时)","实际(小时)"]];
  function taskRow(p, t){
    rows.push(["工作项", t.title, p.name, taskStatusName(t), "", taskPct(t) + "%", "", "", "", "", "",
      t.owner || "未指派", fmtDate(t.dueDate), hoursNum(t.estimateMinutes), hoursNum(t.totalMinutes)]);
  }
  function groupRow(p, name, kids){
    var c = countCols(kids);
    rows.push(["史诗", name, p.name, "", "", avgPct(kids) + "%", c.backlog, c.doing, c.ended, c.done, c.overdue, "",
      fmtDate(maxDue(kids)), hoursNum(sumMinutes(kids, "estimateMinutes")), hoursNum(sumMinutes(kids, "totalMinutes"))]);
    kids.forEach(function(t){ taskRow(p, t); });
  }
  (pfCache.projects || []).forEach(function(p){
    rows.push(["项目", p.name, p.name, statusName(p.status), p.health === "green" ? "正常" : "需关注",
      (p.progressPct || 0) + "%", p.backlog || 0, p.doing || 0, p.ended || 0, p.done || 0, p.overdue || 0,
      (p.members || []).join("、"), fmtDate(maxDue(plainTasks(p.reqId))),
      hoursNum(p.estimateMinutes), hoursNum(p.actualMinutes)]);
    epicTasks(p.reqId).forEach(function(ep){ groupRow(p, ep.title, childrenOf(ep.id)); });
    var un = ungroupedOf(p.reqId);
    if(un.length) groupRow(p, "未归入史诗", un);
  });
  downloadCsv("项目透视-" + pfCache.today + ".csv", rows);
  toast("已导出项目透视", "fs");
}
function metricTasks(kind){
  var rows = cache.tasks || [];
  if(kind === "backlog" || kind === "doing" || kind === "ended" || kind === "done") return rows.filter(function(t){ return statusBucket(t) === kind; });
  if(kind === "overdue") return rows.filter(function(t){ return dueState(t).kind === "over"; });
  if(kind === "blocked") return rows.filter(function(t){ return t.boardColumn !== "done" && t.blocked; });
  if(kind === "estimate") return rows.filter(function(t){ return t.estimateMinutes > 0; });
  if(kind === "actual") return rows.filter(function(t){ return t.totalMinutes > 0; });
  if(kind === "variance") return rows.filter(function(t){ return t.boardColumn === "done" && t.estimateMinutes > 0; });
  return rows;
}
function onClick(e){
  if(e.target.closest("#btnProjectBack")){
    window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:"projects" } }));
    return;
  }
  if(e.target.closest("[data-empty-action]")){ loadProject(); return; }
  var openRes = e.target.closest("[data-project-open]");
  if(openRes){
    var kind = openRes.dataset.projectOpen;
    var pid = (cache && cache.project && cache.project.id) || rt.managerProjectId;
    if(!pid) return;
    var go = function(view){ window.dispatchEvent(new CustomEvent("ds:route-go", { detail:{ view:view } })); };
    import("../core/view-loader.js").then(function(m){
      if(kind === "versions"){
        return m.loadView("phase").then(function(mod){
          if(mod && mod.setPhaseProject) mod.setPhaseProject(pid, "version");
          go("phase");
        });
      }
      if(kind === "docs"){
        return m.loadView("requirements").then(function(mod){
          if(mod && mod.setReqDocProjectFilter) mod.setReqDocProjectFilter(pid);
          go("requirements");
        });
      }
      return m.loadView("testcases").then(function(mod){
        if(mod && mod.setTcProject) mod.setTcProject(pid);
        go("testcases");
      });
    }).catch(function(ex){ toast(ex.message || "打开失败", "bad"); });
    return;
  }
  var tabBtn = e.target.closest("[data-project-tab]");
  if(tabBtn){ setProjectTab(tabBtn.dataset.projectTab); return; }
  if(e.target.closest("[data-roster-retry]")){
    loadRoster((cache && cache.project && cache.project.id) || rt.managerProjectId, true);
    return;
  }
  if(e.target.closest("[data-roster-options]")){
    var labelCtx = rosterContext();
    if(labelCtx && !rosterBusy()) import("../core/view-loader.js").then(function(m){ return m.loadView("settings"); }).then(function(){
      if(workspaceId() === labelCtx.workspaceId) window.dispatchEvent(new CustomEvent("ds:open-member-label-options"));
    }).catch(function(ex){ toast(ex.message || "候选设置打开失败", "bad"); });
    return;
  }
  if(e.target.closest("[data-roster-copy]")){ openRosterCopy(); return; }
  if(e.target.closest("[data-roster-batch]")){ saveRosterBatch(); return; }
  if(e.target.closest("[data-roster-unselect]")){ if(!rosterBusy()){ rosterUi.selected.clear(); paintRoster(); } return; }
  if(e.target.closest("[data-roster-clear]")){ rosterUi.companyName = ""; rosterUi.roleTitle = ""; paintRoster(); return; }
  var secondaryBtn = e.target.closest("[data-roster-secondary]");
  if(secondaryBtn){ saveRosterSecondary(secondaryBtn.dataset.rosterSecondary); return; }
  if(e.target.closest("[data-project-member-clear]")){ memberFilter = { companyName:"", roleTitle:"" }; renderProject(); return; }
  if(e.target.closest("[data-project-member-export]")){ exportProjectMembers(); return; }
  if(e.target.closest("[data-module-add]")){
    moduleUi.adding = true;
    moduleUi.deleting = "";
    renderProject();
    return;
  }
  if(e.target.closest("[data-module-cancel]")){ moduleUi.adding = false; renderProject(); return; }
  if(e.target.closest("[data-module-save]")){ saveModule(); return; }
  var moduleDel = e.target.closest("[data-module-del]");
  if(moduleDel){
    if((cache.modules || []).length <= 1){ toast("至少需要保留一个模块", "warn"); return; }
    moduleUi.deleting = moduleDel.dataset.moduleDel;
    moduleUi.adding = false;
    renderProject();
    return;
  }
  if(e.target.closest("[data-module-del-cancel]")){ moduleUi.deleting = ""; renderProject(); return; }
  var moduleDelConfirm = e.target.closest("[data-module-del-confirm]");
  if(moduleDelConfirm){ deleteModule(moduleDelConfirm.dataset.moduleDelConfirm); return; }
  var moduleRow = e.target.closest("[data-module-open]");
  if(moduleRow){
    var moduleId = moduleRow.dataset.moduleOpen;
    var moduleHit = moduleId === "__none" ? null : (cache.modules || []).filter(function(x){ return x.id === moduleId; })[0];
    openTaskTable((cache.project.name || "项目") + " · " + (moduleHit ? moduleHit.name : "未指定"), moduleTasksOf(moduleId));
    return;
  }
  var pvMode = e.target.closest("[data-pv-mode]");
  if(pvMode){
    var m = pvMode.dataset.pvMode;
    if(m === currentMode()) return;
    effectiveMode = m;
    renderAfterModeSwitch();
    listPrefs.setViewMode(VIEW_KEY, m).catch(function(ex){ toast(ex.message || "偏好保存失败", "bad"); });
    return;
  }
  if(pfCache){
    var toggle = e.target.closest("[data-drill-toggle]");
    if(toggle){
      var key = toggle.dataset.drillToggle;
      expanded[key] = !expanded[key];
      renderDrill();
      return;
    }
    if(e.target.closest("[data-drill-risk]")){
      drillOnlyRisk = !drillOnlyRisk;
      renderDrill();
      return;
    }
    if(e.target.closest("[data-drill-expand]")){ expandAllDrill(); return; }
    if(e.target.closest("[data-drill-collapse]")){ collapseAllDrill(); return; }
    if(e.target.closest("[data-drill-export]")){ exportDrill(); return; }
    var epicOpen = e.target.closest("[data-drill-open]");
    if(epicOpen){
      var ok = epicOpen.dataset.drillOpen, reqId = ok.substring(2);
      var proj = ((pfCache.projects) || []).filter(function(x){ return x.reqId === reqId; })[0];
      var prefix = proj ? proj.name + " · " : "";
      if(ok.charAt(0) === "e"){
        var ep = drillTasks().filter(function(t){ return t.id === reqId; })[0];
        openTaskTable(prefix + (ep ? ep.title : "史诗") + " · 子项", childrenOf(reqId));
      }else{
        openTaskTable(prefix + "未归入史诗", ungroupedOf(reqId));
      }
      return;
    }
    var open = e.target.closest("[data-open-project]");
    if(open){
      effectiveMode = "board";
      rt.managerProjectId = open.dataset.openProject;
      loadProject();
      return;
    }
    var task = e.target.closest("[data-open-task]");
    if(task){ openTaskById(task.dataset.openTask); return; }
  }
  var metricBtn = e.target.closest("[data-project-metric]");
  if(metricBtn){
    var kind = metricBtn.dataset.projectMetric;
    var names = {all:"全部工作项",backlog:"待处理",doing:"进行中",ended:"执行结束",done:"已完成",overdue:"逾期",blocked:"被阻塞",estimate:"有预估的工作项",actual:"有实际工时的工作项",variance:"已完成工作项工时偏差"};
    openTaskTable((cache.project.name || "项目") + " · " + names[kind], metricTasks(kind)); return;
  }
  var epic = e.target.closest("[data-epic]");
  if(epic){
    var id = epic.dataset.epic;
    var ep = (cache.epics || []).filter(function(x){ return x.id === id; })[0];
    openTaskTable((ep ? ep.title : "史诗") + " · 子项", (cache.tasks || []).filter(function(t){ return t.epicId === id; })); return;
  }
  var member = e.target.closest("[data-member-key]");
  if(member){
    var key = member.dataset.memberKey;
    var hit = filteredProjectMembers().filter(function(m){ return m.key === key; })[0];
    if(hit) openTaskTable(hit.name + " · 成员项目工作项", projectMemberTasks(key));
  }
}
function renderAfterModeSwitch(){
  if(currentMode() === "drill") loadDrill();
  else loadProject();
}
function onChange(e){
  if(e.target.id === "managerProjectSelect"){ rt.managerProjectId = e.target.value; loadProject(); }
  if(e.target.id === "drillSort"){ drillSort = e.target.value; renderDrill(); }
  var roleSel = e.target.closest("[data-roster-role]");
  if(roleSel){ saveRosterRole(roleSel); return; }
  var check = e.target.closest("[data-roster-check]"), all = e.target.closest("[data-roster-all]");
  if((check || all) && rosterContext() && !rosterBusy()){
    if(check){ if(check.checked) rosterUi.selected.add(check.dataset.rosterCheck); else rosterUi.selected.delete(check.dataset.rosterCheck); }
    else filteredRoster().forEach(function(m){ if(all.checked) rosterUi.selected.add(m.userId); else rosterUi.selected.delete(m.userId); });
    var id = check ? check.dataset.rosterCheck : null;
    paintRoster();
    var target = id ? Array.from(document.querySelectorAll("[data-roster-check]")).filter(function(el){ return el.dataset.rosterCheck === id; })[0] : document.querySelector("[data-roster-all]");
    if(target) target.focus();
    return;
  }
  if(e.target.matches("[data-roster-batch-role]")){ chooseRosterBatchRole(e.target); return; }
  var filter = e.target.closest("[data-roster-filter]");
  if(filter){ rosterUi[filter.dataset.rosterFilter] = filter.value; paintRoster(); var next = document.querySelector('[data-roster-filter="' + filter.dataset.rosterFilter + '"]'); if(next) next.focus(); }
  var mf = e.target.closest("[data-project-member-filter]");
  if(mf){ memberFilter[mf.dataset.projectMemberFilter] = mf.value; renderProject(); var field = document.querySelector('[data-project-member-filter="' + mf.dataset.projectMemberFilter + '"]'); if(field) field.focus(); }
}
/* 透视树行键盘可达：聚焦任务行后 Enter/空格打开详情 */
function onKeydown(e){
  var tab = e.target.closest && e.target.closest("[data-project-tab]");
  if(tab && ["ArrowLeft","ArrowRight","Home","End"].indexOf(e.key) !== -1){
    var tabs = ["overview","epics","members","roles"], index = tabs.indexOf(tab.dataset.projectTab);
    var next = e.key === "Home" ? 0 : (e.key === "End" ? tabs.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length);
    e.preventDefault(); setProjectTab(tabs[next]);
    var target = document.querySelector('[data-project-tab="' + tabs[next] + '"]'); if(target) target.focus();
    return;
  }
  if(e.key === "Enter" && e.target.matches && e.target.matches("[data-module-new-name]")){
    e.preventDefault();
    saveModule();
    return;
  }
  if(e.key !== "Enter" && e.key !== " ") return;
  var row = e.target.closest ? e.target.closest("tr[data-open-task]") : null;
  if(row && row === e.target){ e.preventDefault(); openTaskById(row.dataset.openTask); return; }
  var memberRow = e.target.closest ? e.target.closest("tr[data-member-key]") : null;
  if(memberRow && memberRow === e.target){ e.preventDefault(); memberRow.click(); return; }
  var moduleRow = e.target.closest ? e.target.closest("tr[data-module-open]") : null;
  if(moduleRow && moduleRow === e.target){ e.preventDefault(); moduleRow.click(); }
}
if($("projectBody")){
  $("projectBody").addEventListener("click", onClick);
  $("projectBody").addEventListener("change", onChange);
  $("projectBody").addEventListener("keydown", onKeydown);
}

export { enterProjectView, loadProject };
