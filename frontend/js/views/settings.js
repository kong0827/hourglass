/* views/settings · 设置（空间 / 工作流 / 数据 / 活动 / 账号） */

import { API } from "../core/api.js";
import { invalidateRules, loadRules } from "../core/transitions.js";
import { loadCategories, loadWorkspaces } from "../core/app.js";
import { attachCombo } from "../core/combo.js";
import { $, actCount, actList, btnNotifySave, channelCards, notifyStatus, notifyStatusText, searchInput, searchWrap, wsWebhookHint, wsWebhookLabel } from "../core/dom.js";
import { navTelemetryCsv } from "../core/nav-telemetry.js";
import { saveViewState } from "../core/filters-ui.js";
import { icon } from "../core/icons.js";
import { loadPriorities } from "../core/priorities.js";
import { canManageProject, catTag, roleReadOnly, rt, state, totalTaskCount } from "../core/state.js";
import { UI, copyToClipboard, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { triggerDownload } from "../lib/download.js";
import { companyChipHTML, companyEditChipHTML } from "../lib/company.js";
import { loadMemberLabelOptions, DEFAULT_ROLE_TITLES } from "../lib/member-labels.js";
import { BACKUP_NAME, CAT_DEFAULT_COLOR, avatarHTML, dayDiff, fmtShortMD, fmtTs, priTagHTML, startOfDay } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import { ganttState, syncGanttUndoUI } from "./gantt.js";
import { loadReqDocs } from "./requirements.js";

var trashList = $("trashList");
function loadTrash(opts){
  opts = opts || {};
  if(!opts.silent) trashList.innerHTML = UI.skeletonRows(4);
  API.getAllPages("/api/trash").then(function(list){
    renderTrash(list);
  }).catch(function(ex){
    trashList.innerHTML = UI.errorState(ex.message);
    bindRetry(trashList, function(){ loadTrash(); });
  });
}
function remainingDays(deletedAt){
  if(!deletedAt) return 30;
  var d = new Date(deletedAt);
  if(isNaN(d.getTime())) return 30;
  return Math.max(0, 30 - dayDiff(rt.TODAY, startOfDay(d)));
}
function renderTrash(list){
  if(!list || !list.length){
    trashList.innerHTML = UI.emptyState({
      icon:"trash", title:"回收站是空的", text:"删除的工作项会在这里保留 30 天，之后自动清理。"
    });
    return;
  }
  /* O-22：把"即将自动清理"显式说出来（≤3 天），避免用户以为删除后可以无限期找回 */
  var soon = list.filter(function(t){ return remainingDays(t.deletedAt) <= 3; });
  var html = "";
  if(soon.length){
    html += '<div class="trash-warn">' + icon("alert", 14) +
      '<span>' + soon.length + ' 项将在 3 天内被自动清理（保留 30 天后不可恢复），需要的话请先恢复。</span></div>';
  }
  var canPurge = !!(rt.currentWs && rt.currentWs.myRole === "owner");
  html += list.map(function(t){
    var rem = remainingDays(t.deletedAt);
    return '<div class="trash-item" data-trash-id="' + esc(t.id) + '">' +
      '<span class="ti-main">' +
        '<span class="ti-t">' + esc(t.title) + '</span>' +
        '<span class="ti-m' + (rem <= 3 ? " urgent" : "") + '">' +
          priTagHTML(t.priority) +
          catTag(t.categoryId) +
          '<span>删除于 ' + esc(fmtTs(t.deletedAt)) + ' · ' +
            (rem <= 3
              ? '<strong class="trash-soon">剩余 ' + rem + ' 天，即将自动清理</strong>'
              : '剩余 ' + rem + ' 天') +
          '</span>' +
        '</span>' +
      '</span>' +
      '<span class="ti-acts">' +
        '<button class="btn sm" type="button" data-trash-restore="' + esc(t.id) + '">恢复</button>' +
        (canPurge ? '<button class="btn sm danger" type="button" data-trash-purge="' + esc(t.id) + '">彻底删除</button>' : '') +
      '</span>' +
    '</div>';
  }).join("");
  trashList.innerHTML = html;
}
trashList.addEventListener("click", function(e){
  var rs = e.target.closest("[data-trash-restore]");
  if(rs){
    var id = rs.dataset.trashRestore;
    var row = rs.closest("[data-trash-id]");
    var title = row && row.querySelector(".ti-t") ? row.querySelector(".ti-t").textContent : "";
    if(row) row.remove();   // 乐观移除
    API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).then(function(){
      toast("已恢复「" + (title || "") + "」", "fs");
      loadTrash();
      loadBoard({animate:false});
      loadReqs();
    }).catch(function(ex){
      toast(ex.message || "恢复失败", "bad");
      loadTrash();
    });
    return;
  }
  var pg = e.target.closest("[data-trash-purge]");
  if(pg){
    if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可彻底删除工作项", "warn"); return; }
    var row2 = pg.closest("[data-trash-id]");
    var title2 = row2 && row2.querySelector(".ti-t") ? row2.querySelector(".ti-t").textContent : "";
    UI.showConfirm({
      title:"彻底删除",
      msg:"彻底删除后不可恢复（含子任务、附件、工时记录），确定删除「" + esc(title2 || "") + "」？",
      okText:"彻底删除"
    }).then(function(ok){
      if(!ok) return;
      API.del("/api/tasks/" + encodeURIComponent(pg.dataset.trashPurge) + "/purge").then(function(){
        toast("已彻底删除", "fs");
        loadTrash();
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
});
var wsNameInput = $("wsNameInput"), wsWebhook = $("wsWebhook"),
    wsMemberList = $("wsMemberList"), wsMemberName = $("wsMemberName"),
    colCfgList = $("colCfgList"), colNewName = $("colNewName"), colNewColor = $("colNewColor"), colNewRule = $("colNewRule");
var transMatrix = $("colTransMatrix"), transSummary = $("colTransSummary"),
    transHint = $("colTransHint"), btnTransReset = $("btnTransReset");
var transData = null;
var TRANS_LABELS = { allow:"允许", reason:"需填原因", deny:"禁止" };
var TRANS_FULL = { allow:"允许", reason:"需填原因", deny:"禁止" };
var TRANS_NEXT = { allow:"reason", reason:"deny", deny:"allow" };
/* 成员搜索选择器：用户先从候选列表选中，再点「添加成员」 */
var wsMemberSelected = null, wsMemberCandidates = {}, wsMemberTimer = null, wsMemberSeq = 0;
var ROLE_LABELS = { owner:"空间主", admin:"管理员", member:"成员", viewer:"查看者" };
var RULE_LABELS = { normal:"正常计时（算逾期）", waiting:"暂停计时（算逾期）", ended:"结束计时（不计逾期）" };
var FIXED_RULE_LABELS = {
  backlog:"不计时（算逾期）",
  doing:"正常计时（算逾期）",
  done:"结束计时（不计逾期）"
};
var RULE_TITLES = {
  normal:"可以计时，逾期照常计算",
  waiting:"停止计时，逾期照常计算（例如等待外部反馈）",
  ended:"停止计时，也不再计算逾期（例如待发布、待验收）"
};
function roleLabel(role){ return ROLE_LABELS[role] || ROLE_LABELS.member; }
function colRuleOptions(selected){
  return Object.keys(RULE_LABELS).map(function(k){
    return '<option value="' + k + '"' + (k === selected ? " selected" : "") +
      ' title="' + RULE_TITLES[k] + '">' + RULE_LABELS[k] + '</option>';
  }).join("");
}
function roleOptions(selected, allowAdmin){
  var roles = allowAdmin === false ? ["member","viewer"] : ["admin","member","viewer"];
  return roles.map(function(r){
    return '<option value="' + r + '"' + (r === selected ? " selected" : "") + '>' + roleLabel(r) + '</option>';
  }).join("");
}

var ROLE_GUIDE_YES = '<span class="perm-mark yes" aria-label="允许">✓</span>';
var ROLE_GUIDE_NO = '<span class="perm-mark no" aria-label="不允许">—</span>';
function roleGuideRow(cells){
  return "<tr>" + cells.map(function(c, i){
    return i === 0 ? '<th scope="row">' + c + "</th>" : '<td class="perm-cell">' + c + "</td>";
  }).join("") + "</tr>";
}
function roleGuideGroup(title){
  return '<tr class="perm-group"><th colspan="5" scope="colgroup">' + title + "</th></tr>";
}
function roleGuideTable(head, body){
  return '<div class="tbl-wrap"><table class="manager-tbl perm-matrix"><thead><tr>' +
    head.map(function(c, i){ return '<th' + (i ? ' class="perm-cell"' : '') + ">" + c + "</th>"; }).join("") +
    "</tr></thead><tbody>" + body + "</tbody></table></div>";
}
function openRoleGuide(){
  var roleRows = [
    roleGuideGroup("数据范围"),
    roleGuideRow(["查看项目与工作项", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "新成员仅已分配的项目；早期成员默认全部，设为「不可见」的除外", ROLE_GUIDE_YES]),
    roleGuideRow(["查看统计 / 报表 / 成员负载", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "按可见项目过滤", ROLE_GUIDE_YES]),
    roleGuideGroup("工作项"),
    roleGuideRow(["新建 / 编辑工作项", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "可见且可写的项目", ROLE_GUIDE_NO]),
    roleGuideRow(["删除工作项（进回收站）", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "可见且可写的项目", ROLE_GUIDE_NO]),
    roleGuideRow(["恢复回收站工作项", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "可见且可写的项目", ROLE_GUIDE_NO]),
    roleGuideRow(["彻底删除回收站工作项", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["添加 / 编辑 / 排序看板列", ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_NO]),
    roleGuideRow(["删除看板列", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["维护项目模块（添加 / 改名 / 排序 / 删除）", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "仅项目负责人", ROLE_GUIDE_NO]),
    roleGuideRow(["新建 / 编辑 / 改状态分支", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "项目可写", ROLE_GUIDE_NO]),
    roleGuideRow(["删除分支", ROLE_GUIDE_YES, ROLE_GUIDE_YES, "项目可写", ROLE_GUIDE_NO]),
    roleGuideRow(["甘特分享 / 清除基线", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideGroup("成员与空间"),
    roleGuideRow(["生成邀请链接", ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["调整成员角色", "除空间主外的角色", "仅成员 / 查看者", ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["移除成员", "除空间主外", "成员 / 查看者", ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["配置项目可见范围", ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["空间改名 / 推送配置", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["完整备份导出 / 导入 / 清空数据", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["导出工作项 CSV", ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_YES]),
    roleGuideRow(["删除共享空间", ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO, ROLE_GUIDE_NO])
  ].join("");

  var menuRows = [
    roleGuideRow(["我的工作、周回顾", "可见", "可见", "可见", "可见"]),
    roleGuideRow(["需求池、项目（含全局健康度）、版本、文档", "可见", "可见", "可见（按可见项目过滤）", "可见"]),
    roleGuideRow(["工作项（看板/列表/日历/甘特）、测试、分支", "可见", "可见", "可见（不可见项目的工作项不出现）", "可见"]),
    roleGuideRow(["报表（趋势与分布/完成记录/流程体检/交付图表）", "可见", "可见", "可见（按可见项目过滤）", "可见"]),
    roleGuideRow(["成员负载、逾期与阻塞", "可见", "可见", "可见（按可见项目过滤）", "可见"]),
    roleGuideRow(["设置、个人设置", "可见", "可见", "可见（编辑项受角色限制）", "可见（只读）"])
  ].join("");

  var settingsRows = [
    roleGuideRow(["空间 / 成员与权限 / 工作流 / 通知与集成 / 数据与审计", "所有空间角色可见", "所有空间角色可见", "所有空间角色可见", "所有空间角色可见"]),
    roleGuideRow(["项目可见范围", ROLE_GUIDE_YES, ROLE_GUIDE_YES, ROLE_GUIDE_NO, ROLE_GUIDE_NO]),
    roleGuideRow(["平台（账号管理 / 系统信息 / 审计日志）", "仅平台管理员", "仅平台管理员", "仅平台管理员", "仅平台管理员"]),
    roleGuideRow(["通知与集成 → SMTP 邮件配置", "仅平台管理员", "仅平台管理员", "仅平台管理员", "仅平台管理员"])
  ].join("");

  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "角色权限说明");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML =
    '<div class="sheet perm-guide-sheet">' +
      '<div class="sheet-head">' +
        '<div style="flex:1;min-width:0">' +
          '<h2>角色权限说明</h2>' +
          '<div class="desc">勾选表示允许，「—」表示不允许。能力口径与后端校验一致；成员的数据范围还会受项目可见范围影响。</div>' +
        '</div>' +
        '<button class="icon-btn sm" type="button" data-role-guide-close aria-label="关闭">' + icon("close", 15) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<section class="perm-sect"><h4>空间角色权限</h4>' +
          roleGuideTable(["能力", "空间主", "管理员", "成员", "查看者"], roleRows) +
        '</section>' +
        '<section class="perm-sect"><h4>可访问菜单</h4>' +
          roleGuideTable(["菜单", "空间主", "管理员", "成员", "查看者"], menuRows) +
          '<p class="perm-note">当前版本不按角色隐藏侧栏菜单：四种空间角色看到同一套 12 个菜单，差异体现在页面内按钮和数据范围。查看者可见全部菜单，但所有写操作都会被拒绝；成员可见全部菜单，但「不可见」项目的工作项、文档和报表数据会被过滤。</p>' +
        '</section>' +
        '<section class="perm-sect"><h4>设置内入口差异</h4>' +
          roleGuideTable(["入口", "空间主", "管理员", "成员", "查看者"], settingsRows) +
          '<p class="perm-note">「平台管理员」是账号级身份，与空间角色无关：它额外可见「设置 → 平台 → 账号管理」和「通知与集成 → SMTP 邮件配置」，但不会自动获得任何空间的角色。以上为界面展示口径，最终以后端校验为准。</p>' +
        '</section>' +
      '</div>' +
    '</div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-role-guide-close]")) UI.closeModal(layer);
  });
  UI.openModal(layer, "[data-role-guide-close]");
}
var btnRoleGuide = $("btnRoleGuide");
if(btnRoleGuide){
  btnRoleGuide.innerHTML = icon("infoCircle", 14) + "<span>角色权限说明</span>";
  btnRoleGuide.addEventListener("click", openRoleGuide);
}
function enterSettingsView(){
  if(!rt.currentWs || !wsNameInput) return;
  rt.settingsReady = true;
  if(rt.projectAccessCache && rt.projectAccessCache.wsId !== rt.currentWs.id) rt.projectAccessCache = null;
  var isOwner = rt.currentWs.myRole === "owner";
  var myRole = rt.currentWs.myRole || "member";
  var isManager = isOwner || myRole === "admin";
  var isPersonal = rt.currentWs.type === "personal";
  if(btnRoleGuide) btnRoleGuide.hidden = isPersonal;
  $("wsTypeHint").textContent = isPersonal
    ? "个人空间 · 仅自己可见"
    : ("共享空间 · " + (isOwner ? "你是空间主" : "你是" + roleLabel(myRole)) + "（" + (rt.currentWs.memberCount || 0) + " 人）");
  wsNameInput.value = rt.currentWs.name;
  wsNameInput.disabled = isPersonal || !isOwner;
  wsWebhook.value = rt.currentWs.notifyWebhook || "";
  $("btnWsSave").disabled = !isOwner;
  $("wsSaveNote").textContent = isOwner ? "改动立即生效" : "仅空间主可修改名称与推送";
  /* O-1：通知推送面板按角色门控，并读取真实生效状态 */
  var canNotify = isOwner;
  ["wsNotifyInAppEnabled","wsNotifyEnabled","wsWebhook","wsNotifyToken","wsNotifyClearToken"].forEach(function(id){
    if($(id)) $(id).disabled = !canNotify;
  });
  if(btnNotifySave) btnNotifySave.disabled = !canNotify;
  if($("btnNotifyTest")) $("btnNotifyTest").disabled = !canNotify;
  var nh = $("notifyHint");
  if(nh) nh.textContent = canNotify
    ? "改动立即生效；站内通知与外部推送可分别开关（测试推送只走外部渠道）"
    : "仅空间主可配置与测试";
  /* 按登录名直接加人只有平台管理员可用；普通空间主只能走邀请链接（对方确认后加入） */
  var isAdmin = !!(rt.currentUser && rt.currentUser.role === "admin");
  $("wsMemberAdd").hidden = !(isOwner && isAdmin);
  resetMemberPicker();
  if($("wsMemberHint")) $("wsMemberHint").hidden = isPersonal || isAdmin;
  var canInvite = !isPersonal && isManager;
  $("inviteBox").hidden = !canInvite;
  if($("inviteHint")) $("inviteHint").textContent =
    "把链接发给已有账号的同事：对方登录后打开链接即可加入。生成时可先分配项目权限；未分配的项目加入后不可见，之后可随时调整。";
  updateInviteAccountHint(isAdmin);
  if($("setTabPlatform")) $("setTabPlatform").hidden = !isAdmin;
  if(isPersonal){
    wsMemberList.innerHTML = '<div class="foot-note">个人空间没有其他成员。</div>';
    $("wsMemberCount").textContent = "";
  }else{
    loadWsMemberList();
    if(canInvite) loadInvites();
  }
  $("btnWsLeave").hidden = isPersonal || isOwner;
  $("btnWsDelete").hidden = isPersonal || !isOwner;
  $("wsFootHint").textContent = isPersonal
    ? "清空任务数据仅空间主可操作"
    : (isOwner ? "危险操作仅空间主可执行；删除空间会连同其数据一起删除" : "完整备份导出、清空任务数据、导入覆盖与删除看板列仅空间主可操作");
  /* 完整备份导入/导出与清空在后端均要求空间主；CSV 导出对所有角色开放 */
  ["btnExport", "btnImport", "btnReset"].forEach(function(id){
    var el = $(id);
    if(!el) return;
    if(!el.dataset.ownerTitle) el.dataset.ownerTitle = el.title || "";
    el.disabled = !isOwner;
    el.title = isOwner ? el.dataset.ownerTitle : "仅空间主可操作";
  });
  loadColCfg();
  loadPriorityCfg();
  loadNotifyStatus();
  loadActivity();
  initSetTabs();
  initPlatformTabs();
  setSettingsTab(settingsTab);
}
var settingsTab = "space";
var platformTab = "account";
function setSettingsTab(tab){
  var prevTab = settingsTab;
  var isAdmin = !!(rt.currentUser && rt.currentUser.role === "admin");
  var myRole = rt.currentWs && rt.currentWs.myRole;
  var isManager = myRole === "owner" || myRole === "admin";
  var isPersonal = !!(rt.currentWs && rt.currentWs.type === "personal");
  /* 兼容旧页签名：account/system→平台（并落到对应二级分区），access→成员与权限，activity→数据与审计 */
  var legacyPlatformTab = null;
  if(tab === "account" || tab === "system"){
    legacyPlatformTab = tab;
    tab = "platform";
  }
  if(tab === "access") tab = "members";
  if(tab === "activity") tab = "data";
  if(tab === "platform" && !isAdmin) tab = "space";
  if(legacyPlatformTab) platformTab = legacyPlatformTab;
  settingsTab = tab;
  document.querySelectorAll("#setTabs [data-set-tab]").forEach(function(b){
    var on = b.dataset.setTab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("#view-settings [data-set-pane]").forEach(function(p){
    p.hidden = p.dataset.setPane !== tab;
  });
  /* 项目可见范围与成员同属权限域，但只对管理者可见 */
  if($("set-access")) $("set-access").hidden = !(tab === "members" && isManager && !isPersonal);
  /* SMTP 配置在「通知与集成」页里，仅平台管理员可见 */
  if($("set-mail")) $("set-mail").hidden = tab !== "integration" || !isAdmin;
  if(tab === "data") loadTrash({silent:true});
  if(tab === "workflow") loadWsCatProjects();
  /* 切换页签时清掉成员搜索残留：避免上一次选中的账号在下一次打开时仍留在输入框里 */
  if(prevTab !== tab && (prevTab === "members" || tab === "members")) resetMemberPicker();
  if(tab === "members" && isManager && !isPersonal) loadProjectAccess();
  if(tab === "integration" && isAdmin) loadMailSettings();
  if(tab === "platform" && isAdmin) setPlatformTab(platformTab);
}
function initSetTabs(){
  var box = $("setTabs");
  if(!box || box.__wired) return;
  box.__wired = true;
  box.addEventListener("click", function(e){
    var b = e.target.closest("[data-set-tab]");
    if(b) setSettingsTab(b.dataset.setTab);
  });
}
function initPlatformTabs(){
  var box = $("platformBar");
  if(!box || box.__wired) return;
  box.__wired = true;
  box.addEventListener("click", function(e){
    var b = e.target.closest("[data-platform-tab]");
    if(b) setPlatformTab(b.dataset.platformTab);
  });
}
/* 平台下再分三段：账号管理 / 系统信息 / 审计日志。只有平台管理员能进「平台」。 */
function setPlatformTab(tab){
  if(tab !== "system" && tab !== "audit") tab = "account";
  platformTab = tab;
  var sys = $("set-system"), acc = $("set-account");
  if(acc) acc.hidden = tab !== "account";
  if(sys) sys.hidden = !(tab === "system" || tab === "audit");
  document.querySelectorAll("#set-system [data-platform-sub]").forEach(function(el){
    el.hidden = el.dataset.platformSub !== tab;
  });
  document.querySelectorAll("#platformBar [data-platform-tab]").forEach(function(b){
    var on = b.dataset.platformTab === tab;
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(!(rt.currentUser && rt.currentUser.role === "admin")) return;
  if(tab === "account") enterUsersView();
  else if(tab === "system") loadSystemInfo();
  else loadAudit(1);
}
/* 路由回刷：只刷新当前平台分区，避免切回页面时三个分区一起发请求 */
function refreshPlatformTab(){
  if(settingsTab !== "platform") return;
  if(!(rt.currentUser && rt.currentUser.role === "admin")) return;
  if(platformTab === "account"){ loadUsers(true); loadUserMemberships(); }
  else if(platformTab === "system") loadSystemInfo();
  else loadAudit(auditState.page || 1);
}
function loadWsMemberList(){
  wsMemberList.innerHTML = UI.skeletonRows(2);
  var rawWsId = rt.currentWs.id;
  var wsId = encodeURIComponent(rawWsId);
  var myRole = rt.currentWs.myRole;
  var isOwner = myRole === "owner";
  var isManager = isOwner || myRole === "admin";
  var render = function(){
    $("wsMemberCount").textContent = "共 " + rt.wsMembersCache.length + " 人";
    wsMemberList.innerHTML = (rt.currentWs.type === "shared"
      ? '<div class="member-label-toolbar foot-note">默认职能用于本空间所有项目；项目角色留空时自动沿用，已有项目覆盖不变。'
        + (isManager ? ' <button class="btn sm" type="button" data-member-label-options>管理公司与角色候选</button>' : '') + '</div>' : '')
      + rt.wsMembersCache.map(function(m){
      var isSelf = rt.currentUser && m.userId === rt.currentUser.id;
      var role = m.role || "member";
      /* 空间主不进入角色下拉（后端禁止改空间主）；管理员只能处理成员与查看者 */
      var canManageRow = role !== "owner" && (isOwner || (isManager && role !== "admin"));
      var canRemove = isSelf ? role !== "owner" : (canManageRow && role !== "owner");
      var roleCell = canManageRow
        ? '<select class="mini-select" data-member-role aria-label="空间角色" title="调整空间角色">' +
            roleOptions(role, isOwner) + '</select>'
        : '<span class="tag ' + (role === "owner" ? "tag-primary" : "tag-ghost") + '">' +
            roleLabel(role) + '</span>';
      var sub = "@" + esc(m.username);
      var vis = memberVisibilityText(m);
      if(vis) sub += ' · ' + vis;
      var company = "";
      if(rt.currentWs.type === "shared"){
        company = isManager
          ? companyEditChipHTML(m.companyName, m.userId)
          : companyChipHTML(m.companyName);
      }
      var job = "";
      if(rt.currentWs.type === "shared"){
        job = isManager ? '<button class="org-chip editable" type="button" data-member-job-title="' + esc(m.userId) + '" title="设置空间默认职能（项目可覆盖，不改变权限）">职能 · ' + esc(m.jobTitle || "未设置") + '</button>'
          : '<span class="org-chip">职能 · ' + esc(m.jobTitle || "未设置") + '</span>';
      }
      var assignBtn = (canManageRow && role === "member")
        ? '<button class="btn sm" type="button" data-assign-projects="' + esc(m.userId) + '">分配项目</button>'
        : '';
      var removeBtn = canRemove
        ? '<button class="btn sm danger" type="button" data-mid-del="' + esc(m.userId) + '">' +
            (isSelf ? "退出" : "移除") + '</button>'
        : '';
      return '<div class="member-row" data-mid="' + esc(m.userId) + '">' +
        avatarHTML(m.displayName, "lg") +
        '<span class="mi"><span class="nm"><span class="nm-text">' + esc(m.displayName) + '</span>' + company + job + '</span>' +
          '<span class="sub">' + sub + '</span></span>' +
        roleCell +
        ((assignBtn || removeBtn) ? '<span class="acts">' + assignBtn + removeBtn + '</span>' : '') +
      '</div>';
    }).join("");
  };
  API.get("/api/workspaces/" + wsId + "/members").then(function(list){
    /* 请求期间切换了空间：丢弃旧空间的结果，避免覆盖新空间的成员列表 */
    if(!rt.currentWs || rt.currentWs.id !== rawWsId) return;
    rt.wsMembersCache = list || [];
    window.dispatchEvent(new CustomEvent("ds:member-roster-changed", {detail:{workspaceId:rawWsId}}));
    /* 可见项目数来自矩阵接口：只有管理者能读，读不到就不显示这一项 */
    if(isManager && !(rt.projectAccessCache && rt.projectAccessCache.wsId === rawWsId)){
      fetchAccessData(rawWsId).then(render, render);
      return;
    }
    render();
  }).catch(function(ex){
    wsMemberList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function memberVisibilityText(m){
  var data = rt.projectAccessCache;
  if(!data || !rt.currentWs || data.wsId !== rt.currentWs.id) return "";
  var projects = data.projects || [];
  var role = m.role || "member";
  if(!projects.length) return role === "member" && m.projectAccessMode === "assigned" ? "按项目分配" : "";
  if(role !== "member") return (role === "viewer" ? "只读全部 " : "可见全部 ") + projects.length + " 个项目";
  /* 缺记录按成员模式回落：按项目分配的新成员缺记录即不可见，存量成员缺记录仍可参与 */
  var raw = {};
  (data.grants || []).forEach(function(g){
    if(g && g.userId === m.userId && g.projectId) raw[g.projectId] = g.access;
  });
  var visible = 0, readOnly = 0;
  projects.forEach(function(p){
    var v = effectiveGrant(raw[p.id], m);
    if(v !== "none") visible++;
    if(v === "read") readOnly++;
  });
  var assigned = m.projectAccessMode === "assigned";
  if(!visible && assigned) return "尚未分配项目";
  return "可见 " + visible + "/" + projects.length + " 个项目" +
    (readOnly ? ("（其中 " + readOnly + " 个只读）") : "") +
    (assigned ? " · 按项目分配" : "");
}
var memberLabelDialog = null;
function canManageMemberLabels(){ return rt.currentWs && rt.currentWs.type === "shared" && ["owner", "admin"].indexOf(rt.currentWs.myRole) !== -1; }
function memberLabelLayer(title, desc, content){
  if(memberLabelDialog) UI.closeModal(memberLabelDialog);
  var layer = document.createElement("div"), titleId = "memberLabelTitle" + Date.now();
  layer.className = "modal-layer"; layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-labelledby", titleId);
  layer.innerHTML = '<form class="sheet xs" novalidate><div class="sheet-head"><div style="flex:1;min-width:0"><h2 id="' + titleId + '">' + esc(title) + '</h2><div class="desc">' + esc(desc) + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-label-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body">' + content + '<p class="foot-note" data-label-error role="alert"></p></div>'
    + '<div class="sheet-foot"><button class="btn" type="button" data-label-close>取消</button><button class="btn primary" type="submit">保存</button></div></form>';
  layer.__uiOnClose = function(){ if(memberLabelDialog === layer) memberLabelDialog = null; setTimeout(function(){ layer.remove(); }, 220); };
  layer.addEventListener("click", function(e){ if(e.target.closest("[data-label-close]")) UI.closeModal(layer); });
  document.body.appendChild(layer); memberLabelDialog = layer;
  UI.openModal(layer, "input,textarea"); return layer;
}
function editMemberLabel(userId, kind){
  var m = (rt.wsMembersCache || []).filter(function(x){ return x.userId === userId; })[0];
  if(!m || !canManageMemberLabels()) return;
  var wsId = rt.currentWs.id, isJob = kind === "job-title", field = isJob ? "jobTitle" : "companyName", max = isJob ? 32 : 64;
  var inputId = "memberLabelInput" + Date.now();
  var layer = memberLabelLayer((isJob ? "默认职能" : "公司") + " · " + (m.displayName || m.username || userId),
    isJob ? "维护一次，本空间各项目默认沿用；项目覆盖优先。留空清除默认职能，不改变权限。"
      : "选择已有公司或输入新名称；请避免同一公司的不同写法。留空清除，不改变权限。",
    '<div class="field"><label for="' + inputId + '">' + (isJob ? "空间默认职能" : "公司名称") + '</label>'
      + '<input id="' + inputId + '" type="text" list="' + inputId + 'Options" maxlength="' + max + '" autocomplete="off" value="' + esc(m[field] || "") + '" placeholder="' + (isJob ? "例如：全栈工程师 / 产品经理" : "选择或输入公司") + '">'
      + '<datalist id="' + inputId + 'Options"></datalist><small class="foot-note">可选择候选或直接输入新的名称。</small></div>');
  var input = layer.querySelector("input"), err = layer.querySelector("[data-label-error]"), form = layer.querySelector("form"), busy = false;
  var combo = attachCombo(input, { chevron:true });
  loadMemberLabelOptions(wsId).then(function(options){
    var titles = options[isJob ? "roleTitles" : "companyNames"] || [];
    layer.querySelector("datalist").innerHTML = titles.map(function(v){ return '<option value="' + esc(v) + '"></option>'; }).join("");
    if(combo) combo.refresh();
  }).catch(function(){ err.textContent = "候选加载失败，仍可手动输入；保存时会校验。"; });
  form.addEventListener("submit", function(e){
    e.preventDefault(); if(busy) return;
    if(!rt.currentWs || rt.currentWs.id !== wsId){ err.textContent = "空间已切换，请关闭并在当前空间重新操作。"; return; }
    var value = input.value.trim(); if(value.length > max){ err.textContent = "最多 " + max + " 个字符"; input.focus(); return; }
    var body = {}; body[field] = value;
    busy = true; form.querySelectorAll("button,input").forEach(function(el){ el.disabled = true; }); err.textContent = "保存中…";
    API.put("/api/workspaces/" + encodeURIComponent(wsId) + "/members/" + encodeURIComponent(userId) + "/" + kind, body).then(function(){
      m[field] = value;
      UI.closeModal(layer);
      window.dispatchEvent(new CustomEvent(isJob ? "ds:member-job-title-changed" : "ds:member-company-changed", {detail:{workspaceId:wsId, userId:userId, jobTitle:isJob ? value : undefined, companyName:isJob ? undefined : value}}));
      if(rt.currentWs && rt.currentWs.id === wsId) loadWsMemberList();
      toast(value ? "已保存" + (isJob ? "默认职能" : "公司") + "「" + value + "」" : "已清除" + (isJob ? "默认职能" : "公司"), "fs");
    }).catch(function(ex){ busy = false; form.querySelectorAll("button,input").forEach(function(el){ el.disabled = false; }); err.textContent = ex.message || "保存失败，请重试"; });
  });
}
function editMemberCompany(userId){ editMemberLabel(userId, "company"); }
var CAND_OPTIONS = {
  role: { label:"角色 / 职能候选", max:32, placeholder:"输入角色后按 Enter" },
  company: { label:"公司候选", max:64, placeholder:"输入公司后按 Enter" }
};
var CAND_MAX_ITEMS = 100;
function candSectHTML(kind, inputId){
  var cfg = CAND_OPTIONS[kind];
  return '<section class="cand-sect" data-cand="' + kind + '">' +
    '<div class="cand-head"><label for="' + inputId + '">' + cfg.label + '</label>' +
      '<span class="cand-count" data-cand-count></span></div>' +
    '<div class="tag-input-wrap cand-editor" data-cand-editor>' +
      '<input id="' + inputId + '" type="text" autocomplete="off" maxlength="' + cfg.max + '" placeholder="' + cfg.placeholder + '">' +
    '</div>' +
    '<p class="cand-note">按 Enter 或逗号添加，可粘贴多行；单条最多 ' + cfg.max + ' 字，最多 ' + CAND_MAX_ITEMS + ' 项。</p>' +
  '</section>';
}
function openMemberLabelOptions(){
  if(!canManageMemberLabels()){ toast("仅空间主或管理员可维护角色候选", "warn"); return; }
  var wsId = rt.currentWs.id;
  var layer = memberLabelLayer("公司与角色候选", "维护后供成员标注与筛选选择，内置角色及已使用标签会自动保留为建议；删除候选不会清除成员标签或改变权限。",
    candSectHTML("role", "memberRoleOptions") + candSectHTML("company", "memberCompanyOptions"));
  var form = layer.querySelector("form"), err = layer.querySelector("[data-label-error]"), busy = true;
  var lists = { role:[], company:[] }, editors = {};
  function setErr(text, isError){ err.textContent = text; err.classList.toggle("is-error", !!isError); }
  ["role","company"].forEach(function(kind){
    var cfg = CAND_OPTIONS[kind], sect = layer.querySelector('[data-cand="' + kind + '"]');
    var wrap = sect.querySelector("[data-cand-editor]"), input = wrap.querySelector("input"), count = sect.querySelector("[data-cand-count]");
    function render(){
      wrap.querySelectorAll(".tag").forEach(function(el){ el.remove(); });
      lists[kind].forEach(function(v, i){
        var chip = document.createElement("span");
        chip.className = "tag cand-chip"; chip.title = v;
        chip.innerHTML = '<span class="ct">' + esc(v) + '</span>' +
          '<button class="x" type="button" data-cand-del="' + i + '" aria-label="移除 ' + esc(v) + '">' + icon("close", 10) + '</button>';
        wrap.insertBefore(chip, input);
      });
      count.textContent = lists[kind].length ? lists[kind].length + " 项" : "未设置";
    }
    /* 返回 false 表示有内容被拒，调用方应中止保存，避免静默丢弃输入 */
    function add(raw){
      var rejected = "";
      String(raw || "").split(/[\r\n,，、;；]+/).forEach(function(part){
        var v = part.trim(); if(!v) return;
        if(v.length > cfg.max){ rejected = rejected || (cfg.label + "：单条最多 " + cfg.max + " 字，「" + (v.length > 10 ? v.slice(0, 10) + "…" : v) + "」未添加"); return; }
        if(lists[kind].indexOf(v) !== -1) return;
        if(lists[kind].length >= CAND_MAX_ITEMS){ rejected = rejected || (cfg.label + "最多 " + CAND_MAX_ITEMS + " 项"); return; }
        lists[kind].push(v);
      });
      setErr(rejected, !!rejected); render();
      return !rejected;
    }
    editors[kind] = { input:input, add:add, render:render };
    input.addEventListener("keydown", function(e){
      if(e.isComposing) return;
      if(e.key === "Enter" || e.key === "," || e.key === "，" || e.key === "、"){
        e.preventDefault(); add(input.value); input.value = "";
      }else if(e.key === "Backspace" && !input.value && lists[kind].length){
        lists[kind].pop(); setErr(""); render();
      }
    });
    /* 失焦提交半成品输入，避免点保存时把刚输入的内容丢掉 */
    input.addEventListener("blur", function(){ if(input.value.trim()){ add(input.value); input.value = ""; } });
    input.addEventListener("paste", function(e){
      var text = (e.clipboardData || window.clipboardData).getData("text") || "";
      if(!/[\r\n,，、;；]/.test(text)) return;
      e.preventDefault(); add(text);
    });
    wrap.addEventListener("mousedown", function(e){
      /* 阻止移除按钮抢走输入焦点：避免 blur 先重渲染导致这一次点击丢失 */
      if(e.target.closest("[data-cand-del]")) e.preventDefault();
    });
    wrap.addEventListener("click", function(e){
      var del = e.target.closest("[data-cand-del]");
      if(del){ lists[kind].splice(Number(del.dataset.candDel), 1); setErr(""); render(); return; }
      if(!e.target.closest("button")) input.focus();
    });
    render();
  });
  function setBusy(state){
    busy = state;
    form.querySelector('[type="submit"]').disabled = state;
    ["role","company"].forEach(function(kind){ editors[kind].input.disabled = state; });
  }
  function flushPending(){
    var ok = true;
    ["role","company"].forEach(function(kind){
      if(!ok) return;
      var val = editors[kind].input.value;
      if(val.trim()){ if(!editors[kind].add(val)) ok = false; editors[kind].input.value = ""; }
    });
    return ok;
  }
  setBusy(true); setErr("加载中…");
  loadMemberLabelOptions(wsId, true).then(function(options){
    lists.role = (options.roleTitles || DEFAULT_ROLE_TITLES).slice();
    lists.company = (options.companyNames || []).slice();
    editors.role.render(); editors.company.render();
    setBusy(false); setErr("");
    editors.role.input.focus();
  }).catch(function(ex){ setErr(ex.message || "加载失败，请关闭后重试", true); });
  form.addEventListener("submit", function(e){
    e.preventDefault(); if(busy) return;
    if(!rt.currentWs || rt.currentWs.id !== wsId){ setErr("空间已切换，请关闭并重新操作。", true); return; }
    if(!flushPending()) return;
    var body = { roleTitles:lists.role.slice(), companyNames:lists.company.slice() };
    setBusy(true); setErr("保存中…");
    API.put("/api/workspaces/" + encodeURIComponent(wsId) + "/member-label-options", body).then(function(){
      UI.closeModal(layer); window.dispatchEvent(new CustomEvent("ds:member-label-options-changed", {detail:{workspaceId:wsId}})); toast("已保存公司与角色候选", "fs");
    }).catch(function(ex){ setBusy(false); setErr(ex.message || "保存失败，请重试", true); });
  });
}
window.addEventListener("ds:open-member-label-options", openMemberLabelOptions);
wsMemberList.addEventListener("change", function(e){
  var sel = e.target.closest("[data-member-role]");
  if(!sel) return;
  var row = sel.closest("[data-mid]");
  if(!row) return;
  var userId = row.dataset.mid;
  var role = sel.value;
  sel.disabled = true;
  API.put("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members/" +
    encodeURIComponent(userId) + "/role", { role: role }).then(function(){
    toast("角色已改为「" + roleLabel(role) + "」", "fs");
    /* 角色影响矩阵的整行展示（全部项目 / 逐项目），旧缓存必须作废后再刷新 */
    rt.projectAccessCache = null;
    loadWsMemberList();
    if(settingsTab === "members") loadProjectAccess();
  }).catch(function(ex){
    sel.disabled = false;
    sel.value = (rt.wsMembersCache || []).reduce(function(prev, m){
      return m.userId === userId ? (m.role || "member") : prev;
    }, "member");
    toast(ex.message || "角色修改失败", "bad");
  });
});
/* ---------- 项目可见范围矩阵 ---------- */
var ACCESS_OPTIONS = [
  { value:"write", label:"可参与" },
  { value:"read", label:"只读" },
  { value:"none", label:"不可见" }
];
/* 矩阵只写显式值；历史 pm/dev/qa 与空值都按「可参与」理解（与后端默认参与口径一致） */
function normalizeAccess(value){
  return (value === "read" || value === "none" || value === "write") ? value : "write";
}
function accessLabel(value){
  if(value === "none") return "不可见";
  if(value === "read") return "只读";
  return "可参与";
}
/* 新成员按项目分配时缺记录即不可见；存量成员缺记录仍是默认参与 */
function defaultGrantFor(member){
  return member && member.projectAccessMode === "assigned" ? "none" : "write";
}
/* 显式 write/read/none 优先；缺记录与历史 pm/dev/qa 按成员模式回落（与后端 effectiveAccess 一致） */
function effectiveGrant(raw, member){
  return (raw === "write" || raw === "read" || raw === "none") ? raw : defaultGrantFor(member);
}
function accessOptions(selected){
  return ACCESS_OPTIONS.map(function(o){
    return '<option value="' + o.value + '"' + (o.value === selected ? " selected" : "") + '>' + o.label + '</option>';
  }).join("");
}
function isPrivilegedRole(role){ return role === "owner" || role === "admin"; }
function accessKey(userId, projectId){ return userId + "|" + projectId; }
/* 矩阵数据统一入口：按发起时的空间落缓存，响应回来时空间已切换则不写缓存 */
function fetchAccessData(wsId){
  return API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/project-access").then(function(data){
    var fresh = data || {};
    fresh.wsId = wsId;
    if(rt.currentWs && rt.currentWs.id === wsId) rt.projectAccessCache = fresh;
    return fresh;
  });
}
function loadProjectAccess(){
  var box = $("projectAccessWrap");
  if(!box || !rt.currentWs) return;
  var wsId = rt.currentWs.id;
  box.innerHTML = '<div class="foot-note">加载中…</div>';
  fetchAccessData(wsId).then(function(){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    renderProjectAccess();
  }).catch(function(ex){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    box.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderProjectAccess(){
  var box = $("projectAccessWrap");
  var data = rt.projectAccessCache;
  if(!box || !data) return;
  var members = data.members || [];
  var projects = data.projects || [];
  var grants = data.grants || [];
  var summary = $("accessSummary");
  if(summary) summary.textContent = members.length + " 位成员 · " + projects.length + " 个项目";
  if(!projects.length){
    box.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目", text:"先在项目中创建项目，再回来配置成员的可见范围。"
    });
    return;
  }
  var grantMap = {};
  grants.forEach(function(g){
    if(g && g.userId && g.projectId) grantMap[accessKey(g.userId, g.projectId)] = g.access;
  });
  var head = '<thead><tr><th class="access-sticky">成员</th><th>角色</th>' +
    projects.map(function(p){ return '<th title="' + esc(p.name) + '">' + esc(p.name) + '</th>'; }).join("") +
    '</tr></thead>';
  var body = members.map(function(m){
    var role = m.role || "member";
    var cells;
    if(isPrivilegedRole(role)){
      cells = '<td class="access-all" colspan="' + projects.length + '">全部项目</td>';
    }else if(role === "viewer"){
      cells = '<td class="access-all" colspan="' + projects.length + '">全部项目（只读）</td>';
    }else{
      cells = projects.map(function(p){
        var value = effectiveGrant(grantMap[accessKey(m.userId, p.id)], m);
        return '<td><select class="mini-select access-select" data-access-user="' + esc(m.userId) +
          '" data-access-project="' + esc(p.id) + '" aria-label="' + esc(m.displayName + " · " + p.name) + '">' +
          accessOptions(value) + '</select></td>';
      }).join("");
    }
    return '<tr data-access-mid="' + esc(m.userId) + '">' +
      '<td class="access-sticky"><span class="access-name">' + esc(m.displayName || m.username || m.userId) + '</span>' +
        '<span class="access-sub">@' + esc(m.username || "") + '</span></td>' +
      '<td><span class="tag ' + (role === "owner" ? "tag-primary" : "tag-ghost") + '">' + roleLabel(role) + '</span></td>' +
      cells + '</tr>';
  }).join("");
  box.innerHTML = '<table class="manager-tbl access-matrix">' + head + '<tbody>' + body + '</tbody></table>';
}
$("projectAccessWrap").addEventListener("change", function(e){
  var sel = e.target.closest("[data-access-user]");
  if(!sel) return;
  var userId = sel.dataset.accessUser;
  var projectId = sel.dataset.accessProject;
  var access = normalizeAccess(sel.value);
  sel.disabled = true;
  API.put("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/project-access", {
    userId: userId, projectId: projectId, access: access
  }).then(function(){
    if(rt.projectAccessCache){
      rt.projectAccessCache.grants = rt.projectAccessCache.grants || [];
      rt.projectAccessCache.grants = rt.projectAccessCache.grants.filter(function(g){
        return !(g.userId === userId && g.projectId === projectId);
      });
      rt.projectAccessCache.grants.push({ userId:userId, projectId:projectId, access:access });
    }
    toast("已设为「" + accessLabel(access) + "」", "fs");
    /* 成员行上的「可见 x/y」同步刷新（复用已更新的矩阵缓存） */
    loadWsMemberList();
  }).catch(function(ex){
    toast(ex.message || "保存失败", "bad");
    loadProjectAccess();
  }).then(function(){
    sel.disabled = false;
  });
});
/* ---------- 项目权限三态选择（邀请预分配 / 成员分配共用） ----------
   每次打开弹窗开一个会话：记下发起时的空间与成员、递增序号。
   加载完成前「保存」不可点；旧会话的异步结果（连点、切空间、换成员）一律丢弃，
   避免把 A 成员的草稿提交到 B 成员，或在项目没加载完时提交空授权。 */
var grantSeq = 0;
var grantSession = null;
function startGrantSession(kind, member, okBtn){
  grantSeq++;
  grantSession = {
    seq: grantSeq, kind: kind, wsId: rt.currentWs.id,
    member: member || null, ready: false, busy: false,
    projects: [], draft: {}, okBtn: okBtn || null
  };
  if(okBtn) okBtn.disabled = true;
  return grantSession;
}
function isLiveSession(session){
  return !!session && grantSession === session && !!rt.currentWs && rt.currentWs.id === session.wsId;
}
function markSessionReady(session){
  session.ready = true;
  if(session.okBtn) session.okBtn.disabled = false;
}
function grantButtons(value){
  return ACCESS_OPTIONS.map(function(o){
    return '<button type="button" data-grant-access="' + o.value + '"' +
      (o.value === value ? ' aria-pressed="true"' : '') + '>' + o.label + '</button>';
  }).join("");
}
function countGrants(session){
  var write = 0, read = 0;
  session.projects.forEach(function(p){
    if(session.draft[p.id] === "write") write++;
    else if(session.draft[p.id] === "read") read++;
  });
  return { write: write, read: read };
}
function updateGrantSummary(summaryEl){
  var session = grantSession;
  if(!session || !summaryEl) return;
  var c = countGrants(session);
  summaryEl.textContent = "可见 " + (c.write + c.read) + "/" + session.projects.length + " 个项目" +
    " · 可参与 " + c.write + " · 只读 " + c.read;
}
function renderGrantPicker(listEl, summaryEl){
  var session = grantSession;
  if(!session) return;
  if(!session.projects.length){
    listEl.innerHTML = '<div class="foot-note">当前空间还没有项目。成员加入后可在创建项目时再分配，或稍后回来设置。</div>';
    summaryEl.textContent = "暂无项目可分配";
    return;
  }
  listEl.innerHTML = session.projects.map(function(p){
    return '<div class="grant-row" data-grant-pid="' + esc(p.id) + '">' +
      '<span class="nm" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
      '<span class="seg mini">' + grantButtons(session.draft[p.id] || "none") + '</span>' +
    '</div>';
  }).join("");
  updateGrantSummary(summaryEl);
}
function onGrantClick(e, summaryEl){
  var session = grantSession;
  if(!session || !session.ready || session.busy) return;
  var btn = e.target.closest("[data-grant-access]");
  if(!btn) return;
  var row = btn.closest("[data-grant-pid]");
  if(!row) return;
  session.draft[row.dataset.grantPid] = btn.dataset.grantAccess;
  row.querySelectorAll("[data-grant-access]").forEach(function(b){
    b.setAttribute("aria-pressed", b === btn ? "true" : "false");
  });
  updateGrantSummary(summaryEl);
}
function grantLoadFailed(session, listEl, ex){
  if(!isLiveSession(session)) return;
  listEl.innerHTML = '<div class="foot-note">项目加载失败：' + esc((ex && ex.message) || "网络异常") +
    '。请关闭后重试。</div>';
}
function openInviteCreate(){
  if(!rt.currentWs) return;
  var dlg = $("dlgInviteCreate");
  if(!dlg) return;
  var session = startGrantSession("invite", null, $("dlgInviteCreateOk"));
  var list = $("inviteGrantList");
  var summary = $("inviteGrantSummary");
  list.innerHTML = UI.skeletonRows(2);
  summary.textContent = "加载项目中…";
  UI.openModal(dlg);
  /* 每次打开都取最新项目列表：期间可能有人新建或删除项目 */
  fetchAccessData(session.wsId).then(function(data){
    if(!isLiveSession(session)) return;
    session.projects = data.projects || [];
    session.projects.forEach(function(p){ session.draft[p.id] = "none"; });
    renderGrantPicker(list, summary);
    markSessionReady(session);
  }).catch(function(ex){ grantLoadFailed(session, list, ex); });
}
function grantCountText(c){
  var parts = [];
  if(c.write) parts.push("可参与 " + c.write + " 个");
  if(c.read) parts.push("只读 " + c.read + " 个");
  return parts.join("、") + "项目";
}
function submitInvite(){
  var session = grantSession;
  var btn = $("dlgInviteCreateOk");
  if(!btn || btn.disabled || !session || session.kind !== "invite" || !session.ready || session.busy) return;
  if(!isLiveSession(session)) return;
  session.busy = true;
  btn.disabled = true;
  var grants = session.projects.filter(function(p){
    return session.draft[p.id] === "write" || session.draft[p.id] === "read";
  }).map(function(p){
    return { projectId: p.id, access: session.draft[p.id] };
  });
  var counts = countGrants(session);
  API.post("/api/workspaces/" + encodeURIComponent(session.wsId) + "/invites", { grants: grants })
    .then(function(res){
      if(isLiveSession(session)) UI.closeModal($("dlgInviteCreate"));
      copyToClipboard(inviteLink(res.id), grants.length
        ? ("邀请链接已复制（加入后" + grantCountText(counts) + "；对方需先有账号）")
        : "邀请链接已复制（加入后暂无项目权限，需在成员列表再分配）");
      if(rt.currentWs && rt.currentWs.id === session.wsId) loadInvites();
    }).catch(function(ex){
      toast(ex.message || "生成失败", "bad");
    }).then(function(){
      session.busy = false;
      if(isLiveSession(session)) btn.disabled = false;
    });
}
function openMemberGrants(userId){
  var m = (rt.wsMembersCache || []).filter(function(x){ return x.userId === userId; })[0];
  if(!m) return;
  var dlg = $("dlgMemberGrants");
  if(!dlg) return;
  var session = startGrantSession("member", m, $("dlgMemberGrantsOk"));
  $("dlgMemberGrantsTitle").textContent = "分配项目 · " + (m.displayName || m.username || m.userId);
  $("dlgMemberGrantsDesc").textContent = "未选择「可参与 / 只读」的项目，该成员看不到；保存后立即生效，之后可随时调整。";
  var list = $("memberGrantList");
  var summary = $("memberGrantSummary");
  list.innerHTML = UI.skeletonRows(2);
  summary.textContent = "加载项目中…";
  UI.openModal(dlg);
  /* 整批提交会覆盖该成员全部项目，必须基于最新授权打开，不能用可能过期的缓存 */
  fetchAccessData(session.wsId).then(function(data){
    if(!isLiveSession(session)) return;
    /* 以最新数据里的成员为准（模式/角色可能刚被别人改过） */
    var fresh = (data.members || []).filter(function(x){ return x.userId === userId; })[0];
    if(fresh) session.member = fresh;
    if(!fresh || (fresh.role || "member") !== "member"){
      list.innerHTML = '<div class="foot-note">该成员当前不是「成员」角色，无需按项目分配。</div>';
      summary.textContent = "";
      return;
    }
    session.projects = data.projects || [];
    var values = {};
    (data.grants || []).forEach(function(g){
      if(g && g.userId === userId && g.projectId) values[g.projectId] = g.access;
    });
    session.projects.forEach(function(p){
      session.draft[p.id] = effectiveGrant(values[p.id], session.member);
    });
    renderGrantPicker(list, summary);
    markSessionReady(session);
  }).catch(function(ex){ grantLoadFailed(session, list, ex); });
}
function submitMemberGrants(){
  var session = grantSession;
  var btn = $("dlgMemberGrantsOk");
  if(!btn || btn.disabled || !session || session.kind !== "member" || !session.ready || session.busy) return;
  if(!isLiveSession(session) || !session.member) return;
  session.busy = true;
  btn.disabled = true;
  var target = session.member;
  var grants = session.projects.map(function(p){
    return { projectId: p.id, access: session.draft[p.id] || "none" };
  });
  API.put("/api/workspaces/" + encodeURIComponent(session.wsId) + "/members/" +
    encodeURIComponent(target.userId) + "/project-access", { grants: grants })
    .then(function(){
      var name = target.displayName || target.username || target.userId;
      if(isLiveSession(session)) UI.closeModal($("dlgMemberGrants"));
      toast("已更新「" + name + "」的项目权限", "fs");
      if(rt.currentWs && rt.currentWs.id === session.wsId){
        rt.projectAccessCache = null;
        loadWsMemberList();
        loadProjectAccess();
      }
    }).catch(function(ex){
      toast(ex.message || "保存失败", "bad");
    }).then(function(){
      session.busy = false;
      if(isLiveSession(session)) btn.disabled = false;
    });
}
(function wireGrantDialogs(){
  var inviteDlg = $("dlgInviteCreate");
  if(inviteDlg){
    ["dlgInviteCreateX", "dlgInviteCreateCancel"].forEach(function(id){
      if($(id)) $(id).addEventListener("click", function(){ UI.closeModal(inviteDlg); });
    });
    if($("dlgInviteCreateOk")) $("dlgInviteCreateOk").addEventListener("click", submitInvite);
    if($("inviteGrantList")) $("inviteGrantList").addEventListener("click", function(e){
      onGrantClick(e, $("inviteGrantSummary"));
    });
  }
  var memberDlg = $("dlgMemberGrants");
  if(memberDlg){
    ["dlgMemberGrantsX", "dlgMemberGrantsCancel"].forEach(function(id){
      if($(id)) $(id).addEventListener("click", function(){ UI.closeModal(memberDlg); });
    });
    if($("dlgMemberGrantsOk")) $("dlgMemberGrantsOk").addEventListener("click", submitMemberGrants);
    if($("memberGrantList")) $("memberGrantList").addEventListener("click", function(e){
      onGrantClick(e, $("memberGrantSummary"));
    });
  }
})();
function inviteLink(code){
  return window.location.origin + API.appBase + "/join.html?code=" + encodeURIComponent(code);
}
function loadInvites(){
  var listEl = $("inviteList");
  if(!listEl || !rt.currentWs) return;
  listEl.innerHTML = UI.skeletonRows(1);
  API.getAllPages("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/invites").then(function(list){
    rt.inviteCache = list || [];
    renderInvites();
  }).catch(function(ex){
    listEl.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderInvites(){
  var listEl = $("inviteList");
  if(!listEl) return;
  if(!rt.inviteCache.length){
    listEl.innerHTML = UI.colEmpty("还没有邀请链接，点上方按钮生成");
    return;
  }
  listEl.innerHTML = rt.inviteCache.map(function(v){
    var w = v.writeGrantCount || 0, r = v.readGrantCount || 0;
    var grantText = (w || r) ? ("加入后" + grantCountText({ write: w, read: r })) : "加入后暂无项目";
    return '<div class="invite-row" data-invite-id="' + esc(v.id) + '">' +
      '<code title="' + esc(inviteLink(v.id)) + '">' + esc(inviteLink(v.id)) + '</code>' +
      '<span class="foot-note">有效期至 ' + esc(fmtShortMD(new Date(v.expiresAt))) + ' · 已加入 ' + (v.usedCount || 0) + ' 人' +
        ' · ' + esc(grantText) + '</span>' +
      '<span class="row row-gap" style="gap:6px">' +
        '<button class="icon-btn sm" type="button" data-invite-copy title="复制链接" aria-label="复制链接">' + icon("copy", 14) + '</button>' +
        '<button class="btn sm danger" type="button" data-invite-del>撤销</button>' +
      '</span>' +
    '</div>';
  }).join("");
}
function loadColCfg(){
  colCfgList.innerHTML = UI.skeletonRows(2);
  API.get("/api/columns").then(function(defs){
    rt.doneColDef = null;
    rt.colDefsCache = (defs || []).filter(function(d){
      if(d.done){ rt.doneColDef = d; return false; }
      return true;
    });
    renderColCfg();
    loadColTrans();
  }).catch(function(ex){
    colCfgList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderColCfg(){
  var readOnly = roleReadOnly();
  var canDel = !readOnly && rt.currentWs && rt.currentWs.myRole === "owner";
  var rows = rt.colDefsCache.map(function(d, idx){
    var fixed = (d.id === "backlog" || d.id === "doing" || d.id === "test" || d.id === "testing");
    var ruleFixed = (d.id === "backlog" || d.id === "doing");
    var delDisabled = fixed || !canDel;
    var ruleControl = ruleFixed
      ? '<span class="rule-fixed" data-rule="' + (d.id === "backlog" ? "waiting" : "normal") + '" title="' + (d.id === "backlog" ? "待处理是系统列：不计时，逾期照常计算" : "进行中是系统列：正常计时，逾期照常计算") + '">' + FIXED_RULE_LABELS[d.id] + '</span>'
      : '<select class="mini-select col-rule" data-col-rule data-rule="' + esc(d.processingRule || "normal") + '" aria-label="处理规则" title="正常计时：计时且计逾期；暂停计时：停表仍计逾期；结束计时：停表且不计逾期；规则同时影响计时、逾期和统计口径"' + (readOnly ? " disabled" : "") + '>' +
          colRuleOptions(d.processingRule || "normal") + '</select>';
    return '<div class="cfg-row colcfg-row" data-col-id="' + esc(d.id) + '">' +
      '<span class="handle" title="用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(d.color || CAT_DEFAULT_COLOR) + '" data-col-color aria-label="列颜色"' + (readOnly ? " disabled" : "") + ' />' +
      '<input type="text" value="' + esc(d.name) + '" maxlength="12" data-col-name aria-label="列名"' + (readOnly ? " disabled" : "") + ' />' +
      ruleControl +
      '<span class="cfg-type">' + (fixed ? '<span class="sys-chip">系统</span>' : '') + '</span>' +
      '<span class="cfg-acts">' +
        '<button class="cc-act" type="button" data-col-up title="上移"' + (readOnly || idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
        '<button class="cc-act" type="button" data-col-down title="下移"' + (readOnly || idx === rt.colDefsCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
        '<button class="cc-act dan" type="button" data-col-del title="' + (fixed ? "内置列不可删除" : (canDel ? "删除列" : "仅空间主可删除列")) + '"' + (delDisabled ? " disabled" : "") + '>' + icon("trash", 14) + '</button>' +
      '</span>' +
    '</div>';
  }).join("");
  var done = rt.doneColDef || { id:"done", name:"已完成", color:"#5f7a4a" };
  colCfgList.innerHTML = rows +
    '<div class="cfg-row colcfg-row is-done" data-col-id="done">' +
      '<span class="handle" title="系统列固定在看板末尾">' + icon("shield", 14) + '</span>' +
      '<input type="color" value="' + esc(done.color || "#5f7a4a") + '" aria-label="列颜色" disabled />' +
      '<input type="text" value="' + esc(done.name || "已完成") + '" aria-label="列名" disabled />' +
      '<span class="rule-fixed" data-rule="ended" title="已完成是系统列：停止计时，也不再计算逾期">' + FIXED_RULE_LABELS.done + '</span>' +
      '<span class="cfg-type"><span class="sys-chip">系统</span></span>' +
      '<span class="cfg-acts"><span class="cc-act is-lock" title="「已完成」由系统维护">' + icon("shield", 14) + '</span></span>' +
    '</div>';
  ["colNewColor", "colNewName", "colNewRule", "btnColAdd"].forEach(function(id){ if($(id)) $(id).disabled = readOnly; });
  if($("colCfgHint")) $("colCfgHint").hidden = !readOnly;
  UI.wireTooltips(colCfgList);
}
function saveColRow(id){
  if(roleReadOnly() || id === "done") return;
  var row = colCfgList.querySelector('[data-col-id="' + id + '"]');
  if(!row) return;
  var nameEl = row.querySelector("[data-col-name]");
  var colorEl = row.querySelector("[data-col-color]");
  var ruleEl = row.querySelector("[data-col-rule]");
  var name = nameEl.value.trim();
  var color = colorEl.value;
  var processingRule = ruleEl ? ruleEl.value : null;
  if(!name){ toast("列名不能为空", "warn"); loadColCfg(); return; }
  row.setAttribute("aria-busy", "true");
  API.put("/api/columns/" + encodeURIComponent(id), { name: name, color: color, processingRule: processingRule }).then(function(saved){
    row.removeAttribute("aria-busy");
    var d = null;
    for(var i = 0; i < rt.colDefsCache.length; i++) if(rt.colDefsCache[i].id === id) d = rt.colDefsCache[i];
    if(d && saved){
      d.name = saved.name || name;
      d.color = saved.color || color;
      /* 后端固定列统一落 normal；待处理的前端伪规则 backlog 不能被覆盖，否则会误判为可计时 */
      if(saved.processingRule && id !== "backlog") d.processingRule = saved.processingRule;
      nameEl.value = d.name;
      colorEl.value = d.color;
      if(ruleEl) ruleEl.setAttribute("data-rule", saved.processingRule || processingRule || "normal");
    }
    toast("已更新列「" + (d ? d.name : name) + "」", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){
    row.removeAttribute("aria-busy");
    toast(ex.message || "保存失败", "bad");
    loadColCfg();
  });
}
/* 状态流转矩阵：行 = 当前列，列 = 目标列；点格子按 允许 → 需填原因 → 禁止 循环 */
function transCanConfig(){
  var role = rt.currentWs && rt.currentWs.myRole;
  return !roleReadOnly() && (role === "owner" || role === "admin");
}
function loadColTrans(){
  if(!transMatrix) return;
  transMatrix.innerHTML = '<div class="foot-note" style="padding:8px 2px">加载中…</div>';
  loadRules(rt.currentWs && rt.currentWs.id, true).then(function(data){
    transData = data;
    renderColTrans();
  }).catch(function(ex){
    transMatrix.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function transRuleOf(from, to){
  if(transData && transData.map && transData.map[from + "|" + to]) return transData.map[from + "|" + to];
  return from === "done" && to !== "done" ? "reason" : "allow";
}
function renderColTrans(){
  if(!transMatrix || !transData) return;
  var canConfig = transCanConfig();
  var cols = transData.columns || [];
  var html = '<table class="trans-table"><thead><tr>' +
    '<th class="trans-corner">当前 \\ 目标</th>';
  cols.forEach(function(c){
    html += '<th title="' + esc(c.name) + '"><span class="trans-col">' +
      '<i style="background:' + esc(c.color || "#8a8578") + '"></i>' + esc(c.name) + '</span></th>';
  });
  html += '</tr></thead><tbody>';
  var reasonCount = 0, denyCount = 0;
  cols.forEach(function(from){
    html += '<tr><th class="trans-row"><span class="trans-col">' +
      '<i style="background:' + esc(from.color || "#8a8578") + '"></i>' + esc(from.name) + '</span></th>';
    cols.forEach(function(to){
      if(from.id === to.id){
        html += '<td class="trans-self">—</td>';
        return;
      }
      var rule = transRuleOf(from.id, to.id);
      if(rule === "reason") reasonCount++;
      if(rule === "deny") denyCount++;
      html += '<td><button type="button" class="trans-cell ' + rule + '"' +
        ' data-trans-from="' + esc(from.id) + '" data-trans-to="' + esc(to.id) + '"' +
        ' title="' + esc(from.name + " → " + to.name + "：" + TRANS_FULL[rule]) + '"' +
        (canConfig ? "" : " disabled") + '>' + TRANS_LABELS[rule] + '</button></td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  transMatrix.innerHTML = html;
  if(transSummary){
    var parts = [];
    if(reasonCount) parts.push("需填原因 " + reasonCount + " 格");
    if(denyCount) parts.push("禁止 " + denyCount + " 格");
    transSummary.textContent = parts.length ? parts.join(" · ") : "全部允许";
  }
  if(btnTransReset) btnTransReset.disabled = !canConfig;
  if(transHint) transHint.textContent = canConfig
    ? "改动立即保存；已完成的「重开」默认需填原因"
    : "仅空间主 / 管理员可配置流转规则";
  if(UI.wireTooltips) UI.wireTooltips(transMatrix);
}
if(transMatrix){
  transMatrix.addEventListener("click", function(e){
    var cell = e.target.closest("[data-trans-from]");
    if(!cell || cell.disabled) return;
    var from = cell.dataset.transFrom, to = cell.dataset.transTo;
    var next = TRANS_NEXT[transRuleOf(from, to)] || "allow";
    cell.disabled = true;
    API.put("/api/columns/transitions", { from: from, to: to, rule: next }).then(function(){
      transData.map[from + "|" + to] = next;
      invalidateRules();
      renderColTrans();
    }).catch(function(ex){
      cell.disabled = false;
      toast(ex.message || "保存失败", "bad");
    });
  });
}
if(btnTransReset){
  btnTransReset.addEventListener("click", function(){
    if(!transCanConfig()) return;
    UI.showConfirm({
      title: "恢复默认",
      msg: "所有格子恢复默认规则（仅「已完成」移到其他列需填原因），确定？",
      okText: "恢复默认"
    }).then(function(ok){
      if(!ok) return;
      API.post("/api/columns/transitions/reset", {}).then(function(){
        invalidateRules();
        toast("已恢复默认流转规则", "fs");
        loadColTrans();
      }).catch(function(ex){ toast(ex.message || "恢复失败", "bad"); });
    });
  });
}
colCfgList.addEventListener("change", function(e){
  var row = e.target.closest("[data-col-id]");
  if(!row) return;
  if(e.target.matches("[data-col-name]") || e.target.matches("[data-col-color]") || e.target.matches("[data-col-rule]")) saveColRow(row.dataset.colId);
});
colCfgList.addEventListener("click", function(e){
  if(roleReadOnly()) return;
  var row = e.target.closest("[data-col-id]");
  if(!row) return;
  var id = row.dataset.colId;
  if(e.target.closest("[data-col-up]") || e.target.closest("[data-col-down]")){
    var idx = -1;
    for(var i = 0; i < rt.colDefsCache.length; i++) if(rt.colDefsCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-col-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= rt.colDefsCache.length) return;
    var moved = rt.colDefsCache.splice(idx, 1)[0];
    rt.colDefsCache.splice(to, 0, moved);
    API.put("/api/columns/order", { ids: rt.colDefsCache.map(function(d){ return d.id; }) }).then(function(){
      loadColCfg();
      loadBoard({silent:true});
    }).catch(function(ex){
      toast(ex.message || "排序失败", "bad");
      loadColCfg();
    });
    return;
  }
  if(e.target.closest("[data-col-del]")){
    var col = null;
    for(var j = 0; j < rt.colDefsCache.length; j++) if(rt.colDefsCache[j].id === id) col = rt.colDefsCache[j];
    if(!col) return;
    UI.showConfirm({
      title:"删除看板列",
      msg:"删除列「" + esc(col.name) + "」？其下工作项将移入最靠前的列。",
      okText:"删除列"
    }).then(function(ok){
      if(!ok) return;
      API.del("/api/columns/" + encodeURIComponent(id)).then(function(){
        toast("已删除列「" + col.name + "」", "fs");
        loadColCfg();
        loadBoard({silent:true});
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
});
$("btnColAdd").addEventListener("click", function(){
  if(roleReadOnly()) return;
  var name = colNewName.value.trim();
  if(!name){ toast("请填写新列名", "warn"); return; }
  API.post("/api/columns", { name: name, color: colNewColor.value, processingRule: colNewRule.value || "normal" }).then(function(){
    toast("已添加列「" + name + "」", "fs");
    colNewName.value = "";
    if(colNewRule) colNewRule.value = "normal";
    loadColCfg();
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
/* 模块配置：模块挂在项目下，设置页提供统一入口（项目页编辑项目里也有同一份配置） */
var wsCatProjectSel = $("wsCatProject"), wsCatList = $("wsCatList"),
    wsCatNewName = $("wsCatNewName"), wsCatNewColor = $("wsCatNewColor"), btnWsCatAdd = $("btnWsCatAdd");
var wsCatProjects = [], wsCatCache = [], wsCatSeq = 0;
function wsCatProjectId(){
  return wsCatProjectSel ? wsCatProjectSel.value : "";
}
function wsCatProjectOwner(){
  var pid = wsCatProjectId();
  for(var i = 0; i < wsCatProjects.length; i++){
    if(wsCatProjects[i].id === pid) return wsCatProjects[i].ownerUserId;
  }
  return null;
}
function wsCatRefreshDependents(){
  loadCategories(true);
  loadBoard({silent:true});
}
function loadWsCatProjects(){
  if(!wsCatProjectSel || !wsCatList) return;
  var seq = ++wsCatSeq;
  wsCatList.innerHTML = UI.skeletonRows(2);
  API.getAllPages("/api/reqs").then(function(list){
    if(seq !== wsCatSeq) return;
    wsCatProjects = list || [];
    var current = wsCatProjectSel.value;
    if(!wsCatProjects.length){
      wsCatProjectSel.innerHTML = '<option value="">暂无项目</option>';
      wsCatProjectSel.disabled = true;
      if($("wsCatCount")) $("wsCatCount").textContent = "";
      wsCatList.innerHTML = UI.emptyState({
        icon:"folder", title:"还没有项目",
        text:"模块按项目配置，请先在「项目」中新建项目，再回来添加模块。"
      });
      renderWsCatCfg();
      return;
    }
    wsCatProjectSel.disabled = false;
    wsCatProjectSel.innerHTML = wsCatProjects.map(function(r){
      return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
    }).join("");
    if(wsCatProjects.some(function(r){ return r.id === current; })) wsCatProjectSel.value = current;
    loadWsCatCfg();
  }).catch(function(ex){
    if(seq !== wsCatSeq) return;
    wsCatList.innerHTML = '<div class="foot-note">项目加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function loadWsCatCfg(){
  if(!wsCatList) return;
  var pid = wsCatProjectId();
  var seq = ++wsCatSeq;
  wsCatCache = [];
  if(!pid){ renderWsCatCfg(); return; }
  wsCatList.innerHTML = UI.skeletonRows(2);
  API.get("/api/categories?project=" + encodeURIComponent(pid)).then(function(list){
    if(seq !== wsCatSeq) return;
    wsCatCache = list || [];
    renderWsCatCfg();
  }).catch(function(ex){
    if(seq !== wsCatSeq) return;
    wsCatList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderWsCatCfg(){
  if(!wsCatList) return;
  var canManage = !!wsCatProjectId() && canManageProject(wsCatProjectId(), wsCatProjectOwner());
  var readOnly = !canManage;
  var canDel = canManage;
  if($("wsCatCount")) $("wsCatCount").textContent = wsCatCache.length ? "共 " + wsCatCache.length + " 个" : "";
  if(!wsCatCache.length){
    if(wsCatProjectId()) wsCatList.innerHTML = UI.colEmpty("该项目还没有模块，用下方输入框添加第一个");
  }
  if(wsCatCache.length){
    wsCatList.innerHTML = wsCatCache.map(function(c, idx){
      return '<div class="cfg-row" data-wscat-id="' + esc(c.id) + '">' +
        '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
        '<input type="color" value="' + esc(c.color || CAT_DEFAULT_COLOR) + '" data-wscat-color aria-label="模块颜色"' + (readOnly ? " disabled" : "") + ' />' +
        '<input type="text" value="' + esc(c.name) + '" maxlength="12" data-wscat-name aria-label="模块名称"' + (readOnly ? " disabled" : "") + ' />' +
        '<button class="cc-act" type="button" data-wscat-up title="上移"' + (readOnly || idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
        '<button class="cc-act" type="button" data-wscat-down title="下移"' + (readOnly || idx === wsCatCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
        '<button class="cc-act dan" type="button" data-wscat-del title="' + (canDel ? "删除模块" : "仅空间主、管理员或项目负责人可删除模块") + '"' + (canDel ? "" : " disabled") + '>' + icon("trash", 14) + '</button>' +
      '</div>';
    }).join("");
  }
  [wsCatNewColor, wsCatNewName, btnWsCatAdd].forEach(function(el){ if(el) el.disabled = readOnly; });
  if($("wsCatHint")) $("wsCatHint").hidden = !readOnly || !wsCatProjectId();
  UI.wireTooltips(wsCatList);
}
function saveWsCatRow(id){
  if(roleReadOnly()) return;
  var row = wsCatList.querySelector('[data-wscat-id="' + id + '"]');
  if(!row) return;
  var name = row.querySelector("[data-wscat-name]").value.trim();
  var color = row.querySelector("[data-wscat-color]").value;
  if(!name){ toast("模块名不能为空", "warn"); loadWsCatCfg(); return; }
  API.put("/api/categories/" + encodeURIComponent(id), { name: name, color: color }).then(function(){
    toast("已更新模块「" + name + "」", "fs");
    loadWsCatCfg();
    wsCatRefreshDependents();
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); loadWsCatCfg(); });
}
if(wsCatProjectSel) wsCatProjectSel.addEventListener("change", function(){ loadWsCatCfg(); });
if(wsCatList) wsCatList.addEventListener("change", function(e){
  var row = e.target.closest("[data-wscat-id]");
  if(!row) return;
  if(e.target.matches("[data-wscat-name]") || e.target.matches("[data-wscat-color]")) saveWsCatRow(row.dataset.wscatId);
});
if(wsCatList) wsCatList.addEventListener("click", function(e){
  if(roleReadOnly()) return;
  var row = e.target.closest("[data-wscat-id]");
  if(!row) return;
  var id = row.dataset.wscatId;
  if(e.target.closest("[data-wscat-up]") || e.target.closest("[data-wscat-down]")){
    var idx = -1;
    for(var i = 0; i < wsCatCache.length; i++) if(wsCatCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-wscat-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= wsCatCache.length) return;
    var moved = wsCatCache.splice(idx, 1)[0];
    wsCatCache.splice(to, 0, moved);
    API.put("/api/categories/order?project=" + encodeURIComponent(wsCatProjectId()), { ids: wsCatCache.map(function(c){ return c.id; }) }).then(function(){
      loadWsCatCfg();
      wsCatRefreshDependents();
    }).catch(function(ex){ toast(ex.message || "排序失败", "bad"); loadWsCatCfg(); });
    return;
  }
  if(e.target.closest("[data-wscat-del]")){
    var cat = null;
    for(var j = 0; j < wsCatCache.length; j++) if(wsCatCache[j].id === id) cat = wsCatCache[j];
    if(!cat) return;
    var others = wsCatCache.filter(function(c){ return c.id !== id; });
    if(!others.length){ toast("至少需要保留一个模块", "warn"); return; }
    var menu = document.createElement("div");
    menu.className = "menu";
    menu.style.minWidth = "200px";
    menu.innerHTML = '<div class="menu-title">迁移到</div>' + others.map(function(c){
      return '<button class="menu-item" type="button" data-wscat-target="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    }).join("");
    UI.openPop(menu, e.target.closest("[data-wscat-del]"), { onClose: function(){ menu.remove(); } });
    menu.addEventListener("click", function(ev){
      var b = ev.target.closest("[data-wscat-target]");
      if(!b) return;
      var target = null;
      for(var k = 0; k < others.length; k++) if(others[k].id === b.dataset.wscatTarget) target = others[k];
      if(!target) return;
      UI.closeAllPops();
      UI.showConfirm({
        title:"删除模块",
        msg:"删除模块「" + esc(cat.name) + "」？其下工作项与需求将改到「" + esc(target.name) + "」。",
        okText:"删除模块"
      }).then(function(ok){
        if(!ok) return;
        API.del("/api/categories/" + encodeURIComponent(id) + "?targetId=" + encodeURIComponent(target.id)).then(function(){
          toast("已删除模块「" + cat.name + "」，工作项与需求已迁到「" + target.name + "」", "fs");
          loadWsCatCfg();
          wsCatRefreshDependents();
        }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
      });
    });
  }
});
if(btnWsCatAdd) btnWsCatAdd.addEventListener("click", function(){
  if(roleReadOnly()) return;
  var pid = wsCatProjectId();
  if(!pid){ toast("请先选择项目", "warn"); return; }
  var name = wsCatNewName.value.trim();
  if(!name){ toast("请填写模块名称", "warn"); return; }
  API.post("/api/categories?project=" + encodeURIComponent(pid), { name: name, color: wsCatNewColor.value }).then(function(){
    toast("已添加模块「" + name + "」", "fs");
    wsCatNewName.value = "";
    loadWsCatCfg();
    wsCatRefreshDependents();
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
var priorityCfgCache = [];
var priorityCfgBusy = false;
function setPriorityCfgBusy(busy){
  priorityCfgBusy = busy;
  var readOnly = roleReadOnly();
  $("btnPrioritySave").disabled = busy || readOnly;
  $("btnPriorityReset").disabled = busy || readOnly;
  $("priorityCfgList").querySelectorAll("input").forEach(function(input){
    input.disabled = busy || readOnly;
  });
}
function renderPriorityCfg(){
  var readOnly = roleReadOnly();
  $("priorityCfgList").innerHTML = priorityCfgCache.map(function(p){
    return '<div class="cfg-row" data-priority-code="' + esc(p.code) + '">' +
      '<span class="tag tag-ghost">' + esc(p.code) + '</span>' +
      '<input type="color" value="' + esc(p.color) + '" data-priority-color aria-label="' + esc(p.code) + ' 颜色"' + (readOnly ? " disabled" : "") + ' />' +
      '<input type="text" value="' + esc(p.name) + '" maxlength="12" data-priority-name aria-label="' + esc(p.code) + ' 显示名"' + (readOnly ? " disabled" : "") + ' />' +
    '</div>';
  }).join("");
  $("priorityCfgHint").textContent = readOnly ? "查看者只能查看，不能修改配置" : "保存后同步到工作项、需求、筛选与报表";
  setPriorityCfgBusy(priorityCfgBusy);
}
function loadPriorityCfg(){
  $("priorityCfgList").innerHTML = UI.skeletonRows(2);
  API.get("/api/priorities").then(function(defs){
    priorityCfgCache = defs || [];
    renderPriorityCfg();
  }).catch(function(ex){
    $("priorityCfgList").innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
    $("btnPrioritySave").disabled = true;
    $("btnPriorityReset").disabled = true;
  });
}
function afterPriorityCfgChange(message){
  return loadPriorities(null, true).then(function(){
    loadPriorityCfg();
    loadBoard({silent:true});
    toast(message, "fs");
  });
}
$("btnPrioritySave").addEventListener("click", function(){
  if(roleReadOnly() || priorityCfgBusy) return;
  var rows = Array.prototype.slice.call($("priorityCfgList").querySelectorAll("[data-priority-code]"));
  for(var i = 0; i < rows.length; i++){
    if(!rows[i].querySelector("[data-priority-name]").value.trim()){
      toast("优先级显示名不能为空", "warn");
      rows[i].querySelector("[data-priority-name]").focus();
      return;
    }
  }
  setPriorityCfgBusy(true);
  Promise.all(rows.map(function(row){
    return API.put("/api/priorities/" + encodeURIComponent(row.dataset.priorityCode), {
      name: row.querySelector("[data-priority-name]").value.trim(),
      color: row.querySelector("[data-priority-color]").value
    });
  })).then(function(){
    setPriorityCfgBusy(false);
    return afterPriorityCfgChange("优先级显示配置已保存");
  }).catch(function(ex){
    setPriorityCfgBusy(false);
    toast(ex.message || "保存失败", "bad");
    loadPriorityCfg();
  });
});
$("btnPriorityReset").addEventListener("click", function(){
  if(roleReadOnly() || priorityCfgBusy) return;
  setPriorityCfgBusy(true);
  API.del("/api/priorities").then(function(){
    setPriorityCfgBusy(false);
    return afterPriorityCfgChange("已恢复为紧急 / 高 / 中 / 低");
  }).catch(function(ex){
    setPriorityCfgBusy(false);
    toast(ex.message || "恢复默认失败", "bad");
  });
});
var CHANNEL_LABEL = { webhook:"企业微信 / 钉钉 webhook", serverchan:"Server 酱", pushplus:"PushPlus" };
function loadNotifyStatus(){
  if(!notifyStatusText) return;
  if(!rt.currentWs || rt.currentWs.myRole !== "owner"){
    rt.notifyInfo = null;
    if(notifyStatus) notifyStatus.className = "notify-status off";
    notifyStatusText.textContent = "推送配置与生效状态仅空间主可查看";
    return;
  }
  API.get("/api/notify/status").then(function(d){
    rt.notifyInfo = d || {};
    if(!rt.pickedChannel) rt.pickedChannel = rt.notifyInfo.channel || "webhook";
    fillNotifyForm(d);
    renderNotifyStatus();
  }).catch(function(){
    rt.notifyInfo = null;
    if(notifyStatus) notifyStatus.className = "notify-status off";
    if(notifyStatusText) notifyStatusText.textContent = "无法读取推送状态（该接口需要后端支持）";
  });
}
function fillNotifyForm(d){
  d = d || {};
  if($("wsNotifyEnabled")) $("wsNotifyEnabled").checked = !!d.enabled;
  if($("wsNotifyInAppEnabled")) $("wsNotifyInAppEnabled").checked = d.inAppEnabled !== false;
  if($("wsNotifyToken")){
    $("wsNotifyToken").value = "";
    $("wsNotifyToken").placeholder = d.workspaceHasToken
      ? "已保存，留空保持不变"
      : "留空则用服务端环境变量里的 token";
  }
  if($("wsNotifyClearToken")) $("wsNotifyClearToken").checked = false;
  var hint = $("wsNotifyTokenHint");
  if(hint){
    hint.textContent = d.workspaceHasToken
      ? "本空间已保存 Token；留空保持不变，勾选下方可清除"
      : (d.hasToken ? "当前使用服务端环境变量里的 Token" : "还没有配置 Token");
  }
}
function renderNotifyStatus(){
  var d = rt.notifyInfo || {};
  var parts = [];
  if(d.enabled){
    parts.push('服务端推送总开关：<b style="color:var(--success-fg)">已开启</b>');
  }else{
    parts.push('服务端推送总开关：<b style="color:var(--warning-fg)">未开启</b>（定时提醒不会发送）');
  }
  parts.push('<span class="sep">|</span>渠道：' + esc(CHANNEL_LABEL[d.channel] || d.channel || "未配置"));
  if(d.workspaceHasAddress === false){
    parts.push('<span class="sep">|</span><b style="color:var(--warning-fg)">本空间还没填地址</b>');
  }
  if(d.lastAttemptAt){
    parts.push('<span class="sep">|</span>上次推送：' + esc(fmtTs(d.lastAttemptAt)) + ' ' +
      (d.lastResult === "success"
        ? '<b style="color:var(--success-fg)">成功</b>'
        : '<b style="color:var(--danger-fg)">失败</b>' + (d.lastError ? '（' + esc(d.lastError) + '）' : '')));
  }else{
    parts.push('<span class="sep">|</span>还没有推送记录');
  }
  if(notifyStatus) notifyStatus.className = "notify-status " + (d.enabled ? "on" : "off");
  if(notifyStatusText) notifyStatusText.innerHTML = parts.join(" ");

  if(channelCards){
    channelCards.querySelectorAll(".channel-card").forEach(function(card){
      var on = card.dataset.channel === rt.pickedChannel;
      card.classList.toggle("on", on);
      var badge = card.querySelector(".cc-badge");
      if(badge){
        badge.textContent = on
          ? (card.dataset.channel === d.channel ? "当前生效" : "将保存为")
          : "未选中";
      }
    });
  }
  updateWebhookField();
}
function updateWebhookField(){
  var ch = rt.pickedChannel || "webhook";
  var hints = {
    webhook: ["推送地址（群机器人 webhook）",
      "形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=… 或 https://oapi.dingtalk.com/robot/send?access_token=…"],
    serverchan: ["推送地址（Server 酱完整地址，或把 SendKey 填到下面的 Token）",
      "完整地址形如 https://sctapi.ftqq.com/你的SendKey.send；只填 Token 时服务端会自动补全端点"],
    pushplus: ["启用开关地址（PushPlus 统一发官方端点，这里填任意有效 http/https 地址即可）",
      "PushPlus 的 token 优先取本空间填的 Token，留空则用服务端环境变量 NOTIFY_TOKEN"]
  };
  var h = hints[ch] || hints.webhook;
  if(wsWebhookLabel) wsWebhookLabel.textContent = h[0];
  if(wsWebhookHint) wsWebhookHint.textContent = h[1];
  var inp = $("wsWebhook");
  if(inp) inp.placeholder = (ch === "pushplus") ? "https://example.com（仅作启用开关）" : "https://…";
  if($("fNotifyToken")) $("fNotifyToken").hidden = (ch === "webhook");
}
function channelOfAddress(url){
  var s = String(url || "").toLowerCase();
  if(s.indexOf("qyapi.weixin.qq.com") >= 0 || s.indexOf("oapi.dingtalk.com") >= 0) return "webhook";
  if(s.indexOf("sctapi.ftqq.com") >= 0) return "serverchan";
  if(s.indexOf("pushplus") >= 0) return "pushplus";
  return "";
}
function notifyFieldEl(){
  var panel = $("set-notify");
  return panel ? panel.querySelector(".field") : null;
}
function validateWebhookInput(){
  var f = notifyFieldEl();
  if(f) f.classList.remove("invalid");
  var inp = $("wsWebhook");
  var val = inp ? inp.value.trim() : "";
  if(!val || !rt.notifyInfo) return true;
  if(rt.pickedChannel === "pushplus") return true;
  var guess = channelOfAddress(val);
  if(guess && guess !== rt.pickedChannel){
    if(f) f.classList.add("invalid");
    if(wsWebhookHint) wsWebhookHint.textContent = "该地址看起来属于「" + (CHANNEL_LABEL[guess] || guess) +
      "」，与当前选中的「" + (CHANNEL_LABEL[rt.pickedChannel] || rt.pickedChannel) + "」不一致。";
    return false;
  }
  return true;
}
if(channelCards){
  channelCards.addEventListener("click", function(e){
    var card = e.target.closest("[data-channel]");
    if(!card) return;
    rt.pickedChannel = card.dataset.channel;
    renderNotifyStatus();
    if(btnNotifySave) btnNotifySave.disabled = !(rt.currentWs && rt.currentWs.myRole === "owner");
  });
}
if(btnNotifySave){
  btnNotifySave.addEventListener("click", function(){
    if(!rt.currentWs) return;
    if(!validateWebhookInput()){ toast("推送地址与所选渠道不匹配，请检查", "warn"); return; }
    var body = {
      /* 推送面板只保存推送字段：名称由「空间信息」面板单独保存，两个入口互不覆盖 */
      notifyWebhook: ($("wsWebhook") ? $("wsWebhook").value.trim() : ""),
      notifyChannel: rt.pickedChannel || "webhook",
      notifyEnabled: !!($("wsNotifyEnabled") && $("wsNotifyEnabled").checked),
      /* BUG-12：站内通知独立开关，默认开启 */
      notifyInAppEnabled: !!($("wsNotifyInAppEnabled") && $("wsNotifyInAppEnabled").checked),
      /* Token 留空 + clearToken=false 表示“保持原值”，不再把已保存的 Token 静默写空 */
      notifyToken: ($("wsNotifyToken") ? $("wsNotifyToken").value.trim() : "") || null,
      clearToken: !!($("wsNotifyClearToken") && $("wsNotifyClearToken").checked)
    };
    btnNotifySave.disabled = true;
    API.put("/api/workspaces/" + encodeURIComponent(rt.currentWs.id), body).then(function(ws){
      btnNotifySave.disabled = false;
      rt.currentWs = ws;
      if(!rt.currentWs.myRole) rt.currentWs.myRole = "owner";
      toast("推送配置已保存", "fs");
      loadNotifyStatus();
    }).catch(function(ex){
      btnNotifySave.disabled = false;
      toast(ex.message || "保存失败", "bad");
    });
  });
}
if($("wsWebhook")) $("wsWebhook").addEventListener("input", function(){ validateWebhookInput(); });
if($("wsNotifyToken")) $("wsNotifyToken").addEventListener("input", function(){
  if(this.value.trim() && $("wsNotifyClearToken")) $("wsNotifyClearToken").checked = false;
});
var ACT_LABEL = {create:"新建", update:"修改", move:"移动", delete:"删除", restore:"恢复", config:"配置"};
var actState = {items:[], total:0, hasMore:false, loading:false};
function loadActivity(opts){
  if(!actList) return;
  opts = opts || {};
  var append = !!opts.more && actState.items.length > 0;
  if(append && actState.loading) return;
  if(!append){
    actState.items = [];
    actState.total = 0;
    actState.hasMore = false;
    actList.innerHTML = UI.skeletonRows(4);
  }
  actState.loading = true;
  API.get("/api/activity", {offset: actState.items.length, limit: 100}).then(function(page){
    actState.loading = false;
    var rows = (page && page.items) || [];
    actState.items = append ? actState.items.concat(rows) : rows;
    actState.total = Math.max((page && page.total) || 0, actState.items.length);
    actState.hasMore = !!(page && page.hasMore) && rows.length > 0;
    renderActivity(actState.items);
  }).catch(function(ex){
    actState.loading = false;
    if(append){ toast(ex.message || "加载更多失败", "bad"); return; }
    actList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "该接口需要后端支持") + '</div>';
  });
}
function renderActivity(list){
  if(actCount) actCount.textContent = list.length ? ("已加载 " + list.length + " / 共 " + actState.total + " 条") : "";
  if(!list.length){
    actList.innerHTML = UI.colEmpty("还没有操作记录");
    return;
  }
  actList.innerHTML = list.map(function(a){
    return '<div class="act-item">' +
      '<span class="ai-time">' + esc(fmtTs(a.createdAt)) + '</span>' +
      '<span class="ai-main"><b>' + esc(a.actorName || "系统") + '</b> ' +
        esc(a.detail || ACT_LABEL[a.action] || a.action) +
        (a.taskTitle && a.action !== "update" ? ('　·　' + esc(a.taskTitle)) : '') + '</span>' +
      '<span class="ai-act"><span class="tag ' + (a.action === "delete" ? "tag-danger" : (a.action === "create" ? "tag-success" : "tag-ghost")) + '">' +
        esc(ACT_LABEL[a.action] || a.action) + '</span></span>' +
    '</div>';
  }).join("") + (actState.hasMore
    ? '<div class="act-more"><button class="btn sm block" type="button" data-act-more>加载更多</button></div>'
    : "");
}
if(actList) actList.addEventListener("click", function(e){
  if(e.target.closest("[data-act-more]")) loadActivity({more:true});
});
/* ---------- 系统信息 + 审计日志（B6，平台管理员） ---------- */
var AUDIT_LABEL = {
  login:"登录成功", login_fail:"登录失败", logout:"退出登录",
  role_change:"权限变更", export:"数据导出", import:"备份恢复", clear:"清空数据",
  member_add:"添加成员", member_remove:"移除成员", member_company:"标注成员公司",
  project_role:"标注项目角色", workspace_delete:"删除空间",
  project_delete:"删除项目", user_create:"新建账号", user_update:"修改账号",
  user_delete:"删除账号", password_reset:"重置密码", user_disable:"禁用账号", user_enable:"启用账号",
  invite_create:"生成邀请链接", invite_revoke:"撤销邀请链接",
  password_change:"修改密码", profile_update:"修改个人资料", work_hours_update:"修改计时设置",
  mail_settings_update:"修改邮件服务器", ai_config_update:"修改 AI 配置", ai_assistant_exec:"AI 助手执行",
  gantt_share_create:"生成甘特分享", gantt_share_revoke:"撤销甘特分享",
  test_case_delete:"删除测试用例", test_case_import:"导入测试用例",
  test_plan_delete:"删除测试计划", test_plan_status:"测试计划状态变更",
  comment_delete:"删除评论", task_purge:"彻底删除任务",
  demand_delete:"删除需求", requirement_doc_delete:"删除需求文档",
  branch_delete:"删除分支", version_delete:"删除版本"
};
var AUDIT_TARGET = {
  auth:"登录", user:"账号", workspace:"空间", member:"成员", project:"项目", data:"数据",
  invite:"邀请", mail_settings:"邮件配置", gantt_share:"甘特分享",
  test_case:"测试用例", test_plan:"测试计划", comment:"评论",
  task:"工作项", demand:"需求", requirement_doc:"需求文档", branch:"分支", project_version:"版本"
};
var auditState = { page:1, size:50, total:0, pages:1, loading:false };

function fmtBytes(n){
  var v = Number(n) || 0;
  if(v < 1024) return v + " B";
  var units = ["KB","MB","GB","TB"], i = -1;
  do { v /= 1024; i++; } while(v >= 1024 && i < units.length - 1);
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + " " + units[i];
}
function fmtUptime(sec){
  var s = Math.max(0, Number(sec) || 0);
  var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if(d > 0) return d + " 天 " + h + " 小时";
  if(h > 0) return h + " 小时 " + m + " 分";
  return m + " 分钟";
}
function fmtAuditTs(value){
  if(!value) return "—";
  return String(value).replace("T", " ").slice(0, 19);
}
function auditParams(){
  return {
    q: ($("auditQ") && $("auditQ").value.trim()) || "",
    action: ($("auditAction") && $("auditAction").value) || "",
    result: ($("auditResult") && $("auditResult").value) || "",
    from: ($("auditFrom") && $("auditFrom").value) || "",
    to: ($("auditTo") && $("auditTo").value) || ""
  };
}
function loadAudit(page){
  if(!$("auditBody")) return;
  if(auditState.loading) return;
  auditState.loading = true;
  auditState.page = page || 1;
  var p = auditParams();
  p.page = auditState.page;
  p.size = auditState.size;
  $("auditBody").innerHTML = '<tr><td colspan="7" class="audit-empty">加载中…</td></tr>';
  API.getGlobal("/api/admin/audit/logs", p).then(function(data){
    auditState.loading = false;
    renderAudit(data || {});
  }).catch(function(ex){
    auditState.loading = false;
    $("auditBody").innerHTML = '<tr><td colspan="7" class="audit-empty">加载失败：' +
      esc(ex.message || "网络异常") + '</td></tr>';
  });
}
function renderAudit(data){
  var list = data.items || [];
  auditState.total = data.total || 0;
  auditState.page = data.page || 1;
  auditState.size = data.size || 50;
  auditState.pages = Math.max(1, Math.ceil(auditState.total / auditState.size));
  if($("auditCount")) $("auditCount").textContent = "共 " + auditState.total + " 条 · 全空间";
  if($("auditHint")) $("auditHint").textContent = "登录成功/失败、权限变更、删除、账号安全、配置变更、数据导出、备份恢复等安全事件；保留 " +
    (data.retentionDays || 90) + " 天，可按条件筛选并导出 CSV。";
  if(!list.length){
    $("auditBody").innerHTML = '<tr><td colspan="7" class="audit-empty">当前条件下没有审计记录</td></tr>';
  }else{
    $("auditBody").innerHTML = list.map(function(a){
      var target = a.targetName || a.targetId || "—";
      var kind = AUDIT_TARGET[a.targetType] || a.targetType || "";
      var ok = a.result !== "fail";
      return '<tr>' +
        '<td class="audit-time">' + esc(fmtAuditTs(a.createdAt)) + '</td>' +
        '<td class="audit-actor">' + esc(a.actorName || "系统") + '</td>' +
        '<td><span class="tag tag-ghost">' + esc(AUDIT_LABEL[a.action] || a.action) + '</span></td>' +
        '<td class="audit-target" title="' + esc(target) + '">' + esc(target) +
          (kind ? '<span class="audit-kind">' + esc(kind) + '</span>' : '') + '</td>' +
        '<td><span class="tag ' + (ok ? "tag-success" : "tag-danger") + '">' + (ok ? "成功" : "失败") + '</span></td>' +
        '<td class="audit-detail" title="' + esc(a.detail || "") + '">' + esc(a.detail || "—") + '</td>' +
        '<td class="audit-ip">' + esc(a.ip || "—") + '</td>' +
      '</tr>';
    }).join("");
  }
  if($("auditPage")){
    $("auditPage").textContent = auditState.total
      ? ("第 " + auditState.page + " / " + auditState.pages + " 页 · 保留 " + (data.retentionDays || 90) + " 天")
      : "";
  }
  if($("auditPrev")) $("auditPrev").disabled = auditState.page <= 1;
  if($("auditNext")) $("auditNext").disabled = !data.hasMore;
}
function loadSystemInfo(){
  if(!$("sysGrid")) return;
  $("sysGrid").innerHTML = '<div class="sys-card sys-loading">加载中…</div>';
  API.get("/api/admin/system/info").then(function(d){
    renderSystemInfo(d || {});
  }).catch(function(ex){
    $("sysGrid").innerHTML = '<div class="sys-card sys-loading">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function sysKv(rows){
  return '<dl class="sys-kv">' + rows.map(function(r){
    return '<div><dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + esc(r[1] == null || r[1] === "" ? "—" : r[1]) + '</dd></div>';
  }).join("") + '</dl>';
}
function sysCard(title, badge, body, tone){
  return '<div class="sys-card' + (tone ? " " + tone : "") + '">' +
    '<div class="sys-card-h"><span>' + esc(title) + '</span>' +
    (badge ? '<span class="tag ' + (badge.tone || "tag-ghost") + '">' + esc(badge.text) + '</span>' : '') +
    '</div>' + body + '</div>';
}
function renderSystemInfo(d){
  var app = d.app || {}, rtInfo = d.runtime || {}, db = d.database || {};
  var storage = d.storage || {}, mail = d.mail || {}, hook = d.webhook || {};
  var sse = d.sse || {}, backup = d.backup || {}, audit = d.audit || {};
  var dbOk = db.status === "up";
  var cards = [];
  cards.push(sysCard("版本与运行", { text:"v" + (app.version || "—") }, sysKv([
    ["启动时间", app.startedAt],
    ["已运行", fmtUptime(app.uptimeSeconds)],
    ["Java", (rtInfo.javaVersion || "—") + (rtInfo.javaVendor ? " · " + rtInfo.javaVendor : "")],
    ["系统", (rtInfo.osName || "—") + " / " + (rtInfo.osArch || "—")],
    ["内存", fmtBytes(rtInfo.usedMemoryBytes) + " / " + fmtBytes(rtInfo.maxMemoryBytes)]
  ]), dbOk ? "" : "sys-warn"));
  cards.push(sysCard("数据库", { text: dbOk ? "连接正常" : "连接异常", tone: dbOk ? "tag-success" : "tag-danger" }, sysKv([
    ["状态", dbOk ? "up" : "down"],
    ["版本", db.version],
    ["附件文件", (storage.fileCount || 0) + " 个 · " + fmtBytes(storage.totalBytes)],
    ["存储目录", storage.path],
    ["磁盘可用", storage.diskUsableBytes == null ? null : fmtBytes(storage.diskUsableBytes) + " / " + fmtBytes(storage.diskTotalBytes)]
  ]), dbOk ? "" : "sys-warn"));
  cards.push(sysCard("邮件投递", { text: mail.enabled ? "已启用" : "未启用", tone: mail.enabled ? "tag-success" : "tag-ghost" }, sysKv([
    ["已发送", mail.sent || 0],
    ["等待重试", mail.pending || 0],
    ["最终失败", mail.failed || 0],
    ["最近一封", mail.lastSentAt || mail.lastAt],
    ["最近错误", mail.lastError]
  ]), mail.failed > 0 ? "sys-warn" : ""));
  var hookState = hook.configured ? (hook.enabled === false ? "已配置 · 关闭" : "已配置") : "未配置";
  cards.push(sysCard("外部推送（当前空间）", { text: hook.workspaceName || "未知空间", tone: "tag-ghost" }, sysKv([
    ["状态", hookState],
    ["渠道", hook.channel],
    ["站内通知", hook.inAppEnabled === false ? "关闭" : "开启"],
    ["最近推送", hook.lastAt],
    ["最近结果", hook.lastStatus]
  ]), !hook.configured ? "sys-warn" : ""));
  cards.push(sysCard("实时连接", { text: (sse.connections || 0) + " 条", tone: (sse.connections ? "tag-success" : "tag-ghost") }, sysKv([
    ["SSE 连接", sse.connections || 0],
    ["在线用户", sse.users || 0]
  ])));
  cards.push(sysCard("备份与审计", { text: "审计 " + (audit.total || 0) + " 条", tone: "tag-ghost" }, sysKv([
    ["最近导入/清空", backup.lastImportAt ? (backup.lastImportAction === "clear" ? "清空" : "导入") + " · " + backup.lastImportAt : null],
    ["导入说明", backup.lastImportDetail],
    ["最近导出", backup.lastExportAt ? backup.lastExportDetail + " · " + backup.lastExportAt : null],
    ["最早审计", audit.oldestAt],
    ["审计总数", audit.total || 0]
  ])));
  $("sysGrid").innerHTML = cards.join("");
}
function resetAuditFilters(){
  ["auditQ","auditFrom","auditTo"].forEach(function(id){ if($(id)) $(id).value = ""; });
  if($("auditAction")) $("auditAction").value = "";
  if($("auditResult")) $("auditResult").value = "";
  loadAudit(1);
}
function exportAuditCsv(){
  var p = auditParams(), parts = [];
  for(var k in p){
    if(Object.prototype.hasOwnProperty.call(p, k) && p[k]) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k]));
  }
  var url = API.url("/api/admin/audit/logs.csv" + (parts.length ? "?" + parts.join("&") : ""));
  fetch(url, { credentials:"same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok) throw new Error("请求失败（HTTP " + res.status + "）");
    return res.blob();
  }).then(function(blob){
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u;
    a.download = "audit-" + rt.TODAY_ISO + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(u); }, 1500);
    toast("已导出审计日志 CSV", "fs");
  }).catch(function(ex){
    toast("导出失败：" + (ex.message || "网络异常"), "bad");
  });
}
if($("btnAuditApply")) $("btnAuditApply").addEventListener("click", function(){ loadAudit(1); });
if($("btnAuditReset")) $("btnAuditReset").addEventListener("click", resetAuditFilters);
if($("btnAuditCsv")) $("btnAuditCsv").addEventListener("click", exportAuditCsv);
if($("auditPrev")) $("auditPrev").addEventListener("click", function(){
  if(auditState.page > 1) loadAudit(auditState.page - 1);
});
if($("auditNext")) $("auditNext").addEventListener("click", function(){
  if(auditState.page < auditState.pages) loadAudit(auditState.page + 1);
});
if($("auditQ")) $("auditQ").addEventListener("keydown", function(e){
  if(e.key === "Enter"){ e.preventDefault(); loadAudit(1); }
});
if($("auditAction")) $("auditAction").addEventListener("change", function(){ loadAudit(1); });
if($("auditResult")) $("auditResult").addEventListener("change", function(){ loadAudit(1); });

$("btnWsSave").addEventListener("click", function(){
  if(!rt.currentWs) return;
  var body = {
    name: rt.currentWs.type === "personal" ? rt.currentWs.name : wsNameInput.value.trim()
  };
  if(!body.name){ toast("空间名称不能为空", "warn"); return; }
  var btn = $("btnWsSave");
  btn.disabled = true;
  API.put("/api/workspaces/" + encodeURIComponent(rt.currentWs.id), body).then(function(ws){
    btn.disabled = false;
    toast("空间设置已保存", "fs");
    rt.currentWs = ws;
    if(!rt.currentWs.myRole) rt.currentWs.myRole = "owner";
    var nameEl = $("wsName");
    if(nameEl) nameEl.textContent = ws.name;
    loadWorkspaces(rt.currentUser);
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
$("btnNotifyTest").addEventListener("click", function(){
  var btn = $("btnNotifyTest");
  btn.disabled = true;
  API.post("/api/notify/test", {}).then(function(res){
    btn.disabled = false;
    /* §8.3：测试必须走与定时任务相同的开关判断，未开启时如实说明，不给「假绿」 */
    if(res && res.sent){
      toast("测试推送已发送（渠道返回成功）", "fs");
    }else{
      toast((res && res.reason) || "未发送（无逾期或今日到期工作项）", "warn");
    }
    loadNotifyStatus();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "推送失败", "bad");
  });
});
function memberOptionsEl(){ return $("wsMemberOptions"); }
function setMemberOptionsOpen(open){
  var box = memberOptionsEl();
  if(box) box.hidden = !open;
  if(wsMemberName) wsMemberName.setAttribute("aria-expanded", open ? "true" : "false");
}
function resetMemberPicker(){
  wsMemberSelected = null;
  wsMemberCandidates = {};
  wsMemberSeq++;
  if(wsMemberName) wsMemberName.value = "";
  if($("btnWsMemberAdd")) $("btnWsMemberAdd").disabled = true;
  var box = memberOptionsEl();
  if(box) box.innerHTML = "";
  setMemberOptionsOpen(false);
}
/* 无账号的人怎么进空间：平台管理员可直接去新建，其他人只能请平台管理员建号。 */
function updateInviteAccountHint(isAdmin){
  var text = $("inviteNoAccountText"), btn = $("btnInviteCreateAccount");
  if(text) text.textContent = isAdmin
    ? "对方还没有账号？"
    : "对方还没有账号？请联系平台管理员先新建账号。";
  if(btn) btn.hidden = !isAdmin;
}
function openCreateAccountFromMember(q){
  var isAdmin = !!(rt.currentUser && rt.currentUser.role === "admin");
  if(!isAdmin){ toast("请联系平台管理员先新建账号", "warn"); return; }
  setMemberOptionsOpen(false);
  platformTab = "account";
  setSettingsTab("platform");
  var login = String(q || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32);
  setTimeout(function(){
    if($("uNewName") && login) $("uNewName").value = login;
    if($("uNewDisplay") && q) $("uNewDisplay").value = String(q).slice(0, 32);
    if($("uNewName")) $("uNewName").focus();
    var pane = $("set-account");
    if(pane && pane.scrollIntoView) pane.scrollIntoView({ block:"start", behavior:"smooth" });
  }, 60);
}
function renderMemberOptions(list){
  var box = memberOptionsEl();
  if(!box) return;
  wsMemberCandidates = {};
  (list || []).forEach(function(u){ wsMemberCandidates[u.id] = u; });
  if(!list || !list.length){
    var q = wsMemberName ? wsMemberName.value.trim() : "";
    var isAdmin = !!(rt.currentUser && rt.currentUser.role === "admin");
    box.innerHTML = '<div class="member-option-empty">没有匹配的账号。' +
      (isAdmin
        ? '<button class="link-btn" type="button" data-create-account="' + esc(q) + '">去新建账号</button>'
        : '请联系平台管理员先新建账号。') +
      '</div>';
    setMemberOptionsOpen(true);
    return;
  }
  box.innerHTML = list.map(function(u){
    var inWs = !!u.inWorkspace;
    return '<button class="member-option' + (inWs ? " is-member" : "") + '" type="button" role="option" data-cid="' + esc(u.id) + '"' +
      (inWs ? ' aria-disabled="true"' : "") + '>' +
      '<span class="nm">' + esc(u.displayName || u.username) + '</span>' +
      '<span class="sub">@' + esc(u.username) + (inWs ? ' · 已在空间内' : '') + '</span></button>';
  }).join("");
  setMemberOptionsOpen(true);
}
function searchMemberCandidates(){
  if(!rt.currentWs) return;
  var q = wsMemberName.value.trim();
  var box = memberOptionsEl();
  if(box) box.innerHTML = '<div class="member-option-empty">搜索中…</div>';
  var seq = ++wsMemberSeq;
  API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) +
    "/member-candidates?q=" + encodeURIComponent(q)).then(function(list){
    if(seq !== wsMemberSeq) return;
    renderMemberOptions(list);
  }).catch(function(ex){
    if(seq !== wsMemberSeq) return;
    if(box) box.innerHTML = '<div class="member-option-empty">搜索失败：' + esc(ex.message || "网络异常") + '</div>';
    setMemberOptionsOpen(true);
  });
}
wsMemberName.addEventListener("input", function(){
  wsMemberSelected = null;
  $("btnWsMemberAdd").disabled = true;
  wsMemberSeq++;
  clearTimeout(wsMemberTimer);
  if(!wsMemberName.value.trim()){ setMemberOptionsOpen(false); return; }
  wsMemberTimer = setTimeout(searchMemberCandidates, 250);
});
wsMemberName.addEventListener("focus", function(){
  if(!wsMemberName.value.trim()) searchMemberCandidates();
});
wsMemberName.addEventListener("keydown", function(e){
  if(e.key === "Escape"){ setMemberOptionsOpen(false); return; }
  if(e.key === "Enter"){
    e.preventDefault();
    if(wsMemberSelected){ $("btnWsMemberAdd").click(); return; }
    var first = memberOptionsEl() && memberOptionsEl().querySelector("[data-cid]");
    if(first) first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }
});
$("wsMemberOptions").addEventListener("mousedown", function(e){
  var opt = e.target.closest("[data-cid]");
  if(!opt) return;
  e.preventDefault();
  var u = wsMemberCandidates[opt.dataset.cid];
  if(!u) return;
  if(u.inWorkspace){ setMemberOptionsOpen(false); toast("该账号已在当前空间内", "warn"); return; }
  wsMemberSelected = u;
  wsMemberName.value = (u.displayName || u.username) + " (@" + u.username + ")";
  $("btnWsMemberAdd").disabled = false;
  setMemberOptionsOpen(false);
});
$("wsMemberOptions").addEventListener("click", function(e){
  var b = e.target.closest("[data-create-account]");
  if(!b) return;
  openCreateAccountFromMember(b.dataset.createAccount || "");
});
document.addEventListener("click", function(e){
  if(!e.target || !e.target.closest || !e.target.closest("#wsMemberAdd")) setMemberOptionsOpen(false);
});
$("btnWsMemberAdd").addEventListener("click", function(){
  if(!wsMemberSelected){ toast("请先从搜索结果中选择成员", "warn"); return; }
  var un = wsMemberSelected.username;
  API.post("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members", { username: un }).then(function(){
    toast("已添加成员 @" + un, "fs");
    resetMemberPicker();
    loadWsMemberList();
    loadWorkspaces(rt.currentUser);
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
wsMemberList.addEventListener("click", function(e){
  if(e.target.closest("[data-member-label-options]")){ openMemberLabelOptions(); return; }
  var job = e.target.closest("[data-member-job-title]");
  if(job){ editMemberLabel(job.dataset.memberJobTitle, "job-title"); return; }
  var company = e.target.closest("[data-member-company]");
  if(company){
    editMemberCompany(company.dataset.memberCompany);
    return;
  }
  var assign = e.target.closest("[data-assign-projects]");
  if(assign){
    openMemberGrants(assign.dataset.assignProjects);
    return;
  }
  var del = e.target.closest("[data-mid-del]");
  if(!del) return;
  var uid = del.dataset.midDel;
  var isSelf = rt.currentUser && uid === rt.currentUser.id;
  UI.showConfirm({
    title: isSelf ? "退出空间" : "移除成员",
    msg: isSelf ? "确定退出该空间？你的工作项会保留在空间里。" : "确定移除该成员？",
    okText: isSelf ? "退出空间" : "移除成员"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members/" + encodeURIComponent(uid)).then(function(){
      if(isSelf){ toast("已退出空间", "fs"); window.location.reload(); }
      else { toast("已移除成员", "fs"); loadWsMemberList(); loadWorkspaces(rt.currentUser); }
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
});
$("btnWsLeave").addEventListener("click", function(){
  if(!rt.currentWs || !rt.currentUser) return;
  UI.showConfirm({
    title:"退出空间",
    msg:"确定退出空间「" + esc(rt.currentWs.name) + "」？你的工作项会保留在空间里。",
    okText:"退出空间"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/members/" + encodeURIComponent(rt.currentUser.id)).then(function(){
      toast("已退出空间", "fs");
      window.location.reload();
    }).catch(function(ex){ toast(ex.message || "退出失败", "bad"); });
  });
});
$("btnWsDelete").addEventListener("click", function(){
  if(!rt.currentWs) return;
  $("dlgWsDeleteName").textContent = "「" + rt.currentWs.name + "」";
  $("dlgWsDeleteInput").value = "";
  $("fDlgWsDelete").classList.remove("invalid");
  $("dlgWsDeleteOk").disabled = true;
  UI.openModal($("dlgWsDelete"));
});
$("dlgWsDeleteInput").addEventListener("input", function(){
  $("dlgWsDeleteOk").disabled = !rt.currentWs || this.value !== rt.currentWs.name;
  $("fDlgWsDelete").classList.remove("invalid");
});
$("dlgWsDeleteForm").addEventListener("submit", function(e){
  e.preventDefault();
  if($("dlgWsDeleteOk").disabled) return;
  var inp = $("dlgWsDeleteInput");
  if(!rt.currentWs || inp.value !== rt.currentWs.name){
    $("fDlgWsDelete").classList.add("invalid");
    return;
  }
  var btn = $("dlgWsDeleteOk");
  btn.disabled = true;
  API.del("/api/workspaces/" + encodeURIComponent(rt.currentWs.id)).then(function(){
    toast("空间已删除", "fs");
    window.location.reload();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "删除失败", "bad");
  });
});
if($("btnInviteCreateAccount")) $("btnInviteCreateAccount").addEventListener("click", function(){
  openCreateAccountFromMember("");
});
if($("btnAccountGotoMembers")) $("btnAccountGotoMembers").addEventListener("click", function(){
  setSettingsTab("members");
});
$("btnInviteGen").addEventListener("click", function(){
  openInviteCreate();
});
$("inviteList").addEventListener("click", function(e){
  var row = e.target.closest("[data-invite-id]");
  if(!row || !rt.currentWs) return;
  var id = row.dataset.inviteId;
  if(e.target.closest("[data-invite-copy]")){
    copyToClipboard(inviteLink(id), "邀请链接已复制（对方需先有账号，登录后打开即可加入）");
    return;
  }
  if(e.target.closest("[data-invite-del]")){
    UI.showConfirm({
      title:"撤销邀请链接",
      msg:"撤销后该链接立即失效，已加入的成员不受影响。",
      okText:"撤销链接"
    }).then(function(ok){
      if(!ok) return;
      API.del("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/invites/" + encodeURIComponent(id)).then(function(){
        toast("已撤销邀请链接", "fs");
        loadInvites();
      }).catch(function(ex){ toast(ex.message || "撤销失败", "bad"); });
    });
  }
});
$("btnExport").addEventListener("click", function(){
  API.get("/api/export").then(function(data){
    triggerDownload(BACKUP_NAME, JSON.stringify(data, null, 2), "application/json");
    toast("已导出任务备份（含工作项/项目/评论/甘特依赖与基线/文档/分支/版本/需求池/测试用例/文档评论）", "fs");
  }).catch(function(ex){ toast("导出失败：" + (ex.message || "网络异常"), "bad"); });
});
$("btnImport").addEventListener("click", function(){ $("fileImport").click(); });
$("fileImport").addEventListener("change", function(e){
  var f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  UI.showConfirm({
    title:"导入任务备份",
    msg:"导入会覆盖当前空间的工作项、回收站、项目、子任务、标签、工时、评论、甘特依赖与基线，并按工作项重建完成归档；同时清空工作项通知。已选文件：<b>" +
      esc(f.name) + "</b>。<br><br>附件、操作时间线、保存视图、看板列/模块<b>不会被导入或删除</b>。" +
      "<br><br>v6 备份会连同<b>文档与分支</b>一起覆盖恢复，v8 备份还会恢复<b>项目版本、版本工作项绑定、需求池与首版上线日</b>，v10 备份还会恢复<b>测试用例、执行流水与文档评论</b>；旧备份不含这些数据时保留现状。旧备份不含依赖/基线（v4 之前也不含评论）：缺失的部分导入后会被清空。建议先导出一份当前任务备份。导入后当前空间的只读分享链接会失效。",
    okText:"继续导入"
  }).then(function(ok){
    if(!ok) return;
    f.text().then(function(text){
      var data;
      try{ data = JSON.parse(text); }
      catch(err){ toast("导入失败：文件不是有效的 JSON", "bad"); return; }
      if(!data || Object.prototype.toString.call(data.tasks) !== "[object Array]"){
        toast("导入失败：文件中未找到任务数据", "bad");
        return;
      }
      API.post("/api/import", data).then(function(res){
        toast("已从备份恢复 " + res.tasks + " 项工作项 / " + res.reqs + " 项项目" +
          (res.reqDocs ? " / " + res.reqDocs + " 份文档" : "") +
          (res.branches ? " / " + res.branches + " 个分支" : "") +
          (res.versions ? " / " + res.versions + " 个版本" : "") +
          (res.demands ? " / " + res.demands + " 条需求池" : "") +
          (res.testCases ? " / " + res.testCases + " 条用例" : "") +
          (res.docComments ? " / " + res.docComments + " 条文档评论" : "") +
          (res.comments ? " / " + res.comments + " 条评论" : ""), "fs");
        ganttState.undo = [];
        syncGanttUndoUI();
        loadBoard({animate:true});
        loadReqs();
        loadReqDocs(true);
      }).catch(function(ex){ toast("导入失败：" + (ex.message || "网络异常"), "bad"); });
    }).catch(function(){ toast("读取文件失败", "bad"); });
  });
});
$("btnExportCsv").addEventListener("click", function(){
  var csvUrl = API.url("/api/export/csv" + (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
  fetch(csvUrl, { credentials:"same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok) throw new Error("请求失败（HTTP " + res.status + "）");
    return res.blob();
  }).then(function(blob){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "workbench-tasks-" + rt.TODAY_ISO + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    toast("已导出 CSV", "fs");
  }).catch(function(ex){ toast("导出失败：" + (ex.message || "网络异常"), "bad"); });
});
var btnNavTelemetry = $("btnNavTelemetryCsv");
if(btnNavTelemetry) btnNavTelemetry.addEventListener("click", function(){
  triggerDownload("hourglass-nav-" + rt.TODAY_ISO + ".csv", "\ufeff" + navTelemetryCsv(), "text/csv;charset=utf-8");
  toast("已导出导航使用记录", "fs");
});
var btnReset = $("btnReset"), resetLabel = $("resetLabel");
if(resetLabel) resetLabel.textContent = "清空任务数据";
if(btnReset) btnReset.title = "删除工作项、回收站、项目、子任务、标签、工时、评论、甘特依赖/基线、工作项通知与完成归档、文档（随项目）、文档评论、测试用例、版本与需求池、分享链接失效；分支、附件、时间线、视图、看板列与模块保留";
btnReset.addEventListener("click", function(){
  var n = totalTaskCount(), m = rt.reqList.length;
  var desc = "将删除当前空间的 " + n + " 项工作项与 " + m + " 个项目，以及评论、依赖/基线、文档、文档评论、测试用例、版本与需求池、工作项通知和完成归档；分支、附件、时间线、视图、看板列与模块保留。"
    + "执行前会自动导出当前空间的完整备份。此操作不可撤销。";
  UI.showPrompt({
    title:"清空任务数据",
    desc:desc,
    label:"输入「清空」确认",
    placeholder:"清空",
    maxLength:2,
    required:true,
    okText:"导出备份并清空"
  }).then(function(word){
    if(word === null) return;
    if(word.trim() !== "清空"){ toast("确认文字不正确，未执行清空", "warn"); return; }
    btnReset.disabled = true;
    toast("正在导出备份…", "fs");
    return API.get("/api/export").then(function(data){
      triggerDownload(BACKUP_NAME, JSON.stringify(data, null, 2), "application/json");
      return API.post("/api/import", {v:10, tasks:[], reqs:[], comments:[], deps:[], baseline:[], reqDocs:[], versions:[], demands:[], testCases:[], testCaseRuns:[], docComments:[]});
    }).then(function(){
      state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.reqs = [];
      state.tags = []; state.types = []; state.columns = []; state.completion = ""; state.due = null; state.focus = false; state.blocked = false;
      searchInput.value = "";
      searchWrap.classList.remove("has");
      saveViewState();
      toast((n + m > 0)
        ? ("已清空 " + n + " 项工作项与 " + m + " 个项目；清空前备份已下载")
        : "任务数据已清空（分支、附件、时间线保留）；清空前备份已下载", "warn");
      ganttState.undo = [];
      syncGanttUndoUI();
      loadBoard({animate:true});
      loadReqs();
      loadReqDocs(true);
    }).catch(function(ex){
      toast("清空失败（备份可能已下载）：" + (ex.message || "网络异常"), "bad");
    }).then(function(){ btnReset.disabled = false; });
  });
});
var SHORTCUT_ROWS = [
  ["N","新建工作项：看板内是列内快速录入；其它视图直接打开新建抽屉（不再强制切回看板）"],
  ["C","新建工作项（打开详情抽屉）"],
  ["?","打开这份帮助（快捷键 + 录入语法）"],
  ["g b / g l / g m","跳转：工作项看板 / 工作项列表 / 我的工作"],
  ["g c / g g / g p","跳转：日历 / 甘特图 / 项目"],
  ["g d / g v / g o","跳转：需求池 / 版本 / 文档"],
  ["g t / g i / g w","跳转：测试 / 逾期与阻塞 / 成员负载"],
  ["g n / g r / g a / g s","跳转：消息 / 周回顾 / 报表 / 设置"],
  ["0 / 1 / 2 / 3","卡片/列表行聚焦时设置优先级 P0–P3"],
  ["Ctrl/⌘ + K","打开全局搜索：项目、工作项、文档、需求、用例一次搜到"],
  ["/","聚焦顶部工作项搜索框：在支持筛选的视图里直接过滤列表"],
  ["Space","卡片/列表行聚焦时打开详情抽屉"],
  ["D","卡片/列表行聚焦时改期（今天 / 明天 / 一周后＝5 个工作日 / 无期限，或选具体日期）"],
  ["X","卡片/列表行聚焦时标记完成；在已完成列内按 X 则取消完成"],
  ["← / →","卡片/列表行聚焦时移动到相邻列"],
  ["↑ / ↓","看板内卡片之间上下移动焦点"],
  ["Delete","卡片/列表行聚焦时移入回收站（可在提示里撤销）"],
  ["Esc","逐层关闭：拖拽 → 确认框 → 浮层 → 抽屉 → 弹窗 → 内联输入 → 搜索"],
  ["Ctrl/⌘ + Enter","保存抽屉或弹窗表单；在评论框内为发送评论"],
  ["T","日历视图回到今天"],
  ["Ctrl/⌘ + B","收起 / 展开侧边栏"],
  ["录入语法","!P0 优先级 · #项目 · @负责人 · +标签 · %进度 · ~每周 循环 · 明天 / 3天后 / 10-20 日期"]
];
function renderShortcutRows(){
  return SHORTCUT_ROWS.map(function(r){
    return '<div class="done-item">' +
      '<span class="tag tag-ghost" style="font-family:var(--font-mono)">' + esc(r[0]) + '</span>' +
      '<span class="di-main"><span class="di-m">' + esc(r[1]) + '</span></span></div>';
  }).join("");
}
if($("kbdBody")) $("kbdBody").innerHTML = renderShortcutRows();
if($("helpBody")) $("helpBody").innerHTML = renderShortcutRows();
function openHelp(){
  if(!$("dlgHelp")) return;
  UI.openModal($("dlgHelp"));
}
/* 顶栏帮助菜单在 core/app.js 中绑定：设置模块是懒加载的，
   入口不能跟着它一起延后可用 */
if($("dlgHelpX")) $("dlgHelpX").addEventListener("click", function(){ UI.closeModal($("dlgHelp")); });
if($("dlgHelpOk")) $("dlgHelpOk").addEventListener("click", function(){ UI.closeModal($("dlgHelp")); });
var userListEl = $("userList");
var userMembershipState = { loading:false, loaded:false, loadedAt:0, error:"" };
var userMembershipMap = {};
var userMembershipPromise = null;
var userMembershipSeq = 0;
function enterUsersView(){
  if(rt.currentUser && rt.currentUser.role !== "admin"){
    if(userListEl) userListEl.innerHTML = '<div class="foot-note">仅平台管理员可访问账号管理</div>';
    return;
  }
  loadUserMemberships();
  loadUsers(false);
}
function loadUsers(silent){
  if(!userListEl) return;
  if(!silent) userListEl.innerHTML = '<div style="padding:12px 14px">' + UI.skeletonRows(3) + '</div>';
  API.getAllPages("/api/admin/users").then(function(list){
    renderUsers(list);
  }).catch(function(ex){
    if(rt.currentUser && rt.currentUser.role !== "admin"){
      userListEl.innerHTML = '<div class="foot-note">仅平台管理员可访问账号管理</div>';
      return;
    }
    userListEl.innerHTML = UI.errorState(ex.message);
    bindRetry(userListEl, function(){ loadUsers(false); });
  });
}
/* 账号是平台身份，空间角色是「账号 × 空间」的关系。这里只聚合当前管理员能进入的共享空间；
   拿不到的空间不展示，避免把平台账号列表变成跨空间越权入口。 */
function loadUserMemberships(force){
  if(userMembershipPromise && !force) return userMembershipPromise;
  if(userMembershipState.loaded && !force && Date.now() - userMembershipState.loadedAt < 60000) return Promise.resolve();
  userMembershipState.loading = true;
  userMembershipState.error = "";
  var seq = ++userMembershipSeq;
  userMembershipPromise = API.get("/api/workspaces").then(function(list){
    var shared = (list || []).filter(function(ws){ return ws && ws.type !== "personal"; });
    return Promise.all(shared.map(function(ws){
      return API.get("/api/workspaces/" + encodeURIComponent(ws.id) + "/members").then(function(members){
        return { ws: ws, members: members || [] };
      }).catch(function(){ return { ws: ws, members: [] }; });
    }));
  }).then(function(results){
    if(seq !== userMembershipSeq) return;
    var map = {};
    results.forEach(function(r){
      (r.members || []).forEach(function(m){
        if(!m || !m.userId) return;
        if(!map[m.userId]) map[m.userId] = [];
        map[m.userId].push({ workspaceId:r.ws.id, workspaceName:r.ws.name, role:m.role || "member" });
      });
    });
    userMembershipMap = map;
    userMembershipState.loaded = true;
    userMembershipState.loadedAt = Date.now();
    userMembershipState.loading = false;
    userMembershipPromise = null;
    if(userCache.length) renderUsers(userCache);
  }).catch(function(ex){
    if(seq !== userMembershipSeq) return;
    userMembershipState.loading = false;
    userMembershipState.error = (ex && ex.message) || "网络异常";
    userMembershipPromise = null;
    if(userCache.length) renderUsers(userCache);
  });
  return userMembershipPromise;
}
function userSpacesCell(u){
  if(userMembershipState.loading && !userMembershipState.loaded) return '<span class="foot-note">加载中…</span>';
  if(userMembershipState.error) return '<span class="foot-note" title="' + esc(userMembershipState.error) + '">加载失败</span>';
  var list = userMembershipMap[u.id] || [];
  if(!list.length) return '<span class="foot-note" title="仅统计你有权进入的共享空间">无可见共享空间</span>';
  var shown = list.slice(0, 2).map(function(m){
    return '<span class="tag ghost" title="' + esc(m.workspaceName + " · " + roleLabel(m.role)) + '">' +
      esc(m.workspaceName) + ' · ' + esc(roleLabel(m.role)) + '</span>';
  }).join("");
  var more = list.length > 2 ? '<span class="tag ghost">+' + (list.length - 2) + '</span>' : '';
  return '<button class="user-spaces" type="button" data-u-spaces="' + esc(u.id) + '" title="查看所属空间与角色">' +
    shown + more + '</button>';
}
function openUserSpaces(u){
  var list = (userMembershipMap[u.id] || []).slice();
  var isAdmin = u.role === "admin";
  var rows = list.map(function(m){
    var current = rt.currentWs && rt.currentWs.id === m.workspaceId;
    return '<div class="member-row user-space-row">' +
      '<span class="mi"><span class="nm">' + esc(m.workspaceName) +
        (current ? '<span class="user-space-current">当前空间</span>' : '') + '</span>' +
        '<span class="sub">共享空间</span></span>' +
      '<span class="tag ' + (m.role === "owner" ? "tag-primary" : "ghost") + '">' + esc(roleLabel(m.role)) + '</span>' +
    '</div>';
  }).join("");
  if(!rows) rows = '<div class="foot-note">尚未加入任何共享空间，或你无权查看其空间成员。</div>';
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "账号归属");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML =
    '<div class="sheet user-spaces-sheet">' +
      '<div class="sheet-head">' +
        '<div style="flex:1 1 auto;min-width:0">' +
          '<h2>账号归属</h2>' +
          '<div class="desc">' + esc(u.displayName || u.username) + ' · @' + esc(u.username) + '</div>' +
        '</div>' +
        '<button class="icon-btn sm" type="button" data-user-spaces-close aria-label="关闭">' + icon("close", 15) + '</button>' +
      '</div>' +
      '<div class="sheet-body">' +
        '<div class="user-spaces-summary">' +
          '<span class="tag ' + (isAdmin ? "tag-primary" : "ghost") + '">' + (isAdmin ? "平台管理员" : "普通账号") + '</span>' +
          (u.disabled ? '<span class="tag tag-danger">已停用</span>' : '') +
          '<span class="foot-note">平台角色只决定账号与系统管理权限，不等于空间角色。</span>' +
        '</div>' +
        '<section class="user-spaces-sect"><h4>所属共享空间与角色</h4>' +
          '<div class="member-list">' + rows + '</div>' +
          '<p class="foot-note">仅显示你有权进入的共享空间；每个账号另有仅本人可见的个人空间。</p>' +
        '</section>' +
        '<section class="user-spaces-sect"><h4>在哪里调整</h4>' +
          '<p class="set-hint">空间角色：设置 → 成员与权限（由该空间主/管理员调整）。平台管理员身份：账号管理 → 编辑。</p>' +
        '</section>' +
      '</div>' +
    '</div>';
  layer.querySelector("[data-user-spaces-close]").addEventListener("click", function(){ UI.closeModal(layer); });
  document.body.appendChild(layer);
  UI.openModal(layer, "[data-user-spaces-close]");
}
var userCache = [];
var userAdminCount = 0;
function renderUsers(list){
  userCache = list || [];
  userAdminCount = userCache.filter(function(u){ return u.role === "admin"; }).length;
  if(!userCache.length){
    userListEl.innerHTML = '<div class="foot-note" style="padding:12px 14px">暂无账号</div>';
    return;
  }
  userListEl.innerHTML =
    '<table class="user-table">' +
      '<thead><tr>' +
        '<th scope="col">账号</th>' +
        '<th scope="col">邮箱</th>' +
        '<th scope="col">平台角色</th>' +
        '<th scope="col">所属空间</th>' +
        '<th scope="col" class="user-th-acts">操作</th>' +
      '</tr></thead><tbody>' +
      userCache.map(function(u){
        var isMe = rt.currentUser && u.id === rt.currentUser.id;
        return '<tr data-user-id="' + esc(u.id) + '">' +
          '<td><div class="user-acct">' + avatarHTML(u.displayName, "xl") +
            '<span class="mi"><span class="nm">' + esc(u.displayName) +
              (isMe ? '<span class="self-tag">当前登录</span>' : '') +
              (u.disabled ? '<span class="self-tag">已停用</span>' : '') + '</span>' +
            '<span class="sub">@' + esc(u.username) + '</span></span>' +
          '</div></td>' +
          '<td class="user-email' + (u.email ? '' : ' empty') + '">' +
            (u.email ? esc(u.email) : '未绑定') + '</td>' +
          '<td><span class="tag ' + (u.role === "admin" ? "tag-primary" : "ghost") + '">' +
            (u.role === "admin" ? "平台管理员" : "普通账号") + '</span></td>' +
          '<td>' + userSpacesCell(u) + '</td>' +
          '<td><div class="user-row-acts">' +
            '<button class="btn sm" type="button" data-u-edit>编辑</button>' +
            '<button class="btn sm ghost" type="button" data-u-more aria-haspopup="true" aria-expanded="false">更多</button>' +
          '</div></td>' +
        '</tr>';
      }).join("") +
    '</tbody></table>';
}
function userDeleteGuard(u){
  if(rt.currentUser && u.id === rt.currentUser.id) return "不能删除当前登录账号";
  if(u.role === "admin" && userAdminCount <= 1) return "至少保留一名平台管理员";
  return "";
}
/* A4 停用/启用：停用≠删除，历史数据与负责人引用保留，只阻断登录与在线会话 */
function userDisableGuard(u){
  if(rt.currentUser && u.id === rt.currentUser.id) return "不能停用当前登录账号";
  if(u.disabled) return "";
  var activeAdmins = userCache.filter(function(x){ return x.role === "admin" && !x.disabled; }).length;
  if(u.role === "admin" && activeAdmins <= 1) return "至少保留一名可用平台管理员";
  return "";
}
function toggleUserDisabled(u){
  var disabling = !u.disabled;
  var run = function(){
    API.put("/api/admin/users/" + encodeURIComponent(u.id) + "/disabled?disabled=" + disabling, {}).then(function(){
      toast(disabling ? "已停用账号「" + u.displayName + "」（历史数据保留）"
                      : "已启用账号「" + u.displayName + "」", "fs");
      loadUsers();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  };
  if(!disabling){ run(); return; }
  UI.showConfirm({
    title:"停用账号",
    msg:"停用「" + esc(u.displayName) + "」？该账号将立即退出登录且无法再登录；其历史工作项、负责人引用与成员关系全部保留，随时可重新启用。",
    okText:"停用账号"
  }).then(function(ok){ if(ok) run(); });
}
function removeUser(u){
  UI.showConfirm({
    title:"删除账号",
    msg:"删除账号「" + esc(u.displayName) + "」？该账号个人空间的工作项/项目需已清空；个人空间剩余的文档、附件与配置会随账号一并删除，不可恢复。共享空间里的成员关系同时移除，工作项负责人引用保留。",
    okText:"删除账号"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/admin/users/" + encodeURIComponent(u.id)).then(function(){
      toast("已删除账号「" + u.displayName + "」", "fs");
      loadUsers();
      loadUserMemberships(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openUserMenu(anchor, u){
  var guard = userDeleteGuard(u);
  var dGuard = userDisableGuard(u);
  var menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML =
    '<button class="menu-item" type="button" data-act="pass">' + icon("refresh", 14) + '重置密码</button>' +
    (dGuard && !u.disabled ? '<div class="menu-note">' + esc(dGuard) + '</div>' : '') +
    '<button class="menu-item' + (u.disabled ? '' : ' danger') + '" type="button" data-act="toggle"' +
      (dGuard && !u.disabled ? " disabled" : "") + '>' +
      icon(u.disabled ? "check" : "pause", 14) + (u.disabled ? '启用账号</button>' : '停用账号</button>') +
    (guard ? '<div class="menu-note">' + esc(guard) + '</div>' : '') +
    '<button class="menu-item danger" type="button" data-act="del"' + (guard ? " disabled" : "") + '>' +
      icon("trash", 14) + '删除账号</button>';
  menu.addEventListener("click", function(ev){
    var b = ev.target.closest("[data-act]");
    if(!b || b.disabled) return;
    UI.closeAllPops();
    if(b.dataset.act === "pass") openUserPwdDialog(u.id, u.displayName);
    else if(b.dataset.act === "toggle") toggleUserDisabled(u);
    else removeUser(u);
  });
  UI.openPop(menu, anchor, {
    width:180,
    onClose:function(){ if(menu.parentNode) menu.parentNode.removeChild(menu); }
  });
}
var editingUserId = null;
function openUserEdit(u){
  editingUserId = u.id;
  var lastAdmin = u.role === "admin" && userAdminCount <= 1;
  $("dlgUserEditFor").textContent = "@" + u.username;
  $("dlgUserName").value = u.displayName || "";
  $("dlgUserEmail").value = u.email || "";
  $("dlgUserRole").value = u.role === "admin" ? "admin" : "user";
  $("dlgUserRole").disabled = lastAdmin;
  $("dlgUserRoleHint").textContent = lastAdmin
    ? "最后一名平台管理员不能降级为普通账号；如需调整，请先把其他账号设为平台管理员。"
    : "普通账号只能管理自己的数据与参与的空间；平台管理员另可管理全部账号与系统设置。空间内的角色在「成员与权限」中分配。";
  $("fDlgUserName").classList.remove("invalid");
  $("fDlgUserEmail").classList.remove("invalid");
  UI.openModal($("dlgUserEdit"));
}
$("dlgUserEditForm").addEventListener("submit", function(e){
  e.preventDefault();
  if($("dlgUserEditOk").disabled) return;
  if(!editingUserId) return;
  var name = $("dlgUserName").value.trim();
  var email = $("dlgUserEmail").value.trim();
  var missingName = !name;
  var badEmail = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  $("fDlgUserName").classList.toggle("invalid", missingName);
  $("fDlgUserEmail").classList.toggle("invalid", badEmail);
  if(missingName || badEmail) return;
  var btn = $("dlgUserEditOk");
  btn.disabled = true;
  API.put("/api/admin/users/" + encodeURIComponent(editingUserId), {
    displayName: name, email: email || null, role: $("dlgUserRole").value
  }).then(function(){
    btn.disabled = false;
    editingUserId = null;
    UI.closeModal($("dlgUserEdit"));
    toast("已保存账号「" + name + "」", "fs");
    loadUsers();
    loadBoard({silent:true});
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
userListEl.addEventListener("click", function(e){
  var row = e.target.closest("tr[data-user-id]");
  if(!row) return;
  var u = userCache.filter(function(x){ return x.id === row.dataset.userId; })[0];
  if(!u) return;
  if(e.target.closest("[data-u-edit]")){ openUserEdit(u); return; }
  if(e.target.closest("[data-u-spaces]")){ openUserSpaces(u); return; }
  var more = e.target.closest("[data-u-more]");
  if(more) openUserMenu(more, u);
});
$("btnUserAdd").addEventListener("click", function(){
  var username = $("uNewName").value.trim();
  var display = $("uNewDisplay").value.trim();
  var password = $("uNewPass").value;
  var role = $("uNewRole").value;
  if(!username || !password){ toast("请填写登录名和初始密码", "warn"); return; }
  if(password.length < 6){ toast("初始密码至少 6 位", "warn"); return; }
  var btn = $("btnUserAdd");
  btn.disabled = true;
  API.post("/api/admin/users", { username: username, password: password, displayName: display || null, role: role }).then(function(u){
    btn.disabled = false;
    toast("已创建账号「" + u.displayName + "」（@" + u.username + "）", "fs");
    $("uNewName").value = ""; $("uNewDisplay").value = ""; $("uNewPass").value = "";
    loadUsers();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "新建失败", "bad");
  });
});
var userPwdTargetId = null;
function openUserPwdDialog(id, display){
  userPwdTargetId = id;
  $("dlgUserPwdFor").textContent = display ? "「" + display + "」" : "该账号";
  $("dlgUserPwdInput").value = "";
  $("fDlgUserPwd").classList.remove("invalid");
  UI.openModal($("dlgUserPwd"));
}
$("dlgUserPwdForm").addEventListener("submit", function(e){
  e.preventDefault();
  if($("dlgUserPwdOk").disabled) return;
  var pwd = $("dlgUserPwdInput").value;
  if(pwd.length < 6){ $("fDlgUserPwd").classList.add("invalid"); return; }
  if(!userPwdTargetId) return;
  var btn = $("dlgUserPwdOk");
  btn.disabled = true;
  API.post("/api/admin/users/" + encodeURIComponent(userPwdTargetId) + "/password", { password: pwd }).then(function(){
    btn.disabled = false;
    UI.closeModal($("dlgUserPwd"));
    toast("密码已重置，请通知该账号", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "重置失败", "bad");
  });
});
function renderMailSettings(d){
  if(!$("mailHost")) return;
  d = d || {};
  $("mailEnabled").checked = !!d.enabled;
  $("mailHost").value = d.host || "";
  $("mailPort").value = d.port || 587;
  $("mailUsername").value = d.username || "";
  $("mailPassword").value = "";
  $("mailFrom").value = d.fromEmail || "";
  $("mailPasswordHint").textContent = d.passwordSet ? "已保存密码，留空表示不修改" : "尚未保存密码";
}
function loadMailSettings(){
  if(!$("mailHost")) return;
  API.get("/api/admin/mail-settings").then(renderMailSettings).catch(function(ex){
    if($("mailResult")){
      $("mailResult").hidden = false;
      $("mailResult").textContent = "SMTP 配置加载失败：" + (ex.message || "未知错误");
    }
  });
}
function mailSettingsBody(){
  return {
    enabled: $("mailEnabled").checked,
    host: $("mailHost").value.trim(),
    port: Number($("mailPort").value),
    username: $("mailUsername").value.trim(),
    password: $("mailPassword").value,
    fromEmail: $("mailFrom").value.trim()
  };
}
function saveMailSettings(){
  return API.put("/api/admin/mail-settings", mailSettingsBody()).then(function(d){
    renderMailSettings(d);
    return d;
  });
}
if($("mailSave")) $("mailSave").addEventListener("click", function(){
  var btn = this;
  btn.disabled = true;
  saveMailSettings().then(function(){
    btn.disabled = false;
    toast("SMTP 配置已保存", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
if($("mailTest")) $("mailTest").addEventListener("click", function(){
  var btn = this;
  btn.disabled = true;
  if($("mailResult")){
    $("mailResult").hidden = false;
    $("mailResult").textContent = "正在保存并发送测试邮件…";
  }
  saveMailSettings().then(function(){ return API.post("/api/admin/mail-settings/test", {}); }).then(function(d){
    btn.disabled = false;
    $("mailResult").textContent = "测试邮件已发送至 " + (d.recipient || "当前管理员邮箱");
    toast("测试邮件发送成功", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    if($("mailResult")) $("mailResult").textContent = "测试失败：" + (ex.message || "未知错误");
    toast(ex.message || "测试失败", "bad");
  });
});

export { enterSettingsView, loadTrash, loadUsers, openHelp, refreshPlatformTab, setPlatformTab, setSettingsTab, settingsTab };
