/* views/mine · 我的任务（分页 + 分组 + 行内操作） */

import { API } from "../core/api.js";
import { btnMineRefresh, mineBody, mineMeta, mineSpaceFilter } from "../core/dom.js";
import { clearFilters } from "../core/filters-ui.js";
import { filterParams } from "../core/filters.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { currentMode, saveMode } from "../core/mobile-rules.js";
import { loadPrioritySpaces } from "../core/priorities.js";
import { taskPayloadWith } from "../core/shortcuts.js";
import { canEditTask, catTag, dueState, dueText, progressOf, rt, state, tagChip } from "../core/state.js";
import { loadRunningTimer, openTaskById } from "../core/task-actions.js";
import { UI, esc, toast } from "../core/ui.js";
import { bindRetry } from "../core/utils.js";
import { CAT_DEFAULT_COLOR, addDays, colMeta, colName, duePresetDate, fmtFull, iso, parseDate, priTagHTML } from "../lib/format.js";
import { loadBoard } from "./board.js";
import { refreshCalendarIfOpen } from "./calendar.js";

function wsNameById(id){
  for(var i = 0; i < rt.allWorkspaces.length; i++) if(rt.allWorkspaces[i].id === id) return rt.allWorkspaces[i].name;
  return "该空间";
}
function askSwitchWorkspace(wsId, wsName, opts){
  opts = opts || {};
  var target = wsName || wsNameById(wsId);
  var msg = opts.taskTitle
    ? ('即将切换到「' + esc(target) + '」并打开任务「' + esc(opts.taskTitle) + '」。<br><br>' +
       '当前空间的筛选条件、抽屉里未保存的编辑都不会保留。')
    : ('切换到「' + esc(target) + '」会重新加载页面。<br><br>' +
       '当前空间的筛选条件、抽屉里未保存的编辑都不会保留。');
  return UI.showConfirm({
    title: opts.title || "切换空间",
    msg: msg,
    okText: "切换",
    cancelText: "取消",
    danger: false
  }).then(function(ok){
    if(!ok) return false;
    return API.post("/api/workspaces/" + encodeURIComponent(wsId) + "/select", {}).then(function(){
      if(opts.openTaskId){
        try{ sessionStorage.setItem("ds.openTask", opts.openTaskId); }catch(e){ /* noop */ }
      }
      window.location.reload();
      return true;
    }).catch(function(ex){
      toast(ex.message || "切换空间失败", "bad");
      return false;
    });
  });
}
function enterMineView(){
  syncMineFilters();
  if(isMobile() && currentMineMode() === "team"){ renderTeam(); return; }
  loadMine();
}
function mineFiltered(items){
  return (items || []).filter(function(t){
    if(state.mineSpace && t.workspaceId !== state.mineSpace) return false;
    return true;
  });
}
function mineFiltering(){ return !!state.mineSpace; }
function syncMineFilters(){
  /* 统一筛选由顶栏 FilterBar 显示；页内只保留空间下拉 */
}
function populateMineSpaces(spaces){
  if(!mineSpaceFilter) return;
  var cur = state.mineSpace || "";
  var html = '<option value="">全部空间</option>' + (spaces || []).map(function(s){
    return '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
  }).join("");
  if(mineSpaceFilter.innerHTML !== html) mineSpaceFilter.innerHTML = html;
  mineSpaceFilter.value = cur;
  if(mineSpaceFilter.value !== cur){
    state.mineSpace = "";
    mineSpaceFilter.value = "";
  }
}
var mineCache = {};
var mineAll = [], mineSpaces = [], mineNameOnly = 0, mineTotal = 0, mineHasMore = false;
var MINE_PAGE_SIZE = 200;
var mineLoading = false, mineSeq = 0;
function rerenderMine(){
  renderMine({items: mineAll, spaces: mineSpaces, matchedByNameOnly: mineNameOnly,
    total: mineTotal, hasMore: mineHasMore}, false);
}
function loadMine(opts){
  opts = opts || {};
  if(!mineBody) return;
  /* 团队模式下搜索/筛选仍可能走到这里：不要用 my-tasks 骨架覆盖团队面板 */
  if(isMobile() && currentMineMode() === "team"){ renderTeam({silent:true}); return; }
  if(mineLoading) return;
  var append = !!opts.append;
  mineLoading = true;
  var seq = ++mineSeq;
  var offset = append ? mineAll.length : 0;
  var btn = mineBody.querySelector("[data-mine-more]");
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  if(!opts.silent && !append){
    mineBody.innerHTML = UI.skeletonRows(6);
    if(mineMeta) mineMeta.textContent = "加载中…";
  }
  var params = filterParams({scope: "open", offset: offset, limit: MINE_PAGE_SIZE});
  delete params.owners;      // 负责人维度天然是我
  API.getGlobal("/api/my-tasks", params).then(function(d){
    if(seq !== mineSeq) return;
    return loadPrioritySpaces(d && d.spaces).then(function(){
      if(seq !== mineSeq) return;
      mineLoading = false;
      renderMine(d || {}, append);
    });
  }).catch(function(ex){
    if(seq !== mineSeq) return;
    mineLoading = false;
    if(append){
      toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
      if(btn){ btn.disabled = false; btn.textContent = "加载更多"; }
      return;
    }
    if(mineMeta) mineMeta.textContent = "";
    mineBody.innerHTML = UI.errorState(ex.message);
    bindRetry(mineBody, function(){ loadMine(); });
  });
}
function mineGroupOf(t){
  var st = dueState(t);
  if(st.kind === "over") return "over";
  if(st.kind === "today") return "today";
  if(st.kind === "none") return "later";
  var dow = (rt.TODAY.getDay() + 6) % 7;             // 周一=0
  var weekEnd = addDays(rt.TODAY, 6 - dow);
  return parseDate(t.dueDate) <= weekEnd ? "week" : "later";
}
var MINE_GROUPS = [
  {k:"over", label:"逾期", hint:"先处理已经拖过期的"},
  {k:"today", label:"今天", hint:"今天到期"},
  {k:"week", label:"本周", hint:"本周内到期"},
  {k:"later", label:"以后", hint:"本周之后或未设截止"}
];
function mineRowHTML(t){
  var st = dueState(t);
  var p = progressOf(t);
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 跨空间任务的可写性由后端下发；只读项目只保留「停止计时」这一条合法入口 */
  var editable = canEditTask(t);
  return '<div class="list-row" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row" style="grid-template-columns:minmax(0,1fr) 140px 96px 92px 84px 128px 108px">' +
    '<span class="lr-task"><span class="lr-t">' + esc(t.title) + '</span>' +
      '<span class="lr-tags">' + catTag(t.category) +
        ((t.tags || []).slice(0, 2).map(tagChip).join("")) +
        (t.blocked ? '<span class="blocked-tag">' + icon("alert", 12) + '被阻塞</span>' : '') + '</span></span>' +
    '<span class="cell">' + esc(t.workspaceName || "—") + '</span>' +
    '<span class="cell">' + esc(colName(t.boardColumn)) + '</span>' +
    '<span>' + priTagHTML(t.priority, t.workspaceId) + '</span>' +
    '<span class="cell ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' +
      esc(dueText(t)) + '</span>' +
    '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span>' +
      '<span class="pv">' + p + '%</span></span></span>' +
    '<span class="mine-acts">' +
      (editable ? '<button class="icon-btn sm" type="button" data-mine-done title="标记完成" aria-label="标记完成">' + icon("check", 14) + '</button>' : '') +
      ((editable || running) ? '<button class="icon-btn sm' + (running ? " on" : "") + '" type="button" data-mine-timer title="' +
        (running ? "停止计时" : "开始计时") + '" aria-label="开始或停止计时">' + icon("clock", 14) + '</button>' : '') +
      (editable ? '<button class="icon-btn sm" type="button" data-mine-due title="改期" aria-label="改期">' + icon("calendar", 14) + '</button>' : '') +
    '</span>' +
  '</div>';
}
var mineModeEl = document.getElementById("mineMode");
var teamSeq = 0;
var teamLoading = false;
var teamQueued = false;

function currentMineMode(){
  var ws = rt.currentWs;
  return currentMode(ws ? ws.id : "", ws && ws.myRole);
}
function syncMineModeUI(){
  if(!mineModeEl) return;
  var mode = currentMineMode();
  mineModeEl.querySelectorAll("[data-mine-mode]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.dataset.mineMode === mode));
  });
  document.body.classList.toggle("mine-team", isMobile() && mode === "team");
}
function setMineMode(mode){
  var ws = rt.currentWs;
  saveMode(ws ? ws.id : "", mode);
  syncMineModeUI();
  if(mode === "team"){ renderTeam(); return; }
  if(!mineAll.length) loadMine(); else rerenderMine();
}
function hm(minutes){
  var h = (Number(minutes) || 0) / 60;
  return (Math.round(h * 10) / 10) + "h";
}
function teamWeekRange(){
  var dow = (rt.TODAY.getDay() + 6) % 7;
  var from = addDays(rt.TODAY, -dow);
  var to = addDays(from, 6);
  return {from: iso(from), to: iso(to)};
}
function teamSectionError(err, title){
  if(err && err.code === 4030){
    return UI.noPermState({ title: title || "当前角色无权查看", desc: "该区块仅对空间管理员开放，请联系空间主调整成员角色。" });
  }
  return UI.errorState(err && err.message ? err.message : "网络异常，请稍后重试");
}
function renderTeam(opts){
  opts = opts || {};
  syncMineModeUI();
  if(mineMeta) mineMeta.textContent = "团队视图 · 本周";
  if(!mineBody) return;
  /* 刷新途中收到新的进入/刷新请求：只保留尾随一次，避免旧响应覆盖新模式 */
  if(teamLoading){ teamQueued = true; return; }
  if(!opts.silent) mineBody.innerHTML = UI.skeletonRows(6);
  teamLoading = true;
  var seq = ++teamSeq;
  var range = teamWeekRange();
  Promise.all([
    API.get("/api/mobile/team-overview", range),
    API.get("/api/mobile/workload").catch(function(err){ return {__err: err}; }),
    API.get("/api/mobile/risks").catch(function(err){ return {__err: err}; })
  ]).then(function(res){
    teamLoading = false;
    if(teamQueued){
      teamQueued = false;
      if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
      return;
    }
    if(seq !== teamSeq || !isMobile() || currentMineMode() !== "team") return;
    var overview = res[0] || {};
    var workload = res[1] || {};
    var risks = res[2] || {};
    var h = overview.health || {};
    var pending = overview.pending || {};
    var riskList = (overview.risks || []).slice();
    if(!riskList.length && !risks.__err){
      riskList = (risks.overdue || []).concat(risks.blocked || []).slice(0, 5);
    }

    var rate = Math.round((Number(h.doneRate) || 0) * 100);
    var delta = Math.round((Number(h.deltaWeek) || 0) * 100);
    var html = '<div class="team-panel">' +
      '<section class="team-hero">' +
        '<div class="th-main"><b>' + rate + '%</b><span>本周完成率</span>' +
          '<em class="' + (delta >= 0 ? "up" : "down") + '">' +
            (delta >= 0 ? "↑ +" + delta : "↓ " + Math.abs(delta)) + '%</em></div>' +
        '<div class="th-grid">' +
          '<div><b>' + (h.doneCount || 0) + '/' + (h.planCount || 0) + '</b><span>完成 / 计划</span></div>' +
          '<div class="danger"><b>' + (h.overdue || 0) + '</b><span>已逾期</span></div>' +
          '<div class="warn"><b>' + (h.blocked || 0) + '</b><span>被阻塞</span></div>' +
        '</div>' +
      '</section>' +
      '<section class="team-card"><div class="tc-head"><h3>待处理</h3><span class="foot-note">' + esc(range.from) + ' ~ ' + esc(range.to) + '</span></div>' +
        '<div class="team-pending">' +
          '<button type="button" data-team-go="demands"><b>' + (pending.review || 0) + '</b><span>待评审</span></button>' +
          '<button type="button" data-team-go="branches"><b>' + (pending.accept || 0) + '</b><span>待验收</span></button>' +
          '<button type="button" data-team-go="branches"><b>' + (pending.merge || 0) + '</b><span>待合并</span></button>' +
        '</div></section>';

    html += '<section class="team-card"><div class="tc-head"><h3>风险任务</h3><span class="foot-note">' + riskList.length + ' 项</span></div>' +
      (riskList.length ? '<div class="team-risks">' + riskList.map(function(r){
        var lv = r.level === "high" ? "high" : "mid";
        return '<div class="team-risk ' + lv + '" data-team-task="' + esc(r.taskId) + '" role="button" tabindex="0">' +
          '<i class="tr-dot"></i>' +
          '<div class="tr-main"><b>' + esc(r.title || "未命名任务") + '</b>' +
            '<span>' + esc(r.ownerName || "未指派") + ' · ' + esc(r.reason || "") + '</span></div>' +
          (r.dayCount ? '<span class="tr-days">' + r.dayCount + ' 天</span>' : '') +
        '</div>';
      }).join("") + '</div>' : UI.emptyState({icon:"checkCircle", title:"本周没有风险任务", compact:true})) +
      '</section>';

    if(workload.__err){
      html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3></div>' + teamSectionError(workload.__err, "成员负载不可见") + '</section>';
    } else {
      var members = workload.members || [];
      html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3><span class="foot-note">本周计时 / 周容量</span></div>' +
        (members.length ? '<div class="team-load">' + members.map(function(m){
          var pct = Math.round((Number(m.percent) || 0) * 100);
          var cls = pct > 100 ? "over" : (pct >= 90 ? "near" : "");
          return '<div class="tl-row">' +
            '<div class="tl-top"><b>' + esc(m.name || "—") + '</b><span>' + hm(m.actualMinutes) + ' / ' + hm(m.plannedMinutes) + '</span></div>' +
            '<div class="tl-bar"><i class="' + cls + '" style="width:' + Math.min(pct, 100) + '%"></i></div>' +
            '<span class="tl-pct ' + cls + '">' + pct + '%</span>' +
          '</div>';
        }).join("") + '</div>' : UI.emptyState({icon:"inbox", title:"本周还没有成员计时", compact:true})) +
        '</section>';
    }
    html += '</div>';
    mineBody.innerHTML = html;
    var retry = mineBody.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", function(){ renderTeam(); });
    mineBody.querySelectorAll("[data-team-task]").forEach(function(el){
      el.addEventListener("click", function(){ openTaskById(el.dataset.teamTask); });
      el.addEventListener("keydown", function(ev){
        if(ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); el.click(); }
      });
    });
    mineBody.querySelectorAll("[data-team-go]").forEach(function(el){
      el.addEventListener("click", function(){
        /* 走侧栏既有的 data-view 入口，避免 mine → router 的循环依赖 */
        var nav = document.querySelector('#sideNav [data-view="' + el.dataset.teamGo + '"]');
        if(nav) nav.click();
      });
    });
  }).catch(function(err){
    teamLoading = false;
    if(teamQueued){
      teamQueued = false;
      if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
      return;
    }
    if(seq !== teamSeq || !isMobile() || currentMineMode() !== "team") return;
    if(mineMeta) mineMeta.textContent = "";
    mineBody.innerHTML = (err && err.code === 4030)
      ? UI.noPermState({title:"当前角色无权查看团队数据", desc:"团队视图仅对空间主、管理员开放。"})
      : UI.errorState(err && err.message ? err.message : "网络异常，请稍后重试");
    var retry = mineBody.querySelector("[data-empty-action]");
    if(retry) retry.addEventListener("click", function(){ renderTeam(); });
  });
}

function mobileMineCardHTML(t){
  var st = dueState(t);
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var col = colMeta(t.boardColumn) || {};
  var colColor = col.color || CAT_DEFAULT_COLOR;
  var pri = t.priority || "P2";
  return '<article class="mob-task-card" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
      ' tabindex="0" role="row">' +
    '<div class="mtc-top">' +
      priTagHTML(pri, t.workspaceId) +
      '<span class="mtc-chip" style="--c:' + esc(colColor) + '"><i></i>' + esc(colName(t.boardColumn)) + '</span>' +
      (t.blocked ? '<span class="blocked-tag">' + icon("alert", 12) + '被阻塞</span>' : '') +
      '<span class="sp"></span>' +
      '<button class="mtc-ico' + (running ? " on" : "") + '" type="button" data-mine-timer title="' +
        (running ? "停止计时" : "开始计时") + '" aria-label="开始或停止计时">' + icon("clock", 15) + '</button>' +
    '</div>' +
    '<h3 class="mtc-title">' + esc(t.title) + '</h3>' +
    '<div class="mtc-meta">' +
      '<span class="mtc-path">' + esc(t.workspaceName || "—") + ' · ' + esc(colName(t.boardColumn)) + '</span>' +
      '<span class="mtc-due ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' +
        esc(dueText(t)) + '</span>' +
    '</div>' +
    '<div class="mtc-swipe">' +
      '<button class="mtc-act done" type="button" data-mine-done>完成</button>' +
      '<button class="mtc-act" type="button" data-mine-due>改期</button>' +
    '</div>' +
  '</article>';
}
function renderMobileMine(groups){
  var html = '<div class="mob-groups">';
  MINE_GROUPS.forEach(function(g){
    var rows = groups[g.k];
    if(!rows.length) return;
    html += '<section class="mob-group" data-mine-group="' + g.k + '">' +
      '<div class="mob-group-head"><h3 class="' + (g.k === "over" ? "over" : "") + '">' + g.label + '</h3>' +
        '<span class="mob-group-n">' + rows.length + '</span></div>' +
      '<div class="mob-card-list">' + rows.map(mobileMineCardHTML).join("") + '</div>' +
    '</section>';
  });
  html += '</div>' + mineMoreHTML();
  mineBody.innerHTML = html;
}
function renderMine(d, append){
  if(isMobile() && currentMineMode() === "team"){ syncMineModeUI(); return; }
  var incoming = d.items || [];
  var spaces = d.spaces || [];
  mineSpaces = spaces;
  mineNameOnly = Number(d.matchedByNameOnly) || 0;
  mineTotal = typeof d.total === "number" ? d.total : (append ? mineAll.length : incoming.length);
  mineHasMore = !!d.hasMore;
  if(append){
    var seen = {};
    mineAll.forEach(function(t){ seen[t.workspaceId + "|" + t.id] = true; });
    incoming.forEach(function(t){
      var key = t.workspaceId + "|" + t.id;
      if(!seen[key]){ seen[key] = true; mineAll.push(t); }
    });
  }else{
    mineAll = incoming;
  }
  populateMineSpaces(spaces);
  mineCache = {};
  mineAll.forEach(function(t){ mineCache[t.workspaceId + "|" + t.id] = t; });
  var items = mineFiltered(mineAll);
  var filtering = mineFiltering();
  if(mineMeta){
    var nameOnly = mineNameOnly;
    var loaded = mineAll.length;
    var countTxt = filtering
      ? ("筛选出 " + items.length + " / " + loaded + " 项（已加载）")
      : ("已加载 " + loaded + (mineTotal > loaded ? (" / " + mineTotal) : "") + " 项");
    mineMeta.textContent = countTxt + " · 覆盖 " + spaces.length + " 个空间" +
      (mineHasMore ? " · 还有更多，可继续加载" : "") +
      (nameOnly > 0 ? ("　·　其中 " + nameOnly + " 项仅按显示名匹配（未绑定账号）") : "");
  }
  if(!mineAll.length){
    mineBody.innerHTML = UI.emptyState({
      icon:"checkCircle", title:"没有分派给你的任务",
      text:"被指派到你账号的任务会汇总在这里（跨你参与的全部空间）。若老数据只填了显示名、没有绑定账号，请先在任务里重新指定负责人。",
      actionLabel:"刷新"
    });
    var emptyRefresh = mineBody.querySelector("[data-empty-action]");
    if(emptyRefresh) emptyRefresh.addEventListener("click", function(){ loadMine(); });
    return;
  }
  if(!items.length){
    mineBody.innerHTML = UI.emptyState({
      icon:"filterOff", title:"当前筛选下没有任务", compact:true,
      text:"试着放宽顶栏筛选条件，或切换空间。",
      actionLabel:"清除筛选"
    }) + mineMoreHTML();
    var btn = mineBody.querySelector(".empty-state .btn");
    if(btn) btn.addEventListener("click", function(){
      state.mineSpace = "";
      clearFilters();
      rerenderMine();
    });
    return;
  }
  var groups = {};
  MINE_GROUPS.forEach(function(g){ groups[g.k] = []; });
  items.forEach(function(t){ groups[mineGroupOf(t)].push(t); });
  if(isMobile()){ renderMobileMine(groups); return; }
  var html = '<div class="mine-groups">';
  MINE_GROUPS.forEach(function(g){
    var rows = groups[g.k];
    if(!rows.length) return;
    html += '<section class="mine-group" data-mine-group="' + g.k + '">' +
      '<div class="mine-group-head"><h3>' + g.label + '</h3>' +
        '<span class="mine-group-n">' + rows.length + '</span>' +
        '<span class="foot-note">' + g.hint + '</span></div>' +
      '<div class="list-scroll"><div class="list-body">' + rows.map(mineRowHTML).join("") + '</div></div>' +
    '</section>';
  });
  html += '</div>' + mineMoreHTML();
  mineBody.innerHTML = html;
}
function mineMoreHTML(){
  if(mineHasMore){
    return '<div class="mine-more"><button class="btn sm" type="button" data-mine-more>加载更多（已显示 ' +
      mineAll.length + ' / ' + mineTotal + '）</button></div>';
  }
  if(mineTotal > MINE_PAGE_SIZE){
    return '<div class="mine-more"><span class="foot-note">已显示全部 ' + mineTotal + ' 项</span></div>';
  }
  return "";
}
function mineTaskFromRow(row){
  return mineCache[(row.dataset.mineWs || "") + "|" + row.dataset.mineId] || null;
}
function mineComplete(t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/move", {column:"done"}).then(function(){
    toast("已完成「" + t.title + "」", "fs");
    loadMine({silent:true});
    loadBoard({silent:true});
    loadRunningTimer();
  }).catch(function(ex){ toast(ex.message || "完成失败", "bad"); });
}
function mineToggleTimer(t){
  if(!t) return;
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  /* 停止自己的计时不受项目可见范围限制（与后端一致），只拦「开始」 */
  if(!running && !canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  API.postWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id) + "/timer/" + (running ? "stop" : "start"), {})
    .then(function(){
      toast(running ? ("已停止「" + t.title + "」计时") : ("已开始「" + t.title + "」计时"), "fs");
      loadRunningTimer();
      setTimeout(function(){ loadMine({silent:true}); }, 200);
    }).catch(function(ex){ toast(ex.message || "计时操作失败", "bad"); });
}
function mineReschedule(anchor, t){
  if(!t) return;
  if(!canEditTask(t)){ toast("你对该项目只有查看权限", "warn"); return; }
  var el = document.createElement("div");
  el.className = "menu due-pop";
  el.innerHTML =
    '<div class="dp-quick">' +
      '<button class="btn sm" type="button" data-mine-due-set="0">今天</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="1">明天</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="w5" title="按 5 个工作日计算，自动跳过周末">一周后</button>' +
      '<button class="btn sm" type="button" data-mine-due-set="">无期限</button>' +
    '</div>' +
    '<div class="dp-row">' +
      '<input type="date" value="' + esc(t.dueDate || "") + '" data-mine-due-input aria-label="选择截止日期" />' +
      '<button class="btn sm primary" type="button" data-mine-due-save>确定</button>' +
    '</div>';
  function apply(v){
    UI.closeAllPops();
    API.putWs(t.workspaceId, "/api/tasks/" + encodeURIComponent(t.id), taskPayloadWith(t, {dueDate: v || null}))
      .then(function(){
        toast(v ? ("已改期至 " + fmtFull(parseDate(v))) : "已清除截止日期", v ? "fs" : "warn");
        loadMine({silent:true});
        loadBoard({silent:true});
        refreshCalendarIfOpen();
      }).catch(function(ex){ toast(ex.message || "改期失败", "bad"); });
  }
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-due-set]");
    if(b){ apply(duePresetDate(b.dataset.mineDueSet)); return; }
    if(e.target.closest("[data-mine-due-save]")){
      apply(el.querySelector("[data-mine-due-input]").value || null);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
  setTimeout(function(){
    try{ el.querySelector("[data-mine-due-input]").focus(); }catch(e2){ /* noop */ }
  }, 30);
}
if(mineBody){
  mineBody.addEventListener("click", function(e){
    if(e.target.closest("[data-mine-more]")){ e.stopPropagation(); loadMine({append:true}); return; }
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    var t = mineTaskFromRow(row);
    if(e.target.closest("[data-mine-done]")){ e.stopPropagation(); mineComplete(t); return; }
    if(e.target.closest("[data-mine-timer]")){ e.stopPropagation(); mineToggleTimer(t); return; }
    var dueBtn = e.target.closest("[data-mine-due]");
    if(dueBtn){ e.stopPropagation(); mineReschedule(dueBtn, t); return; }
    var id = row.dataset.mineId;
    var wsId = row.dataset.mineWs;
    if(wsId && rt.currentWs && wsId !== rt.currentWs.id){
      var rowTitle = row.querySelector(".lr-t");
      askSwitchWorkspace(wsId, wsNameById(wsId), {
        title: "打开其他空间的任务",
        okText: "切换并打开",
        taskTitle: rowTitle ? rowTitle.textContent : "",
        openTaskId: id
      });
      return;
    }
    openTaskById(id);
  });
  mineBody.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    if(e.target.closest("button,input,select,a,textarea")) return;
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    e.preventDefault();
    row.click();
  });
}
if(mineSpaceFilter){
  mineSpaceFilter.addEventListener("change", function(){
    state.mineSpace = mineSpaceFilter.value || "";
    rerenderMine();
  });
}
if(btnMineRefresh) btnMineRefresh.addEventListener("click", function(){ loadMine(); });
if(mineModeEl){
  mineModeEl.addEventListener("click", function(e){
    var b = e.target.closest("[data-mine-mode]");
    if(b) setMineMode(b.dataset.mineMode);
  });
}
/* 跨断点重排：手机卡片 / 桌面表格共用同一份数据 */
window.addEventListener("ds:layout", function(){
  if(!rt.currentWs || document.body.dataset.view !== "mine") return;
  syncMineModeUI();
  if(isMobile() && currentMineMode() === "team"){ renderTeam(); return; }
  /* 从手机团队模式切回桌面时，我的任务可能从未加载过 */
  if(mineAll.length) rerenderMine(); else loadMine();
});
/* 下拉刷新走统一入口：团队模式刷新团队面板，我的模式刷新任务列表 */
window.addEventListener("ds:refresh-mine", function(){
  if(isMobile() && currentMineMode() === "team") renderTeam({silent:true});
  else loadMine({silent:true});
});
syncMineModeUI();

export { askSwitchWorkspace, enterMineView, loadMine, wsNameById };
