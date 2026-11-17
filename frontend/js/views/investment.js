/* views/investment · 投入结构：年度 / 季度的人力、工时与资源分布 */

import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { fullscreenButtonHTML } from "../core/fullscreen.js";
import { rt } from "../core/state.js";
import { UI, esc, toast } from "../core/ui.js";
import { AIProgress, aiErrorText, aiUsageText } from "../core/ai-progress.js";
import { labelFilterText } from "../lib/member-labels.js";
import { triggerDownload } from "../lib/download.js";
import { avatarHTML, colName, mdLite } from "../lib/format.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { loadReqs } from "./board.js";
import { downloadCsv, fmtDate, fmtHours, openTaskTable } from "./manager-shared.js";

var DIM_LABEL = { project:"项目", member:"成员", company:"公司", role:"角色", position:"职能" };
var METRIC_KEY = { act:"actualMinutes", est:"estimateMinutes" };
/* 与 ManagerService 的 UNASSIGNED_MEMBER_KEY 对齐：未指派的预估计工时但不计人力 */
var UNASSIGNED_MEMBER_KEY = "x:unassigned";
var state = { mode:"quarter", year:0, quarter:0, dim:"project", metric:"act", customFrom:"", customTo:"" };
var filters = { reqId:"", companyName:"", roleTitle:"", memberUserIds:[] };
var cache = null, options = {}, pivotRows = [], seq = 0, loading = false, filterWorkspace = "";
/* AI 总结按「空间#周期#筛选」缓存：翻周期/改筛选不覆盖已生成的结果，导出时取当前范围那一份 */
var aiCache = {}, aiBusy = false, memberPop = null, exportPop = null;

function investmentWorkspace(){ return rt.currentWs && rt.currentWs.id || ""; }
function pad2(value){ return value < 10 ? "0" + value : String(value); }
function todayISO(){
  if(rt.TODAY_ISO) return rt.TODAY_ISO;
  var d = rt.TODAY || new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function ensurePeriod(){
  if(!state.year){
    state.year = rt.TODAY.getFullYear();
    state.quarter = Math.floor(rt.TODAY.getMonth() / 3) + 1;
  }
  if(!state.customFrom || !state.customTo){
    /* 自定义默认给「最近 45 天」：够覆盖一个半月度复盘，又不会一上来就拉满 800 天 */
    var to = rt.TODAY;
    var from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 44);
    state.customFrom = isoDate(from);
    state.customTo = isoDate(to);
  }
}
function isoDate(d){
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function periodRange(){
  if(state.mode === "custom") return { from:state.customFrom, to:state.customTo };
  var year = state.year;
  if(state.mode === "year") return { from:year + "-01-01", to:year + "-12-31" };
  var first = (state.quarter - 1) * 3 + 1;
  var last = first + 2;
  var lastDay = new Date(year, last, 0).getDate();
  return { from:year + "-" + pad2(first) + "-01", to:year + "-" + pad2(last) + "-" + pad2(lastDay) };
}
function periodLabel(){
  if(state.mode === "custom") return state.customFrom + " — " + state.customTo;
  return state.mode === "year" ? state.year + " 年" : state.year + " 年 Q" + state.quarter;
}
function periodShortName(){
  if(state.mode === "custom") return state.customFrom + "_" + state.customTo;
  return state.mode === "year" ? String(state.year) : state.year + "Q" + state.quarter;
}
function periodStatusText(range){
  var today = todayISO();
  if(state.mode === "custom"){
    var days = Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1;
    var tail = range.to < today ? "已结束" : (range.from > today ? "未开始" : "截至 " + fmtDate(today));
    return range.from + " — " + range.to + " · " + days + " 天 · " + tail;
  }
  if(range.to < today) return periodLabel() + " · 已结束";
  if(range.from > today) return periodLabel() + " · 未开始";
  return periodLabel() + " · 截至 " + fmtDate(today);
}
function scopeText(){
  var project = filters.reqId
    ? (rt.reqList || []).filter(function(r){ return r.id === filters.reqId; })[0]
    : null;
  return "项目：" + (filters.reqId ? (project ? project.name : filters.reqId) : "全部项目")
    + " · 公司：" + scopeLabel(filters.companyName, "未设公司", "全部公司")
    + " · 角色：" + scopeLabel(filters.roleTitle, "未设角色", "全部角色")
    + " · 成员：" + memberScopeText();
}
function memberOptions(){
  return (options && options.members) || [];
}
function memberNameById(userId){
  var hit = memberOptions().filter(function(m){ return m.userId === userId; })[0];
  return hit ? (hit.name || userId) : userId;
}
function memberScopeText(){
  var ids = filters.memberUserIds || [];
  if(!ids.length) return "全部成员";
  var names = ids.map(memberNameById);
  if(names.length <= 3) return names.join("、");
  return names.slice(0, 3).join("、") + " 等 " + names.length + " 人";
}
function scopeLabel(value, unsetText, allText){
  if(!value) return allText;
  var text = labelFilterText(value);
  return text === "__unset__" ? unsetText : text;
}

function loadInvestment(opts){
  opts = opts || {};
  var body = $("investmentBody");
  if(!body) return Promise.resolve(null);
  var ws = investmentWorkspace();
  if(filterWorkspace !== ws){
    filters = { reqId:"", companyName:"", roleTitle:"", memberUserIds:[] };
    cache = null; options = {}; pivotRows = []; filterWorkspace = ws;
  }
  ensurePeriod();
  var current = ++seq;
  if(filters.reqId && rt.reqsLoaded && !rt.reqList.some(function(r){
    return r.id === filters.reqId && (!r.workspaceId || r.workspaceId === ws);
  })) filters.reqId = "";
  var range = periodRange();
  var params = {
    from:range.from, to:range.to,
    reqId:filters.reqId || null,
    companyName:filters.companyName || null,
    roleTitle:filters.roleTitle || null,
    memberUserIds:(filters.memberUserIds && filters.memberUserIds.length) ? filters.memberUserIds : null
  };
  loading = true;
  if(!opts.silent || !cache){
    body.innerHTML = toolbarHTML() + UI.skeletonCards(4);
    body.setAttribute("aria-busy", "true");
  }
  return API.get("/api/manager/investment", params).then(function(data){
    if(current !== seq || ws !== investmentWorkspace()) return null;
    cache = data;
    options = data.filterOptions || {};
    loading = false;
    body.setAttribute("aria-busy", "false");
    renderInvestment();
    return cache;
  }).catch(function(ex){
    if(current !== seq || ws !== investmentWorkspace()) return null;
    var status = ex && ex.code;
    if(filters.reqId && (status === 403 || status === 404)){
      filters.reqId = "";
      toast("所选项目已不可访问，已切换为全部项目", "warn");
      return loadInvestment(opts);
    }
    loading = false;
    body.setAttribute("aria-busy", "false");
    if(!opts.silent || !cache){
      cache = null;
      body.innerHTML = toolbarHTML() + UI.errorState(ex && ex.message ? ex.message : "加载失败，请重试");
    }else{
      toast(ex && ex.message ? ex.message : "加载失败，请重试", "bad");
    }
    return null;
  });
}

function enterInvestmentView(){
  /* 项目列表只用于筛选下拉：与投入数据并行，不阻塞首屏 */
  if(rt.reqsLoaded){ loadInvestment(); return; }
  loadInvestment();
  loadReqs().then(function(){
    if(document.body.dataset.view === "investment" && cache) renderInvestment();
  });
}

/* ---------- 口径提示：? 解释定义，! 提示边界 ---------- */
var HELP = {
  crossPeriod: {
    title:"跨期口径提醒",
    rows:[
      ["实际", "按每条计时记录的开始日期（started_at）归入年 / 季；跨零点的计时整条落在开始日。", "ok"],
      ["预估", "按工作项计划开始日（为空则创建日）整条归入，不按天摊分。", "info"],
      ["跨期", "跨季度 / 跨年的工作项，实际会随计时自然分到各期；预估只在计划开始日所在的那一期计一次，之后可能出现「有实际、无预估」。", "warn"]
    ],
    note:"本页不做跨期摊分，也不补摊预估，因此「实际 vs 预估」不能直接相减。"
  },
  headcount: {
    title:"去重人力",
    rows:[
      ["怎么算", "本期有结束计时的计时人 + 本期有预估的负责人，按人去重；同一人跨多个项目只算 1 人。", "ok"],
      ["不计", "未结束、0 分钟的计时不计；未指派负责人的预估仍计入工时，但不计入人力数。", "mute"]
    ]
  },
  actual: {
    title:"实际工时",
    rows:[
      ["来源", "本期所有已结束且分钟 > 0 的计时记录之和，按开始日期归属周期。", "ok"],
      ["归属", "按计时人统计，不按工作项负责人统计：跨项目支援、代记的工时会留在实际计时人身上。", "info"],
      ["构成", "测试窗口内 + 测试窗口外 = 实际；未结束和 0 分钟计时不计。", "mute"]
    ]
  },
  dev: {
    title:"测试窗口外工时",
    rows:[
      ["怎么算", "实际工时 − 测试窗口内的计时分钟。", "ok"],
      ["包含", "需求评审、方案与设计、开发、联调、验收、运维等不在测试窗口内的计时都在这里，不只是开发。", "info"],
      ["没有窗口", "工作项没有提测/测试结束记录时，全部实际计时都计入窗口外。", "mute"]
    ]
  },
  test: {
    title:"测试窗口内工时",
    rows:[
      ["怎么算", "计时日期落在工作项「提测 → 测试结束」窗口内的分钟，含首尾两天。", "ok"],
      ["最近一轮", "窗口只保留最近一轮测试；重开测试前的早期轮次会回落到窗口外。", "warn"],
      ["不是角色", "这里按时间窗口切分，不按人的岗位或测试计划推断：产品、设计在窗口内的计时也会落在这里。要按岗位看投入，切「职能」维度。", "mute"]
    ]
  },
  estimate: {
    title:"预估工时",
    rows:[
      ["怎么算", "计划开始日（为空则创建日）落在本期的所有工作项预估之和，整条归入。", "ok"],
      ["按谁归属", "按负责人归属，不按计时人；找不到负责人的保留在「未指派」分组。", "info"],
      ["不可相减", "预估没有时间轴，与按日发生的实际不是同一段时间，不能直接算偏差。", "warn"]
    ]
  },
  days: {
    title:"投入人天",
    rows:[
      ["折算", "实际工时 ÷ 8 小时，保留 1 位小数。", "ok"],
      ["含义", "只反映投入规模，不扣请假、加班和周末，不是考勤天数。", "mute"]
    ]
  },
  compose: {
    title:"测试窗口内 / 外构成",
    rows:[
      ["拆分", "窗口内 = 计时日期落在工作项测试窗口内的分钟；其余全部计入窗口外。", "ok"],
      ["不是开发/测试", "窗口外包含需求评审、设计、开发、运维等；要区分岗位请切「职能」维度。", "info"],
      ["注意", "一个工作项只保留最近一轮测试窗口，重开前的早期计时会落回窗口外。", "warn"]
    ]
  },
  position: {
    title:"职能维度",
    rows:[
      ["怎么算", "按成员在空间里设置的岗位归集：实际按计时人岗位，预估按负责人岗位。", "ok"],
      ["和角色的区别", "「角色」是项目内角色（如业务接口人、项目负责人），会随项目变；「职能」是空间岗位（如产品经理、后端开发），同一个人只归一处。", "info"],
      ["兼岗", "一人多岗时按空间岗位归集，不做拆分；没有设置岗位的归入「未设岗位」。", "mute"]
    ]
  },
  trend: {
    title:"投入趋势",
    rows:[
      ["分桶", "按计时开始月份汇总实际工时；季度显示 3 个月，年度显示 12 个月。", "ok"],
      ["空槽", "没有计时和预估的月份显示空槽，不补 0 柱，避免把「没记录」误读成「没投入」。", "mute"],
      ["当月", "当月是截至今天的不完整数据，用斜纹标出。", "info"]
    ]
  },
  pivot: {
    title:"维度与筛选",
    rows:[
      ["同一口径", "项目 / 成员 / 公司 / 角色 / 职能共用同一批计时与预估，切换只换分组，不换口径。", "ok"],
      ["职能", "职能取空间岗位，与项目角色不是一回事：角色会随项目变，职能只按人算。", "info"],
      ["成员", "实际按计时人，预估按负责人；公司来自空间成员，角色按项目有效主角色归属，兼岗在筛选时也能命中。", "info"],
      ["下钻", "点行按同一周期与筛选下钻到工作项；实际和预估会合并到同一工作项上。", "mute"]
    ]
  },
  versionWarn: {
    title:"版本为什么不进维度",
    rows:[
      ["重复计数", "一个工作项可以同时绑定多个版本，按版本汇总会把同一段工时报多次。", "warn"],
      ["版本投入", "单版本投入请看版本详情或版本页的单版本汇总。", "info"]
    ]
  },
  share: {
    title:"占比",
    rows:[
      ["怎么算", "该分组的选中指标 ÷ 当前维度下全部行的合计；分母随「按实际 / 按预估」切换。", "ok"],
      ["合计行", "合计恒为 100%；选中指标的合计为 0 时显示「—」。", "mute"],
      ["显示", "各组占比按最大余数法取整，相加恰好 100%，与直接四舍五入相比可能有 1 个百分点的差异。", "info"]
    ]
  }
};
registerHelp(HELP);
initCaliberHelp();

/* ---------- 工具条 ---------- */
function yearOptions(){
  var now = rt.TODAY.getFullYear();
  var years = [];
  for(var y = now; y >= now - 5; y--) years.push(y);
  if(years.indexOf(state.year) === -1) years.push(state.year);
  years.sort(function(a, b){ return b - a; });
  return years.map(function(y){
    return '<option value="' + y + '"' + (y === state.year ? ' selected' : '') + '>' + y + '</option>';
  }).join("");
}
function quarterOptions(){
  return [1, 2, 3, 4].map(function(q){
    return '<option value="' + q + '"' + (q === state.quarter ? ' selected' : '') + '>Q' + q
      + '（' + (q * 3 - 2) + '–' + (q * 3) + ' 月）</option>';
  }).join("");
}
function projectOptions(){
  var list = (rt.reqList || []).filter(function(r){
    return (!r.workspaceId || r.workspaceId === investmentWorkspace())
      && (!r.archivedAt || r.id === filters.reqId);
  });
  return '<option value="">全部项目</option>' + list.map(function(r){
    return '<option value="' + esc(r.id) + '"' + (r.id === filters.reqId ? ' selected' : '') + '>'
      + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
}
function labelOptions(values, selected, allText, unsetText){
  var seen = {}, list = [];
  (values || []).concat(selected ? [selected] : []).forEach(function(v){
    if(!v || v === "__unset__") return;
    var text = labelFilterText(v);
    if(!text || seen[text]) return;
    seen[text] = 1;
    list.push(text);
  });
  list.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  return '<option value="">' + allText + '</option>'
    + '<option value="__unset__"' + (selected === "__unset__" ? ' selected' : '') + '>' + unsetText + '</option>'
    + list.map(function(v){
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join("");
}
function toolbarHTML(){
  var hasData = !!cache;
  var memberCount = (filters.memberUserIds || []).length;
  return '<div class="manager-toolbar"><div><b>投入结构</b><span>按年度 / 季度 / 自定义区间盘点人力、工时与资源分布</span></div>'
    + '<div class="manager-actions">'
    + '<button class="btn sm primary" type="button" data-inv-ai' + (hasData ? '' : ' disabled') + '>✦ AI 总结</button>'
    + '<button class="btn sm" type="button" data-inv-export' + (hasData ? '' : ' disabled') + '>导出报告 ▾</button>'
    + '<button class="btn sm" type="button" data-inv-csv' + (hasData ? '' : ' disabled') + '>导出 CSV</button>'
    + fullscreenButtonHTML() + '</div></div>'
    + '<div class="inv-controls">'
    + '<span class="inv-seg" role="group" aria-label="周期类型">'
    + '<button type="button" data-inv-mode="quarter" class="' + (state.mode === "quarter" ? "on" : "") + '" aria-pressed="' + (state.mode === "quarter") + '">季度</button>'
    + '<button type="button" data-inv-mode="year" class="' + (state.mode === "year" ? "on" : "") + '" aria-pressed="' + (state.mode === "year") + '">年度</button>'
    + '<button type="button" data-inv-mode="custom" class="' + (state.mode === "custom" ? "on" : "") + '" aria-pressed="' + (state.mode === "custom") + '">自定义</button>'
    + '</span>'
    + (state.mode === "custom"
      ? '<label class="inv-field">从<input type="date" id="invFromInput" class="mini-select inv-date" aria-label="开始日期" value="' + esc(state.customFrom) + '"></label>'
        + '<label class="inv-field">至<input type="date" id="invToInput" class="mini-select inv-date" aria-label="结束日期" value="' + esc(state.customTo) + '"></label>'
      : '<label class="inv-field">年份<select id="invYearSelect" class="mini-select" aria-label="选择年份">' + yearOptions() + '</select></label>'
        + (state.mode === "quarter"
          ? '<label class="inv-field">季度<select id="invQuarterSelect" class="mini-select" aria-label="选择季度">' + quarterOptions() + '</select></label>'
          : ''))
    + '<div class="member-picker"><button class="btn sm soft mp-trigger" type="button" data-inv-member aria-haspopup="true">'
    + '成员' + (memberCount ? '<span class="mp-cnt">' + memberCount + '</span>' : '') + ' ▾</button></div>'
    + (memberCount ? '<span class="mp-chips">' + filters.memberUserIds.map(function(id){
        return '<span class="mp-chip">' + esc(memberNameById(id))
          + '<button type="button" data-inv-member-remove="' + esc(id) + '" aria-label="移除 ' + esc(memberNameById(id)) + '">×</button></span>';
      }).join("") + '</span>' : '')
    + '<label class="inv-field">项目<select id="invProjectSelect" class="mini-select" aria-label="选择项目">' + projectOptions() + '</select></label>'
    + '<label class="inv-field">公司<select id="invCompanySelect" class="mini-select" aria-label="选择公司">'
    + labelOptions(options.companyNames, filters.companyName, "全部公司", "未设公司") + '</select></label>'
    + '<label class="inv-field">角色<select id="invRoleSelect" class="mini-select" aria-label="选择角色">'
    + labelOptions(options.roleTitles, filters.roleTitle, "全部角色", "未设角色") + '</select></label>'
    + '<button class="btn sm soft" type="button" data-inv-clear>清除筛选</button>'
    + '<span class="inv-period-note">' + esc(periodStatusText(periodRange()))
    + caliberMarkHTML("crossPeriod", true, "查看跨期口径提醒") + '</span>'
    + '</div>';
}

/* ---------- 成员多选弹层 ---------- */
function memberPopHTML(){
  var list = memberOptions();
  var selected = {};
  (filters.memberUserIds || []).forEach(function(id){ selected[id] = 1; });
  var items = list.length ? list.map(function(m){
    var sub = [m.companyName || "未设公司", m.jobTitle || "未设岗位"].join(" · ");
    return '<label class="mp-item"><input type="checkbox" data-inv-member-check="' + esc(m.userId) + '"'
      + (selected[m.userId] ? ' checked' : '') + '>'
      + avatarHTML(m.name || m.userId, "sm")
      + '<span class="mp-who"><b>' + esc(m.name || m.userId) + '</b><span>' + esc(sub) + '</span></span></label>';
  }).join("") : '<div class="mp-empty">本期暂无可圈选的成员（需有结束计时或预估归属到账号成员）</div>';
  return '<div class="mp-pop-head">圈选成员<span>不选 = 全部成员</span></div>'
    + '<input type="search" class="mp-search" placeholder="搜索成员 / 公司 / 岗位…" aria-label="搜索成员">'
    + '<div class="mp-list">' + items + '</div>'
    + '<div class="mp-foot"><button class="btn sm soft" type="button" data-inv-member-all>全选</button>'
    + '<button class="btn sm soft" type="button" data-inv-member-none>清空</button>'
    + '<button class="btn sm primary" type="button" data-inv-member-done style="margin-left:auto">确定</button></div>';
}
function openMemberPicker(anchor){
  if(memberPop){ UI.closeAllPops(); return; }
  var el = document.createElement("div");
  el.className = "menu popover mp-pop";
  el.innerHTML = memberPopHTML();
  memberPop = el;
  /* 弹层里勾选先记在草稿上，点「确定」才真正刷新报表，避免每勾一个人就打一次接口 */
  var draft = (filters.memberUserIds || []).slice();
  function syncDraft(){
    draft = [];
    el.querySelectorAll("[data-inv-member-check]").forEach(function(box){
      if(box.checked) draft.push(box.dataset.invMemberCheck);
    });
  }
  el.addEventListener("change", function(e){
    if(e.target.matches("[data-inv-member-check]")) syncDraft();
  });
  el.addEventListener("input", function(e){
    if(!e.target.matches(".mp-search")) return;
    var q = e.target.value.trim().toLowerCase();
    el.querySelectorAll(".mp-item").forEach(function(item){
      item.style.display = !q || item.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
    });
  });
  el.addEventListener("click", function(e){
    if(e.target.closest("[data-inv-member-all]")){
      el.querySelectorAll("[data-inv-member-check]").forEach(function(box){ box.checked = true; });
      syncDraft(); return;
    }
    if(e.target.closest("[data-inv-member-none]")){
      el.querySelectorAll("[data-inv-member-check]").forEach(function(box){ box.checked = false; });
      syncDraft(); return;
    }
    if(e.target.closest("[data-inv-member-done]")){
      filters.memberUserIds = draft;
      UI.closeAllPops();
      loadInvestment();
    }
  });
  UI.openPop(el, anchor, {
    align:"left",
    width:Math.max(280, Math.min(360, window.innerWidth - 16)),
    onClose:function(){ el.remove(); memberPop = null; }
  });
  var search = el.querySelector(".mp-search");
  if(search) search.focus();
}

/* ---------- 总览 ---------- */
function kpiHTML(label, value, unit, desc, opts){
  opts = opts || {};
  var link = opts.link ? ' role="button" tabindex="0" data-inv-kpi="' + opts.link + '"'
    + ' aria-label="' + esc(label + " " + value + (unit || "") + "，点击查看成员明细") + '"' : "";
  return '<div class="inv-kpi' + (opts.hl ? " hl" : "") + (opts.link ? " inv-kpi-link" : "") + '"' + link + '>'
    + '<span class="inv-kl">' + label + caliberMarkHTML(opts.help, false, "查看「" + label + "」口径") + '</span>'
    + '<div class="inv-kv">' + value + (unit ? '<small>' + unit + '</small>' : '') + '</div>'
    + '<div class="inv-kd" title="' + esc(desc) + '">' + esc(desc) + '</div></div>';
}
function overviewHTML(){
  var totals = cache.totals || {};
  var actual = Number(totals.actualMinutes) || 0;
  var dev = Number(totals.devMinutes) || 0;
  var test = Number(totals.testMinutes) || 0;
  var estimate = Number(totals.estimateMinutes) || 0;
  var days = Math.round(actual / 480 * 10) / 10;
  var userNote = Number(totals.users) ? ("共 " + totals.users + " 人 · " + totals.projects + " 个项目 · 点击查看成员") : "本期没有可归集的人力";
  return '<section class="inv-card"><div class="inv-card-head"><div>'
    + '<h2>投入总览 ' + caliberMarkHTML("pivot", false, "查看本页口径") + '</h2>'
    + '<p>' + esc(scopeText()) + ' · ' + esc(periodStatusText(periodRange())) + '</p></div>'
    + '<div class="inv-head-ctl"><span class="inv-chip">口径 <b>计时发生日</b></span></div></div>'
    + '<div class="inv-card-body"><div class="inv-kpis">'
    + kpiHTML("去重人力", totals.users || 0, "人", userNote, { hl:true, help:"headcount", link: Number(totals.users) ? "member" : "" })
    + kpiHTML("实际工时", fmtHours(actual), "", "窗口外 " + fmtHours(dev) + " · 窗口内 " + fmtHours(test), { help:"actual" })
    + kpiHTML("测试窗口外", fmtHours(dev), "", "含评审、设计、开发、运维等计时", { help:"dev" })
    + kpiHTML("测试窗口内", fmtHours(test), "", "提测 → 测试结束期间的计时", { help:"test" })
    + '<div class="inv-kpi"><span class="inv-kl">预估工时' + caliberMarkHTML("estimate", false, "查看「预估工时」口径")
    + caliberMarkHTML("crossPeriod", true, "查看预估跨期提醒") + '</span>'
    + '<div class="inv-kv">' + fmtHours(estimate) + '</div>'
    + '<div class="inv-kd" title="按计划开始日整条归入，与按日发生的实际不可直接相减">按计划开始日整条归入</div></div>'
    + kpiHTML("投入人天", days, "人天", "实际消耗 ÷ 8 小时，按 8h/人日折算", { help:"days" })
    + '</div>' + composeHTML(actual, dev, test, estimate) + '</div></section>';
}
function composeHTML(actual, dev, test, estimate){
  if(!actual){
    return '<div class="inv-compose"><div class="inv-compose-top"><span class="inv-ct">测试窗口内 / 外构成 '
      + caliberMarkHTML("compose", false, "查看测试窗口内 / 外拆分口径") + '</span><span class="inv-cs">本期暂无实际计时</span></div>'
      + '<div class="inv-stack"></div>'
      + '<div class="inv-compose-note">预估 ' + fmtHours(estimate) + ' 仍按计划开始日归属；实际为 0 时不计算构成占比。</div></div>';
  }
  var devPct = Math.round(dev * 100 / actual);
  var testPct = 100 - devPct;
  return '<div class="inv-compose">'
    + '<div class="inv-compose-top"><span class="inv-ct">测试窗口内 / 外构成 ' + caliberMarkHTML("compose", false, "查看测试窗口内 / 外拆分口径") + '</span>'
    + '<span class="inv-cs">' + fmtHours(dev) + ' / ' + fmtHours(actual) + '</span></div>'
    + '<div class="inv-stack" role="img" aria-label="测试窗口外 ' + devPct + '%，测试窗口内 ' + testPct + '%">'
    + '<i class="dev" style="width:' + devPct + '%"></i><i class="test" style="width:' + testPct + '%"></i></div>'
    + '<div class="inv-compose-legend">'
    + '<span><i class="dev"></i>窗口外 ' + fmtHours(dev) + '（' + devPct + '%）</span>'
    + '<span><i class="test"></i>窗口内 ' + fmtHours(test) + '（' + testPct + '%）</span></div>'
    + '<div class="inv-compose-note">窗口内 = 计时日期落在工作项「提测 → 测试结束」的分钟；窗口外包含需求评审、设计、开发、运维等全部其余计时，不等于「开发」。测试窗口只保留最近一轮。</div></div>';
}

/* ---------- 趋势 ---------- */
function trendHTML(){
  var months = cache.months || [];
  var today = todayISO();
  var max = 1;
  months.forEach(function(m){ max = Math.max(max, Number(m.actualMinutes) || 0); });
  var currentMonth = today.substring(0, 7);
  var body = months.map(function(m){
    var value = Number(m.actualMinutes) || 0;
    var estimate = Number(m.estimateMinutes) || 0;
    var future = m.key > currentMonth;
    var partial = m.key === currentMonth;
    var empty = !value && !estimate;
    var cap = "";
    if(future) cap = "未开始";
    else if(partial) cap = value ? "截至今日" : "截至今日 0";
    else if(!value && estimate) cap = "有预估";
    else if(!value) cap = "无记录";
    else cap = "完整月";
    var height = value ? Math.max(2, Math.round(value * 100 / max)) : 0;
    var tip = m.name + "：实际 " + fmtHours(value) + " · 窗口外 " + fmtHours(m.devMinutes)
      + " · 窗口内 " + fmtHours(m.testMinutes) + " · 预估 " + fmtHours(estimate);
    var linkable = !future;
    return '<div class="inv-col' + (linkable ? " inv-col-link" : "") + '"'
      + (linkable
        ? ' role="button" tabindex="0" data-inv-month="' + esc(m.key) + '" aria-label="查看 ' + esc(m.name) + ' 的投入明细"'
        : "")
      + ' title="' + esc(tip + (linkable ? " · 点击查看该月工作项" : "")) + '">'
      + '<span class="inv-v">' + (value ? fmtHours(value) : "—") + '</span>'
      + '<div class="inv-bar' + (partial ? " partial" : "") + (empty ? " empty" : "") + '" style="height:' + height + '%">'
      + (value ? '<i></i>' : '') + '</div>'
      + '<span class="inv-lb">' + esc(m.name) + '</span>'
      + '<span class="inv-cap">' + cap + '</span></div>';
  }).join("");
  return '<section class="inv-card"><div class="inv-card-head"><div>'
    + '<h2>投入趋势 ' + caliberMarkHTML("trend", false, "查看趋势口径") + '</h2>'
    + '<p>按计时发生月份分桶；' + (state.mode === "custom"
        ? '自定义区间跨几个月就铺几个月。'
        : '用于看季度之间或年内的抬升与回落，不改变上方口径。') + '</p></div>'
    + '<div class="inv-head-ctl"><span class="inv-toolbar-meta">' + esc(periodLabel()) + '</span></div></div>'
    + '<div class="inv-card-body"><div class="inv-trend">' + body + '</div>'
    + '<div class="inv-trend-foot">'
    + (state.mode === "custom" ? '<span>自定义区间按月铺开；空槽表示该月没有计时和预估记录</span>'
        : state.mode === "quarter" ? '<span>季度内按月拆开；空槽表示该月没有计时和预估记录</span>'
        : '<span>年度按月铺开；未来月份用空槽标记，不补 0 柱</span>')
    + '<span>当月为截至 ' + esc(fmtDate(today)) + ' 的部分数据</span>'
    + '<span>悬停柱子可看窗口内 / 外与预估；点柱子查看该月工作项</span></div></div></section>';
}

/* ---------- 维度表 ---------- */
function shareList(rows, metric){
  var bases = rows.map(function(r){ return Math.max(0, Number(r[metric]) || 0); });
  var total = bases.reduce(function(a, b){ return a + b; }, 0);
  if(!total) return bases.map(function(){ return 0; });
  var raw = bases.map(function(v){ return v * 100 / total; });
  var out = raw.map(Math.floor);
  var rem = 100 - out.reduce(function(a, b){ return a + b; }, 0);
  var order = raw.map(function(v, i){ return { i:i, f:v - Math.floor(v) }; })
    .sort(function(a, b){ return b.f - a.f; });
  for(var k = 0; k < rem; k++) out[order[k % order.length].i]++;
  return out;
}
function rowMeta(row){
  if(state.dim === "member"){
    return (row.companyName || "未设公司") + " · " + (row.roleTitle || "未设角色")
      + " · 参与 " + (row.projects || 0) + " 个项目 · " + (row.tasks || 0) + " 个工作项";
  }
  if(state.dim === "project") return (row.users || 0) + " 人 · " + (row.tasks || 0) + " 个工作项";
  return (row.users || 0) + " 人 · " + (row.projects || 0) + " 个项目";
}
function pivotHTML(){
  var rows = ((cache.rows && cache.rows[state.dim]) || []).slice();
  var metric = METRIC_KEY[state.metric];
  rows.sort(function(a, b){
    return ((Number(b[metric]) || 0) - (Number(a[metric]) || 0))
      || ((Number(b.actualMinutes) || 0) - (Number(a.actualMinutes) || 0))
      || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
  });
  pivotRows = rows;
  var head = '<div class="inv-card-head"><div>'
    + '<h2>按维度拆分 ' + caliberMarkHTML("pivot", false, "查看维度与筛选口径") + '</h2>'
    + '<p>五种维度共用同一批计时与预估，切换只换分组，不换口径；点行下钻到工作项。'
    + ((filters.memberUserIds || []).length ? '已圈选 ' + filters.memberUserIds.length + ' 名成员，其余成员不进入统计。' : '')
    + '</p></div>'
    + '<div class="inv-head-ctl">'
    + '<span class="inv-seg" role="group" aria-label="拆分维度">'
    + Object.keys(DIM_LABEL).filter(function(dim){
      /* 老服务端没有新维度时不显示空簇 */
      return !!(cache.rows && cache.rows[dim]);
    }).map(function(dim){
      return '<button type="button" data-inv-dim="' + dim + '" class="' + (state.dim === dim ? "on" : "") + '" aria-pressed="' + (state.dim === dim) + '">' + DIM_LABEL[dim] + '</button>';
    }).join("") + '</span>'
    + '<span class="inv-seg" role="group" aria-label="占比指标">'
    + '<button type="button" data-inv-metric="act" class="' + (state.metric === "act" ? "on" : "") + '" aria-pressed="' + (state.metric === "act") + '">按实际</button>'
    + '<button type="button" data-inv-metric="est" class="' + (state.metric === "est" ? "on" : "") + '" aria-pressed="' + (state.metric === "est") + '">按预估</button>'
    + '</span></div></div>';
  if(!rows.length){
    var filtered = !!(filters.reqId || filters.companyName || filters.roleTitle);
    return '<section class="inv-card">' + head + '<div class="inv-card-body">'
      + UI.emptyState({
        icon: filtered ? "filterOff" : "stats",
        title: filtered ? "当前筛选下没有投入记录" : "本期没有投入记录",
        text: filtered ? "清除项目、公司或角色筛选，或换一个周期再试。" : "换一个季度 / 年度，或确认该周期内已有结束的计时或计划开始的工作项。",
        actionLabel: filtered ? "清除筛选" : ""
      }) + '</div></section>';
  }
  var metricTotal = rows.reduce(function(sum, r){ return sum + Math.max(0, Number(r[metric]) || 0); }, 0);
  var shares = shareList(rows, metric);
  var body = rows.map(function(row, index){
    var actual = Number(row.actualMinutes) || 0;
    var test = Number(row.testMinutes) || 0;
    var dev = Math.max(0, actual - test);
    var share = metricTotal ? shares[index] : null;
    var nameInner = '<b>' + esc(row.name || "未命名") + '</b><small>' + esc(rowMeta(row)) + '</small>';
    var nameCell = state.dim === "member"
      ? '<span class="inv-name inv-name-member">' + avatarHTML(row.name || "未命名", "sm") + '<span class="inv-name-txt">' + nameInner + '</span></span>'
      : '<span class="inv-name">' + nameInner + '</span>';
    return '<tr class="inv-row" tabindex="0" data-inv-row="' + index + '" title="点击下钻到该分组的工作项">'
      + '<td>' + nameCell + '</td>'
      + '<td class="num"><b>' + fmtHours(actual) + '</b></td>'
      + '<td class="num">' + fmtHours(dev) + '</td>'
      + '<td class="num">' + fmtHours(test) + '</td>'
      + '<td class="num">' + fmtHours(row.estimateMinutes) + '</td>'
      + '<td class="num">' + personDays(actual) + '</td>'
      + '<td class="num">' + (share === null
        ? '<span class="inv-share empty">—</span>'
        : '<span class="inv-share"><span class="inv-share-bar"><i style="width:' + share + '%"></i></span><span class="inv-share-n">' + share + '%</span></span>')
      + '</td></tr>';
  }).join("");
  var ts = cache.totals || {};
  var totalActual = Number(ts.actualMinutes) || 0;
  var totalTest = Number(ts.testMinutes) || 0;
  var totalRow = '<tr class="total"><td><b>合计</b> <span class="muted">'
    + (state.dim === "project" ? "全部项目" : "全部" + DIM_LABEL[state.dim]) + '</span></td>'
    + '<td class="num">' + fmtHours(totalActual) + '</td>'
    + '<td class="num">' + fmtHours(totalActual - totalTest) + '</td>'
    + '<td class="num">' + fmtHours(totalTest) + '</td>'
    + '<td class="num">' + fmtHours(ts.estimateMinutes) + '</td>'
    + '<td class="num">' + personDays(totalActual) + '</td>'
    + '<td class="num">' + (metricTotal ? "100%" : "—") + '</td></tr>';
  return '<section class="inv-card">' + head + '<div class="inv-card-body">'
    + '<div class="inv-tbl-wrap"><table class="manager-tbl inv-tbl"><thead><tr>'
    + '<th>' + (state.dim === "position"
        ? '<span class="th-help-wrap">职能' + caliberMarkHTML("position", false, "查看「职能」口径") + '</span>'
        : DIM_LABEL[state.dim]) + '</th>'
    + '<th class="num">实际工时</th><th class="num">测试窗口外</th><th class="num">测试窗口内</th>'
    + '<th class="num">预估工时</th><th class="num">投入人天</th><th class="num"><span class="th-help-wrap">'
    + (state.metric === "act" ? "占比（按实际）" : "占比（按预估）")
    + caliberMarkHTML("share", false, "查看「占比」口径") + '</span></th>'
    + '</tr></thead><tbody>' + body + totalRow + '</tbody></table></div>'
    + '<div class="inv-foot"><b>实际</b>按计时开始日归入周期，测试窗口内 + 外 = 实际（窗口外含评审、设计、开发、运维等）；<b>预估</b>按计划开始日整条归入，二者不可直接相减。'
    + '<b>版本</b>不进入本页维度 ' + caliberMarkHTML("versionWarn", true, "查看版本维度提醒") + '</div></div></section>';
}

/* ---------- 口径卡 ---------- */
function notesHTML(){
  return '<section class="inv-card inv-notes"><div class="inv-card-head"><div>'
    + '<h2>口径与边界 ' + caliberMarkHTML("crossPeriod", false, "查看周期归属口径") + '</h2>'
    + '<p>不新增录入项：只读聚合现有计时、工作项与成员配置。关键指标旁的「?」解释定义，「!」提示容易误读的边界。</p></div></div>'
    + '<div class="inv-card-body"><div class="inv-notes-grid">'
    + '<div><h3>周期归属</h3><ul>'
    + '<li><b>实际</b>：按计时开始日归入年 / 季；跨零点的计时整条落在开始日。</li>'
    + '<li><b>预估</b>：按计划开始日（无则创建日）整条归入，不按天拆分。</li>'
    + '<li><b>不补零</b>：没有计时和预估的月份不生成柱子，避免把「没记录」误读成「没投入」。</li></ul></div>'
    + '<div><h3>资源口径</h3><ul>'
    + '<li><b>成员</b>：实际按计时人，预估按负责人；同一人多项目只算 1 人。</li>'
    + '<li><b>公司 / 角色</b>：公司来自空间成员；角色按项目有效主角色归属，兼岗在筛选时也能命中。</li>'
    + '<li><b>职能</b>：取空间成员岗位（产品经理、后端开发、运营等），没填岗位时回落到项目角色；同一个人只归一处，便于看非研发投入。</li>'
    + '<li><b>筛选</b>：实际看计时人，预估看负责人，跨项目支援的计时不会漏。</li></ul></div>'
    + '<div><h3>边界</h3><ul>'
    + '<li><b>版本</b>：工作项可多绑版本，按版本会重复计数，因此不进入本页维度。</li>'
    + '<li><b>未结束计时</b>：ended_at 为空不计，避免把进行中的计时算成已发生工时。</li>'
    + '<li><b>预估偏差</b>：周期归属不同，本页不展示「预估 − 实际」的偏差结论。</li></ul></div>'
    + '<div><h3>下钻</h3><ul>'
    + '<li><b>入口</b>：维度表行、去重人力卡片、趋势柱都可下钻，分别看该分组、该成员、该月的工作项。</li>'
    + '<li><b>同一范围</b>：下钻沿用当前周期与项目 / 公司 / 角色筛选，不另开口径。</li>'
    + '<li><b>合并</b>：同一工作项的实际与预估会合并成一行，实际列只含本期计时。</li>'
    + '<li><b>只读</b>：明细里不修改工时，点击行打开工作项详情。</li></ul></div>'
    + '</div></div></section>';
}

function renderInvestment(){
  if(!cache || loading || filterWorkspace !== investmentWorkspace()) return;
  var body = $("investmentBody");
  if(!body) return;
  var focused = document.activeElement && document.activeElement.id;
  body.innerHTML = toolbarHTML() + overviewHTML() + trendHTML() + pivotHTML() + notesHTML();
  if(focused && ["invYearSelect", "invQuarterSelect", "invProjectSelect", "invCompanySelect", "invRoleSelect"].indexOf(focused) !== -1){
    var field = $(focused);
    if(field) field.focus();
  }
}

/* ---------- 下钻 ---------- */
function drillBase(from, to){
  return {
    from:from, to:to,
    reqId:filters.reqId || null,
    companyName:filters.companyName || null,
    roleTitle:filters.roleTitle || null,
    memberUserIds:(filters.memberUserIds && filters.memberUserIds.length) ? filters.memberUserIds : null,
    limit:100
  };
}
function openDrill(row, dim){
  if(!row || !cache) return;
  var range = periodRange();
  var dimension = dim || state.dim;
  var base = Object.assign(drillBase(range.from, range.to), { dimension:dimension, key:row.key });
  API.get("/api/manager/investment/tasks", Object.assign({}, base, { offset:0 })).then(function(page){
    var rows = (page && page.items) || [];
    if(!rows.length){ toast("该分组下本期暂无投入记录", "warn"); return; }
    openTaskTable(DIM_LABEL[dimension] + " · " + (row.name || "未命名"), rows,
      periodLabel() + " · " + scopeText() + " · 共 " + page.total + " 项 · 实际与预估按同一周期归集", {
        total:page.total,
        hasMore:page.hasMore,
        fetch:function(offset, pub){
          return API.get("/api/manager/investment/tasks", Object.assign({}, base, { offset:offset, pub:(pub === "published" || pub === "unpublished") ? pub : "" }));
        }
      }, { split:true, pub:true });
  }).catch(function(ex){
    toast(ex && ex.message ? ex.message : "明细加载失败", "bad");
  });
}
/* 去重人力卡片：先列人，点人再用成员维度下钻到工作项 */
function memberDrillRows(){
  return ((cache && cache.rows && cache.rows.member) || [])
    .filter(function(row){ return row && row.key !== UNASSIGNED_MEMBER_KEY; })
    .slice()
    .sort(function(a, b){
      return ((Number(b.actualMinutes) || 0) - (Number(a.actualMinutes) || 0))
        || ((Number(b.estimateMinutes) || 0) - (Number(a.estimateMinutes) || 0))
        || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
    });
}
function memberDrillRowHTML(row){
  var meta = (row.companyName || "未设公司") + " · " + (row.roleTitle || "未设角色");
  return '<tr data-inv-member-drill="' + esc(row.key) + '" tabindex="0"'
    + ' title="查看 ' + esc(row.name || "未命名") + ' 本期的工作项">'
    + '<td><span class="inv-name inv-name-member">' + avatarHTML(row.name || "未命名", "sm")
    + '<span class="inv-name-txt"><b>' + esc(row.name || "未命名") + '</b><small>' + esc(meta) + '</small></span></span></td>'
    + '<td class="num">' + (row.projects || 0) + '</td>'
    + '<td class="num">' + (row.tasks || 0) + '</td>'
    + '<td class="num"><b>' + fmtHours(row.actualMinutes) + '</b></td>'
    + '<td class="num">' + fmtHours(row.devMinutes) + '</td>'
    + '<td class="num">' + fmtHours(row.testMinutes) + '</td>'
    + '<td class="num">' + fmtHours(row.estimateMinutes) + '</td>'
    + '<td class="num">' + personDays(row.actualMinutes) + '</td></tr>';
}
function openMemberDrill(){
  if(!cache || loading) return;
  var rows = memberDrillRows();
  if(!rows.length){ toast("本期没有可归集的人力", "warn"); return; }
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "去重人力明细");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet manager-drill-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>去重人力 · ' + rows.length + ' 人</h2>'
    + '<div class="desc">' + esc(periodLabel() + " · " + scopeText() + " · 按实际工时排序，点成员查看其本期工作项") + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-inv-member-close aria-label="关闭">' + icon("close", 15) + '</button></div>'
    + '<div class="sheet-body"><div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
    + '<th>成员</th><th class="num">项目</th><th class="num">工作项</th><th class="num">实际工时</th>'
    + '<th class="num">测试窗口外</th><th class="num">测试窗口内</th><th class="num">预估工时</th><th class="num">投入人天</th>'
    + '</tr></thead><tbody>' + rows.map(memberDrillRowHTML).join("") + '</tbody></table></div>'
    + '<div class="inv-foot">去重人力按人合并；未指派的预估计入工时但不计入人数。实际与预估按同一周期归集。</div>'
    + '</div></div>';
  document.body.appendChild(layer);
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-inv-member-close]")){ UI.closeModal(layer); return; }
    var tr = e.target.closest("[data-inv-member-drill]");
    if(!tr) return;
    var hit = rows.filter(function(r){ return r.key === tr.dataset.invMemberDrill; })[0];
    if(!hit) return;
    UI.closeModal(layer);
    openDrill(hit, "member");
  });
  layer.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var tr = e.target.closest && e.target.closest("[data-inv-member-drill]");
    if(!tr || tr !== e.target) return;
    e.preventDefault();
    tr.click();
  });
  UI.openModal(layer);
}
/* 趋势柱：把区间夹到该自然月，看这一个月的工作项 */
function monthRange(key){
  var parts = key.split("-");
  var year = Number(parts[0]), month = Number(parts[1]);
  var lastDay = new Date(year, month, 0).getDate();
  return { from: key + "-01", to: key + "-" + pad2(lastDay) };
}
function openMonthDrill(key){
  if(!cache || loading || !key) return;
  var range = periodRange();
  var own = monthRange(key);
  var from = range.from > own.from ? range.from : own.from;
  var to = range.to < own.to ? range.to : own.to;
  if(from > to){ toast("该月不在当前统计区间内", "warn"); return; }
  var month = (cache.months || []).filter(function(m){ return m.key === key; })[0];
  var name = month ? month.name : key;
  var base = drillBase(from, to);
  API.get("/api/manager/investment/tasks", Object.assign({}, base, { offset:0 })).then(function(page){
    var rows = (page && page.items) || [];
    if(!rows.length){ toast("该月没有可下钻的投入记录", "warn"); return; }
    openTaskTable(name + " · 投入明细", rows,
      periodLabel() + " · " + scopeText() + " · 仅 " + name + " · 共 " + page.total
        + " 项 · 实际按计时发生日、预估按计划开始日归入该月", {
        total:page.total,
        hasMore:page.hasMore,
        fetch:function(offset, pub){
          return API.get("/api/manager/investment/tasks", Object.assign({}, base, { offset:offset, pub:(pub === "published" || pub === "unpublished") ? pub : "" }));
        }
      }, { split:true, pub:true });
  }).catch(function(ex){
    toast(ex && ex.message ? ex.message : "明细加载失败", "bad");
  });
}

/* ---------- 导出 ---------- */
function exportCsv(){
  if(!cache || loading || filterWorkspace !== investmentWorkspace()) return;
  var totals = cache.totals || {};
  var rows = [["投入结构", periodLabel(), scopeText()], [],
    ["指标", "数值"],
    ["去重人力", (totals.users || 0) + " 人"],
    ["实际工时（分钟）", totals.actualMinutes || 0],
    ["测试窗口外（分钟）", totals.devMinutes || 0],
    ["测试窗口内（分钟）", totals.testMinutes || 0],
    ["预估工时（分钟）", totals.estimateMinutes || 0],
    ["投入人天", Math.round((Number(totals.actualMinutes) || 0) / 480 * 10) / 10],
    [], ["月份", "实际（分钟）", "测试窗口外（分钟）", "测试窗口内（分钟）", "预估（分钟）"]];
  ((cache.months || [])).forEach(function(m){
    rows.push([m.key, m.actualMinutes, m.devMinutes, m.testMinutes, m.estimateMinutes]);
  });
  var metric = METRIC_KEY[state.metric];
  var list = ((cache.rows && cache.rows[state.dim]) || []).slice();
  list.sort(function(a, b){ return (Number(b[metric]) || 0) - (Number(a[metric]) || 0); });
  var shares = shareList(list, metric);
  rows.push([], [DIM_LABEL[state.dim], "预估（分钟）", "实际（分钟）", "测试窗口外（分钟）", "测试窗口内（分钟）", "占比%"]);
  list.forEach(function(r, i){
    rows.push([r.name, r.estimateMinutes, r.actualMinutes, r.devMinutes, r.testMinutes, shares[i]]);
  });
  rows.push(["合计", totals.estimateMinutes || 0, totals.actualMinutes || 0, totals.devMinutes || 0, totals.testMinutes || 0, 100]);
  downloadCsv("投入结构_" + periodShortName() + ".csv", rows);
  toast("已导出投入结构 CSV", "fs");
}

/* ---------- AI 工作总结 ---------- */
function aiScopeKey(){
  var range = periodRange();
  return [investmentWorkspace(), range.from, range.to, filters.reqId || "", filters.companyName || "",
    filters.roleTitle || "", (filters.memberUserIds || []).slice().sort().join(",")].join("#");
}
function currentAiSummary(){
  return aiCache[aiScopeKey()] || null;
}
function aiRequestBody(){
  var range = periodRange();
  return {
    from:range.from, to:range.to,
    reqId:filters.reqId || null,
    companyName:filters.companyName || null,
    roleTitle:filters.roleTitle || null,
    memberUserIds:(filters.memberUserIds && filters.memberUserIds.length) ? filters.memberUserIds : null,
    note:""
  };
}
function runAiSummary(){
  if(!cache || loading || aiBusy) return;
  var key = aiScopeKey();
  var body = aiRequestBody();
  var t = cache.totals || {};
  aiBusy = true;
  AIProgress.run({
    title:"AI 工作总结",
    desc:"汇总 " + (t.users || 0) + " 名成员 · " + (t.tasks || 0) + " 个工作项 · "
      + fmtHours(t.actualMinutes || 0) + " 计时；按人整理素材后交模型撰写…",
    hint:"长区间多人素材较多，通常需要 20–60 秒；数字由系统统计，AI 只负责撰写",
    errorText:aiErrorText,
    request:function(signal){
      return API.postWithSignal("/api/ai/investment/summary", body, signal);
    },
    onSuccess:function(r){
      aiBusy = false;
      if(r) aiCache[key] = r;
      /* 生成期间可能已翻周期/改筛选：只展示与当前范围一致的那一份 */
      if(key === aiScopeKey() && r) openAiDrawer(r);
      else if(r) toast("总结已生成，但当前范围已变化，可在对应范围重新查看", "warn");
    },
    onError:function(){ aiBusy = false; },
    onCancel:function(){ aiBusy = false; }
  }).catch(function(){ aiBusy = false; });
}

/* Markdown 渲染：优先 marked + DOMPurify（与 AI 助手同源），库未到时退化为安全的轻量排版 */
var mdLibPromise = null;
function ensureMdLib(){
  if(window.marked && window.DOMPurify) return Promise.resolve(true);
  if(mdLibPromise) return mdLibPromise;
  function load(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  mdLibPromise = load(API.url("/vendor/markdown/marked.min.js"))
    .then(function(){ return load(API.url("/vendor/markdown/purify.min.js")); })
    .then(function(){ return true; })
    .catch(function(){ mdLibPromise = null; return false; });
  return mdLibPromise;
}
function mdFallbackHTML(text){
  var lines = String(text || "").split("\n");
  var html = "", inList = false;
  function closeList(){ if(inList){ html += "</ul>"; inList = false; } }
  lines.forEach(function(line){
    var h = /^(#{1,4})\s+(.*)$/.exec(line);
    if(h){ closeList(); var lv = Math.min(4, h[1].length + 1); html += "<h" + lv + ">" + mdLite(h[2]) + "</h" + lv + ">"; return; }
    var li = /^\s*[-*]\s+(.*)$/.exec(line);
    if(li){ if(!inList){ html += "<ul>"; inList = true; } html += "<li>" + mdLite(li[1]) + "</li>"; return; }
    closeList();
    if(line.trim()) html += "<p>" + mdLite(line) + "</p>";
  });
  closeList();
  return html;
}
function aiMarkdownHTML(text){
  return ensureMdLib().then(function(ok){
    if(ok && window.marked && window.DOMPurify){
      try{ return window.DOMPurify.sanitize(window.marked.parse(String(text || ""), { gfm:true, breaks:false })); }
      catch(e){ /* 落到轻量排版 */ }
    }
    return mdFallbackHTML(text);
  });
}
function aiSourceText(r){
  var s = (r && r.source) || {};
  var text = "素材：" + (s.members || 0) + " 名成员 · " + (s.items || 0) + " 个工作项";
  if(s.truncated){
    var names = (s.truncatedNames || []).filter(Boolean);
    var cap = s.perMember || 20;
    text += names.length
      ? "（" + names.join("、") + " 按工时取前 " + cap + " 项）"
      : "（部分成员工作项较多，按工时取前 " + cap + " 项撰写）";
  }
  return text;
}
function openAiDrawer(r){
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  var range = periodRange();
  var sub = esc(range.from + " — " + range.to) + " · " + esc(memberScopeText());
  layer.innerHTML = '<div class="sheet inv-ai-drawer"><div class="sheet-head inv-ai-head">'
    + '<span class="inv-ai-ic">✦</span><div style="flex:1;min-width:0"><h2>AI 工作总结</h2><div class="desc">' + sub + '</div></div>'
    + '<button class="icon-btn sm" type="button" data-ai-close aria-label="关闭">×</button></div>'
    + '<div class="sheet-body inv-ai-body">'
    + '<div class="inv-ai-note">数字由系统统计、AI 只负责撰写；内容仅供参考，发出前请过目。' + esc(aiSourceText(r)) + '。</div>'
    + '<div class="inv-ai-src" data-ai-src></div>'
    + '<div class="inv-ai-md" data-ai-md></div>'
    + '</div>'
    + '<div class="sheet-foot inv-ai-foot">'
    + '<button class="btn sm" type="button" data-ai-regen>重新生成</button>'
    + '<button class="btn sm primary" type="button" data-ai-export>导出报告 ▾</button>'
    + '<span class="inv-ai-usage">' + esc(aiUsageText(r.usage)) + '</span>'
    + '</div></div>';
  document.body.appendChild(layer);
  var totals = cache.totals || {};
  var src = layer.querySelector("[data-ai-src]");
  src.innerHTML = '<span class="mini-tag ok">实际 ' + fmtHours(totals.actualMinutes) + '</span>'
    + '<span class="mini-tag">窗口外 ' + fmtHours(totals.devMinutes) + '</span>'
    + '<span class="mini-tag warn">窗口内 ' + fmtHours(totals.testMinutes) + '</span>'
    + '<span class="mini-tag info">' + (Math.round((Number(totals.actualMinutes) || 0) / 480 * 10) / 10) + ' 人天</span>';
  var mdBox = layer.querySelector("[data-ai-md]");
  mdBox.innerHTML = '<div class="inv-ai-loading">' + UI.skeletonRows(5) + '</div>';
  aiMarkdownHTML(r.report).then(function(html){ if(layer.isConnected) mdBox.innerHTML = html; });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-ai-close]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-ai-regen]")){ UI.closeModal(layer); runAiSummary(); return; }
    if(e.target.closest("[data-ai-export]")){ openExportMenu(e.target.closest("[data-ai-export]")); }
  });
  UI.openModal(layer);
}

/* ---------- 报告导出 ---------- */
function reportMemberRows(){
  var list = ((cache.rows && cache.rows.member) || []).slice();
  list.sort(function(a, b){ return (Number(b.actualMinutes) || 0) - (Number(a.actualMinutes) || 0); });
  return list;
}
function statusName(column){
  return column === "done" ? "已完成" : colName(column);
}
/* 附录取每个成员的全部工作项（沿用当前周期与筛选）；成员过多时截断并如实注明 */
var REPORT_MAX_MEMBERS = 50;
function gatherReport(){
  var members = reportMemberRows();
  var truncatedMembers = members.length > REPORT_MAX_MEMBERS;
  var picked = members.slice(0, REPORT_MAX_MEMBERS);
  var range = periodRange();
  var base = {
    from:range.from, to:range.to,
    reqId:filters.reqId || null,
    companyName:filters.companyName || null,
    roleTitle:filters.roleTitle || null,
    memberUserIds:(filters.memberUserIds && filters.memberUserIds.length) ? filters.memberUserIds : null,
    dimension:"member"
  };
  var appendix = [];
  var chain = Promise.resolve();
  picked.forEach(function(m){
    chain = chain.then(function(){
      return API.getAllPages("/api/manager/investment/tasks", Object.assign({}, base, { key:m.key }))
        .then(function(items){
          (items || []).forEach(function(t){
            appendix.push({ member:m.name || "未命名", title:t.title || "（无标题）",
              reqName:t.reqName || "未归类", status:statusName(t.boardColumn),
              actualMinutes:Number(t.totalMinutes) || 0, estimateMinutes:Number(t.estimateMinutes) || 0 });
          });
        }).catch(function(){ /* 单个成员明细失败不阻塞整份报告 */ });
    });
  });
  return chain.then(function(){
    return {
      title:"团队投入报告",
      sub:range.from + " — " + range.to + " · " + (rt.currentWs && rt.currentWs.name || "当前空间"),
      scope:scopeText(),
      generatedAt:new Date().toLocaleString("zh-CN", { hour12:false }),
      generatedBy:(rt.currentUser && (rt.currentUser.displayName || rt.currentUser.username)) || "",
      members:picked, totals:cache.totals || {},
      ai:currentAiSummary(), appendix:appendix, truncatedMembers:truncatedMembers
    };
  });
}
function personDays(minutes){ return Math.round((Number(minutes) || 0) / 480 * 10) / 10; }
function reportFileName(ext){
  return "团队投入报告_" + periodShortName() + "." + ext;
}
function reportMarkdown(rep){
  var md = "# " + rep.title + "\n\n";
  md += rep.sub + "\n\n";
  md += "- 范围：" + rep.scope + "\n";
  md += "- 生成：" + rep.generatedAt + (rep.generatedBy ? " · " + rep.generatedBy : "") + "\n\n";
  md += "## 1. 投入统计\n\n";
  md += "| 成员 | 角色 / 公司 | 实际 | 测试窗口外 | 测试窗口内 | 预估 | 人天 | 工作项 |\n";
  md += "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  rep.members.forEach(function(m){
    md += "| " + (m.name || "未命名") + " | " + [m.roleTitle || "未设角色", m.companyName || "未设公司"].join(" · ")
      + " | " + fmtHours(m.actualMinutes) + " | " + fmtHours(m.devMinutes) + " | " + fmtHours(m.testMinutes)
      + " | " + fmtHours(m.estimateMinutes) + " | " + personDays(m.actualMinutes) + " | " + (m.tasks || 0) + " |\n";
  });
  var t = rep.totals;
  md += "| 合计 | " + (t.users || 0) + " 人 | " + fmtHours(t.actualMinutes) + " | " + fmtHours(t.devMinutes)
    + " | " + fmtHours(t.testMinutes) + " | " + fmtHours(t.estimateMinutes) + " | " + personDays(t.actualMinutes)
    + " | " + (t.tasks || 0) + " |\n\n";
  md += "## 2. 工作总结" + (rep.ai ? "（✦ AI 生成 · 仅供参考）" : "") + "\n\n";
  md += rep.ai ? rep.ai.report + "\n\n" : "> 未生成 AI 总结。可先在报表点「AI 总结」，再导出含总结的报告。\n\n";
  md += "## 3. 工作项明细（附录）\n\n";
  md += "| 成员 | 工作项 | 项目 | 状态 | 实际工时 |\n| --- | --- | --- | --- | ---: |\n";
  rep.appendix.forEach(function(a){
    md += "| " + a.member + " | " + a.title + " | " + a.reqName + " | " + a.status + " | " + fmtHours(a.actualMinutes) + " |\n";
  });
  if(rep.truncatedMembers) md += "\n> 成员较多，附录仅列出前 " + REPORT_MAX_MEMBERS + " 名成员的工作项。\n";
  md += "\n---\n\n口径：实际工时按计时发生日归期、按计时人归属；测试窗口内 = 最近一轮「提测 → 测试结束」窗口内的计时，"
    + "其余计时（需求评审、设计、开发、运维等）全部计入窗口外；"
    + "预估按计划开始日整条归入、按负责人归属，与实际不可直接相减。人天 = 实际 ÷ 8 小时。\n\n"
    + "本报告由沙漏生成 · 统计数字来自系统计时记录；「工作总结」一节由 AI 撰写，仅供参考。\n";
  return md;
}
function reportTableHTML(rep){
  function th(v){ return "<th>" + esc(v) + "</th>"; }
  function td(v){ return "<td>" + esc(v == null ? "" : String(v)) + "</td>"; }
  var t = rep.totals;
  var stats = '<table class="rp-table"><thead><tr>' + th("成员") + th("角色 / 公司")
    + th("实际") + th("测试窗口外") + th("测试窗口内") + th("预估") + th("人天") + th("工作项") + '</tr></thead><tbody>';
  rep.members.forEach(function(m){
    stats += '<tr>' + td(m.name || "未命名") + td([m.roleTitle || "未设角色", m.companyName || "未设公司"].join(" · "))
      + td(fmtHours(m.actualMinutes)) + td(fmtHours(m.devMinutes)) + td(fmtHours(m.testMinutes))
      + td(fmtHours(m.estimateMinutes)) + td(personDays(m.actualMinutes)) + td(m.tasks || 0) + '</tr>';
  });
  stats += '<tr class="total">' + td("合计") + td((t.users || 0) + " 人") + td(fmtHours(t.actualMinutes))
    + td(fmtHours(t.devMinutes)) + td(fmtHours(t.testMinutes)) + td(fmtHours(t.estimateMinutes))
    + td(personDays(t.actualMinutes)) + td(t.tasks || 0) + '</tr></tbody></table>';
  var appendix = '<table class="rp-table"><thead><tr>' + th("成员") + th("工作项") + th("项目") + th("状态") + th("实际工时") + '</tr></thead><tbody>';
  rep.appendix.forEach(function(a){
    appendix += '<tr>' + td(a.member) + td(a.title) + td(a.reqName) + td(a.status) + td(fmtHours(a.actualMinutes)) + '</tr>';
  });
  if(!rep.appendix.length) appendix += '<tr><td colspan="5">本期暂无工作项明细</td></tr>';
  appendix += '</tbody></table>';
  return { stats:stats, appendix:appendix };
}
function reportDocHTML(rep, forWord){
  var tables = reportTableHTML(rep);
  var aiHTML = rep.ai ? mdFallbackHTML(rep.ai.report) : '<p class="rp-muted">未生成 AI 总结。可先在报表点「AI 总结」，再导出含总结的报告。</p>';
  var style = forWord
    ? '@page{size:A4;margin:1.8cm 1.6cm;}body{font:10.5pt/1.5 "Microsoft YaHei","PingFang SC",sans-serif;color:#101828;}'
      + 'h1{font-size:18pt;margin:0 0 4pt;}h2{font-size:13pt;margin:14pt 0 6pt;}h3{font-size:11.5pt;margin:10pt 0 4pt;}'
      + 'table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:9pt;}'
      + 'th,td{border:1px solid #D0D5DD;padding:4pt 5pt;vertical-align:top;text-align:left;}'
      + 'th{background:#F2F4F7;font-weight:600;}.rp-muted,.rp-meta,.rp-foot{color:#667085;font-size:9pt;}'
      + 'ul{margin:4pt 0 8pt;padding-left:18pt;}li{margin:2pt 0;}'
    : 'body{font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828;padding:28px;max-width:820px;margin:0 auto;}'
      + 'h1{font-size:22px;margin:0 0 4px;}h2{font-size:16px;margin:20px 0 8px;border-bottom:1px solid #E4E7EC;padding-bottom:6px;}'
      + 'h3{font-size:14px;margin:12px 0 4px;}table{border-collapse:collapse;width:100%;margin:8px 0 14px;font-size:12px;}'
      + 'th,td{border:1px solid #E4E7EC;padding:5px 7px;text-align:left;vertical-align:top;}th{background:#F9FAFB;font-weight:600;}'
      + 'tr.total td{font-weight:600;background:#F9FAFB;}.rp-muted,.rp-meta,.rp-foot{color:#667085;font-size:12px;}'
      + 'ul{margin:6px 0 10px;padding-left:20px;}li{margin:3px 0;}.rp-ai-tag{color:#7A5AF8;font-size:12px;font-weight:400;}';
  var head = forWord
    ? '<!doctype html><html lang="zh-CN" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>' + esc(rep.title) + '</title><style>' + style + '</style></head><body>'
    : '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(rep.title) + '</title><style>' + style + '</style></head><body>';
  return head
    + '<h1>' + esc(rep.title) + '</h1>'
    + '<p class="rp-meta">' + esc(rep.sub) + '</p>'
    + '<p class="rp-meta">范围：' + esc(rep.scope) + ' · 生成：' + esc(rep.generatedAt)
    + (rep.generatedBy ? ' · ' + esc(rep.generatedBy) : '') + '</p>'
    + '<h2>1. 投入统计</h2>' + tables.stats
    + '<h2>2. 工作总结' + (rep.ai ? ' <span class="rp-ai-tag">✦ AI 生成 · 仅供参考</span>' : '') + '</h2>' + aiHTML
    + '<h2>3. 工作项明细（附录）</h2>' + tables.appendix
    + (rep.truncatedMembers ? '<p class="rp-muted">成员较多，附录仅列出前 ' + REPORT_MAX_MEMBERS + ' 名成员的工作项。</p>' : '')
    + '<p class="rp-foot">口径：实际工时按计时发生日归期、按计时人归属；测试窗口内 = 最近一轮「提测 → 测试结束」窗口内的计时，'
    + '其余计时（需求评审、设计、开发、运维等）全部计入窗口外；'
    + '预估按计划开始日整条归入、按负责人归属，与实际不可直接相减。人天 = 实际 ÷ 8 小时。<br>'
    + '本报告由沙漏生成 · 统计数字来自系统计时记录；「工作总结」一节由 AI 撰写，仅供参考。</p>'
    + '</body></html>';
}
function exportReport(format){
  if(!cache || loading) return;
  toast("正在整理报告…", "fs");
  gatherReport().then(function(rep){
    if(format === "md"){
      triggerDownload(reportFileName("md"), reportMarkdown(rep), "text/markdown;charset=utf-8");
      toast("已导出报告 Markdown", "fs");
    }else if(format === "doc"){
      triggerDownload(reportFileName("doc"), "\ufeff" + reportDocHTML(rep, true), "application/msword;charset=utf-8");
      toast("已导出报告 Word", "fs");
    }else if(format === "pdf"){
      printReport(rep);
    }
  }).catch(function(ex){
    toast(ex && ex.message ? ex.message : "报告整理失败", "bad");
  });
}
function printReport(rep){
  var frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  var doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(reportDocHTML(rep, false)); doc.close();
  setTimeout(function(){
    try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ /* 打印被拦截时保持静默 */ }
    setTimeout(function(){ frame.remove(); }, 1500);
  }, 150);
}
function openExportMenu(anchor){
  if(exportPop){ UI.closeAllPops(); return; }
  var el = document.createElement("div");
  el.className = "menu popover inv-export-menu";
  el.innerHTML = '<button class="mi" type="button" data-inv-export-fmt="preview"><b>预览报告</b><span>统计 + AI 总结 + 工作项附录</span></button>'
    + '<button class="mi" type="button" data-inv-export-fmt="md"><b>Markdown（.md）</b><span>纯文本，适合贴进文档 / 知识库</span></button>'
    + '<button class="mi" type="button" data-inv-export-fmt="doc"><b>Word（.doc）</b><span>表格排版，可直接编辑另存 .docx</span></button>'
    + '<button class="mi" type="button" data-inv-export-fmt="pdf"><b>PDF（打印）</b><span>A4 排版，打印对话框另存为 PDF</span></button>'
    + '<div class="sep"></div>'
    + '<button class="mi" type="button" data-inv-export-fmt="csv"><b>仅数据 CSV</b><span>不含 AI 总结的原始统计表</span></button>';
  exportPop = el;
  el.addEventListener("click", function(e){
    var item = e.target.closest("[data-inv-export-fmt]");
    if(!item) return;
    var fmt = item.dataset.invExportFmt;
    UI.closeAllPops();
    if(fmt === "csv") exportCsv();
    else if(fmt === "preview") openReportPreview();
    else exportReport(fmt);
  });
  UI.openPop(el, anchor, {
    align:"right", width:280,
    onClose:function(){ el.remove(); exportPop = null; }
  });
}
function openReportPreview(){
  if(!cache || loading) return;
  var layer = document.createElement("div");
  layer.className = "modal-layer";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.__uiOnClose = function(){ setTimeout(function(){ layer.remove(); }, 0); };
  layer.innerHTML = '<div class="sheet inv-report-sheet"><div class="sheet-head"><div style="flex:1;min-width:0">'
    + '<h2>导出报告</h2><div class="desc">报告 = 统计表格 + AI 总结 + 工作项明细；三种载体同一份内容</div></div>'
    + '<div class="inv-report-acts">'
    + '<button class="btn sm" type="button" data-inv-export-fmt="md">Markdown</button>'
    + '<button class="btn sm" type="button" data-inv-export-fmt="doc">Word</button>'
    + '<button class="btn sm primary" type="button" data-inv-export-fmt="pdf">PDF</button>'
    + '<button class="icon-btn sm" type="button" data-report-close aria-label="关闭">×</button>'
    + '</div></div>'
    + '<div class="sheet-body inv-report-body"><div class="inv-report-loading">' + UI.skeletonRows(8) + '</div></div></div>';
  document.body.appendChild(layer);
  var body = layer.querySelector(".inv-report-body");
  gatherReport().then(function(rep){
    if(!layer.isConnected) return;
    var tables = reportTableHTML(rep);
    body.innerHTML = '<div class="report-doc">'
      + '<div class="rp-title">' + esc(rep.title) + '</div>'
      + '<div class="rp-sub">' + esc(rep.sub) + '</div>'
      + '<div class="rp-meta"><span>范围：' + esc(rep.scope) + '</span><span>生成：' + esc(rep.generatedAt)
      + (rep.generatedBy ? ' · ' + esc(rep.generatedBy) : '') + '</span></div>'
      + '<div class="rp-sec"><span class="no">1</span>投入统计</div>' + tables.stats
      + '<div class="rp-sec"><span class="no">2</span>工作总结'
      + (rep.ai ? ' <span class="rp-ai-tag">✦ AI 生成 · 仅供参考</span>' : '') + '</div>'
      + '<div class="rp-md" data-report-md></div>'
      + '<div class="rp-sec"><span class="no">3</span>工作项明细（附录）</div>' + tables.appendix
      + (rep.truncatedMembers ? '<div class="rp-muted">成员较多，附录仅列出前 ' + REPORT_MAX_MEMBERS + ' 名成员的工作项。</div>' : '')
      + '<div class="rp-foot">口径：实际工时按计时发生日归期、按计时人归属；测试窗口内 = 最近一轮「提测 → 测试结束」窗口内的计时，'
      + '其余计时（需求评审、设计、开发、运维等）全部计入窗口外；'
      + '预估按计划开始日整条归入、按负责人归属，与实际不可直接相减。人天 = 实际 ÷ 8 小时。<br>'
      + '本报告由沙漏生成 · 统计数字来自系统计时记录；「工作总结」一节由 AI 撰写，仅供参考。</div>'
      + '</div>';
    var mdBox = body.querySelector("[data-report-md]");
    if(rep.ai){
      aiMarkdownHTML(rep.ai.report).then(function(html){ if(layer.isConnected) mdBox.innerHTML = html; });
    }else{
      mdBox.innerHTML = '<p class="rp-muted">未生成 AI 总结。可先在报表点「AI 总结」，再导出含总结的报告。</p>';
    }
    layer.__report = rep;
  }).catch(function(ex){
    if(layer.isConnected) body.innerHTML = UI.errorState(ex && ex.message ? ex.message : "报告整理失败");
  });
  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-report-close]")){ UI.closeModal(layer); return; }
    var item = e.target.closest("[data-inv-export-fmt]");
    if(!item) return;
    var rep = layer.__report;
    if(!rep){ toast("报告还在整理，请稍候", "warn"); return; }
    var fmt = item.dataset.invExportFmt;
    if(fmt === "md"){ triggerDownload(reportFileName("md"), reportMarkdown(rep), "text/markdown;charset=utf-8"); toast("已导出报告 Markdown", "fs"); }
    else if(fmt === "doc"){ triggerDownload(reportFileName("doc"), "\ufeff" + reportDocHTML(rep, true), "application/msword;charset=utf-8"); toast("已导出报告 Word", "fs"); }
    else if(fmt === "pdf"){ printReport(rep); }
  });
  UI.openModal(layer);
}

/* ---------- 事件 ---------- */
function onInvestmentClick(e){
  var mode = e.target.closest("[data-inv-mode]");
  if(mode){
    if(state.mode === mode.dataset.invMode) return;
    state.mode = mode.dataset.invMode;
    ensurePeriod();
    loadInvestment();
    return;
  }
  var dim = e.target.closest("[data-inv-dim]");
  if(dim){
    if(state.dim === dim.dataset.invDim) return;
    state.dim = dim.dataset.invDim;
    renderInvestment();
    return;
  }
  var metric = e.target.closest("[data-inv-metric]");
  if(metric){
    if(state.metric === metric.dataset.invMetric) return;
    state.metric = metric.dataset.invMetric;
    renderInvestment();
    return;
  }
  if(e.target.closest("[data-inv-ai]")){ runAiSummary(); return; }
  var exportBtn = e.target.closest("[data-inv-export]");
  if(exportBtn){ openExportMenu(exportBtn); return; }
  var memberBtn = e.target.closest("[data-inv-member]");
  if(memberBtn){ openMemberPicker(memberBtn); return; }
  var removeMember = e.target.closest("[data-inv-member-remove]");
  if(removeMember){
    var rid = removeMember.dataset.invMemberRemove;
    filters.memberUserIds = (filters.memberUserIds || []).filter(function(id){ return id !== rid; });
    loadInvestment();
    return;
  }
  if(e.target.closest("[data-inv-csv]")){ exportCsv(); return; }
  if(e.target.closest("[data-inv-clear]")){
    filters = { reqId:"", companyName:"", roleTitle:"", memberUserIds:[] };
    loadInvestment();
    return;
  }
  if(e.target.closest("[data-empty-action]")){
    if(!filters.reqId && !filters.companyName && !filters.roleTitle && !(filters.memberUserIds || []).length) loadInvestment();
    else { filters = { reqId:"", companyName:"", roleTitle:"", memberUserIds:[] }; loadInvestment(); }
    return;
  }
  var kpi = e.target.closest("[data-inv-kpi]");
  if(kpi){
    /* 卡片里的「?」只打开口径说明，不再触发下钻 */
    if(!e.target.closest(".caliber-mark")) openMemberDrill();
    return;
  }
  var monthCol = e.target.closest("[data-inv-month]");
  if(monthCol){ openMonthDrill(monthCol.dataset.invMonth); return; }
  var row = e.target.closest("[data-inv-row]");
  if(row) openDrill(pivotRows[Number(row.dataset.invRow)]);
}
function onInvestmentChange(e){
  var id = e.target.id;
  if(id === "invYearSelect"){
    state.year = Number(e.target.value) || state.year;
    loadInvestment();
  }else if(id === "invQuarterSelect"){
    state.quarter = Number(e.target.value) || state.quarter;
    loadInvestment();
  }else if(id === "invFromInput" || id === "invToInput"){
    if(!e.target.value) return;
    var from = id === "invFromInput" ? e.target.value : state.customFrom;
    var to = id === "invToInput" ? e.target.value : state.customTo;
    if(from > to){
      toast("开始日期不能晚于结束日期，已恢复原区间", "warn");
      e.target.value = id === "invFromInput" ? state.customFrom : state.customTo;
      return;
    }
    state.customFrom = from;
    state.customTo = to;
    loadInvestment();
  }else if(id === "invProjectSelect"){
    filters.reqId = e.target.value;
    loadInvestment();
  }else if(id === "invCompanySelect"){
    filters.companyName = e.target.value;
    loadInvestment();
  }else if(id === "invRoleSelect"){
    filters.roleTitle = e.target.value;
    loadInvestment();
  }
}
function onInvestmentKeydown(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var kpi = e.target.closest && e.target.closest("[data-inv-kpi]");
  if(kpi && kpi === e.target){
    e.preventDefault();
    openMemberDrill();
    return;
  }
  var monthCol = e.target.closest && e.target.closest("[data-inv-month]");
  if(monthCol && monthCol === e.target){
    e.preventDefault();
    openMonthDrill(monthCol.dataset.invMonth);
    return;
  }
  var row = e.target.closest && e.target.closest("[data-inv-row]");
  if(!row) return;
  e.preventDefault();
  openDrill(pivotRows[Number(row.dataset.invRow)]);
}

if($("investmentBody")){
  $("investmentBody").addEventListener("click", onInvestmentClick);
  $("investmentBody").addEventListener("change", onInvestmentChange);
  $("investmentBody").addEventListener("keydown", onInvestmentKeydown);
}
["ds:project-roles-changed", "ds:member-company-changed", "ds:member-job-title-changed",
  "ds:member-label-options-changed", "ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(e){
    var detail = e && e.detail || {};
    if(detail.workspaceId && detail.workspaceId !== investmentWorkspace()) return;
    options = {};
    seq++;
    if(document.body.dataset.view === "investment") loadInvestment({ silent:true });
  });
});

export { enterInvestmentView, loadInvestment };
