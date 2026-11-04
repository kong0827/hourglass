/* views/settings · 设置（空间 / 工作流 / 数据 / 活动 / 账号） */

import { API } from "../core/api.js";
import { loadCategories, loadWorkspaces } from "../core/app.js";
import { $, actCount, actList, btnNotifySave, channelCards, notifyStatus, notifyStatusText, searchInput, searchWrap, wsWebhookHint, wsWebhookLabel } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { catTag, rt, state, totalTaskCount } from "../core/state.js";
import { UI, copyToClipboard, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { triggerDownload } from "../lib/download.js";
import { BACKUP_NAME, CAT_DEFAULT_COLOR, avatarHTML, dayDiff, fmtShortMD, fmtTs, startOfDay } from "../lib/format.js";
import { loadBoard, loadReqs } from "./board.js";
import { ganttState, syncGanttUndoUI } from "./gantt.js";
import { loadReqDocs } from "./requirements.js";

var trashList = $("trashList");
function loadTrash(opts){
  opts = opts || {};
  if(!opts.silent) trashList.innerHTML = UI.skeletonRows(4);
  API.get("/api/trash").then(function(list){
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
      icon:"trash", title:"回收站是空的", text:"删除的任务会在这里保留 30 天，之后自动清理。"
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
          '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
          catTag(t.category) +
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
    if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可彻底删除任务", "warn"); return; }
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
    catCfgList = $("catCfgList"), catNewName = $("catNewName"), catNewColor = $("catNewColor"),
    colCfgList = $("colCfgList"), colNewName = $("colNewName"), colNewColor = $("colNewColor");
/* 成员搜索选择器：用户先从候选列表选中，再点「添加成员」 */
var wsMemberSelected = null, wsMemberCandidates = {}, wsMemberTimer = null, wsMemberSeq = 0;
var ROLE_LABELS = { owner:"空间主", admin:"管理员", member:"成员", viewer:"查看者" };
function roleLabel(role){ return ROLE_LABELS[role] || ROLE_LABELS.member; }
function roleOptions(selected, allowAdmin){
  var roles = allowAdmin === false ? ["member","viewer"] : ["admin","member","viewer"];
  return roles.map(function(r){
    return '<option value="' + r + '"' + (r === selected ? " selected" : "") + '>' + roleLabel(r) + '</option>';
  }).join("");
}
function enterSettingsView(){
  if(!rt.currentWs || !wsNameInput) return;
  rt.settingsReady = true;
  if(rt.projectAccessCache && rt.projectAccessCache.wsId !== rt.currentWs.id) rt.projectAccessCache = null;
  var isOwner = rt.currentWs.myRole === "owner";
  var myRole = rt.currentWs.myRole || "member";
  var isManager = isOwner || myRole === "admin";
  var isPersonal = rt.currentWs.type === "personal";
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
  if($("inviteHint")) $("inviteHint").textContent = isAdmin
    ? "把链接发给已有账号的同事：对方登录后打开链接即可一键加入；新同事请先在你的「用户管理」里创建账号。链接 7 天有效，可随时撤销。"
    : "把链接发给已有账号的同事：对方登录后打开链接即可一键加入。链接 7 天有效，可随时撤销。";
  if($("setTabAccess")) $("setTabAccess").hidden = !isManager || isPersonal;
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
    : (isOwner ? "危险操作仅空间主可执行；删除空间会连同其数据一起删除" : "清空任务数据、导入覆盖、删除列/分类仅空间主可操作");
  loadColCfg();
  loadCatCfg();
  loadNotifyStatus();
  loadActivity();
  initSetTabs();
  setSettingsTab(settingsTab);
}
var settingsTab = "space";
function setSettingsTab(tab){
  var isAdmin = !!(rt.currentUser && rt.currentUser.role === "admin");
  var myRole = rt.currentWs && rt.currentWs.myRole;
  var isManager = myRole === "owner" || myRole === "admin";
  if(tab === "account" && !isAdmin) tab = "space";
  if(tab === "access" && !isManager) tab = "space";
  settingsTab = tab;
  document.querySelectorAll("#setTabs [data-set-tab]").forEach(function(b){
    var on = b.dataset.setTab === tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("#view-settings [data-set-pane]").forEach(function(p){
    p.hidden = p.dataset.setPane !== tab;
  });
  /* SMTP 配置在「集成」页里，仅平台管理员可见 */
  if($("set-mail")) $("set-mail").hidden = tab !== "integration" || !isAdmin;
  if(tab === "data") loadTrash({silent:true});
  if(tab === "access") loadProjectAccess();
  if(tab === "integration" && isAdmin) loadMailSettings();
  if(tab === "account") enterUsersView();
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
function loadWsMemberList(){
  wsMemberList.innerHTML = UI.skeletonRows(2);
  var wsId = encodeURIComponent(rt.currentWs.id);
  var myRole = rt.currentWs.myRole;
  var isOwner = myRole === "owner";
  var isManager = isOwner || myRole === "admin";
  var render = function(){
    $("wsMemberCount").textContent = "共 " + rt.wsMembersCache.length + " 人";
    wsMemberList.innerHTML = rt.wsMembersCache.map(function(m){
      var isSelf = rt.currentUser && m.userId === rt.currentUser.id;
      var role = m.role || "member";
      /* 管理员只能调整/移除成员与查看者；管理员本人与空间主仅空间主可处理 */
      var canManageRow = isOwner || (isManager && role !== "admin" && role !== "owner");
      var canRemove = isSelf ? role !== "owner" : (canManageRow && role !== "owner");
      var roleCell = canManageRow
        ? '<select class="mini-select" data-member-role aria-label="空间角色" title="调整空间角色">' +
            roleOptions(role, isOwner) + '</select>'
        : '<span class="tag ' + (role === "owner" ? "tag-primary" : "tag-ghost") + '">' +
            roleLabel(role) + '</span>';
      var sub = "@" + esc(m.username);
      var vis = memberVisibilityText(m);
      if(vis) sub += ' · ' + vis;
      return '<div class="member-row" data-mid="' + esc(m.userId) + '">' +
        avatarHTML(m.displayName, "lg") +
        '<span class="mi"><span class="nm">' + esc(m.displayName) + '</span>' +
          '<span class="sub">' + sub + '</span></span>' +
        roleCell +
        (canRemove ? '<span class="acts"><button class="btn sm danger" type="button" data-mid-del="' +
          esc(m.userId) + '">' + (isSelf ? "退出" : "移出") + '</button></span>' : '') +
      '</div>';
    }).join("");
  };
  API.get("/api/workspaces/" + wsId + "/members").then(function(list){
    rt.wsMembersCache = list || [];
    /* 可见项目数来自矩阵接口：只有管理者能读，读不到就不显示这一项 */
    if(isManager && !rt.projectAccessCache){
      API.get("/api/workspaces/" + wsId + "/project-access").then(function(data){
        rt.projectAccessCache = data || {};
        rt.projectAccessCache.wsId = rt.currentWs.id;
        render();
      }).catch(render);
      return;
    }
    render();
  }).catch(function(ex){
    wsMemberList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function memberVisibilityText(m){
  var data = rt.projectAccessCache;
  if(!data || !(data.projects || []).length) return "";
  var projects = data.projects || [];
  var role = m.role || "member";
  if(role !== "member") return "可见全部 " + projects.length + " 个项目";
  var hidden = 0;
  (data.grants || []).forEach(function(g){
    if(g.userId === m.userId && g.projectId && g.access === "none") hidden++;
  });
  return "可见 " + (projects.length - hidden) + "/" + projects.length + " 个项目";
}
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
    loadWsMemberList();
    if(settingsTab === "access") loadProjectAccess();
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
  { value:"default", label:"默认（参与）" },
  { value:"read", label:"只读" },
  { value:"none", label:"不可见" }
];
/* 历史数据可能残留 pm/dev/qa：小团队不区分项目内角色，统一按默认参与展示 */
function normalizeAccess(value){
  return (value === "read" || value === "none") ? value : "default";
}
function accessOptions(selected){
  return ACCESS_OPTIONS.map(function(o){
    return '<option value="' + o.value + '"' + (o.value === selected ? " selected" : "") + '>' + o.label + '</option>';
  }).join("");
}
function isPrivilegedRole(role){ return role === "owner" || role === "admin"; }
function accessKey(userId, projectId){ return userId + "|" + projectId; }
function loadProjectAccess(){
  var box = $("projectAccessWrap");
  if(!box || !rt.currentWs) return;
  box.innerHTML = '<div class="foot-note">加载中…</div>';
  API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/project-access").then(function(data){
    rt.projectAccessCache = data || {};
    rt.projectAccessCache.wsId = rt.currentWs.id;
    renderProjectAccess();
  }).catch(function(ex){
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
        var value = normalizeAccess(grantMap[accessKey(m.userId, p.id)] || "default");
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
  var access = sel.value === "default" ? "" : sel.value;
  sel.disabled = true;
  API.put("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/project-access", {
    userId: userId, projectId: projectId, access: access
  }).then(function(){
    if(rt.projectAccessCache){
      rt.projectAccessCache.grants = rt.projectAccessCache.grants || [];
      rt.projectAccessCache.grants = rt.projectAccessCache.grants.filter(function(g){
        return !(g.userId === userId && g.projectId === projectId);
      });
      if(access) rt.projectAccessCache.grants.push({ userId:userId, projectId:projectId, access:access });
    }
    toast(access ? "可见范围已更新" : "已恢复默认参与", "fs");
  }).catch(function(ex){
    toast(ex.message || "保存失败", "bad");
    loadProjectAccess();
  }).then(function(){
    sel.disabled = false;
  });
});
function inviteLink(code){
  return window.location.origin + "/join.html?code=" + encodeURIComponent(code);
}
function loadInvites(){
  var listEl = $("inviteList");
  if(!listEl || !rt.currentWs) return;
  listEl.innerHTML = UI.skeletonRows(1);
  API.get("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/invites").then(function(list){
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
    listEl.innerHTML = '<div class="col-empty">还没有邀请链接，点上方按钮生成</div>';
    return;
  }
  listEl.innerHTML = rt.inviteCache.map(function(v){
    return '<div class="invite-row" data-invite-id="' + esc(v.id) + '">' +
      '<code title="' + esc(inviteLink(v.id)) + '">' + esc(inviteLink(v.id)) + '</code>' +
      '<span class="foot-note">有效期至 ' + esc(fmtShortMD(new Date(v.expiresAt))) + ' · 已加入 ' + (v.usedCount || 0) + ' 人</span>' +
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
    rt.colDefsCache = (defs || []).filter(function(d){ return !d.done; });
    renderColCfg();
  }).catch(function(ex){
    colCfgList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderColCfg(){
  var canEdit = rt.currentWs && rt.currentWs.myRole === "owner";
  colCfgList.innerHTML = rt.colDefsCache.map(function(d, idx){
    var fixed = (d.id === "backlog" || d.id === "doing");
    var delDisabled = fixed || !canEdit;
    return '<div class="cfg-row" data-col-id="' + esc(d.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(d.color || CAT_DEFAULT_COLOR) + '" data-col-color aria-label="列颜色" />' +
      '<input type="text" value="' + esc(d.name) + '" maxlength="12" data-col-name aria-label="列名" />' +
      (fixed ? '<span class="sysmark">系统列</span>' : '') +
      '<button class="cc-act" type="button" data-col-up title="上移"' + (idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-col-down title="下移"' + (idx === rt.colDefsCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
      '<button class="cc-act dan" type="button" data-col-del title="' + (fixed ? "内置列不可删除" : "删除列") + '"' + (delDisabled ? " disabled" : "") + '>' + icon("trash", 14) + '</button>' +
    '</div>';
  }).join("");
  UI.wireTooltips(colCfgList);
}
function saveColRow(id){
  var row = colCfgList.querySelector('[data-col-id="' + id + '"]');
  if(!row) return;
  var name = row.querySelector("[data-col-name]").value.trim();
  var color = row.querySelector("[data-col-color]").value;
  if(!name){ toast("列名不能为空", "warn"); loadColCfg(); return; }
  API.put("/api/columns/" + encodeURIComponent(id), { name: name, color: color }).then(function(){
    toast("已更新列「" + name + "」", "fs");
    loadColCfg();
    loadBoard({silent:true});
  }).catch(function(ex){
    toast(ex.message || "保存失败", "bad");
    loadColCfg();
  });
}
colCfgList.addEventListener("change", function(e){
  var row = e.target.closest("[data-col-id]");
  if(!row) return;
  if(e.target.matches("[data-col-name]") || e.target.matches("[data-col-color]")) saveColRow(row.dataset.colId);
});
colCfgList.addEventListener("click", function(e){
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
      msg:"删除列「" + esc(col.name) + "」？其下任务将移入最靠前的列。",
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
  var name = colNewName.value.trim();
  if(!name){ toast("请填写新列名", "warn"); return; }
  API.post("/api/columns", { name: name, color: colNewColor.value }).then(function(){
    toast("已添加列「" + name + "」", "fs");
    colNewName.value = "";
    loadColCfg();
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
function loadCatCfg(){
  catCfgList.innerHTML = UI.skeletonRows(2);
  API.get("/api/categories").then(function(list){
    rt.catDefsCache = list || [];
    renderCatCfg();
  }).catch(function(ex){
    catCfgList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderCatCfg(){
  $("catCount").textContent = rt.catDefsCache.length ? "共 " + rt.catDefsCache.length + " 个" : "";
  var canDel = rt.currentWs && rt.currentWs.myRole === "owner";
  catCfgList.innerHTML = rt.catDefsCache.map(function(c, idx){
    return '<div class="cfg-row" data-cat-id="' + esc(c.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(c.color || CAT_DEFAULT_COLOR) + '" data-cat-color aria-label="分类颜色" />' +
      '<input type="text" value="' + esc(c.name) + '" maxlength="12" data-cat-name aria-label="分类名称" />' +
      '<button class="cc-act" type="button" data-cat-up title="上移"' + (idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-cat-down title="下移"' + (idx === rt.catDefsCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
      '<button class="cc-act dan" type="button" data-cat-del title="删除分类"' + (canDel ? "" : " disabled") + '>' + icon("trash", 14) + '</button>' +
    '</div>';
  }).join("");
  UI.wireTooltips(catCfgList);
}
function saveCatRow(id){
  var row = catCfgList.querySelector('[data-cat-id="' + id + '"]');
  if(!row) return;
  var name = row.querySelector("[data-cat-name]").value.trim();
  var color = row.querySelector("[data-cat-color]").value;
  if(!name){ toast("分类名不能为空", "warn"); loadCatCfg(); return; }
  API.put("/api/categories/" + encodeURIComponent(id), { name: name, color: color }).then(function(){
    toast("已更新分类「" + name + "」", "fs");
    loadCatCfg();
    loadCategories(true);
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); loadCatCfg(); });
}
catCfgList.addEventListener("change", function(e){
  var row = e.target.closest("[data-cat-id]");
  if(!row) return;
  if(e.target.matches("[data-cat-name]") || e.target.matches("[data-cat-color]")) saveCatRow(row.dataset.catId);
});
catCfgList.addEventListener("click", function(e){
  var row = e.target.closest("[data-cat-id]");
  if(!row) return;
  var id = row.dataset.catId;
  if(e.target.closest("[data-cat-up]") || e.target.closest("[data-cat-down]")){
    var idx = -1;
    for(var i = 0; i < rt.catDefsCache.length; i++) if(rt.catDefsCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-cat-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= rt.catDefsCache.length) return;
    var moved = rt.catDefsCache.splice(idx, 1)[0];
    rt.catDefsCache.splice(to, 0, moved);
    API.put("/api/categories/order", { ids: rt.catDefsCache.map(function(c){ return c.id; }) }).then(function(){
      loadCatCfg();
    }).catch(function(ex){ toast(ex.message || "排序失败", "bad"); loadCatCfg(); });
    return;
  }
  if(e.target.closest("[data-cat-del]")){
    var cat = null;
    for(var j = 0; j < rt.catDefsCache.length; j++) if(rt.catDefsCache[j].id === id) cat = rt.catDefsCache[j];
    if(!cat) return;
    UI.showConfirm({
      title:"删除分类",
      msg:"删除分类「" + esc(cat.name) + "」？其下任务将改到第一个分类。",
      okText:"删除分类"
    }).then(function(ok){
      if(!ok) return;
      API.del("/api/categories/" + encodeURIComponent(id)).then(function(){
        toast("已删除分类「" + cat.name + "」", "fs");
        loadCatCfg();
        loadCategories(true);
        loadBoard({silent:true});
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
});
$("btnCatAdd").addEventListener("click", function(){
  var name = catNewName.value.trim();
  if(!name){ toast("请填写分类名称", "warn"); return; }
  API.post("/api/categories", { name: name, color: catNewColor.value }).then(function(){
    toast("已添加分类「" + name + "」", "fs");
    catNewName.value = "";
    loadCatCfg();
    loadCategories(true);
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
var CHANNEL_LABEL = { webhook:"企业微信 / 钉钉 webhook", serverchan:"Server 酱", pushplus:"PushPlus" };
function loadNotifyStatus(){
  if(!notifyStatusText) return;
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
function loadActivity(){
  if(!actList) return;
  actList.innerHTML = UI.skeletonRows(4);
  API.get("/api/activity", {limit: 200}).then(function(list){
    renderActivity(list || []);
  }).catch(function(ex){
    actList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "该接口需要后端支持") + '</div>';
  });
}
function renderActivity(list){
  if(actCount) actCount.textContent = list.length ? ("最近 " + list.length + " 条") : "";
  if(!list.length){
    actList.innerHTML = '<div class="col-empty">还没有操作记录</div>';
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
  }).join("");
}
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
      toast((res && res.reason) || "未发送（无逾期或今日到期任务）", "warn");
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
function renderMemberOptions(list){
  var box = memberOptionsEl();
  if(!box) return;
  wsMemberCandidates = {};
  (list || []).forEach(function(u){ wsMemberCandidates[u.id] = u; });
  if(!list || !list.length){
    box.innerHTML = '<div class="member-option-empty">没有匹配的账号（账号需先由平台管理员创建）</div>';
    setMemberOptionsOpen(true);
    return;
  }
  box.innerHTML = list.map(function(u){
    return '<button class="member-option" type="button" role="option" data-cid="' + esc(u.id) + '">' +
      '<span class="nm">' + esc(u.displayName || u.username) + '</span>' +
      '<span class="sub">@' + esc(u.username) + '</span></button>';
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
  wsMemberSelected = u;
  wsMemberName.value = (u.displayName || u.username) + " (@" + u.username + ")";
  $("btnWsMemberAdd").disabled = false;
  setMemberOptionsOpen(false);
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
  var del = e.target.closest("[data-mid-del]");
  if(!del) return;
  var uid = del.dataset.midDel;
  var isSelf = rt.currentUser && uid === rt.currentUser.id;
  UI.showConfirm({
    title: isSelf ? "退出空间" : "移除成员",
    msg: isSelf ? "确定退出该空间？你的任务会保留在空间里。" : "确定移除该成员？",
    okText: isSelf ? "退出空间" : "移除"
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
    msg:"确定退出空间「" + esc(rt.currentWs.name) + "」？你的任务会保留在空间里。",
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
$("btnInviteGen").addEventListener("click", function(){
  if(!rt.currentWs) return;
  var btn = $("btnInviteGen");
  btn.disabled = true;
  API.post("/api/workspaces/" + encodeURIComponent(rt.currentWs.id) + "/invites", {}).then(function(res){
    btn.disabled = false;
    copyToClipboard(inviteLink(res.id), "邀请链接已复制（对方需先有账号，登录后打开即可加入）");
    loadInvites();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "生成失败", "bad");
  });
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
    toast("已导出任务备份（含任务/项目/评论/甘特依赖与基线/文档/分支/版本/需求池）", "fs");
  }).catch(function(ex){ toast("导出失败：" + (ex.message || "网络异常"), "bad"); });
});
$("btnImport").addEventListener("click", function(){ $("fileImport").click(); });
$("fileImport").addEventListener("change", function(e){
  var f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  UI.showConfirm({
    title:"导入任务备份",
    msg:"导入会覆盖当前空间的任务、回收站、项目、子任务、标签、工时、评论、甘特依赖与基线，并按任务重建完成归档；同时清空任务通知。已选文件：<b>" +
      esc(f.name) + "</b>。<br><br>附件、操作时间线、保存视图、看板列/分类<b>不会被导入或删除</b>。" +
      "<br><br>v6 备份会连同<b>文档与分支</b>一起覆盖恢复，v8 备份还会恢复<b>项目版本、版本任务绑定、需求池与首版上线日</b>；旧备份不含这些数据时保留现状。旧备份不含依赖/基线（v4 之前也不含评论）：缺失的部分导入后会被清空。建议先导出一份当前任务备份。导入后当前空间的只读分享链接会失效。",
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
        toast("已从备份恢复 " + res.tasks + " 项任务 / " + res.reqs + " 项项目" +
          (res.reqDocs ? " / " + res.reqDocs + " 份文档" : "") +
          (res.branches ? " / " + res.branches + " 个分支" : "") +
          (res.versions ? " / " + res.versions + " 个版本" : "") +
          (res.demands ? " / " + res.demands + " 条需求池" : "") +
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
  var csvUrl = "/api/export/csv" + (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
  fetch(csvUrl, { credentials:"same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = "/login.html"; throw new Error("未登录"); }
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
var btnReset = $("btnReset"), resetLabel = $("resetLabel");
function disarmReset(){
  if(rt.resetArmed){ clearTimeout(rt.resetArmed); rt.resetArmed = null; }
  btnReset.classList.remove("armed");
  resetLabel.textContent = "清空任务数据";
  btnReset.title = "删除任务、回收站、项目、子任务、标签、工时、评论、甘特依赖/基线、任务通知与完成归档、文档（随项目）、版本与需求池、分享链接失效；分支、附件、时间线、视图、看板列与分类保留";
}
disarmReset();
btnReset.addEventListener("click", function(){
  if(rt.resetArmed){
    disarmReset();
    var n = totalTaskCount(), m = rt.reqList.length;
    API.post("/api/import", {v:8, tasks:[], reqs:[], comments:[], deps:[], baseline:[], reqDocs:[], versions:[], demands:[]}).then(function(){
      state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.reqs = [];
      state.tags = []; state.types = []; state.due = null; state.focus = false; state.blocked = false;
      searchInput.value = "";
      searchWrap.classList.remove("has");
      toast((n + m > 0)
        ? ("已清空 " + n + " 项任务与 " + m + " 个项目（含回收站、评论、任务通知、完成归档、文档、版本与需求池）")
        : "任务数据已清空（分支、附件、时间线保留）", "warn");
      ganttState.undo = [];
      syncGanttUndoUI();
      loadBoard({animate:true});
      loadReqs();
      loadReqDocs(true);
    }).catch(function(ex){ toast("清空失败：" + (ex.message || "网络异常"), "bad"); });
    return;
  }
  btnReset.classList.add("armed");
  resetLabel.textContent = "再次点击清空任务数据";
  toast("再次点击确认：删除任务/回收站/项目/评论/甘特依赖与基线/任务通知/完成归档/文档/版本与需求池，分享链接失效；分支、附件、时间线保留", "warn");
  rt.resetArmed = setTimeout(disarmReset, 3500);
});
var SHORTCUT_ROWS = [
  ["N","新建任务：看板内是列内快速录入；其它视图直接打开新建抽屉（不再强制切回看板）"],
  ["C","新建任务（打开详情抽屉）"],
  ["?","打开这份帮助（快捷键 + 录入语法）"],
  ["g b / g l / g m","跳转：看板 / 列表 / 我的任务"],
  ["g c / g g / g p","跳转：日历 / 甘特图 / 项目"],
  ["g r / g a / g s","跳转：周回顾 / 分析 / 设置"],
  ["0 / 1 / 2 / 3","卡片/列表行聚焦时设置优先级 P0–P3"],
  ["/ 或 Ctrl/⌘ + K","聚焦全局搜索：任意视图可用；不支持筛选的视图不会自动跳页"],
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
if($("btnHelp")) $("btnHelp").addEventListener("click", openHelp);
if($("dlgHelpX")) $("dlgHelpX").addEventListener("click", function(){ UI.closeModal($("dlgHelp")); });
if($("dlgHelpOk")) $("dlgHelpOk").addEventListener("click", function(){ UI.closeModal($("dlgHelp")); });
var userListEl = $("userList");
function enterUsersView(){
  if(rt.currentUser && rt.currentUser.role !== "admin"){
    if(userListEl) userListEl.innerHTML = '<div class="foot-note">仅管理员可访问用户管理</div>';
    return;
  }
  loadUsers(false);
}
function loadUsers(silent){
  if(!userListEl) return;
  if(!silent) userListEl.innerHTML = UI.skeletonRows(3);
  API.get("/api/admin/users").then(function(list){
    renderUsers(list);
  }).catch(function(ex){
    if(rt.currentUser && rt.currentUser.role !== "admin"){
      userListEl.innerHTML = '<div class="foot-note">仅管理员可访问用户管理</div>';
      return;
    }
    userListEl.innerHTML = UI.errorState(ex.message);
    bindRetry(userListEl, function(){ loadUsers(false); });
  });
}
function renderUsers(list){
  if(!list || !list.length){
    userListEl.innerHTML = '<div class="foot-note">暂无用户</div>';
    return;
  }
  var adminCount = list.filter(function(u){ return u.role === "admin"; }).length;
  userListEl.innerHTML = list.map(function(u){
    var isMe = rt.currentUser && u.id === rt.currentUser.id;
    var lastAdmin = u.role === "admin" && adminCount <= 1;
    var delDisabled = isMe || lastAdmin;
    var delTip = isMe ? "不能删除自己" : (lastAdmin ? "至少保留一名管理员" : "删除用户");
    return '<div class="user-row" data-user-id="' + esc(u.id) + '">' +
      avatarHTML(u.displayName, "xl") +
      '<span class="mi">' +
        '<span class="nm">' + esc(u.displayName) +
          (isMe ? ' <span class="foot-note">（当前登录）</span>' : '') + '</span>' +
        '<span class="sub">@' + esc(u.username) + '</span>' +
      '</span>' +
      '<span class="tag ' + (u.role === "admin" ? "tag-primary" : "tag-ghost") + '">' +
        (u.role === "admin" ? "管理员" : "成员") + '</span>' +
      '<span class="acts">' +
        '<input class="input" type="text" value="' + esc(u.displayName) + '" maxlength="32" data-u-display placeholder="显示名" style="width:140px;height:30px" />' +
        '<select class="mini-select" data-u-role aria-label="角色">' +
          '<option value="user"' + (u.role === "user" ? " selected" : "") + '>成员</option>' +
          '<option value="admin"' + (u.role === "admin" ? " selected" : "") + '>管理员</option>' +
        '</select>' +
        '<button class="btn sm" type="button" data-u-save>保存</button>' +
        '<button class="btn sm" type="button" data-u-pass>重置密码</button>' +
        '<button class="btn sm danger" type="button" data-u-del data-tip="' + esc(delTip) + '"' + (delDisabled ? " disabled" : "") + '>删除</button>' +
      '</span>' +
    '</div>';
  }).join("");
  UI.wireTooltips(userListEl);
}
userListEl.addEventListener("click", function(e){
  var row = e.target.closest("[data-user-id]");
  if(!row) return;
  var id = row.dataset.userId;
  var display = row.querySelector("[data-u-display]").value.trim();
  var role = row.querySelector("[data-u-role]").value;
  if(e.target.closest("[data-u-save]")){
    if(!display){ toast("显示名不能为空", "warn"); return; }
    API.put("/api/admin/users/" + encodeURIComponent(id), { displayName: display, role: role }).then(function(){
      toast("已保存用户「" + display + "」", "fs");
      loadUsers();
      loadBoard({silent:true});
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
    return;
  }
  if(e.target.closest("[data-u-pass]")){ openUserPwdDialog(id, display); return; }
  if(e.target.closest("[data-u-del]")){
    UI.showConfirm({
      title:"删除用户",
      msg:"删除用户「" + esc(display) + "」？该账号个人空间的任务/项目需已清空；个人空间剩余的文档、附件与配置会随账号一并删除，不可恢复。",
      okText:"删除用户"
    }).then(function(ok){
      if(!ok) return;
      API.del("/api/admin/users/" + encodeURIComponent(id)).then(function(){
        toast("已删除用户「" + display + "」", "fs");
        loadUsers();
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
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
    toast("已创建用户「" + u.displayName + "」（@" + u.username + "）", "fs");
    $("uNewName").value = ""; $("uNewDisplay").value = ""; $("uNewPass").value = "";
    loadUsers();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});
var userPwdTargetId = null;
function openUserPwdDialog(id, display){
  userPwdTargetId = id;
  $("dlgUserPwdFor").textContent = display ? "「" + display + "」" : "该用户";
  $("dlgUserPwdInput").value = "";
  $("fDlgUserPwd").classList.remove("invalid");
  UI.openModal($("dlgUserPwd"));
}
$("dlgUserPwdForm").addEventListener("submit", function(e){
  e.preventDefault();
  var pwd = $("dlgUserPwdInput").value;
  if(pwd.length < 6){ $("fDlgUserPwd").classList.add("invalid"); return; }
  if(!userPwdTargetId) return;
  var btn = $("dlgUserPwdOk");
  btn.disabled = true;
  API.post("/api/admin/users/" + encodeURIComponent(userPwdTargetId) + "/password", { password: pwd }).then(function(){
    btn.disabled = false;
    UI.closeModal($("dlgUserPwd"));
    toast("密码已重置，请通知该用户", "fs");
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

export { enterSettingsView, loadTrash, loadUsers, openHelp, setSettingsTab, settingsTab };
