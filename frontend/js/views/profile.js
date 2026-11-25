/* views/profile · 个人设置（账号、计时、AI） */

import { API } from "../core/api.js";
import { renderSideUser } from "../core/app.js";
import { isAssistantEnabled, setAssistantEnabled } from "../core/assistant.js";
import { attachCombo } from "../core/combo.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { mountSandSaySettings } from "../core/sand-say.js";
import { mountOrnamentSettings } from "../core/side-ornament.js";
import { loadRunningTimer } from "../core/task-actions.js";
import { loadView } from "../core/view-loader.js";
import { refreshOwnerSelect } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarColor, avatarColorIndex, initial, pad2 } from "../lib/format.js";
import { loadMemberLabelOptions } from "../lib/member-labels.js";
import { loadBoard } from "./board.js";
import { saveWorkspaceHandoff, clearWorkspaceHandoff } from "./mine.js";

var meReadyCbs = [];function afterMeReady(fn){
  if(rt.currentUser){ fn(); return; }
  meReadyCbs.push(fn);
}
function flushMeReady(){
  var list = meReadyCbs;
  meReadyCbs = [];
  for(var i = 0; i < list.length; i++){
    try{ list[i](); }catch(e){ /* 单个视图初始化失败不该拖垮其它 */ }
  }
}
function enterProfileView(){
  if(!rt.currentUser){
    afterMeReady(enterProfileView);
    return;
  }
  if($("mobMeWs")) $("mobMeWs").textContent = rt.currentWs ? (rt.currentWs.name || "") : "";
  var name = rt.currentUser.displayName || rt.currentUser.username || "?";
  if($("meAvatar")){
    $("meAvatar").className = "avatar me-avatar avatar-c" + avatarColorIndex(name);
    $("meAvatar").textContent = initial(name);
  }
  if($("meName")) $("meName").textContent = name;
  if($("meUsername")) $("meUsername").textContent = "@" + (rt.currentUser.username || "");
  if($("meRoleHint")) $("meRoleHint").textContent = (rt.currentUser.role === "admin") ? "平台管理员" : "普通成员";
  if($("meNameInput")){
    $("meNameInput").value = rt.currentUser.displayName || "";
    $("fMeName").classList.remove("invalid");
  }
  if($("meEmail")) $("meEmail").value = rt.currentUser.email || "";
  fillMeOrg();
  fillMeSelects();
  ["meOldPwd","meNewPwd","meAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.value = ""; });
  ["fMeNewPwd","fMeAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.classList.remove("invalid"); });
  wireMeAnchor();
  mountOrnamentSettings();
  mountSandSaySettings();
  updateMePreview();
  /* AI 配置每次进页面都重新拉：可能在别的设备上改过 */
  loadAiConfig();
  loadNotificationPreferences();
  syncAssistantPref();
}
/* 公司与岗位：空间级展示属性。个人空间不展示；查看者只读；非查看者可改自己。 */
var meOrgBaseline = { companyName: "", jobTitle: "" };
var meCompanyCombo = null, meJobTitleCombo = null;
function meOrgEditable(){
  return !!(rt.currentWs && rt.currentWs.type === "shared" && rt.currentWs.myRole !== "viewer");
}
function currentWsMember(){
  var uid = rt.currentUser && rt.currentUser.id;
  if(!uid) return null;
  var list = rt.wsMembersCache || [];
  for(var i = 0; i < list.length; i++){
    if(list[i].userId === uid) return list[i];
  }
  return null;
}
function meOrgDraft(){
  return {
    companyName: $("meCompany") ? $("meCompany").value.trim() : "",
    jobTitle: $("meJobTitle") ? $("meJobTitle").value.trim() : ""
  };
}
function fillMeOrgFields(m){
  var company = (m && m.companyName) || "", job = (m && m.jobTitle) || "";
  meOrgBaseline = { companyName: company, jobTitle: job };
  if($("meCompany")) $("meCompany").value = company;
  if($("meJobTitle")) $("meJobTitle").value = job;
}
function loadMeOrgOptions(){
  var wsId = rt.currentWs && rt.currentWs.id;
  if(!wsId || rt.currentWs.type !== "shared") return;
  loadMemberLabelOptions(wsId).then(function(options){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    var companyList = $("meCompanyOptions"), jobList = $("meJobTitleOptions");
    if(companyList) companyList.innerHTML = (options.companyNames || []).map(function(v){ return '<option value="' + esc(v) + '"></option>'; }).join("");
    if(jobList) jobList.innerHTML = (options.roleTitles || []).map(function(v){ return '<option value="' + esc(v) + '"></option>'; }).join("");
    if(meCompanyCombo) meCompanyCombo.refresh();
    if(meJobTitleCombo) meJobTitleCombo.refresh();
  }).catch(function(){ /* 候选加载失败仍可手动输入 */ });
}
function fillMeOrg(){
  var shared = !!(rt.currentWs && rt.currentWs.type === "shared");
  ["fMeCompany","fMeJobTitle"].forEach(function(id){
    var field = $(id); if(field) field.hidden = !shared;
  });
  var scope = $("meOrgScope");
  if(scope){
    scope.hidden = !shared;
    if(shared){
      scope.textContent = "公司与岗位只对空间「" + (rt.currentWs.name || "") + "」生效；切换空间后显示该空间的值。"
        + (rt.currentWs.myRole === "viewer" ? "你是查看者，只能查看。" : "");
    }
  }
  var editable = meOrgEditable();
  ["meCompany","meJobTitle"].forEach(function(id){
    var el = $(id); if(el) el.disabled = !editable;
  });
  if(!shared){ fillMeOrgFields(null); return; }
  var member = currentWsMember();
  if(member){ fillMeOrgFields(member); loadMeOrgOptions(); return; }
  var wsId = rt.currentWs.id;
  API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/members").then(function(list){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    rt.wsMembersCache = list || [];
    fillMeOrgFields(currentWsMember());
    loadMeOrgOptions();
  }).catch(function(){ fillMeOrgFields(null); });
}
function saveMeOrg(){
  if(!meOrgEditable()) return Promise.resolve(false);
  var draft = meOrgDraft();
  var companyChanged = draft.companyName !== meOrgBaseline.companyName;
  var jobChanged = draft.jobTitle !== meOrgBaseline.jobTitle;
  if(!companyChanged && !jobChanged) return Promise.resolve(false);
  var wsId = rt.currentWs.id, userId = rt.currentUser.id;
  var base = "/api/workspaces/" + encodeURIComponent(wsId) + "/members/" + encodeURIComponent(userId);
  var calls = [];
  if(companyChanged){
    calls.push(API.put(base + "/company", { companyName: draft.companyName }).then(function(){
      meOrgBaseline.companyName = draft.companyName;
      var member = currentWsMember();
      if(member) member.companyName = draft.companyName || null;
    }));
  }
  if(jobChanged){
    calls.push(API.put(base + "/job-title", { jobTitle: draft.jobTitle }).then(function(){
      meOrgBaseline.jobTitle = draft.jobTitle;
      var member = currentWsMember();
      if(member) member.jobTitle = draft.jobTitle || null;
    }));
  }
  return Promise.all(calls).then(function(){
    if(companyChanged){
      window.dispatchEvent(new CustomEvent("ds:member-company-changed", {detail:{workspaceId:wsId, userId:userId, companyName:draft.companyName}}));
    }
    if(jobChanged){
      window.dispatchEvent(new CustomEvent("ds:member-job-title-changed", {detail:{workspaceId:wsId, userId:userId, jobTitle:draft.jobTitle}}));
    }
    return true;
  });
}
if($("meCompany")) meCompanyCombo = attachCombo($("meCompany"), {chevron:true});
if($("meJobTitle")) meJobTitleCombo = attachCombo($("meJobTitle"), {chevron:true});
var NOTIFY_EVENTS = {
  task_assigned: ["工作项指派", "工作项创建或负责人变更后指派给我"],
  task_comment: ["评论与@", "我负责的工作项有新评论，或评论中被 @ 提及"],
  doc_mention: ["文档@提及", "需求文档（含表格）正文中 @ 我时通知，邮件默认开启"],
  task_watch: ["我关注的工作项", "关注的工作项有新评论、列流转、移入回收站或恢复"],
  task_updated: ["工作项变更与提醒", "我负责的工作项字段变更、移列、移入回收站或恢复"],
  demand_status: ["需求与版本动态", "我提交的需求、负责的文档与分支状态变化，或所在版本发布/删除"],
  demand_watch: ["我关注的需求", "关注的需求状态流转、内容编辑、行内优先级/期望交付调整或新评论"],
  test_plan_assigned: ["测试计划指派", "被指派为测试计划的执行人，或执行人变更为我"],
  release_prep: ["发布准备提醒", "向负责的发布计划工作项推送准备确认、临近发布里程碑提醒"],
  release_watch: ["我关注的发布计划", "关注的计划改期、范围或版本变化、进入就绪与发布日提醒"],
  daily_digest: ["每日工作项汇总", "每天 09:00 汇总我负责的逾期/今日到期工作项（仅站内）"]
};
/* 展示分组：同一类打扰放在一起，用户能就近判断要不要全关 */
var NOTIFY_GROUPS = [
  { title: "工作项", types: ["task_assigned", "task_comment", "task_watch", "task_updated"] },
  { title: "需求与版本", types: ["demand_status", "demand_watch", "release_prep", "release_watch", "doc_mention"] },
  { title: "测试", types: ["test_plan_assigned"] },
  { title: "每日汇总", types: ["daily_digest"] }
];
/* 仅重要事件：直接指向我的（指派/评论@/关注）与低频日报保留，广播类关闭，邮件全关 */
var NOTIFY_PRESET = {
  inApp: ["task_assigned", "task_comment", "doc_mention", "task_watch", "demand_watch", "test_plan_assigned", "release_prep", "release_watch", "daily_digest"],
  email: []
};
function applyNotifyPreset(){
  var box = $("meNotificationPrefs");
  if(!box) return;
  box.querySelectorAll("[data-notify-event]").forEach(function(row){
    var type = row.dataset.notifyEvent;
    var inAppEl = row.querySelector("[data-notify-inapp]");
    var emailEl = row.querySelector("[data-notify-email]");
    if(inAppEl) inAppEl.checked = NOTIFY_PRESET.inApp.indexOf(type) >= 0;
    if(emailEl) emailEl.checked = NOTIFY_PRESET.email.indexOf(type) >= 0;
  });
  toast("已应用「仅重要事件」预设，点保存后生效", "fs");
}
if($("meNotificationPreset")) $("meNotificationPreset").addEventListener("click", applyNotifyPreset);
function loadNotificationPreferences(){
  var box = $("meNotificationPrefs");
  if(!box) return;
  box.innerHTML = '<div class="foot-note">加载中…</div>';
  API.get("/api/auth/notification-preferences").then(function(d){
    renderNotificationPreferences((d && d.preferences) || []);
  }).catch(function(ex){
    box.innerHTML = '<div class="foot-note">通知设置加载失败：' + esc(ex.message || "未知错误") + '</div>';
  });
}
function renderNotificationPreferences(items){
  var box = $("meNotificationPrefs");
  if(!box) return;
  var byType = {};
  items.forEach(function(p){ byType[p.eventType] = p; });
  var consumed = {};
  var html = '<div class="notification-pref-head"><span>事件</span><span>站内通知</span><span>邮件通知</span></div>';
  NOTIFY_GROUPS.forEach(function(group){
    var rows = group.types.filter(function(type){ return byType[type]; }).map(function(type){
      consumed[type] = true;
      return notificationPrefRow(byType[type]);
    });
    if(!rows.length) return;
    html += '<div class="notification-pref-group">' + esc(group.title) + '</div>' + rows.join("");
  });
  var rest = items.filter(function(p){ return !consumed[p.eventType]; });
  if(rest.length) html += rest.map(notificationPrefRow).join("");
  box.innerHTML = html;
}
function notificationPrefRow(p){
  var meta = NOTIFY_EVENTS[p.eventType] || [p.eventType, ""];
  /* daily_digest 只有站内一种投递方式，邮件列留空而不是给个假开关 */
  var emailCell = p.eventType === "daily_digest"
    ? '<span class="foot-note">—</span>'
    : '<label><input type="checkbox" data-notify-email ' + (p.email ? "checked" : "") + ' /><span>接收</span></label>';
  return '<div class="notification-pref-row" data-notify-event="' + esc(p.eventType) + '">' +
    '<span><b>' + esc(meta[0]) + '</b><small>' + esc(meta[1]) + '</small></span>' +
    '<label><input type="checkbox" data-notify-inapp ' + (p.inApp ? "checked" : "") + ' /><span>接收</span></label>' +
    emailCell + '</div>';
}
if($("meNotificationSave")) $("meNotificationSave").addEventListener("click", function(){
  var btn = this;
  var preferences = [];
  $("meNotificationPrefs").querySelectorAll("[data-notify-event]").forEach(function(row){
    var emailEl = row.querySelector("[data-notify-email]");
    preferences.push({
      eventType: row.dataset.notifyEvent,
      inApp: row.querySelector("[data-notify-inapp]").checked,
      email: emailEl ? emailEl.checked : false
    });
  });
  if(!preferences.length) return;
  btn.disabled = true;
  API.put("/api/auth/notification-preferences", { preferences: preferences }).then(function(d){
    btn.disabled = false;
    renderNotificationPreferences((d && d.preferences) || preferences);
    toast("通知设置已保存", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
function fillMeSelects(){
  var s = $("meStart"), e = $("meEnd"), m = $("meMax");
  if(!s || !e || !m) return;
  if(!s.options.length){
    var hs = "";
    for(var h = 0; h < 24; h++) hs += '<option value="' + h + '">' + pad2(h) + ':00</option>';
    s.innerHTML = hs;
    var es = "";
    for(var k = 1; k <= 24; k++) es += '<option value="' + k + '">' + (k === 24 ? "24:00" : pad2(k) + ":00") + '</option>';
    e.innerHTML = es;
    var ms = "";
    for(var x = 1; x <= 24; x++) ms += '<option value="' + x + '">' + x + ' 小时</option>';
    m.innerHTML = ms;
  }
  s.value = String(rt.currentUser.workStartHour == null ? 9 : rt.currentUser.workStartHour);
  e.value = String(rt.currentUser.workEndHour == null ? 18 : rt.currentUser.workEndHour);
  m.value = String(rt.currentUser.workMaxHours == null ? 8 : rt.currentUser.workMaxHours);
}
function updateMePreview(){
  var p = $("mePreview");
  if(!p || !$("meStart")) return;
  var sh = Number($("meStart").value), eh = Number($("meEnd").value), mh = Number($("meMax").value);
  var win = eh - sh;
  var text = "每天 " + pad2(sh) + ":00–" + pad2(eh) + ":00 之间才计入，最多 " + mh + " 小时；周末不计。";
  if(win < mh){
    text += "（这个时段只有 " + win + " 小时，实际最多记 " + win + " 小时）";
  }
  p.textContent = text;
}
function wireMeAnchor(){
  var nav = $("meAnchor");
  var view = $("view-profile");
  if(!nav || !view) return;
  if(!nav.__wired){
    nav.__wired = true;
    nav.querySelectorAll("a").forEach(function(a){
      a.addEventListener("click", function(e){
        e.preventDefault();
        var el = document.querySelector(a.getAttribute("href"));
        if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
      });
    });
  }
  function spy(){
    var panels = view.querySelectorAll(".set-panels .panel[id]");
    var cur = panels.length ? panels[0].id : null;
    var best = -1e9;
    panels.forEach(function(p){
      var top = p.getBoundingClientRect().top;
      if(top - 140 <= 0 && top > best){ best = top; cur = p.id; }
    });
    nav.querySelectorAll("a").forEach(function(a){
      a.classList.toggle("on", a.getAttribute("href") === "#" + cur);
    });
  }
  if(!view.__spyWired){
    view.__spyWired = true;
    view.addEventListener("scroll", function(){
      if(view.__spyRaf) return;
      view.__spyRaf = requestAnimationFrame(function(){ view.__spyRaf = 0; spy(); });
    }, {passive:true});
  }
  spy();
}
$("sideUserBtn").addEventListener("click", function(){ showView("profile"); });
$("meNameSave") && $("meNameSave").addEventListener("click", function(){
  var name = $("meNameInput").value.trim();
  var email = $("meEmail") ? $("meEmail").value.trim() : "";
  if(!name){ $("fMeName").classList.add("invalid"); toast("请填写显示名", "warn"); return; }
  var basicChanged = !(rt.currentUser && name === rt.currentUser.displayName && email === (rt.currentUser.email || ""));
  var draft = meOrgDraft();
  var orgChanged = meOrgEditable() && (draft.companyName !== meOrgBaseline.companyName || draft.jobTitle !== meOrgBaseline.jobTitle);
  if(!basicChanged && !orgChanged){ toast("基本信息没有变化"); return; }
  var btn = $("meNameSave");
  btn.disabled = true;
  var basicSaved = false;
  var step = Promise.resolve();
  if(basicChanged){
    step = step.then(function(){
      return API.put("/api/auth/profile", { displayName: name, email: email }).then(function(res){
        rt.currentUser.displayName = (res && res.displayName) || name;
        rt.currentUser.email = res ? res.email : email;
        rt.OWNER_DEFAULT = rt.currentUser.displayName;
        renderSideUser(rt.currentUser);
        refreshOwnerSelect();
        basicSaved = true;
      });
    });
  }
  step.then(saveMeOrg).then(function(){
    btn.disabled = false;
    enterProfileView();
    toast("基本信息已保存", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){
    btn.disabled = false;
    if(basicSaved){
      enterProfileView();
      loadBoard({silent:true});
      toast("显示名/邮箱已保存；公司或岗位保存失败：" + (ex.message || "未知错误"), "bad");
    } else {
      toast(ex.message || "保存失败", "bad");
    }
  });
});
["meStart","meEnd","meMax"].forEach(function(id){
  var el = $(id);
  if(el) el.addEventListener("change", updateMePreview);
});
$("meTimerSave") && $("meTimerSave").addEventListener("click", function(){
  if(!rt.currentUser) return;
  var sh = Number($("meStart").value), eh = Number($("meEnd").value), mh = Number($("meMax").value);
  if(eh <= sh){ toast("下班时间要晚于上班时间", "warn"); return; }
  var btn = $("meTimerSave");
  btn.disabled = true;
  API.put("/api/auth/work-hours", { startHour: sh, endHour: eh, maxHours: mh }).then(function(res){
    btn.disabled = false;
    rt.currentUser.workStartHour = res && res.workStartHour != null ? res.workStartHour : sh;
    rt.currentUser.workEndHour = res && res.workEndHour != null ? res.workEndHour : eh;
    rt.currentUser.workMaxHours = res && res.workMaxHours != null ? res.workMaxHours : mh;
    updateMePreview();
    toast("已保存：" + pad2(sh) + ":00–" + pad2(eh) + ":00，每天最多 " + mh + " 小时（只影响之后的计时）", "fs");
    /* 运行中的计时按新口径重算 */
    loadRunningTimer();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
var aiCfg = null;
function findAiPreset(id){
  var list = (aiCfg && aiCfg.presets) || [];
  for(var i = 0; i < list.length; i++){ if(list[i].id === id) return list[i]; }
  return null;
}
function loadAiConfig(){
  if(!$("meAiProvider")) return;
  API.get("/api/ai/config").then(function(d){
    aiCfg = d;
    renderAiConfig(d);
  }).catch(function(ex){
    if($("meAiResult")){
      $("meAiResult").hidden = false;
      $("meAiResult").textContent = "AI 配置加载失败：" + (ex.message || "未知错误");
    }
  });
}
function renderAiConfig(d){
  var sel = $("meAiProvider");
  if(!sel.options.length){
    sel.innerHTML = ((d.presets || []).map(function(p){
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    })).join("");
  }
  sel.value = d.provider || "deepseek";
  $("meAiModel").value = d.model || "";
  $("meAiBase").value = d.baseUrl || "";
  $("meAiEnabled").checked = !!d.enabled;
  $("meAiKey").value = "";
  $("meAiKey").placeholder = d.hasKey
    ? "已保存 " + (d.apiKeyMasked || "****") + "（留空表示不修改）"
    : "粘贴你的 API Key";
  if($("meAiKeyState")){
    $("meAiKeyState").textContent = d.keyBroken
      ? "已保存的 Key 无法解密（部署密钥变更过），请重新填一次"
      : (d.hasKey ? "已保存 " + (d.apiKeyMasked || "") + "，留空则保持不变" : "还没有配置 Key");
  }

  var allowPersonal = d.allowPersonal !== false;
  var team = d.team || {};
  var teamReady = !!team.available;
  var teamRadio = $("meAiSourceTeam"), personalRadio = $("meAiSourcePersonal");
  if(teamRadio){
    teamRadio.disabled = !teamReady;
    $("meAiTeamCard").className = "ai-source-card" + (teamReady ? "" : " disabled");
    if($("meAiTeamSub")){
      $("meAiTeamSub").textContent = teamReady
        ? (team.provider || "") + " · " + (team.model || "") + "；" + (team.status || "费用由团队承担")
        : (team.status || "平台尚未开通团队 AI");
    }
  }
  if(personalRadio){
    personalRadio.disabled = !allowPersonal;
    $("meAiPersonalCard").className = "ai-source-card" + (allowPersonal ? "" : " disabled");
    if($("meAiPersonalSub")){
      $("meAiPersonalSub").textContent = !allowPersonal
        ? "平台管理员已关闭个人 API Key：已保存的 Key 会保留，但不再使用"
        : d.keyBroken
        ? "已保存的 Key 无法解密，请重新填写"
        : d.hasKey
        ? "已保存 " + (d.apiKeyMasked || "****") + "，费用从你自己的额度扣除"
        : "还没有填写 Key，选择后请在下方补全";
    }
  }

  /* 单选框记的是"偏好"而不是解析结果：auto 时团队优先，团队不可用才回落到个人 */
  var pickPersonal = allowPersonal && (d.prefer === "personal" || !teamReady);
  if(!allowPersonal) pickPersonal = false;
  if(personalRadio) personalRadio.checked = pickPersonal;
  if(teamRadio) teamRadio.checked = !pickPersonal;

  var source = d.source || "none";
  if($("meAiTeamTag")){
    $("meAiTeamTag").hidden = source !== "team" && source !== "workspace";
    $("meAiTeamTag").textContent = source === "workspace" ? "当前 · 本空间" : "当前来源";
  }
  if($("meAiPersonalTag")) $("meAiPersonalTag").hidden = source !== "personal";
  if($("meAiSourceNote")){
    $("meAiSourceNote").textContent = source === "none"
      ? "当前没有可用的 AI 来源"
      : "当前实际使用：" + (d.sourceName || source) + "；切换来源后点保存生效";
  }
  if($("meAiState")){
    $("meAiState").textContent = d.status || "";
    $("meAiState").className = "meta-right" + (source !== "none" && d.enabled ? "" : " muted");
  }
  syncAiSourceUi();
  var p = findAiPreset(sel.value);
  if(p && $("meAiKeyHint")) $("meAiKeyHint").textContent = p.keyHint || "";
}
function personalSourceSelected(){
  var el = $("meAiSourcePersonal");
  return !!(el && el.checked);
}
function syncAiSourceUi(){
  var personal = personalSourceSelected();
  var teamEl = $("meAiSourceTeam");
  var teamOn = !personal && !!teamEl && !teamEl.disabled;
  if($("meAiTeamCard")) $("meAiTeamCard").classList.toggle("on", teamOn);
  if($("meAiPersonalCard")) $("meAiPersonalCard").classList.toggle("on", personal);
  if($("meAiPersonalForm")) $("meAiPersonalForm").hidden = !personal;
}
function aiFormBody(clearKey){
  var key = $("meAiKey") ? $("meAiKey").value.trim() : "";
  return {
    provider: $("meAiProvider").value,
    baseUrl: $("meAiBase").value.trim(),
    model: $("meAiModel").value.trim(),
    apiKey: key,
    clearKey: !!clearKey,
    enabled: $("meAiEnabled").checked,
    prefer: personalSourceSelected() ? "personal" : "auto"
  };
}
function saveAiConfig(clearKey){
  return API.put("/api/ai/config", aiFormBody(clearKey)).then(function(d){
    aiCfg = d;
    renderAiConfig(d);
    return d;
  });
}
["meAiSourceTeam", "meAiSourcePersonal"].forEach(function(id){
  var el = $(id);
  if(el) el.addEventListener("change", syncAiSourceUi);
});
if($("meAiProvider")){
  $("meAiProvider").addEventListener("change", function(){
    var p = findAiPreset(this.value);
    if(!p) return;
    /* 自定义厂商没有默认值，保留用户已经填的地址和模型 */
    if(this.value !== "custom"){
      if(p.baseUrl) $("meAiBase").value = p.baseUrl;
      if(p.model) $("meAiModel").value = p.model;
    }
    if($("meAiKeyHint")) $("meAiKeyHint").textContent = p.keyHint || "";
  });
}
/* AI 助手显示开关：本地偏好，切换即时显隐右下角悬浮入口，无需点保存 */
function syncAssistantPref(){
  var box = $("meAiAssistant");
  if(box) box.checked = isAssistantEnabled();
  var ic = $("meAiAssistantIc");
  if(ic && !ic.innerHTML) ic.innerHTML = icon("ai", 18);
}
if($("meAiAssistant")){
  syncAssistantPref();
  $("meAiAssistant").addEventListener("change", function(){
    var on = this.checked;
    setAssistantEnabled(on);
    toast(on ? "已显示 AI 助手" : "已隐藏 AI 助手", "fs");
  });
}
if($("meAiSave")){
  $("meAiSave").addEventListener("click", function(){
    var btn = this;
    btn.disabled = true;
    saveAiConfig(false).then(function(d){
      btn.disabled = false;
      toast("AI 设置已保存", "fs");
      if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = d.status || ""; }
    }).catch(function(ex){
      btn.disabled = false;
      toast(ex.message || "保存失败", "bad");
    });
  });
}
if($("meAiTest")){
  /* 先存再测：测的一定是"表单里这个样子"，而不是上次存的旧配置 */
  $("meAiTest").addEventListener("click", function(){
    var btn = this;
    btn.disabled = true;
    var t0 = Date.now();
    if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = "正在保存并测试连接…"; }
    saveAiConfig(false).then(function(){
      return API.post("/api/ai/config/test", {});
    }).then(function(r){
      btn.disabled = false;
      var sec = ((Date.now() - t0) / 1000).toFixed(1);
      if($("meAiResult")){
        var via = r.sourceLabel ? "（" + r.sourceLabel + "）" : "";
        $("meAiResult").textContent = "连通正常" + via + "：模型 " + (r.model || "—")
          + "，往返 " + sec + " 秒，返回「" + String(r.reply || "").slice(0, 20) + "」，本次 " + (r.tokens || 0) + " tokens";
      }
      toast("AI 连接正常", "fs");
    }).catch(function(ex){
      btn.disabled = false;
      if($("meAiResult")){
        $("meAiResult").textContent = "连接失败：" + (ex.message || "未知错误");
      }
      toast(ex.message || "连接失败", "bad");
    });
  });
}
if($("meAiClear")){
  $("meAiClear").addEventListener("click", function(){
    if(!window.confirm("清除已保存的 API Key？清除后 AI 功能不可用，直到重新填写。")) return;
    saveAiConfig(true).then(function(){
      toast("已清除 API Key", "fs");
      if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = "已清除，可以填入新的 Key"; }
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}
$("mePwdSave") && $("mePwdSave").addEventListener("click", function(){
  var oldPwd = $("meOldPwd").value;
  var newPwd = $("meNewPwd").value;
  var again = $("meAgainPwd").value;
  var fNew = $("fMeNewPwd"), fAgain = $("fMeAgainPwd");
  var bad = false;
  if(!oldPwd){ toast("请填写当前密码", "warn"); return; }
  if(newPwd.length < 6){ fNew.classList.add("invalid"); bad = true; } else fNew.classList.remove("invalid");
  if(newPwd !== again){ fAgain.classList.add("invalid"); bad = true; } else fAgain.classList.remove("invalid");
  if(bad) return;
  var btn = $("mePwdSave");
  btn.disabled = true;
  API.post("/api/auth/password", { oldPassword: oldPwd, newPassword: newPwd }).then(function(){
    btn.disabled = false;
    ["meOldPwd","meNewPwd","meAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.value = ""; });
    toast("密码已修改，其他设备上的登录已失效，当前设备保持登录", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "修改失败", "bad");
  });
});
$("btnLogout").addEventListener("click", function(){
  UI.showConfirm({ title:"退出登录", msg:"确定退出当前账号？", okText:"退出", danger:false }).then(function(ok){
    if(!ok) return;
    API.post("/api/auth/logout", {}).then(function(){
      window.location.href = API.loginUrl;
    }).catch(function(){ window.location.href = API.loginUrl; });
  });
});

/* 手机端「我的」页承接桌面侧栏的入口：切换空间 / 设置 / 主题 / 帮助 / 退出 */
function openSpacePicker(anchor){
  var el = document.createElement("div");
  el.className = "menu ws-menu-pop";
  el.innerHTML = (rt.allWorkspaces || []).map(function(ws){
    var on = rt.currentWs && ws.id === rt.currentWs.id;
    return '<button class="menu-item" type="button" data-mob-ws="' + esc(ws.id) + '">' +
      (on ? '<span class="ws-check">✓</span>' : '') + esc(ws.name || ws.id) + '</button>';
  }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-mob-ws]");
    if(!b) return;
    UI.closeAllPops();
    if(rt.currentWs && b.dataset.mobWs === rt.currentWs.id) return;
    var target = null;
    (rt.allWorkspaces || []).forEach(function(ws){ if(ws.id === b.dataset.mobWs) target = ws; });
    UI.showConfirm({
      title: "切换空间",
      msg: "切换到「" + esc(target ? (target.name || target.id) : b.dataset.mobWs) +
        "」会重新加载页面。空间专属的项目、分类、负责人条件会清空，「我的工作」的当前页签会保留；未保存的改动不会保留。",
      okText: "切换",
      cancelText: "取消"
    }).then(function(ok){
      if(!ok) return;
      saveWorkspaceHandoff(b.dataset.mobWs);
      API.post("/api/workspaces/" + encodeURIComponent(b.dataset.mobWs) + "/select", {}).then(function(){
        window.location.reload();
      }).catch(function(ex){
        clearWorkspaceHandoff();
        toast(ex.message || "切换空间失败", "bad");
      });
    });
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
var meMobile = $("meMobile");
if(meMobile){
  meMobile.addEventListener("click", function(e){
    var b = e.target.closest("[data-mob-me]");
    if(!b) return;
    var act = b.dataset.mobMe;
    if(act === "space"){ openSpacePicker(b); return; }
    if(act === "settings"){ showView("settings"); return; }
    if(act === "theme"){ var t = $("btnTheme"); if(t) t.click(); return; }
    if(act === "help"){
      /* 快捷键帮助由懒加载的 settings 模块提供，不能依赖尚未绑定的隐藏按钮 */
      loadView("settings").then(function(m){ m.openHelp(); });
      return;
    }
    if(act === "manual"){ window.open("help.html", "_blank", "noopener"); return; }
    if(act === "logout"){ var l = $("btnLogout"); if(l) l.click(); }
  });
}

export { enterProfileView, flushMeReady };
