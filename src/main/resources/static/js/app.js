/* ==========================================================================
   app.js · 工作台前端主程序（按 ui-redesign-spec v1.0 重构）
   硬约束：不改变任何后端接口的路径 / 入参 / 出参 / 语义；功能只增不减。
   ========================================================================== */
(function () {
"use strict";

var UI = window.UI;
var icon = window.icon;
var esc = UI.esc;
var toast = UI.toast;
var toastAction = UI.toastAction;
var copyToClipboard = UI.copyText;
/* 与只读分享页共用的甘特纯函数（日期 / 刻度表头 / 依赖线几何） */
var GS = window.GanttShared;

/* ==================== 常量 ==================== */
/* 默认列定义：服务端列定义返回后就地覆盖（syncColumns） */
var COLUMNS = [
  {id:"backlog", name:"待处理", color:"#98A2B3"},
  {id:"doing",   name:"进行中", color:"#2E90FA"},
  {id:"done",    name:"已完成", color:"#12B76A", done:true}
];
var COL_INDEX = {};
function rebuildColIndex(){
  COL_INDEX = {};
  COLUMNS.forEach(function(c, i){ COL_INDEX[c.id] = i; });
}
rebuildColIndex();
function syncColumns(defs){
  if(!defs || !defs.length) return;
  COLUMNS.length = 0;
  defs.forEach(function(d){
    COLUMNS.push({ id:d.id, name:d.name, color:d.color || "#98A2B3", done: !!d.done });
  });
  rebuildColIndex();
}
var PRIORITIES = ["P0","P1","P2","P3"];
var PRIORITY_COLOR = {P0:"#F04438", P1:"#F79009", P2:"#2E90FA", P3:"#98A2B3"};
/* 预设色板（§2.1.5）与头像哈希色板（§4.6） */
var PALETTE = ["#2563EB","#12B76A","#F79009","#F04438","#7A5AF8","#0E9384","#DD2590","#98A2B3"];
var AVATAR_COLORS = PALETTE.slice();
var CAT_DEFAULT_COLOR = "#98A2B3";
var BACKUP_NAME = "devstudio-kanban-backup.json";
var OWNER_DEFAULT = "我";
var REQ_STATUS = [
  {id:"active", name:"进行中"},
  {id:"done",   name:"已交付"},
  {id:"hold",   name:"已搁置"}
];

/* ==================== 日期 / 格式化 ==================== */
function startOfDay(d){ return GS.startOfDay(d); }
function addDays(d, n){ return GS.addDays(d, n); }
/* 工作日：向后累计 n 个工作日，自动跳过周六 / 周日。
   「一周后」按 5 个工作日算 —— 若按 7 个自然日，周五点"一周后"会落到下周五，
   中间那个周末白算了两天，排期上不合理。 */
function addWorkdays(from, n){
  var d = startOfDay(from), left = Number(n) || 0;
  while(left > 0){
    d = addDays(d, 1);
    var w = d.getDay();
    if(w !== 0 && w !== 6) left--;
  }
  return d;
}
/* 日期预设值 → 日期：w5 = 5 个工作日，其余按自然日；空值 = 无期限。
   三处「今天/明天/一周后/无期限」共用这一份口径，避免各写各的。 */
function duePresetDate(v){
  if(v === "" || v == null) return null;
  if(v === "w5") return iso(addWorkdays(TODAY, 5));
  return iso(addDays(TODAY, Number(v)));
}
/* 开始日期预设：0 = 今天、-1 = 昨天、week = 本周一（周日算作上一周的周一）、空 = 清空 */
function startPresetDate(v){
  if(v === "" || v == null) return null;
  if(v === "week"){
    var w = TODAY.getDay();
    if(w === 0) w = 7;
    return iso(addDays(TODAY, 1 - w));
  }
  return iso(addDays(TODAY, Number(v)));
}
function iso(d){ return GS.iso(d); }
function pad2(n){ return GS.pad2(n); }
function parseDate(s){ return GS.parseDate(s); }
function dayDiff(a, b){ return GS.dayDiff(a, b); }
/* 日期格式化：一律容忍 null —— 后端某些历史数据 completedAt / dueDate 可能为空，
   之前 fmtMD(parseDate(null)) 会抛 getMonth of null，把整个视图渲染打断。 */
function fmtMD(d){ return GS.fmtMonthDay(d); }
function fmtShortMD(d){ return GS.fmtShortMonthDay(d); }
function fmtFull(d){ return GS.fmtFullDate(d); }
function weekdayCN(d){ return d ? ("周"+"日一二三四五六".charAt(d.getDay())) : ""; }
function fmtTs(s){
  if(!s) return "";
  var d = new Date(s);
  if(isNaN(d.getTime())) return String(s);
  return pad2(d.getMonth()+1)+"-"+pad2(d.getDate())+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());
}
function fmtMinutes(total){
  var m = Number(total) || 0;
  if(m < 60) return m + " 分钟";
  var h = Math.floor(m/60), rest = m % 60;
  return h + " 小时" + (rest ? (" " + rest + " 分") : "");
}
function fmtMinutesShort(total){
  var m = Number(total) || 0;
  if(!m) return "—";
  if(m < 60) return m + "m";
  var h = Math.floor(m/60), rest = m % 60;
  return h + "h" + (rest ? (rest + "m") : "");
}
/* 正在计时的实时工时：刚开表时显示 0m 而不是「—」（"—"看着像没在计时） */
function fmtElapsed(total){
  var m = Number(total) || 0;
  return m < 1 ? "0m" : fmtMinutesShort(m);
}
function fmtSize(bytes){
  var b = Number(bytes) || 0;
  if(b < 1024) return b + " B";
  if(b < 1024*1024) return (b/1024).toFixed(0) + " KB";
  return (b/1024/1024).toFixed(1) + " MB";
}
function recurLabel(type){
  if(type === "daily") return "每天";
  if(type === "weekly") return "每周";
  if(type === "monthly") return "每月";
  return "";
}
/* 少量 Markdown：**加粗** 与 `代码`（先转义再替换，安全） */
function mdLite(text){
  if(!text) return "";
  var s = esc(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
function avatarColor(name){
  name = name || "?";
  var h = 0;
  for(var i = 0; i < name.length; i++) h = (h*31 + name.charCodeAt(i)) % 9973;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initial(name){ return name ? String(name).charAt(0) : "?"; }
function avatarHTML(name, cls){
  return '<span class="avatar' + (cls ? " " + cls : "") + '" style="--a:' + avatarColor(name) + '" aria-hidden="true">' +
    esc(initial(name)) + '</span>';
}
function colMeta(id){
  for(var i = 0; i < COLUMNS.length; i++) if(COLUMNS[i].id === id) return COLUMNS[i];
  return null;
}
function colName(id){
  var c = colMeta(id);
  return c ? c.name : id;
}
function reqStatusName(id){
  for(var i = 0; i < REQ_STATUS.length; i++) if(REQ_STATUS[i].id === id) return REQ_STATUS[i].name;
  return "进行中";
}
/* 十六进制 → RGB / rgba / 加深色：分类与列色为自由色值时的派生配色 */
function hexToRgb(hex){
  var h = String(hex || "").replace("#","");
  if(h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
  if(!/^[0-9a-fA-F]{6}$/.test(h)) return {r:152,g:162,b:179};
  return {r:parseInt(h.substr(0,2),16), g:parseInt(h.substr(2,2),16), b:parseInt(h.substr(4,2),16)};
}
function rgbaOf(hex, a){ var c = hexToRgb(hex); return "rgba("+c.r+","+c.g+","+c.b+","+a+")"; }
function darken(hex, k){
  var c = hexToRgb(hex), f = 1 - (k == null ? .30 : k);
  return "rgb("+Math.round(c.r*f)+","+Math.round(c.g*f)+","+Math.round(c.b*f)+")";
}

/* ==================== 全局状态（§9.3） ==================== */
var TODAY = startOfDay(new Date());
var TODAY_ISO = iso(TODAY);

var state = {
  q:"", owners:[], pris:[], cats:[], reqs:[], tags:[],
  due:null, focus:false, doneScope:"week", blocked:false,
  board:null, doneExtra:[], loadSeq:0, boardGen:0,
  reviewData:null, statsWeeks:8, flowDays:90, workScope:"mine", reviewWork:null,
  mineScope:"open", mineSpace:"", minePri:"", mineBlocked:false,
  collapsedCols:{}, inlineAdd:null,
  runningTimer:null, compMonth:null, reqDocId:null
};
var categoriesCache = [];
var reqList = [];
var reqsLoaded = false;
var formReqStatus = "active";
var editingReqId = null;
var formPri = "P2";
var formCat = "";
var formRecur = "";
var tagsCache = [];
var editingId = null;
var taskFormSeq = 0;
var formDirty = false;
var resetArmed = null;
var suppressClickUntil = 0;
var currentUser = null;
var currentWs = null;
var allWorkspaces = [];
var wsMembersCache = [];
var savedViews = [];
var inviteCache = [];
var colDefsCache = [];
var catDefsCache = [];
var settingsReady = false;
var subtasksCache = [];
var taskCacheExtra = {};   // 抽屉/提醒面板里用到但不在看板分页内的任务
var listCache = {};
var listSeq = 0;
var listSelected = {};
var listTotal = 0;
var calState = {year:null, month:null, tasks:[], selected:null, seq:0};
var reviewSeq = 0, reviewTarget = null;

function safeColor(c){
  return /^#[0-9a-f]{6}$/i.test(String(c == null ? "" : c)) ? c : CAT_DEFAULT_COLOR;
}
function catColor(name){
  for(var i = 0; i < categoriesCache.length; i++){
    if(categoriesCache[i].name === name) return safeColor(categoriesCache[i].color);
  }
  return CAT_DEFAULT_COLOR;
}
/* 分类标签：底色取分类色 9%，文字取加深色，左圆点同色 */
function catTag(name){
  if(!name) return "";
  var color = catColor(name);
  return '<span class="tag" style="background:' + rgbaOf(color,.09) + ';color:' + darken(color) +
    ';border-color:' + rgbaOf(color,.22) + '">' +
    '<i class="dot" style="background:' + color + '"></i>' + esc(name) + '</span>';
}
function tagChip(name){
  return '<span class="tag tag-ghost">' + esc(name) + '</span>';
}

/* ==================== DOM 引用 ==================== */
function $(id){ return document.getElementById(id); }
var board = $("board");
var taskDrawer = $("taskDrawer");
var taskForm = $("taskForm");
var iTitle = $("iTitle"), iDesc = $("iDesc"), iStart = $("iStart"), iDue = $("iDue"), iCol = $("iCol"),
    iEstimate = $("iEstimate"), iActual = $("iActual"),
    iReq = $("iReq"), iProg = $("iProg"), progVal = $("progVal"), iNote = $("iNote"),
    iRemind = $("iRemind"), iOwner = $("iOwner"), iTags = $("iTags"), iBranch = $("iBranch"),
    tagWrap = $("tagWrap"), subList = $("subList"), subCount = $("subCount"),
    iSubNew = $("iSubNew"), attachList = $("attachList"), attachCount = $("attachCount"),
    iAttachFile = $("iAttachFile"), workVal = $("workVal"), btnTimer = $("btnTimer"),
    timelineBox = $("timelineBox"), btnSaveTask = $("btnSaveTask"), btnDeleteTask = $("btnDeleteTask"),
    taskDrawerTitle = $("taskDrawerTitle"), taskFormHint = $("taskFormHint"),
    fTitle = $("fTitle"), fSubtasks = $("fSubtasks"), fAttach = $("fAttach"),
    fWork = $("fWork"), fTimeline = $("fTimeline"),
    segPri = $("segPri"), segCat = $("segCat"), segDue = $("segDue"), segStart = $("segStart"),
    segProg = $("segProg"), segRecur = $("segRecur");
var searchInput = $("searchInput"), searchWrap = $("searchWrap");
var viewTitle = $("viewTitle"), brandSub = $("brandSub");
var chipsOwner = $("chipsOwner"), chipsPri = $("chipsPri");
var filterActions = $("filterActions"), selectedSummary = $("selectedSummary");
var moreFilterMenu = $("moreFilterMenu"), moreFilterCount = $("moreFilterCount");
var viewBox = $("viewBox");
var reqListEl = $("reqList"), reqDot = $("reqDot");
var branchDot = $("branchDot");
/* 报告增量（O-1/O-4/O-5/O-6/O-9/O-10/O-11/O-12/N-1/N-3/N-4/N-6）新增引用 */
var iRemindTarget = $("iRemindTarget"), iBlocked = $("iBlocked"), iBlockedReason = $("iBlockedReason");
var fComments = $("fComments"), commentList = $("commentList"), commentCount = $("commentCount"),
    iComment = $("iComment"), btnCommentSend = $("btnCommentSend");
var commentSending = false;
var drawerNotice = $("drawerNotice"), drawerNoticeText = $("drawerNoticeText"),
    drawerNoticeReload = $("drawerNoticeReload");
var offlineBadge = $("offlineBadge");
var segWorkScope = $("segWorkScope"), statsHoursEl = $("statsHours"),
    workScopeTag = $("workScopeTag"), hoursNote = $("hoursNote");
var reviewHoursEl = $("reviewHours"), reviewPendingBox = $("reviewPendingBox"),
    pendingList = $("pendingList"), pendingCount = $("pendingCount"),
    progCountEl = $("progCount"), doneCountEl = $("doneCount");
var unplannedBox = $("unplannedBox"), unplannedCount = $("unplannedCount"), unplannedList = $("unplannedList");
var mineBody = $("mineBody"), mineMeta = $("mineMeta"), mineScope = $("mineScope"),
    btnMineRefresh = $("btnMineRefresh"), mineDot = $("mineDot"),
    mineSpaceFilter = $("mineSpaceFilter"), minePriFilter = $("minePriFilter"),
    mineBlockedChip = $("mineBlockedChip");
var listBulkBar = $("listBulkBar");
var actList = $("actList"), actCount = $("actCount");
var channelCards = $("channelCards"), notifyStatus = $("notifyStatus"),
    notifyStatusText = $("notifyStatusText"), btnNotifySave = $("btnNotifySave"),
    wsWebhookHint = $("wsWebhookHint"), wsWebhookLabel = $("wsWebhookLabel");
var notifyInfo = null;        // GET /api/notify/status 结果
var pickedChannel = "";       // 设置页当前选中的渠道卡（保存时写入空间配置）

/* ==================== 视图路由 ==================== */
var activeView = "board";
var VIEWS = {
  mine:     { title:"我的任务", sub:"跨空间汇总「分派给我」的待办（按账号归属）", enter:enterMineView },
  board:    { title:"任务看板", sub:null, enter:null },
  list:     { title:"任务列表", sub:"沿用当前筛选条件，点击行打开详情抽屉", enter:enterListView },
  calendar: { title:"日历",     sub:"按 [开始日期, 实际结束日] 逐日铺开；点任务开详情，格子可新建", enter:enterCalendarView },
  gantt:    { title:"甘特图",   sub:"按开始/截止日期排布任务；拖动条改期，拖两端调起止", enter:enterGanttView },
  projects: { title:"项目",     sub:"把任务归入项目，筛选栏可按项目查看全部工作", enter:enterProjectsView },
  requirements: { title:"需求", sub:"项目下的需求文档：在这里写清楚要做什么，任务可以关联到某份需求", enter:enterRequirementsView },
  branches: { title:"分支", sub:"一条分支从开发到发布：改状态就留时间，谁卡在哪一步一眼看到", enter:enterBranchesView },
  review:   { title:"工作回顾", sub:"按周自动总结完成与进展", enter:enterReviewView },
  completions: { title:"任务清单", sub:"任务完成时自动归档：项目、负责人、起止时间与总耗时，可按月统计并导出", enter:enterCompletionsView },
  stats:    { title:"统计报表", sub:"新增 / 完成趋势、当前指标与分布", enter:enterStatsView },
  flow:     { title:"流程体检", sub:"用日志里的真实移动痕迹，算清哪一列最堵、返工多少、需求多久才开工", enter:enterFlowView },
  trash:    { title:"回收站",   sub:"删除的任务保留 30 天，之后自动清理", enter:enterTrashView },
  users:    { title:"用户管理", sub:"账号由管理员创建下发；成员可凭邀请链接自助加入", enter:enterUsersView },
  settings: { title:"设置",     sub:"空间、成员与邀请、看板列、分类与数据管理", enter:enterSettingsView },
  profile:  { title:"个人设置", sub:"账号信息、计时规则、AI 额度与密码", enter:enterProfileView }
};
function showView(name){
  if(!VIEWS[name]) return;
  activeView = name;
  document.body.dataset.view = name;
  var nav = $("sideNav");
  if(nav){
    nav.querySelectorAll("[data-view]").forEach(function(b){
      var on = b.dataset.view === name;
      b.classList.toggle("on", on);
      if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
    });
  }
  document.querySelectorAll(".view").forEach(function(s){
    s.classList.toggle("on", s.id === "view-" + name);
  });
  if(viewTitle) viewTitle.textContent = VIEWS[name].title;
  document.title = VIEWS[name].title + " · 工作台";
  updateBrand();
  UI.closeAllPops();
  syncViewHash(name);
  try{ localStorage.setItem("ds.view", name); }catch(e){ /* 隐私模式忽略 */ }
  if(VIEWS[name].enter) VIEWS[name].enter();
  /* 看板不在当前视图时只置脏，切回来再渲染一次 */
  if(name === "board" && boardDirty){ boardDirty = false; render({animate:false}); }
}
function viewFromHash(){
  var name = String(window.location.hash || "").replace(/^#\/?/, "");
  return VIEWS[name] ? name : "board";
}
var suppressHashSync = false;
function syncViewHash(name){
  if(suppressHashSync) return;
  var h = "#/" + name;
  if(window.location.hash === h) return;
  /* pushState：让浏览器后退能回到上一个视图；file:// 等受限环境降级为直接改 hash */
  try{ history.pushState(null, "", h); }
  catch(e){ try{ window.location.hash = h; }catch(e2){ /* 完全不可用则忽略 */ } }
}
window.addEventListener("popstate", function(){
  var n = viewFromHash();
  /* 后退时正在编辑需求且未保存：留在编辑页并问是否保存，避免静默丢正文 */
  if(n !== activeView && activeView === "requirements"
      && $("reqDocEditPage") && !$("reqDocEditPage").hidden && reqDocDirty){
    try{ history.pushState(null, "", "#/requirements"); }catch(e){ /* noop */ }
    tryCloseReqDocEditor();
    return;
  }
  if(n !== activeView){
    suppressHashSync = true;
    try{ showView(n); } finally { suppressHashSync = false; }
  }
  /* 返回到带 ?task= 的历史项时直接打开对应任务 */
  handleDeepLink();
});
function refreshActiveView(){
  if(activeView === "calendar") loadCalendar({silent:true});
  else if(activeView === "gantt") loadGantt({silent:true});
  else if(activeView === "list") loadList({silent:true});
  else if(activeView === "trash") loadTrash({silent:true});
  else if(activeView === "users") loadUsers(true);
  else if(activeView === "stats") loadStats({silent:true});
  else if(activeView === "flow") loadFlowHealth({silent:true});
  else if(activeView === "projects") loadReqs();
  else if(activeView === "mine") loadMine({silent:true});
  else if(activeView === "completions") loadCompletions({silent:true});
  else if(activeView === "requirements") loadReqDocs();
  else if(activeView === "branches") loadBranches(true).then(renderBranches);
}
$("sideNav").addEventListener("click", function(e){
  var b = e.target.closest("[data-view]");
  if(b) showView(b.dataset.view);
});

/* ==================== 派生计算 ==================== */
function progressOf(t){ return t.boardColumn === "done" ? 100 : (Number(t.progress) || 0); }
/* 只有「待处理」「已完成」以外的列才能计时 —— 与后端 move 的自动计时判断保持一致。
   回退到待处理：已记录的工时保留，但不能再继续计。 */
function timerAllowed(t){
  if(!t) return false;
  return t.boardColumn !== "backlog" && t.boardColumn !== "done";
}
function dueState(t){
  if(!t.dueDate) return {kind:"none"};
  if(t.boardColumn === "done") return {kind:"done"};
  var d = dayDiff(parseDate(t.dueDate), TODAY);
  if(d < 0)   return {kind:"over", n:Math.abs(d)};
  if(d === 0) return {kind:"today", n:0};
  if(d <= 3)  return {kind:"soon", n:d};
  return {kind:"ok", n:d};
}
function dueText(t){
  var s = dueState(t);
  if(s.kind === "none")  return "未设截止";
  if(s.kind === "done")  return "已完成 " + fmtShortMD(parseDate(t.completedAt || t.dueDate));
  if(s.kind === "over")  return "逾期 " + s.n + " 天";
  if(s.kind === "today") return "今天到期";
  if(s.kind === "soon")  return "剩余 " + s.n + " 天";
  return fmtShortMD(parseDate(t.dueDate));
}
function dueMetaClass(kind){
  if(kind === "over") return "meta over";
  if(kind === "today") return "meta today";
  if(kind === "done") return "meta full";
  return "meta ok";
}
function filterOn(){
  return !!(state.q || state.owners.length || state.pris.length || state.cats.length
    || state.reqs.length || state.tags.length || state.due || state.focus || state.blocked);
}
function selectedFilterCount(){
  var n = 0;
  if(state.q) n++;
  n += state.owners.length + state.pris.length + state.cats.length + state.reqs.length + state.tags.length;
  if(state.due) n++;
  if(state.focus) n++;
  if(state.blocked) n++;
  return n;
}
function totalTaskCount(){
  var n = 0;
  if(state.board){
    COLUMNS.forEach(function(c){
      var cd = state.board.columns[c.id];
      if(cd) n += cd.allTotal;
    });
  }
  return n;
}
function taskById(id){
  if(state.board){
    for(var i = 0; i < COLUMNS.length; i++){
      var cd = state.board.columns[COLUMNS[i].id];
      if(!cd) continue;
      for(var j = 0; j < cd.items.length; j++) if(cd.items[j].id === id) return cd.items[j];
    }
    for(var k = 0; k < state.doneExtra.length; k++) if(state.doneExtra[k].id === id) return state.doneExtra[k];
  }
  return listCache[id] || taskCacheExtra[id] || null;
}
function reqNameById(id){
  if(!id) return "无";
  for(var i = 0; i < reqList.length; i++) if(reqList[i].id === id) return reqList[i].name;
  return "无";
}
function boardParams(extra){
  var p = {
    q: state.q || null,
    owners: state.owners.length ? state.owners : null,
    pris: state.pris.length ? state.pris : null,
    cats: state.cats.length ? state.cats : null,
    reqs: state.reqs.length ? state.reqs : null,
    tags: state.tags.length ? state.tags : null,
    due: state.due || null,
    focus: state.focus ? true : null,
    blocked: state.blocked ? true : null,
    doneScope: state.doneScope
  };
  if(extra){
    for(var k in extra) if(Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
  }
  return p;
}
function updateBrand(){
  if(!brandSub) return;
  if(activeView === "board" && state.board){
    var doing = state.board.columns.doing ? state.board.columns.doing.total : 0;
    brandSub.textContent = (currentWs ? currentWs.name + " · " : "") + doing + " 项进行中 · 共 " + totalTaskCount() + " 项";
  }else{
    brandSub.textContent = VIEWS[activeView] ? (VIEWS[activeView].sub || "") : "";
  }
}

/* ==================== 请求：看板 ==================== */
function showBoardSkeleton(){
  board.classList.remove("busy");
  var h = "";
  for(var i = 0; i < 3; i++){
    h += '<div class="board-col"><div class="board-col-head">' +
      '<span class="skel" style="width:60px;height:12px"></span></div>' +
      '<div class="board-col-body">' + UI.skeletonCards(3) + '</div></div>';
  }
  board.innerHTML = h;
}
function showBoardError(msg){
  board.classList.remove("busy");
  board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:60vh">' +
    UI.errorState(msg) + '</div>';
  bindRetry(board, function(){ state.board = null; loadBoard({animate:true}); });
}
function loadBoard(opts){
  opts = opts || {};
  var seq = ++state.loadSeq;
  if(!opts.silent){
    if(!state.board) showBoardSkeleton();
    else { board.classList.add("busy"); UI.syncBusy(true); opts._busy = true; }
  }
  return API.get("/api/board", boardParams()).then(function(data){
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    state.board = data;
    state.doneExtra = [];
    state.boardGen++;
    syncColumns(data.columnDefs);
    updateTagDatalist();
    loadCategories();
    if(pruneStaleFilters(data.meta)){ loadBoard({silent:true}); return; }
    board.classList.remove("busy");
    render({animate: !!opts.animate});
    /* 卡片上的「计时中」状态来自另一个接口；只有确实有运行中的计时才补一次渲染 */
    loadRunningTimer(function(rt){
      if(rt && seq === state.loadSeq) render({animate:false});
    });
    /* 卡片上的需求名来自需求列表（首次加载后会重绘一次） */
    loadReqDocs();
  }).catch(function(ex){
    if(opts._busy) UI.syncBusy(false);
    if(seq !== state.loadSeq) return;
    board.classList.remove("busy");
    if(!state.board) showBoardError(ex.message || "网络异常，请稍后重试");
    else toast("加载失败：" + (ex.message || "网络异常"), "bad");
  });
}
function loadReqs(){
  return API.get("/api/reqs").then(function(list){
    reqList = list || [];
    reqsLoaded = true;
    populateReqSelect();
    if(activeView === "projects") renderReqList();
  }).catch(function(){
    if(activeView === "projects" && !reqsLoaded && reqListEl){
      reqListEl.innerHTML = UI.errorState("项目加载失败，请稍后重试");
    }
  });
}
function loadMoreDone(){
  var cd = state.board && state.board.columns.done;
  if(!cd || !cd.hasMore) return Promise.resolve(false);
  var gen = state.boardGen;
  var offset = cd.items.length + state.doneExtra.length;
  var listEl = board.querySelector('.board-col[data-col="done"] .board-col-body');
  if(listEl) listEl.classList.add("loading-more");
  UI.syncBusy(true);
  return API.get("/api/tasks/done", boardParams({doneLimit:20, doneOffset:offset})).then(function(page){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen !== state.boardGen) return false;
    var known = {};
    cd.items.forEach(function(t){ known[t.id] = 1; });
    state.doneExtra.forEach(function(t){ known[t.id] = 1; });
    (page.items || []).forEach(function(t){ if(!known[t.id]) state.doneExtra.push(t); });
    cd.matched = page.matched;
    cd.hasMore = (cd.items.length + state.doneExtra.length) < page.matched;
    render({animate:false});
    return true;
  }).catch(function(ex){
    UI.syncBusy(false);
    if(listEl) listEl.classList.remove("loading-more");
    if(gen === state.boardGen) toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
function refreshBoardPreserving(){
  var wanted = state.doneExtra.length;
  loadBoard({silent:true}).then(function(){
    if(wanted === 0) return;
    var tries = 0;
    (function step(){
      var cd = state.board && state.board.columns ? state.board.columns.done : null;
      if(state.doneExtra.length >= wanted || !cd || !cd.hasMore || tries++ > 10) return;
      loadMoreDone().then(function(ok){ if(ok) step(); });
    })();
  });
}

/* ==================== 渲染：任务卡片（§4.7） ==================== */
function cardHTML(t, idx){
  var s = dueState(t);
  var isDone = t.boardColumn === "done";
  var blocked = !!t.blocked;
  /* 只有"我自己"正在计时的任务才高亮；别人的计时在卡上不体现（工时是个人口径） */
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var stripe = isDone ? "var(--success)"
    : (blocked ? "var(--warning)" : (PRIORITY_COLOR[t.priority] || "var(--border-strong)"));
  var tip = t.dueDate ? ("截止 " + fmtFull(parseDate(t.dueDate))) : "未设置截止日期";
  if(isDone && t.completedAt) tip += " · 完成于 " + fmtFull(parseDate(t.completedAt));

  var tagsHTML = catTag(t.category);
  /* 关联需求：点一下跳到需求正文（不打开任务抽屉，所以单独用 data-open-reqdoc） */
  if(t.reqDocId){
    var docTitle = reqDocNameById(t.reqDocId);
    if(docTitle){
      tagsHTML += '<button type="button" class="tag tag-doc" data-open-reqdoc="' + esc(t.reqDocId) + '"' +
        ' title="打开需求：' + esc(docTitle) + '">' + esc(docTitle) + '</button>';
    }
  }
  if(t.branchId){
    /* 分支标签只做展示（点击跳转交给「分支」页，避免卡片上三个标签抢点击） */
    var brName = branchNameById(t.branchId);
    if(brName) tagsHTML += '<span class="tag tag-branch" title="所属分支：' + esc(brName) + '">' +
      icon("branch", 11) + esc(brName) + '</span>';
  }
  if(t.tags && t.tags.length){
    t.tags.slice(0, 2).forEach(function(tg){ tagsHTML += tagChip(tg); });
    if(t.tags.length > 2) tagsHTML += '<span class="tag tag-ghost">+' + (t.tags.length - 2) + '</span>';
  }

  var blockedTag = blocked
    ? '<span class="blocked-tag" title="' + esc(t.blockedReason || "被阻塞（未填原因）") + '">' +
        icon("alert", 12) + '被阻塞</span>'
    : "";

  var metaHTML = "";
  if(t.dueDate) metaHTML += '<span class="' + dueMetaClass(s.kind) + '" title="' + esc(tip) + '">' +
    icon("calSmall", 14) + dueText(t) + '</span>';
  if(t.subtaskTotal){
    var allSub = t.subtaskDone >= t.subtaskTotal;
    metaHTML += '<span class="meta' + (allSub ? " full" : "") + '" title="检查清单进度">' +
      icon("checklist", 14) + t.subtaskDone + '/' + t.subtaskTotal + '</span>';
  }
  if(Number(t.attachmentCount) > 0){
    metaHTML += '<span class="meta" title="附件">' + icon("clip", 14) + t.attachmentCount + '</span>';
  }
  if(Number(t.commentCount) > 0){
    metaHTML += '<span class="meta" title="评论">' + icon("comment", 14) + t.commentCount + '</span>';
  }
  if(t.estimateMinutes){
    /* 有预估就显示「实际/预估」：光看实际用了几小时没人知道自己算不算慢。
       计时中的任务同样要显示 —— 那正是最该知道自己快超了的时候；
       此时实际值只含已结束的段，title 里说明，避免误读。 */
    var actMin = Number(t.totalMinutes) || 0;
    var estR = actMin / t.estimateMinutes;
    var estCls = estR >= 1 ? " over" : (estR >= 0.8 ? " near" : "");
    metaHTML += '<span class="meta est-chip' + estCls + '" title="实际 ' + fmtMinutes(actMin) +
      (running ? '（不含正在计的这一段）' : '') + ' / 预估 ' + fmtMinutes(t.estimateMinutes) + '">' +
      (running ? '' : icon("timer", 14)) +
      fmtMinutesShort(actMin) + '/' + fmtMinutesShort(t.estimateMinutes) + '</span>';
  }else if(t.totalMinutes && !running){
    metaHTML += '<span class="meta' + (isDone ? ' full' : '') + '" title="' + (isDone ? "总耗时" : "累计工时") + '">' +
      icon("timer", 14) + (isDone ? '总耗时 ' : '') + fmtMinutesShort(t.totalMinutes) + '</span>';
  }
  if(running){
    /* 计时中的停止入口放在 meta 行（胶囊按钮）。放右上角会常驻挡住卡片标题 */
    metaHTML = '<button class="timer-chip" type="button" data-timer-toggle="' + esc(t.id) + '" title="点击停止计时">' +
      icon("pause", 12) + '<span>计时中</span><b data-elapsed>' +
      fmtElapsed(state.runningTimer.elapsedMinutes) + '</b></button>' + metaHTML;
  }
  if(t.recurType){
    metaHTML += '<span class="meta" title="循环任务：' + recurLabel(t.recurType) + '">' + icon("recur", 14) + '</span>';
  }
  if(t.remindAt && !isDone){
    metaHTML += '<span class="meta" title="提醒 ' + esc(fmtTs(t.remindAt)) + '">' + icon("bell", 14) + fmtTs(t.remindAt) + '</span>';
  }

  var p = progressOf(t);
  var progHTML = '<div class="progress' + (p >= 100 ? " full" : "") + (s.kind === "over" && p < 100 ? " over" : "") +
    '" title="当前进度 ' + p + '%"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></div>';
  var owner = t.owner || "—";

  return '<article class="card' + (isDone ? " is-done" : "") + (blocked ? " is-blocked" : "") +
      (s.kind === "over" ? " is-over" : "") +
      '" data-id="' + esc(t.id) + '" tabindex="0" role="listitem" draggable="false"' +
      ' style="--stripe:' + stripe + '" aria-label="' + esc(t.title) + '">' +
    '<div class="card-acts">' +
      /* 「开始计时」放动作区（hover 出现）；已在计时时不放 —— 停止入口在 meta 行的胶囊里，
         否则常驻的绿色按钮会盖住卡片标题 */
      ((!running && timerAllowed(t))
        ? '<button class="card-act low" type="button" data-timer-toggle="' + esc(t.id) + '"' +
            ' title="开始计时（会自动暂停其他任务的计时）" aria-label="开始计时：' + esc(t.title) + '">' +
            icon("timer", 13) + '</button>'
        : '') +
      '<button class="card-act low" type="button" data-due-pop="' + esc(t.id) + '" title="改期（快捷键 D）" aria-label="改期：' + esc(t.title) + '">' +
        icon("calSmall", 13) + '</button>' +
      '<button class="card-act always" type="button" data-card-menu="' + esc(t.id) + '" title="更多操作" aria-haspopup="true" aria-label="更多操作：' + esc(t.title) + '">' +
        icon("more", 14) + '</button>' +
    '</div>' +
    '<div class="card-head">' +
      '<span class="pri-mark">' +
        '<span class="card-tickwrap">' +
          (isDone
            ? '<span class="pdot-ico" style="color:var(--success)">' + icon("check", 13) + '</span>'
            : '<span class="pdot ' + esc(t.priority) + '"><i></i></span>') +
          '<button class="card-tick" type="button" data-done-toggle="' + esc(t.id) + '"' +
            ' title="' + (isDone ? "取消完成（快捷键 X）" : "标记完成（快捷键 X）") + '"' +
            ' aria-label="' + (isDone ? "取消完成" : "标记完成") + '：' + esc(t.title) + '">' +
            icon(isDone ? "undo" : "check", 11) + '</button>' +
        '</span>' +
        (isDone ? '' : '<span class="pdot ' + esc(t.priority) + '">' + esc(t.priority) + '</span>') +
      '</span>' +
      '<h3 class="card-title">' + esc(t.title) + '</h3>' +
    '</div>' +
    (t.description ? '<p class="card-desc">' + mdLite(t.description) + '</p>' : '') +
    ((tagsHTML || blockedTag) ? '<div class="card-tags">' + blockedTag + tagsHTML + '</div>' : '') +
    (metaHTML ? '<div class="card-meta">' + metaHTML + '</div>' : '') +
    '<div class="card-foot">' + progHTML +
      '<span title="负责人：' + esc(owner) + '">' + avatarHTML(owner) + '</span>' +
    '</div>' +
  '</article>';
}
function cardAddHTML(colId){
  return '<button class="card-add" type="button" data-add="' + esc(colId) + '" aria-label="在「' + esc(colName(colId)) + '」新增任务">' +
    icon("plus", 13) + ' 添加任务</button>';
}

/* ==================== 渲染：看板 ==================== */
var boardDirty = false;
function render(opts){
  opts = opts || {};
  updateBrand();
  /* 不在看板视图时只置脏：避免甘特/列表视图下后台反复重建整块 DOM */
  if(activeView !== "board"){
    boardDirty = true;
    return;
  }
  boardDirty = false;
  UI.hideTip();
  if(!state.board) return;

  var scrollMemo = {}, boardLeft = board.scrollLeft;
  board.querySelectorAll(".board-col-body").forEach(function(el){
    var col = el.closest(".board-col");
    if(col) scrollMemo[col.dataset.col] = el.scrollTop;
  });

  board.innerHTML = "";
  var movedId = opts.movedId || null;

  if(totalTaskCount() === 0 && !filterOn()){
    board.innerHTML = '<div style="flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:70vh;width:100%">' +
      UI.emptyState({
        icon:"board",
        title:"看板还是空的",
        text:"新建一个任务，或用快捷键 <b>N</b> 快速录入。<br>数据保存在服务器，多端实时同步。",
        actionLabel:"新建第一项任务"
      }) + '</div>';
    bindRetry(board, function(){ openTaskDrawer("backlog"); });
    renderAlertBar(); renderFilterChips();
    return;
  }

  COLUMNS.forEach(function(c){
    var cd = state.board.columns[c.id] || {items:[], matched:0, total:0, allTotal:0, hasMore:false};
    var items = cd.items.slice();
    if(c.id === "done" && state.doneExtra.length) items = items.concat(state.doneExtra);
    var collapsed = !!state.collapsedCols[c.id];

    var col = document.createElement("section");
    col.className = "board-col" + (collapsed ? " collapsed" : "");
    col.dataset.col = c.id;

    var isCustom = (c.id !== "backlog" && c.id !== "doing" && c.id !== "done");
    var head = '<div class="board-col-head">' +
      '<span class="col-dot" style="background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"' +
        (isCustom ? ' role="button" tabindex="0" data-col-color="' + esc(c.id) + '" title="修改列颜色"' : '') + '></span>' +
      '<span class="col-name" data-col-rename="' + esc(c.id) + '"' +
        (c.done ? '' : ' role="button" tabindex="0" title="点击改名"') + '>' + esc(c.name) + '</span>' +
      '<span class="col-count" aria-live="polite">' + (filterOn() ? (cd.matched + "/" + cd.total) : cd.total) + '</span>' +
      '<span class="sp"></span>' +
      '<button class="icon-btn sm" type="button" data-col-add="' + esc(c.id) + '" title="在「' + esc(c.name) + '」新增任务" aria-label="在「' + esc(c.name) + '」新增任务">' + icon("plus", 14) + '</button>' +
      '<button class="icon-btn sm" type="button" data-col-fold="' + esc(c.id) + '" title="' + (collapsed ? "展开" : "折叠") + '列" aria-label="' + (collapsed ? "展开" : "折叠") + '列" aria-expanded="' + (!collapsed) + '">' +
        icon(collapsed ? "right" : "caretDown", 14) + '</button>' +
    '</div>';

    var body = '<div class="board-col-body" role="list">';
    if(!items.length){
      var emptyText, emptyIc;
      if(filterOn()){ emptyText = "无匹配任务"; emptyIc = "filterOff"; }
      else if(c.done && state.doneScope === "week" && cd.allTotal){ emptyText = "本周还没有完成的任务"; emptyIc = "checkCircle"; }
      else { emptyText = "拖动卡片到这里"; emptyIc = "inbox"; }
      body += '<div class="col-empty">' + icon(emptyIc, 18) + emptyText + '</div>';
    }else{
      items.forEach(function(t, i){ body += cardHTML(t, i); });
    }
    if(c.done && cd.hasMore){
      body += '<button class="col-more" type="button" data-more="1">加载更多（还有 ' +
        Math.max(cd.matched - items.length, 0) + ' 项）</button>';
    }
    body += cardAddHTML(c.id);
    body += '</div>';

    var foot = "";
    if(c.done){
      var scopeLabel = state.doneScope === "week"
        ? ("仅本周 ⇄ 显示全部（共 " + cd.allTotal + "）")
        : "显示全部 ⇄ 仅本周";
      foot = '<div class="col-foot">' +
        '<button class="col-scope' + (state.doneScope === "week" ? " on" : "") + '" type="button" data-scope="1" title="切换「仅本周 / 全部」">' +
          esc(scopeLabel) + '</button>' +
      '</div>';
    }

    col.innerHTML = head + body + foot;
    board.appendChild(col);

    var listEl = col.querySelector(".board-col-body");
    if(scrollMemo[c.id] != null) listEl.scrollTop = scrollMemo[c.id];
  });

  board.scrollLeft = boardLeft;

  if(state.inlineAdd && state.inlineAdd.col){
    openInlineAdd(state.inlineAdd.col, state.inlineAdd.value, false);
  }

  if(movedId){
    var el = board.querySelector('.card[data-id="' + movedId + '"]');
    if(el){
      el.classList.add("just-moved");
      if(el.scrollIntoView) el.scrollIntoView({block:"nearest", inline:"nearest"});
      try{ el.focus({preventScroll:true}); }catch(e){ /* noop */ }
    }
  }
  renderAlertBar();
  renderFilterChips();
  UI.wireTooltips(board);
}

/* ==================== 内联新增（列内） ==================== */
function openInlineAdd(colId, preset, focusIt){
  var col = board.querySelector('.board-col[data-col="' + colId + '"]');
  if(!col) return;
  var addBtn = col.querySelector(".card-add");
  if(!addBtn) return;
  var input = document.createElement("input");
  input.className = "card-add-input";
  input.type = "text";
  input.maxLength = 120;
  input.placeholder = "输入标题后回车创建…（!P0 / #项目 / @负责人 / +标签 / %进度 / ~每周 / 明天）";
  input.value = preset || "";
  input.setAttribute("aria-label", "在「" + colName(colId) + "」新增任务");
  input._restore = addBtn;

  var hint = document.createElement("div");
  hint.className = "foot-note";
  hint.style.marginTop = "4px";
  hint.hidden = true;

  addBtn.replaceWith(input);
  input.parentNode.insertBefore(hint, input.nextSibling);

  function restore(){
    state.inlineAdd = null;
    if(hint.parentNode) hint.remove();
    if(input._restore && input.parentNode) input.replaceWith(input._restore);
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){
      e.preventDefault();
      var v = input.value.trim();
      if(!v) return;
      state.inlineAdd = {col: colId, value: ""};
      inlineAddCreate(colId, v, input);
    }else if(e.key === "Escape"){
      e.preventDefault();
      restore();
    }
  });
  input.addEventListener("input", function(){
    if(state.inlineAdd) state.inlineAdd.value = input.value;
    /* O-24：#项目名 没命中时给即时提示，而不是静默把它留在标题里 */
    var q = parseQuickAdd(input.value);
    if(q.unmatchedReq){
      hint.textContent = "未找到项目「" + q.unmatchedReq + "」，这段文字会留在标题里（可改用抽屉里的项目下拉）";
      hint.hidden = false;
    }else if(q.unmatchedOwner){
      hint.textContent = "未找到成员「" + q.unmatchedOwner + "」，负责人未设置（这段文字会留在标题里）";
      hint.hidden = false;
    }else if(q.invalidDate){
      hint.textContent = "日期「" + q.invalidDate + "」不存在，不会设置截止日期";
      hint.hidden = false;
    }else{
      hint.hidden = true;
    }
  });
  input.addEventListener("blur", function(){
    setTimeout(function(){
      if(document.activeElement === input) return;
      if(state.inlineAdd && state.inlineAdd.value) return; // 有未提交内容时保留
      restore();
    }, 140);
  });
  if(focusIt !== false){
    try{ input.focus(); input.setSelectionRange(input.value.length, input.value.length); }catch(e){ /* noop */ }
  }
}
function inlineAddCreate(colId, title, input){
  var q = parseQuickAdd(title);
  var payload = {
    title: q.title || title,
    priority: q.priority || "P2",
    boardColumn: colId,
    dueDate: q.dueDate || null,
    reqId: q.reqId || null,
    progress: q.progress == null ? 0 : q.progress,
    owner: q.owner || null,
    ownerUserId: q.ownerUserId || null,
    tags: q.tags || [],
    recurType: q.recurType || ""
  };
  if(q.invalidDate) toast("日期「" + q.invalidDate + "」不存在，未设置截止日期", "warn");
  input.disabled = true;
  API.post("/api/tasks", payload).then(function(nt){
    input.disabled = false;
    input.value = "";
    state.inlineAdd = {col: colId, value: ""};
    var tip = "已创建「" + nt.title + "」到「" + colName(colId) + "」";
    if(nt.dueDate) tip += " · 截止 " + nt.dueDate;
    if(q.priority) tip += " · " + q.priority;
    if(q.owner) tip += " · 负责人 " + q.owner;
    if(q.tags && q.tags.length) tip += " · 标签 " + q.tags.join("/");
    if(q.recurType) tip += " · " + (RECUR_LABEL[q.recurType] || "循环");
    taskCacheExtra[nt.id] = nt;
    loadBoard({animate:true, movedId: nt.id});
    loadReqs();
    toast(tip, "fs");
  }).catch(function(ex){
    input.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
}

/* ==================== 通知中心 / 提醒计数（R-1） ====================
   铃铛 = 通知中心：一个面板两个 tab（应用内通知 / 截止提醒）。
   · 角标数字 = 未读通知数（跨空间口径，与「我的任务」一致）
   · 橙色小圆点 = 有逾期或今天到期的任务（原来的角标语义独立出来，信息不丢）
   通知是增强能力：任何失败都静默，绝不影响主流程。 */
var NOTIFY_ICON = {
  task_remind: "clock",
  task_due: "alert",
  task_assigned: "user",
  task_comment: "comment"
};
var notifyState = {unread:0, items:[], loading:false};
var deadlineGroups = {over:[], today:[], soon:[]};
var alertTab = "notice";
try{ alertTab = localStorage.getItem("ds.alertTab") === "due" ? "due" : "notice"; }
catch(e){ alertTab = "notice"; }

function renderAlertBar(){
  var c = state.board ? state.board.counts : {over:0, today:0, soon:0};
  $("nOver").textContent = c.over;
  $("nToday").textContent = c.today;
  $("nSoon").textContent = c.soon;

  var chipOver = $("chipOver"), chipToday = $("chipToday"), chipSoon = $("chipSoon"), chipFocus = $("chipFocus");
  chipOver.setAttribute("aria-pressed", state.due === "over");
  chipToday.setAttribute("aria-pressed", state.due === "today");
  chipSoon.setAttribute("aria-pressed", state.due === "soon");
  chipFocus.setAttribute("aria-pressed", state.focus);

  chipOver.hidden  = !(c.over > 0 || state.due === "over");
  chipToday.hidden = !(c.today > 0 || state.due === "today");
  chipSoon.hidden  = !(c.soon > 0 || state.due === "soon");

  /* R-1：角标 = 未读通知数；紧急截止改用独立橙点，两件事不共用一个数字 */
  var urgent = c.over + c.today;
  var healthy = $("chipHealthy"), bUrgent = $("bellUrgent");
  if(bUrgent) bUrgent.hidden = !(urgent > 0);
  healthy.hidden = urgent > 0;
  if(urgent === 0){
    healthy.textContent = c.soon > 0 ? ("暂无逾期，最近一项 " + c.soon + " 天后到期") : "暂无逾期";
  }
  renderBellBadge();
  updateBellTitle();
}
function renderBellBadge(){
  var dot = $("alertDot");
  if(!dot) return;
  var n = notifyState.unread;
  dot.hidden = n <= 0;
  dot.textContent = n > 99 ? "99+" : n;
}
function updateBellTitle(){
  var c = state.board ? state.board.counts : {over:0, today:0, soon:0};
  var parts = [];
  if(notifyState.unread > 0) parts.push("未读 " + notifyState.unread);
  if(c.over > 0) parts.push("逾期 " + c.over);
  if(c.today > 0) parts.push("今天到期 " + c.today);
  $("btnAlert").title = parts.length ? ("通知中心：" + parts.join(" · ")) : "通知中心";
}
/* 相对时间：后端 LocalDateTime 无时区，按本地时间解析（服务端与用户同区） */
function relTime(v){
  if(!v) return "";
  var s = String(v).replace(" ", "T");
  var d = new Date(s);
  if(isNaN(d.getTime())) return s.substring(0, 16).replace("T", " ");
  var diff = Date.now() - d.getTime();
  if(diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if(min < 1) return "刚刚";
  if(min < 60) return min + " 分钟前";
  var hr = Math.floor(min / 60);
  if(hr < 24) return hr + " 小时前";
  var day = Math.floor(hr / 24);
  if(day === 1) return "昨天";
  if(day < 30) return day + " 天前";
  return s.substring(0, 10);
}
var unreadFetchedAt = 0;
/* 未读角标：SSE 每次变更都会调它，因此加 3 秒节流（拉到新通知时顺手刷新已打开的面板） */
function loadUnread(force){
  var now = Date.now();
  if(!force && now - unreadFetchedAt < 3000) return Promise.resolve();
  unreadFetchedAt = now;
  return API.getGlobal("/api/notifications/unread").then(function(d){
    var n = (d && d.unread) || 0;
    var changed = n !== notifyState.unread;
    notifyState.unread = n;
    renderBellBadge();
    updateBellTitle();
    if(changed && !$("alertPanel").hidden && alertTab === "notice") loadNoticeList();
  }).catch(function(){ /* 通知是增强能力：失败静默，不打扰用户 */ });
}

/* ---- 面板渲染 ---- */
function renderAlertPanel(){
  var panel = $("alertPanel");
  if(!panel) return;
  var unread = notifyState.unread;
  var html = '<div class="ap-tabs" role="tablist">' +
      '<button class="ap-tab" type="button" role="tab" data-ap-tab="notice" aria-selected="' + (alertTab === "notice") + '">' +
        icon("bell", 14) + '通知' +
        (unread > 0 ? '<span class="n">' + (unread > 99 ? "99+" : unread) + '</span>' : '') +
      '</button>' +
      '<button class="ap-tab" type="button" role="tab" data-ap-tab="due" aria-selected="' + (alertTab === "due") + '">' +
        icon("clock", 14) + '截止提醒' +
      '</button>' +
    '</div><div class="ap-body">' +
      (alertTab === "notice" ? noticeListHTML() : dueGroupsHTML()) +
    '</div>';

  if(alertTab === "notice"){
    if(notifyState.items.length){
      html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-readall>全部标为已读</button></div>';
    }
  }else if(currentWs && currentWs.myRole === "owner"){
    html += '<div class="ap-foot"><button class="btn sm block" type="button" data-ap-test>在空间中测试推送</button></div>';
  }
  panel.innerHTML = html;
}
function noticeListHTML(){
  if(notifyState.loading && !notifyState.items.length) return UI.skeletonRows(4);
  if(!notifyState.items.length){
    return '<div class="ap-empty">' + icon("checkCircle", 22) +
      '<div style="margin-top:6px">还没有通知</div>' +
      '<div class="ap-empty-sub">任务到点提醒、评论与指派都会出现在这里</div></div>';
  }
  var unread = [], read = [];
  notifyState.items.forEach(function(x){ (x.readAt ? read : unread).push(x); });
  var html = unread.map(noticeItemHTML).join("");
  if(unread.length && read.length){
    html += '<div class="ap-glabel" style="padding-left:14px">更早 ' + read.length + '</div>';
  }
  html += read.map(noticeItemHTML).join("");
  return html;
}
function noticeItemHTML(x){
  var ic = NOTIFY_ICON[x.type] || "bell";
  return '<button class="apn' + (x.readAt ? "" : " unread") + '" type="button"' +
    ' data-apn="' + esc(x.id) + '"' +
    (x.refTaskId ? ' data-apn-task="' + esc(x.refTaskId) + '"' : "") +
    (x.workspaceId ? ' data-apn-ws="' + esc(x.workspaceId) + '"' : "") +
    ' title="' + esc(x.title) + '">' +
    '<span class="apn-ic">' + icon(ic, 13) + '</span>' +
    '<span class="apn-main">' +
      '<span class="apn-title">' + esc(x.title) + '</span>' +
      (x.body ? '<span class="apn-body">' + esc(x.body) + '</span>' : "") +
      '<span class="apn-meta">' + esc(relTime(x.createdAt)) +
        (x.workspaceName ? " · " + esc(x.workspaceName) : "") + '</span>' +
    '</span>' +
    (x.readAt ? "" : '<i class="apn-dot"></i>') +
  '</button>';
}
function dueGroupsHTML(){
  var g = deadlineGroups;
  var total = g.over.length + g.today.length + g.soon.length;
  var html = "";
  function group(cls, label, list){
    if(!list.length) return;
    html += '<div class="ap-group ' + cls + '"><div class="ap-glabel"><i></i>' + label + ' ' + list.length + '</div>';
    list.forEach(function(t){
      html += '<button class="ap-item" type="button" data-ap-task="' + esc(t.id) + '">' +
        '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
        '<span class="apt">' + esc(t.title) + '</span>' +
        '<span class="' + (cls === "over" ? "meta over" : (cls === "today" ? "meta today" : "meta ok")) + '">' + esc(dueText(t)) + '</span>' +
      '</button>';
    });
    html += '</div>';
  }
  group("over","已逾期", g.over);
  group("today","今天到期", g.today);
  group("soon","3 天内", g.soon);
  if(!total){
    html += '<div class="ap-empty">' + icon("checkCircle", 22) + '<div style="margin-top:6px">节奏健康，没有逾期或临期任务</div></div>';
  }
  return html;
}

/* ---- 面板数据加载 ---- */
function loadAlertPanel(){
  if(alertTab === "notice") return loadNoticeList();
  return loadDeadlineGroups();
}
function loadNoticeList(){
  notifyState.loading = true;
  if(!notifyState.items.length) renderAlertPanel();
  return API.getGlobal("/api/notifications", {limit: 30}).then(function(d){
    notifyState.loading = false;
    notifyState.items = (d && d.items) || [];
    if(d && typeof d.unread === "number") notifyState.unread = d.unread;
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
  }).catch(function(){
    notifyState.loading = false;
    notifyState.items = [];
    renderAlertPanel();
  });
}
function loadDeadlineGroups(){
  function fetchGroup(due){
    return API.get("/api/tasks/list", {due: due, sort:"due"}).then(function(d){
      var items = (d.items || []).slice(0, 5);
      items.forEach(function(t){ taskCacheExtra[t.id] = t; });
      return items;
    }).catch(function(){ return []; });
  }
  return Promise.all([fetchGroup("over"), fetchGroup("today"), fetchGroup("soon")]).then(function(r){
    deadlineGroups = {over:r[0], today:r[1], soon:r[2]};
    renderAlertPanel();
  });
}

/* ---- 点通知：标记已读 + 打开任务（跨空间自动切换，复用「我的任务」那条路径） ---- */
function openFromNotification(ds){
  var nid = Number(ds.apn);
  var taskId = ds.apnTask || "";
  var wsId = ds.apnWs || "";
  var item = null;
  for(var i = 0; i < notifyState.items.length; i++){
    if(notifyState.items[i].id === nid){ item = notifyState.items[i]; break; }
  }
  if(item && !item.readAt){
    item.readAt = new Date().toISOString();
    notifyState.unread = Math.max(0, notifyState.unread - 1);
    renderBellBadge();
    updateBellTitle();
    renderAlertPanel();
    API.postGlobal("/api/notifications/" + nid + "/read").catch(function(){ /* 已读失败不阻断打开 */ });
  }
  if(!taskId){
    toast(item && item.body ? item.body : (item ? item.title : "已读"));
    return;
  }
  if(wsId && currentWs && wsId !== currentWs.id){
    /* 跨空间通知：先二次确认（切空间会 reload，别让人点一下就被带走） */
    askSwitchWorkspace(wsId, (item && item.workspaceName) || wsNameById(wsId), {
      title: "打开其他空间的任务",
      okText: "切换并打开",
      taskTitle: item ? item.title : "",
      openTaskId: taskId
    });
    return;
  }
  openTaskById(taskId);
}

/* ==================== 渲染：筛选栏（§4.4 / §6.3） ==================== */
function metaCount(list, name){
  if(!list) return 0;
  for(var i = 0; i < list.length; i++) if(list[i].name === name) return list[i].count;
  return 0;
}
function overflowChipHTML(kind, n){
  return '<button class="chip" type="button" data-overflow="' + kind + '" aria-haspopup="true" aria-expanded="false" title="展开其余选项">＋' + n + '</button>';
}
function renderOwnerChips(meta){
  var owners = meta.owners || [];
  var only = owners.length <= 1 ? ((owners[0] && owners[0].name) || OWNER_DEFAULT) : null;
  var html = "", shown = 0, items = [];
  if(only){
    var n0 = owners.length ? owners[0].count : 0;
    if(n0 > 0){
      html = '<span class="chip" style="cursor:default">' + avatarHTML(only, "sm") + esc(only) +
        ' <span class="n">' + n0 + '</span></span>';
      shown = 1;
    }
  }else{
    owners.forEach(function(o){
      var on = state.owners.indexOf(o.name) !== -1;
      if(o.count === 0 && !on) return;
      items.push({name:o.name, count:o.count, on:on});
    });
    items.slice(0, 3).forEach(function(o){
      html += '<button class="chip" type="button" data-owner="' + esc(o.name) + '" aria-pressed="' + o.on + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + ' <span class="n">' + o.count + '</span></button>';
      shown++;
    });
    if(items.length > 3) html += overflowChipHTML("owner", items.length - 3);
  }
  chipsOwner.innerHTML = html;
  $("fgOwner").hidden = shown === 0 && items.length === 0;
}
function renderPriChips(meta){
  var html = "", shown = 0, items = [];
  PRIORITIES.forEach(function(p){
    var on = state.pris.indexOf(p) !== -1;
    var n = metaCount(meta.pris, p);
    if(n === 0 && !on) return;
    items.push({name:p, count:n, on:on});
  });
  items.slice(0, 3).forEach(function(o){
    html += '<button class="chip ' + o.name.toLowerCase() + '" type="button" data-pri="' + o.name + '" aria-pressed="' + o.on + '">' +
      '<i class="cdot" style="background:' + PRIORITY_COLOR[o.name] + '"></i>' + o.name + ' <span class="n">' + o.count + '</span></button>';
    shown++;
  });
  if(items.length > 3) html += overflowChipHTML("pri", items.length - 3);
  chipsPri.innerHTML = html;
  $("fgPri").hidden = shown === 0 && items.length === 0;
}
function renderMoreFilter(meta){
  var cats = (meta.cats || []).filter(function(c){ return c.count > 0 || state.cats.indexOf(c.name) !== -1; });
  var tags = (meta.tags || []).filter(function(t){ return t.count > 0 || state.tags.indexOf(t.name) !== -1; });
  var reqs = (meta.reqs || []).filter(function(r){ return r.count > 0 || state.reqs.indexOf(r.id) !== -1; });
  var noneOn = state.reqs.indexOf("__none") !== -1;

  function section(title, inner){
    if(!inner) return "";
    return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
  }
  var catInner = cats.map(function(c){
    var on = state.cats.indexOf(c.name) !== -1;
    return '<button class="chip" type="button" data-cat="' + esc(c.name) + '" aria-pressed="' + on + '">' +
      esc(c.name) + ' <span class="n">' + c.count + '</span></button>';
  }).join("");
  var tagInner = tags.map(function(t){
    var on = state.tags.indexOf(t.name) !== -1;
    return '<button class="chip" type="button" data-tag="' + esc(t.name) + '" aria-pressed="' + on + '">' +
      esc(t.name) + ' <span class="n">' + t.count + '</span></button>';
  }).join("");
  var reqInner = reqs.map(function(r){
    var on = state.reqs.indexOf(r.id) !== -1;
    return '<button class="chip" type="button" data-req="' + esc(r.id) + '" aria-pressed="' + on + '">' +
      esc(r.name) + ' <span class="n">' + r.count + '</span></button>';
  }).join("");
  if((meta.unassigned || 0) > 0 || noneOn){
    reqInner += '<button class="chip ghost" type="button" data-req="__none" aria-pressed="' + noneOn + '">未归类 <span class="n">' +
      (meta.unassigned || 0) + '</span></button>';
  }
  var blockedInner = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="' + (state.blocked ? "true" : "false") + '">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞</button>';

  var html = '<div class="menu-title">更多筛选</div>' +
    section("状态", blockedInner) +
    section("分类", catInner) + section("标签", tagInner) + section("项目", reqInner);
  if(!catInner && !tagInner && !reqInner){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">当前空间还没有分类、标签或项目可供筛选。</p></div>';
  }
  /* O-15 / F11：去掉只负责关闭的「应用」按钮——本栏所有 chip 都是即时生效，留着它会误导用户 */
  html += '<div class="menu-foot">' +
      '<button class="btn sm" type="button" data-mf-reset>重置</button>' +
    '</div>';
  moreFilterMenu.innerHTML = html;

  var n = state.cats.length + state.tags.length + state.reqs.length + (state.blocked ? 1 : 0);
  moreFilterCount.hidden = n === 0;
  moreFilterCount.textContent = n;
}
/* 「搜索：xxx ✕」chip（O-7） */
function renderQueryChip(){
  var box = $("chipsQuery");
  if(!box) return;
  if(!state.q){ box.innerHTML = ""; $("fgQuery").hidden = true; return; }
  box.innerHTML = '<button class="chip query-chip" type="button" data-clear-q title="清空搜索">' +
    icon("search", 12) + '<span class="q">' + esc(state.q) + '</span>' + icon("close", 12) + '</button>';
  $("fgQuery").hidden = false;
}
/* 「仅看被阻塞」chip（N-4） */
function renderBlockedChip(){
  var box = $("chipsBlocked");
  if(!box) return;
  if(!state.blocked){ box.innerHTML = ""; $("fgBlocked").hidden = true; return; }
  box.innerHTML = '<button class="chip alert-today" type="button" data-blocked-filter aria-pressed="true" title="清空：只看被阻塞的任务">' +
    '<i class="cdot" style="background:var(--warning)"></i>仅看被阻塞' + icon("close", 12) + '</button>';
  $("fgBlocked").hidden = false;
}
function renderViews(){
  if(!viewBox) return;
  viewBox.innerHTML = savedViews.map(function(v){
    return '<span class="view-chip">' +
      '<button class="vname" type="button" data-view-apply="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
      '<button class="vx" type="button" data-view-del="' + esc(v.id) + '" title="删除视图" aria-label="删除视图">' + icon("close", 11) + '</button>' +
      '</span>';
  }).join("");
  $("viewGroup").hidden = savedViews.length === 0;
  updateFilterActions();
}
function updateFilterActions(){
  var n = selectedFilterCount();
  filterActions.hidden = n === 0 && savedViews.length === 0;
  selectedSummary.hidden = n === 0;
  selectedSummary.innerHTML = '已选 ' + n + ' 项 ' + icon("close", 12);
}
function renderFilterChips(){
  var meta = state.board ? state.board.meta : null;
  if(meta){
    renderOwnerChips(meta);
    renderPriChips(meta);
    renderMoreFilter(meta);
    var reqsMeta = meta.reqs || [];
    if(reqDot){ reqDot.textContent = reqsMeta.length; reqDot.hidden = reqsMeta.length === 0; }
  }else{
    chipsOwner.innerHTML = "";
    chipsPri.innerHTML = "";
    moreFilterMenu.innerHTML = "";
    $("fgOwner").hidden = true;
    $("fgPri").hidden = true;
  }
  renderBlockedChip();
  renderQueryChip();
  updateFilterActions();
}

/* ==================== 筛选交互 ==================== */
function toggleIn(arr, v){
  var i = arr.indexOf(v);
  if(i === -1) arr.push(v); else arr.splice(i, 1);
}
var filterReloadTimer = null;
function reloadFilteredViews(){
  /* 连续点选多个筛选条件时合并成一次请求（150ms），避免每点一下都刷新看板/列表/甘特 */
  if(filterReloadTimer) clearTimeout(filterReloadTimer);
  filterReloadTimer = setTimeout(function(){
    filterReloadTimer = null;
    loadBoard({animate:true});
    refreshListIfOpen();
    refreshGanttIfOpen();
    if(activeView === "gantt") renderGanttFilterState();
  }, 150);
}
var searchTimer = null;
searchInput.addEventListener("input", function(){
  searchWrap.classList.toggle("has", searchInput.value.trim().length > 0);
  if(searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(function(){ applySearch(searchInput.value.trim()); }, 300);
});
/* 跨视图搜索（O-7 / F6）：搜索框是全站唯一入口，结果统一在看板呈现 */
function applySearch(kw){
  var supported = {board:1, list:1, mine:1, gantt:1, calendar:1};
  state.q = kw || "";
  /* 支持筛选的视图就地过滤；其余视图仍回看板展示结果（避免搜索框看起来没反应） */
  if(kw && !supported[activeView]){
    showView("board");
    reloadFilteredViews();
    toast("已在看板中显示「" + kw + "」的搜索结果");
    return;
  }
  if(activeView === "mine"){ loadMine(); return; }
  if(activeView === "calendar"){ renderCalendar(); return; }
  if(activeView === "gantt"){ loadGantt({silent:true}); renderGanttFilterState(); return; }
  reloadFilteredViews();
}
$("searchClear").addEventListener("click", function(){
  searchInput.value = "";
  state.q = "";
  searchWrap.classList.remove("has");
  applySearch("");
  searchInput.focus();
});
function setDueFilter(v){
  state.due = (state.due === v) ? null : v;
  reloadFilteredViews();
}
$("chipOver").addEventListener("click", function(){ setDueFilter("over"); });
$("chipToday").addEventListener("click", function(){ setDueFilter("today"); });
$("chipSoon").addEventListener("click", function(){ setDueFilter("soon"); });
$("chipFocus").addEventListener("click", function(){
  state.focus = !state.focus;
  reloadFilteredViews();
});
function clearFilters(){
  state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.reqs = [];
  state.tags = []; state.due = null; state.focus = false; state.blocked = false;
  searchInput.value = "";
  searchWrap.classList.remove("has");
  reloadFilteredViews();
}
$("btnClearFilter").addEventListener("click", function(){ clearFilters(); });
selectedSummary.addEventListener("click", function(){
  var n = selectedFilterCount();
  if(n >= 3){
    UI.showConfirm({
      title:"清空筛选",
      msg:"当前有 <b>" + n + "</b> 项筛选条件，确定全部清空？",
      okText:"清空",
      danger:false
    }).then(function(ok){ if(ok) clearFilters(); });
    return;
  }
  clearFilters();
});
$("filterbar").addEventListener("click", function(e){
  var o = e.target.closest("[data-owner]");
  if(o){ toggleIn(state.owners, o.dataset.owner); reloadFilteredViews(); return; }
  var p = e.target.closest("[data-pri]");
  if(p){ toggleIn(state.pris, p.dataset.pri); reloadFilteredViews(); return; }
  var c = e.target.closest("[data-cat]");
  if(c){ toggleIn(state.cats, c.dataset.cat); reloadFilteredViews(); return; }
  var r = e.target.closest("[data-req]");
  if(r){ toggleIn(state.reqs, r.dataset.req); reloadFilteredViews(); return; }
  var t = e.target.closest("[data-tag]");
  if(t){ toggleIn(state.tags, t.dataset.tag); reloadFilteredViews(); return; }
  var ov = e.target.closest("[data-overflow]");
  if(ov){ openOverflowPop(ov); return; }
  if(e.target.closest("[data-mf-reset]")){
    state.cats = []; state.tags = []; state.reqs = []; state.blocked = false;
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-blocked-filter]")){
    state.blocked = !state.blocked;
    reloadFilteredViews();
    return;
  }
  if(e.target.closest("[data-clear-q]")){
    searchInput.value = "";
    searchWrap.classList.remove("has");
    applySearch("");
    return;
  }
});
function openOverflowPop(anchor){
  var kind = anchor.dataset.overflow;
  var meta = state.board ? state.board.meta : null;
  if(!meta) return;
  var html = '<div class="menu-title">' + (kind === "owner" ? "全部负责人" : "全部优先级") +
    '</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">';
  if(kind === "owner"){
    (meta.owners || []).forEach(function(o){
      var on = state.owners.indexOf(o.name) !== -1;
      if(o.count === 0 && !on) return;
      html += '<button class="chip" type="button" data-owner="' + esc(o.name) + '" aria-pressed="' + on + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + ' <span class="n">' + o.count + '</span></button>';
    });
  }else{
    PRIORITIES.forEach(function(pp){
      var on = state.pris.indexOf(pp) !== -1;
      var n = metaCount(meta.pris, pp);
      if(n === 0 && !on) return;
      html += '<button class="chip ' + pp.toLowerCase() + '" type="button" data-pri="' + pp + '" aria-pressed="' + on + '">' +
        '<i class="cdot" style="background:' + PRIORITY_COLOR[pp] + '"></i>' + pp + ' <span class="n">' + n + '</span></button>';
    });
  }
  html += '</div></div>';
  var el = document.createElement("div");
  el.className = "menu popover";
  el.innerHTML = html;
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
$("btnMoreFilter").addEventListener("click", function(){
  if(UI.popOpen(moreFilterMenu)){ UI.closeAllPops(); return; }
  UI.openPop(moreFilterMenu, $("btnMoreFilter"), {align:"left", width:320});
});

/* ==================== 保存的筛选视图（params 结构必须与后端一致） ==================== */
function loadViews(){
  return API.get("/api/views").then(function(list){
    savedViews = list || [];
    renderViews();
  }).catch(function(){});
}
function currentFilterParams(){
  return {
    q: state.q,
    owners: state.owners.slice(),
    pris: state.pris.slice(),
    cats: state.cats.slice(),
    reqs: state.reqs.slice(),
    tags: state.tags.slice(),
    due: state.due,
    focus: state.focus,
    blocked: state.blocked,
    doneScope: state.doneScope
  };
}
function parseViewParams(p){
  if(!p || typeof p !== "object" || Array.isArray(p)) return null;
  function strArr(v){
    if(v === undefined || v === null) return [];
    if(!Array.isArray(v)) return null;
    for(var i = 0; i < v.length; i++) if(typeof v[i] !== "string") return null;
    return v.slice();
  }
  var owners = strArr(p.owners), pris = strArr(p.pris), cats = strArr(p.cats),
      reqs = strArr(p.reqs), tags = strArr(p.tags);
  if(!owners || !pris || !cats || !reqs || !tags) return null;
  if(p.q !== undefined && p.q !== null && typeof p.q !== "string") return null;
  if(p.focus !== undefined && p.focus !== null && typeof p.focus !== "boolean") return null;
  if(p.blocked !== undefined && p.blocked !== null && typeof p.blocked !== "boolean") return null;
  return {
    q: p.q || "",
    owners: owners, pris: pris, cats: cats, reqs: reqs, tags: tags,
    due: (p.due === "over" || p.due === "today" || p.due === "soon") ? p.due : null,
    focus: p.focus === true,
    blocked: p.blocked === true,
    doneScope: p.doneScope === "all" ? "all" : "week"
  };
}
function applyView(v){
  var p;
  try{ p = JSON.parse(v.params); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  var f = parseViewParams(p);
  if(!f){ toast("视图参数不合法，无法应用（可删除后重新保存）", "bad"); return; }
  state.q = f.q; state.owners = f.owners; state.pris = f.pris; state.cats = f.cats;
  state.reqs = f.reqs; state.tags = f.tags; state.due = f.due; state.focus = f.focus;
  state.blocked = f.blocked;
  state.doneScope = f.doneScope;
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  reloadFilteredViews();
  toast("已应用视图「" + v.name + "」", "fs");
}
viewBox.addEventListener("click", function(e){
  var ap = e.target.closest("[data-view-apply]");
  if(ap){
    for(var i = 0; i < savedViews.length; i++){
      if(String(savedViews[i].id) === String(ap.dataset.viewApply)){ applyView(savedViews[i]); return; }
    }
    return;
  }
  var dl = e.target.closest("[data-view-del]");
  if(dl){
    UI.showConfirm({ title:"删除视图", msg:"确定删除该视图？不影响任务数据。", okText:"删除" }).then(function(ok){
      if(!ok) return;
      API.del("/api/views/" + encodeURIComponent(dl.dataset.viewDel)).then(function(){
        toast("视图已删除", "fs");
        loadViews();
      }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
    });
  }
});
/* 保存当前筛选为视图：看板与甘特共用同一个弹窗与接口 */
function promptSaveView(){
  if(!filterOn()){ toast("当前没有筛选条件，先设置筛选再保存", "warn"); return; }
  $("dlgViewInput").value = "";
  $("fDlgViewName").classList.remove("invalid");
  UI.openModal($("dlgViewName"));
}
$("btnSaveView").addEventListener("click", promptSaveView);
$("dlgViewNameForm").addEventListener("submit", function(e){
  e.preventDefault();
  var name = $("dlgViewInput").value.trim();
  if(!name){ $("fDlgViewName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  API.post("/api/views", { name: name, params: JSON.stringify(currentFilterParams()) }).then(function(){
    UI.closeModal($("dlgViewName"));
    toast("已保存视图「" + name + "」", "fs");
    loadViews();
    if(ganttViewsMenu) renderGanttViewsMenu();
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
});

/* ==================== 拖拽（指针事件，兼容鼠标与触屏） ==================== */
var drag = null, pending = null, lastPt = {x:0, y:0}, rafId = null, dragRaf = 0;

function onPointerDown(e){
  var cardEl = e.target.closest ? e.target.closest(".card") : null;
  if(!cardEl) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  if(e.target.closest("button,input,textarea,select,a")) return;
  pending = {
    el: cardEl, id: cardEl.dataset.id,
    x0: e.clientX, y0: e.clientY,
    touch: e.pointerType !== "mouse",
    timer: null
  };
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending.touch){
    pending.timer = setTimeout(function(){ if(pending) beginDrag(lastPt.x, lastPt.y); }, 190);
  }
}
function onPointerMove(e){
  lastPt.x = e.clientX; lastPt.y = e.clientY;
  if(pending && !drag){
    var dx = e.clientX - pending.x0, dy = e.clientY - pending.y0;
    if(Math.abs(dx) + Math.abs(dy) > 6){
      if(pending.touch){
        if(pending.timer) clearTimeout(pending.timer);
        pending = null;
        return;
      }
      beginDrag(e.clientX, e.clientY);
    }
  }
  if(drag){
    if(e.cancelable) e.preventDefault();
    /* 合并到一帧里读写 DOM，避免 pointermove 高频触发时反复测量布局 */
    if(!dragRaf) dragRaf = requestAnimationFrame(function(){ dragRaf = 0; if(drag) updateDrag(); });
  }
}
function onPointerUp(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; if(drag) updateDrag(); }
  if(drag) endDrag();
}
function onPointerCancel(){
  if(pending && pending.timer) clearTimeout(pending.timer);
  pending = null;
  if(drag) cancelDrag();
}
function boardTouchMove(e){ if(drag && e.cancelable) e.preventDefault(); }

function beginDrag(x, y){
  if(!pending) return;
  var cardEl = pending.el, id = pending.id;
  pending = null;
  if(!cardEl || !cardEl.parentNode) return;

  var rect = cardEl.getBoundingClientRect();
  var ghost = cardEl.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.classList.remove("just-moved");
  ghost.removeAttribute("tabindex");
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";
  document.body.appendChild(ghost);

  var line = document.createElement("div");
  line.className = "drop-line";

  cardEl.classList.add("dragging");
  document.body.classList.add("dragging-active");

  drag = {
    id: id, el: cardEl, ghost: ghost, line: line,
    x0: x, y0: y,
    colEl: cardEl.closest(".board-col"),
    beforeId: null
  };
  if(drag.colEl) drag.colEl.classList.add("drop-active");
  document.addEventListener("touchmove", boardTouchMove, {passive:false});
  var originBody = cardEl.closest(".board-col-body");
  if(originBody) originBody.insertBefore(line, cardEl.nextSibling);
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function updateDrag(){
  if(!drag) return;
  var x = lastPt.x, y = lastPt.y;
  drag.ghost.style.transform = "translate(" + (x - drag.x0) + "px," + (y - drag.y0) + "px) rotate(2deg)";

  var cols = board.querySelectorAll(".board-col");
  var target = null;
  for(var i = 0; i < cols.length; i++){
    var r = cols[i].getBoundingClientRect();
    if(x >= r.left - 12 && x <= r.right + 12){ target = cols[i]; break; }
  }
  if(!target) return;

  if(drag.colEl !== target){
    if(drag.colEl) drag.colEl.classList.remove("drop-active");
    drag.colEl = target;
    target.classList.add("drop-active");
  }

  var bodyEl = target.querySelector(".board-col-body");
  if(!bodyEl) return;
  var cards = Array.prototype.slice.call(bodyEl.querySelectorAll(".card:not(.dragging)"));
  var before = null;
  for(var k = 0; k < cards.length; k++){
    var cr = cards[k].getBoundingClientRect();
    if(y < cr.top + cr.height/2){ before = cards[k]; break; }
  }
  if(before) bodyEl.insertBefore(drag.line, before);
  else {
    var tail = bodyEl.querySelector(".card-add, .card-add-input, .col-more");
    if(tail) bodyEl.insertBefore(drag.line, tail);
    else bodyEl.appendChild(drag.line);
  }
  drag.beforeId = before ? before.dataset.id : null;
}
function loop(){
  if(!drag){ rafId = null; return; }
  var x = lastPt.x, y = lastPt.y;
  var br = board.getBoundingClientRect();
  if(x < br.left + 60) board.scrollLeft -= 14;
  else if(x > br.right - 60) board.scrollLeft += 14;
  if(drag.colEl){
    var bodyEl = drag.colEl.querySelector(".board-col-body");
    if(bodyEl){
      var lr = bodyEl.getBoundingClientRect();
      if(y < lr.top + 40) bodyEl.scrollTop -= 12;
      else if(y > lr.bottom - 40) bodyEl.scrollTop += 12;
    }
  }
  updateDrag();
  rafId = requestAnimationFrame(loop);
}
function endDrag(){
  var d = drag;
  var toCol = d.colEl ? d.colEl.dataset.col : null;
  var beforeId = d.beforeId;
  var fromEl = d.el.closest(".board-col");
  var fromCol = fromEl ? fromEl.dataset.col : null;
  cleanupDrag();
  if(!toCol){ render({animate:false}); return; }

  suppressClickUntil = Date.now() + 260;
  optimisticMove(d.id, toCol, beforeId);
  render({animate:false, movedId:d.id});

  var body = { column: toCol };
  if(beforeId) body.beforeId = beforeId;
  API.post("/api/tasks/" + encodeURIComponent(d.id) + "/move", body).then(function(res){
    var task = res.task;
    if(res.to === "done" && res.from !== "done"){
      var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
      var doneMsg = dd > 0
        ? ("已完成任务「" + task.title + "」，延期 " + dd + " 天完成")
        : ("已完成任务「" + task.title + "」，按期完成");
      /* 完成后自动接力了同列的下一个任务，明确说出来，别让人以为计时断了 */
      if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
      toast(doneMsg, dd > 0 ? "warn" : "fs");
    }else if(res.from === "done" && res.to !== "done"){
      toast("已清除完成时间", "warn");
    }else if(fromCol !== res.to){
      toast("「" + task.title + "」移动到「" + colName(res.to) + "」" +
        (res.autoTimerStarted ? " · 已开始计时（拖到「已完成」会自动停止）" : ""));
    }
    loadBoard({silent:true});
    loadReqs();
  }).catch(function(ex){
    toast("移动失败：" + (ex.message || "网络异常"), "bad");
    loadBoard({silent:true});
  });
}
function cancelDrag(){ cleanupDrag(); render({animate:false}); }
function cleanupDrag(){
  if(!drag) return;
  if(dragRaf){ cancelAnimationFrame(dragRaf); dragRaf = 0; }
  document.removeEventListener("touchmove", boardTouchMove);
  if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
  if(drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  if(drag.line && drag.line.parentNode) drag.line.parentNode.removeChild(drag.line);
  if(drag.el) drag.el.classList.remove("dragging");
  if(drag.colEl) drag.colEl.classList.remove("drop-active");
  document.body.classList.remove("dragging-active");
  drag = null;
}
function optimisticMove(id, toCol, beforeId){
  if(!state.board) return;
  var t = null, cdFrom = null;
  for(var i = 0; i < COLUMNS.length; i++){
    var cd = state.board.columns[COLUMNS[i].id];
    if(!cd) continue;
    for(var j = 0; j < cd.items.length; j++){
      if(cd.items[j].id === id){ t = cd.items[j]; cdFrom = cd; cd.items.splice(j,1); break; }
    }
    if(t) break;
  }
  if(!t){
    for(var k = 0; k < state.doneExtra.length; k++){
      if(state.doneExtra[k].id === id){
        t = state.doneExtra[k];
        cdFrom = state.board.columns.done;
        state.doneExtra.splice(k,1);
        break;
      }
    }
  }
  if(!t) return;
  if(cdFrom){
    cdFrom.matched = Math.max(0, cdFrom.matched - 1);
    if(cdFrom.total > 0) cdFrom.total--;
    if(t.boardColumn === "done"){
      cdFrom.allTotal = Math.max(0, cdFrom.allTotal - 1);
      cdFrom.hasMore = false;
    }
  }
  var cdTo = state.board.columns[toCol];
  if(!cdTo) return;
  var wasDone = t.boardColumn === "done";
  t.boardColumn = toCol;
  if(toCol === "done" && !wasDone) t.completedAt = TODAY_ISO;
  else if(toCol !== "done") t.completedAt = null;
  var pos = cdTo.items.length;
  if(beforeId){
    for(var m = 0; m < cdTo.items.length; m++){
      if(cdTo.items[m].id === beforeId){ pos = m; break; }
    }
  }
  cdTo.items.splice(pos, 0, t);
  cdTo.matched++; cdTo.total++;
  if(toCol === "done" && !wasDone) cdTo.allTotal++;
}
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("pointermove", onPointerMove, {passive:false});
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("pointercancel", onPointerCancel);

/* ==================== 看板点击 / 列操作 ==================== */
board.addEventListener("click", function(e){
  var fold = e.target.closest("[data-col-fold]");
  if(fold){
    var cid = fold.dataset.colFold;
    state.collapsedCols[cid] = !state.collapsedCols[cid];
    render({animate:false});
    return;
  }
  var colAdd = e.target.closest("[data-col-add]");
  if(colAdd){ state.inlineAdd = {col: colAdd.dataset.colAdd, value: ""}; openInlineAdd(colAdd.dataset.colAdd, ""); return; }
  var add = e.target.closest("[data-add]");
  if(add){ state.inlineAdd = {col: add.dataset.add, value: ""}; openInlineAdd(add.dataset.add, ""); return; }
  var colorDot = e.target.closest("[data-col-color]");
  if(colorDot){ openColColorPop(colorDot, colorDot.dataset.colColor); return; }
  var rename = e.target.closest("[data-col-rename]");
  if(rename){ startColRename(rename, rename.dataset.colRename); return; }
  var sc = e.target.closest("[data-scope]");
  if(sc){
    state.doneScope = (state.doneScope === "week") ? "all" : "week";
    loadBoard({animate:true}).then(function(){
      toast(state.doneScope === "week" ? "已完成列：仅显示本周" : "已完成列：显示全部记录");
    });
    return;
  }
  var more = e.target.closest("[data-more]");
  if(more){ loadMoreDone(); return; }
  var dueBtn = e.target.closest("[data-due-pop]");
  if(dueBtn){ openDuePopover(dueBtn, dueBtn.dataset.duePop); return; }
  var menuBtn = e.target.closest("[data-card-menu]");
  if(menuBtn){ openCardMenu(menuBtn, menuBtn.dataset.cardMenu); return; }
  var docBtn = e.target.closest("[data-open-reqdoc]");
  if(docBtn){ openReqDocAndJump(docBtn.dataset.openReqdoc); return; }
  var tmr = e.target.closest("[data-timer-toggle]");
  if(tmr){ toggleTaskTimer(tmr.dataset.timerToggle); return; }
  var tick = e.target.closest("[data-done-toggle]");
  if(tick){ toggleTaskDone(tick.dataset.doneToggle); return; }
  var ed = e.target.closest("[data-edit]");
  if(ed){ openTaskDrawer(null, taskById(ed.dataset.edit)); return; }
  var del = e.target.closest("[data-del]");
  if(del){ deleteTask(del.dataset.del); return; }
  var card = e.target.closest(".card");
  if(card && Date.now() > suppressClickUntil) openTaskDrawer(null, taskById(card.dataset.id));
});
board.addEventListener("dblclick", function(e){
  var title = e.target.closest(".card-title");
  if(!title) return;
  var card = title.closest(".card");
  if(!card) return;
  var t = taskById(card.dataset.id);
  if(t) openTaskDrawer(null, t);
});
board.addEventListener("keydown", function(e){
  var nameEl = e.target.closest("[data-col-rename]");
  if(nameEl && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); startColRename(nameEl, nameEl.dataset.colRename); return; }
  var dot = e.target.closest("[data-col-color]");
  if(dot && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openColColorPop(dot, dot.dataset.colColor); return; }
  if(e.target.closest("button")) return;   // 卡内按钮自己处理 Enter/Space
  if(e.key === "Enter" || e.key === " "){
    var card = e.target.closest(".card");
    if(card){ e.preventDefault(); openTaskDrawer(null, taskById(card.dataset.id)); }
  }
});
function startColRename(el, colId){
  var col = colMeta(colId);
  if(!col || col.done) return;
  var old = colName(colId);
  var input = document.createElement("input");
  input.className = "col-name-edit";
  input.type = "text";
  input.maxLength = 12;
  input.value = old;
  input.setAttribute("aria-label", "列名");
  el.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function restore(){
    var span = document.createElement("span");
    span.className = "col-name";
    span.dataset.colRename = colId;
    span.setAttribute("role","button");
    span.setAttribute("tabindex","0");
    span.title = "点击改名";
    span.textContent = old;
    if(input.parentNode) input.replaceWith(span);
  }
  function commit(save){
    if(done) return;
    done = true;
    var name = input.value.trim();
    if(!save || !name || name === old){ restore(); return; }
    API.put("/api/columns/" + encodeURIComponent(colId), { name: name, color: colColorOf(colId) }).then(function(){
      toast("已更新列「" + name + "」", "fs");
      loadBoard({silent:true});
    }).catch(function(ex){
      toast(ex.message || "保存失败", "bad");
      loadBoard({silent:true});
    });
  }
  input.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === "Enter"){ e.preventDefault(); commit(true); }
    else if(e.key === "Escape"){ e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", function(){ commit(true); });
}
function colColorOf(colId){
  var c = colMeta(colId);
  return safeColor(c && c.color);
}
function openColColorPop(anchor, colId){
  var html = '<div class="menu-title">列颜色</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:8px">';
  PALETTE.forEach(function(c){
    html += '<button type="button" data-colpick="' + c + '" title="' + c + '" aria-label="选择颜色 ' + c +
      '" style="width:26px;height:26px;border-radius:8px;border:1px solid rgba(16,24,40,.12);background:' + c + '"></button>';
  });
  html += '</div><div class="row row-gap" style="margin-top:10px">' +
    '<input type="color" value="' + esc(colColorOf(colId)) + '" data-colpick-custom aria-label="自定义颜色" />' +
    '<span class="foot-note">自定义颜色</span></div></div>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-colpick]");
    if(!b) return;
    UI.closeAllPops();
    saveColColor(colId, b.dataset.colpick);
  });
  el.addEventListener("change", function(e){
    if(e.target.matches("[data-colpick-custom]")){
      UI.closeAllPops();
      saveColColor(colId, e.target.value);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
function saveColColor(colId, color){
  var col = colMeta(colId);
  if(!col) return;
  API.put("/api/columns/" + encodeURIComponent(colId), { name: col.name, color: color }).then(function(){
    toast("已更新列颜色", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
}

/* ==================== 任务深链（O-3 / F5） ==================== */
function taskLink(id){
  return window.location.origin + window.location.pathname + "#/board?task=" + encodeURIComponent(id);
}
/* 按 id 打开抽屉；本地看板里没有就向后端要，按四种降级分别给文案 */
function openTaskById(id){
  var local = taskById(id);
  if(local && !local.deletedAt){ openTaskDrawer(null, local); return Promise.resolve(true); }
  /* 路径用单数 /api/task/{id}：与 /api/tasks/list、/api/tasks/done 零歧义 */
  return API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
    if(!t){ toast("任务不存在或你没有访问权限", "warn"); return false; }
    if(t.deletedAt){ toast("该任务已被删除，可在回收站查看", "warn"); return false; }
    taskCacheExtra[t.id] = t;
    openTaskDrawer(null, t);
    return true;
  }).catch(function(){ toast("任务不存在或你没有访问权限", "warn"); return false; });
}
function hashParam(name){
  var h = String(window.location.hash || "");
  var q = h.indexOf("?");
  if(q < 0) return "";
  var parts = h.substring(q + 1).split("&");
  for(var i = 0; i < parts.length; i++){
    var kv = parts[i].split("=");
    if(decodeURIComponent(kv[0]) === name) return decodeURIComponent(kv[1] || "");
  }
  return "";
}
function stripHashParam(name){
  var h = String(window.location.hash || "");
  var q = h.indexOf("?");
  if(q < 0) return;
  var keep = h.substring(q + 1).split("&").filter(function(p){
    return p && decodeURIComponent(p.split("=")[0]) !== name;
  });
  var next = h.substring(0, q) + (keep.length ? ("?" + keep.join("&")) : "");
  try{ history.replaceState(null, "", next || ("#/" + activeView)); }catch(e){ /* noop */ }
}
function handleDeepLink(){
  var id = hashParam("task");
  if(!id) return;
  stripHashParam("task");   // 先清参数：避免刷新后反复弹窗
  openTaskById(id);
}

/* ==================== 卡片级改期（O-5 / F3） ==================== */
function openDuePopover(anchor, taskId){
  var t = taskById(taskId);
  if(!t) return;
  var el = document.createElement("div");
  el.className = "menu due-pop";
  el.innerHTML =
    '<div class="dp-quick">' +
      '<button class="btn sm" type="button" data-due-set="0">今天</button>' +
      '<button class="btn sm" type="button" data-due-set="1">明天</button>' +
      '<button class="btn sm" type="button" data-due-set="w5" title="按 5 个工作日计算，自动跳过周末">一周后</button>' +
      '<button class="btn sm" type="button" data-due-set="">无期限</button>' +
    '</div>' +
    '<div class="dp-row">' +
      '<input type="date" value="' + esc(t.dueDate || "") + '" data-due-input aria-label="选择截止日期" />' +
      '<button class="btn sm primary" type="button" data-due-save>确定</button>' +
    '</div>';
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-due-set]");
    if(b){
      var v = b.dataset.dueSet;
      UI.closeAllPops();
      setTaskDue(taskId, duePresetDate(v));
      return;
    }
    if(e.target.closest("[data-due-save]")){
      var inp = el.querySelector("[data-due-input]");
      UI.closeAllPops();
      setTaskDue(taskId, inp.value || null);
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
  setTimeout(function(){
    try{ el.querySelector("[data-due-input]").focus(); }catch(e2){ /* noop */ }
  }, 30);
}
/* 注意：已完成任务的改期不改动完成日期（服务端只在列变化时重算 completedAt） */
function setTaskDue(taskId, dueDate){
  var t = taskById(taskId);
  if(!t) return;
  var before = t.dueDate || null;
  t.dueDate = dueDate;                                  // 乐观更新
  if(state.board && activeView === "board") render({animate:false});
  API.put("/api/tasks/" + encodeURIComponent(taskId), taskPayloadWith(t, {dueDate: dueDate})).then(function(){
    toast(dueDate ? ("已改期至 " + fmtFull(parseDate(dueDate))) : "已清除截止日期", dueDate ? "fs" : "warn");
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    t.dueDate = before;                                  // 失败回滚
    if(state.board && activeView === "board") render({animate:false});
    toast(ex.message || "改期失败", "bad");
  });
}

/* ==================== 计时：看板卡片上直接开始 / 停止（2026-10-21） ==================== */
var runningTimerSeq = 0;
/** 拉取「我正在计时的任务」（跨空间）。看板卡片靠它渲染「计时中」状态。 */
function loadRunningTimer(cb){
  var seq = ++runningTimerSeq;
  API.getGlobal("/api/my-running-timer").then(function(d){
    if(seq !== runningTimerSeq) return;
    state.runningTimer = (d && d.running) ? d : null;
    updateElapsedTexts();
    renderTimerPill();
    if(cb) cb(state.runningTimer);
  }).catch(function(){
    if(seq !== runningTimerSeq) return;
    state.runningTimer = null;
    renderTimerPill();
    if(cb) cb(null);
  });
}
/** 顶栏计时胶囊：任何视图都能看到正在计时的任务，并一键停止/打开 */
function renderTimerPill(){
  var pill = $("timerPill");
  if(!pill) return;
  var rt = state.runningTimer;
  pill.hidden = !rt;
  if(!rt) return;
  var name = rt.taskTitle || "任务";
  $("timerPillName").textContent = name;
  pill.title = "正在计时：" + name + "（点击打开任务）";
  updateElapsedTexts();
}
function updateElapsedTexts(){
  var rt = state.runningTimer;
  if(!rt) return;
  document.querySelectorAll("[data-elapsed]").forEach(function(el){
    el.textContent = fmtElapsed(rt.elapsedMinutes);
  });
}
/**
 * 卡片上的计时按钮：未运行 → 开始；正在计时 → 停止。
 * 开始 B 会自动停掉 A —— 这是后端 start() 的既有规则（个人同一时刻只计一个任务），
 * 前端只负责把这个结果说清楚，别让人以为 A 还在跑。
 */
function toggleTaskTimer(taskId){
  var prev = state.runningTimer;
  var on = !!(prev && prev.taskId === taskId);
  var t = taskById(taskId);
  var name = t ? t.title : ((prev && prev.taskTitle) || "任务");
  var url = "/api/tasks/" + encodeURIComponent(taskId) + "/timer/" + (on ? "stop" : "start");
  API.post(url, {}).then(function(d){
    if(on){
      var total = (d && typeof d.totalMinutes === "number") ? d.totalMinutes : 0;
      toast("已停止「" + name + "」的计时" + (total ? "，累计 " + fmtMinutesShort(total) : ""), "fs");
    }else if(prev && prev.taskId && prev.taskId !== taskId){
      var other = taskById(prev.taskId);
      var otherName = other ? other.title : (prev.taskTitle || "另一个任务");
      toast("已开始「" + name + "」的计时 · 自动暂停了「" + otherName + "」", "fs");
    }else{
      toast("已开始「" + name + "」的计时", "fs");
    }
    loadRunningTimer(function(){
      if(state.runningTimer || on){
        if(activeView === "board") render({animate:false});
        else if(activeView === "list") loadList();
        else if(activeView === "calendar") renderCalendar();
      }
    });
  }).catch(function(ex){
    toast(ex.message || "计时操作失败", "bad");
  });
}
/* 顶栏计时胶囊事件 */
if($("timerPill")){
  $("timerPill").addEventListener("click", function(e){
    var rt = state.runningTimer;
    if(!rt) return;
    if(e.target.closest("#timerPillStop")){
      e.stopPropagation();
      toggleTaskTimer(rt.taskId);
      return;
    }
    openTaskById(rt.taskId);
  });
}
/* 每分钟校准一次（换设备操作也能同步）；只有"当前计时的任务变了"才重渲染，避免整页每分钟闪一下 */
setInterval(function(){
  if(document.hidden) return;
  var prevId = state.runningTimer ? state.runningTimer.taskId : null;
  loadRunningTimer(function(rt){
    var nowId = rt ? rt.taskId : null;
    if(prevId !== nowId){
      if(activeView === "board") render({animate:false});
      else if(activeView === "calendar") renderCalendar();
    }
  });
}, 60000);

/* ==================== 卡片级完成（O-6 / F4） ==================== */
function toggleTaskDone(taskId){
  var t = taskById(taskId);
  if(!t) return;
  var isDone = t.boardColumn === "done";
  /* 取消完成 = 回到「完成前所在列」，由后端按最后一次进入已完成列的移动日志还原；
     不是固定回「进行中」。 */
  if(isDone){
    API.post("/api/tasks/" + encodeURIComponent(taskId) + "/reopen", {}).then(function(res){
      var backCol = res && res.to ? colName(res.to) : "进行中";
      toast("已取消完成，回到「" + backCol + "」", "warn");
      loadBoard({animate:false, movedId: taskId});
      loadReqs();
      refreshListIfOpen();
      refreshCalendarIfOpen();
      refreshGanttIfOpen();
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
    return;
  }
  API.post("/api/tasks/" + encodeURIComponent(taskId) + "/move", {column:"done"}).then(function(res){
    var task = res.task;
    var dd = (task.dueDate && task.completedAt) ? dayDiff(parseDate(task.completedAt), parseDate(task.dueDate)) : 0;
    var doneMsg = dd > 0
      ? ("已完成任务「" + task.title + "」，延期 " + dd + " 天完成")
      : ("已完成任务「" + task.title + "」，按期完成");
    if(res.autoTimerTask) doneMsg += " · 已接着开始「" + res.autoTimerTask + "」的计时";
    toast(doneMsg, dd > 0 ? "warn" : "fs");
    loadBoard({animate:false, movedId: task.id});
    loadReqs();
    refreshListIfOpen();
    refreshCalendarIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
}

/* ==================== 卡片「⋯」菜单（O-17 收敛删除入口 / O-21 常驻可发现） ==================== */
function openCardMenu(anchor, taskId){
  var t = taskById(taskId);
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html =
    '<button class="menu-item" type="button" data-cm="open">' + icon("edit", 14) + '打开详情</button>' +
    '<button class="menu-item" type="button" data-cm="due">' + icon("calSmall", 14) + '改期<span class="k">D</span></button>' +
    '<button class="menu-item" type="button" data-cm="done">' + icon(isDone ? "undo" : "check", 14) +
      (isDone ? "取消完成" : "标记完成") + '<span class="k">X</span></button>' +
    '<button class="menu-item" type="button" data-cm="timer">' + icon("timer", 14) +
      (running ? "停止计时" : "开始计时") + '</button>' +
    '<button class="menu-item" type="button" data-cm="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-cm="link">' + icon("extlink", 14) + '复制任务链接</button>';
  var others = COLUMNS.filter(function(c){ return c.id !== t.boardColumn; });
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-cm-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  html += '<div class="menu-sep"></div>' +
    '<button class="menu-item danger" type="button" data-cm="del">' + icon("trash", 14) + '移到回收站</button>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-cm]");
    var mv = e.target.closest("[data-cm-move]");
    if(b){
      var k = b.dataset.cm;
      if(k === "due"){
        UI.closeAllPops();
        setTimeout(function(){ openDuePopover(anchor, t.id); }, 0);
        return;
      }
      UI.closeAllPops();
      if(k === "open") openTaskDrawer(null, t);
      else if(k === "done") toggleTaskDone(t.id);
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "link") copyToClipboard(taskLink(t.id), "任务链接已复制（可直接定位到该任务）");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      UI.closeAllPops();
      var to = mv.dataset.cmMove;
      API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: to}).then(function(res){
        toast("「" + t.title + "」移动到「" + colName(res.to) + "」" +
          (res.autoTimerStarted ? " · 已开始计时" : ""));
        loadBoard({silent:true}); loadReqs(); refreshListIfOpen();
      }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}

/* ==================== 任务详情抽屉（§7.1） ==================== */
function openDrawer(){ taskDrawer.classList.add("on"); }
function closeDrawer(){ taskDrawer.classList.remove("on"); formDirty = false; }

function buildFormControls(){
  segPri.innerHTML = PRIORITIES.map(function(p){
    return '<button type="button" class="' + p.toLowerCase() + '" data-fpri="' + p + '" aria-pressed="false">' + p + '</button>';
  }).join("");
  segRecur.innerHTML = [{v:"", n:"无"},{v:"daily", n:"每天"},{v:"weekly", n:"每周"},{v:"monthly", n:"每月"}]
    .map(function(o){
      return '<button type="button" data-recur="' + o.v + '" aria-pressed="false">' + o.n + '</button>';
    }).join("");
  syncCatSeg();
  populateColSelect();
}
function syncCatSeg(){
  if(!segCat) return;
  segCat.innerHTML = categoriesCache.map(function(c){
    return '<button type="button" data-fcat="' + esc(c.name) + '" aria-pressed="' + (c.name === formCat) + '">' + esc(c.name) + '</button>';
  }).join("");
}
function populateColSelect(){
  if(!iCol) return;
  var cur = iCol.value;
  iCol.innerHTML = COLUMNS.map(function(c){
    return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
  }).join("");
  if(cur && colMeta(cur)) iCol.value = cur;
}
function populateReqSelect(){
  if(!iReq) return;
  var cur = iReq.value;
  var html = '<option value="">（无项目）</option>';
  reqList.forEach(function(r){ html += '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; });
  iReq.innerHTML = html;
  if(cur && reqList.some(function(r){ return r.id === cur; })) iReq.value = cur;
  else iReq.value = "";
}
/* 负责人下拉（N-2）：值 = 账号 ID。历史文本值以「○ xxx（非成员）」保留，
   既不做一次性归并、也不因为改名而串号；保存时同时写 owner（显示名文本）与 ownerUserId（账号） */
function ownerOptions(){
  var opts = [], seen = {};
  if(currentUser){
    opts.push({id: currentUser.id, name: currentUser.displayName || currentUser.username});
    seen[currentUser.id] = 1;
  }
  if(currentWs && currentWs.type === "shared"){
    wsMembersCache.forEach(function(m){
      if(!m.userId || seen[m.userId]) return;
      seen[m.userId] = 1;
      opts.push({id: m.userId, name: m.displayName || m.username});
    });
  }
  return opts;
}
function populateOwnerSelect(currentName, currentUserId){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var opts = ownerOptions();
  var curName = currentName == null ? "" : String(currentName);
  var curId = currentUserId == null ? "" : String(currentUserId);
  var html = "", matched = false;
  opts.forEach(function(o){
    var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
    if(on) matched = true;
    html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (on ? " selected" : "") + '>' +
      esc(o.name) + '</option>';
  });
  if(curName && !matched){
    html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
  }
  if(!opts.length && !curName){
    html += '<option value="__text__" data-name="' + esc(OWNER_DEFAULT) + '">' + esc(OWNER_DEFAULT) + '</option>';
  }
  iOwner.innerHTML = html;
}
/* 成员列表刷新后保留当前选中项（按 id/文本） */
function refreshOwnerSelect(){
  if(!iOwner || iOwner.tagName !== "SELECT") return;
  var sel = iOwner.options[iOwner.selectedIndex];
  var name = sel ? (sel.dataset.name || sel.textContent) : "";
  var uid = sel && sel.value !== "__text__" ? sel.value : "";
  populateOwnerSelect(name, uid);
}
function ownerPick(){
  if(!iOwner || iOwner.tagName !== "SELECT") return {name:null, userId:null};
  var sel = iOwner.options[iOwner.selectedIndex];
  if(!sel) return {name:null, userId:null};
  return {
    name: sel.dataset.name || sel.textContent || null,
    userId: sel.value === "__text__" ? null : sel.value
  };
}
function syncFormSegs(){
  segPri.querySelectorAll("[data-fpri]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.fpri === formPri);
  });
  segCat.querySelectorAll("[data-fcat]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.fcat === formCat);
  });
  segRecur.querySelectorAll("[data-recur]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.recur === formRecur);
  });
}
function renderTagChips(){
  tagWrap.querySelectorAll(".tag").forEach(function(el){ el.remove(); });
  tagsCache.forEach(function(tg, i){
    var span = document.createElement("span");
    span.className = "tag tag-primary";
    span.innerHTML = esc(tg) + '<button class="x" type="button" data-tag-del="' + i +
      '" aria-label="移除标签 ' + esc(tg) + '">' + icon("close", 10) + '</button>';
    tagWrap.insertBefore(span, iTags);
  });
}
function syncProgVal(){ progVal.textContent = (Number(iProg.value) || 0) + "%"; }
function renderTimeline(logs){
  if(!timelineBox) return;
  if(!logs || !logs.length){
    timelineBox.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
    return;
  }
  timelineBox.innerHTML = logs.map(function(l){
    var txt = l.detail || l.action || "";
    var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
    return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
      '<span class="tl-detail">' + actor + esc(txt) + '</span></div>';
  }).join("");
}
var origProgress = 0;      // 已完成任务入列前的原始进度（O-13：展示 100%，保存时保留原值）
var startedDone = false;   // 打开抽屉时该任务是否已在已完成列
var commentsCache = [];
/** 抽屉里的「实际投入」：有预估就带出消耗比例，超了标红、接近标黄 */
function renderActualEstimate(actualMinutes, estimateMinutes){
  if(!iActual) return;
  var act = Number(actualMinutes) || 0;
  var est = Number(estimateMinutes) || 0;
  iActual.className = "est-actual";
  if(!act && !est){
    iActual.textContent = "—";
    return;
  }
  var html = fmtMinutesShort(act);
  if(est > 0){
    var r = act / est;
    html += ' <span class="ea-ratio">/ 预估 ' + fmtMinutesShort(est) + '（' + Math.round(r * 100) + '%）</span>';
    if(r >= 1) iActual.classList.add("over");
    else if(r >= 0.8) iActual.classList.add("near");
  }else{
    html += ' <span class="ea-ratio">还没填预估</span>';
  }
  iActual.innerHTML = html;
}

function openTaskDrawer(colId, task, defaults){  taskFormSeq++;
  editingId = task ? task.id : null;
  formDirty = false;
  if(task) taskCacheExtra[task.id] = task;
  if(drawerNotice) drawerNotice.hidden = true;
  /* 分支列表可能还没拉回来（比如刚登录就直接点开卡片）：补一次。
     loadBranches 内部会调 populateBranchSelect()，它保留当前选中值，不会冲掉刚回填的分支。 */
  if(!branchesLoaded) loadBranches();

  if(task){
    var isDone = task.boardColumn === "done";
    startedDone = isDone;
    taskDrawerTitle.textContent = task.title || "任务详情";
    btnDeleteTask.hidden = false;
    iTitle.value = task.title || "";
    iDesc.value = task.description || "";
    iStart.value = task.startDate || "";
    iDue.value = task.dueDate || "";
    if($("iMilestone")) $("iMilestone").checked = !!task.isMilestone;
    syncDateBounds();
    /* 预估耗时：库里存分钟，表单用小时（0.5 步进） */
    if(iEstimate) iEstimate.value = task.estimateMinutes ? (task.estimateMinutes / 60) : "";
    renderActualEstimate(task.totalMinutes, task.estimateMinutes);
    formPri = task.priority || "P2";
    formCat = task.category || (categoriesCache.length ? categoriesCache[0].name : "");
    populateColSelect();
    iCol.value = task.boardColumn || "backlog";
    populateReqSelect();
    iReq.value = task.reqId || "";
    populateReqDocSelect(task.reqDocId || "");
    populateBranchSelect(task.branchId || "");
    origProgress = (typeof task.progress === "number") ? task.progress : 0;
    iProg.value = origProgress;
    iNote.value = task.note || "";
    formRecur = task.recurType || "";
    iRemind.value = task.remindAt ? String(task.remindAt).substring(0, 16) : "";
    if(iRemindTarget) iRemindTarget.value = task.remindTarget || "owner";
    if(iBlocked) iBlocked.checked = !!task.blocked;
    if(iBlockedReason){
      iBlockedReason.disabled = !task.blocked;
      iBlockedReason.value = task.blockedReason || "";
    }
    tagsCache = (task.tags || []).slice(0, 8);
    renderTagChips();
    populateOwnerSelect(task.owner || "", task.ownerUserId || "");
    fWork.hidden = false; fAttach.hidden = false; fSubtasks.hidden = false; fTimeline.hidden = false;
    if(fComments) fComments.hidden = false;
    loadWorkStatus(task.id);
    loadAttachments(task.id);
    loadSubtasks(task.id);
    loadComments(task.id);
    timelineBox.innerHTML = '<div class="tl-empty">加载中…</div>';
    API.get("/api/tasks/" + encodeURIComponent(task.id) + "/logs").then(function(logs){
      if(editingId === task.id) renderTimeline(logs);
    }).catch(function(){ if(editingId === task.id) renderTimeline([]); });
  }else{
    taskDrawerTitle.textContent = "新建任务";
    btnDeleteTask.hidden = true;
    startedDone = false;
    iTitle.value = ""; iDesc.value = "";
    /* 甘特图双击空白处新建时预填起止日期；普通入口保持为空 */
    iStart.value = (defaults && defaults.startDate) || "";
    iDue.value = (defaults && defaults.dueDate) || "";
    if($("iMilestone")) $("iMilestone").checked = !!(defaults && defaults.isMilestone);
    syncDateBounds();
    if(iEstimate) iEstimate.value = "";
    renderActualEstimate(0, null);
    formPri = "P2";
    formCat = categoriesCache.length ? categoriesCache[0].name : "";
    populateColSelect();
    iCol.value = colId || "backlog";
    populateReqSelect();
    iReq.value = "";
    populateReqDocSelect("");
    populateBranchSelect("");
    origProgress = 0;
    iProg.value = 0;
    iNote.value = "";
    formRecur = "";
    iRemind.value = "";
    if(iRemindTarget) iRemindTarget.value = "owner";
    if(iBlocked) iBlocked.checked = false;
    if(iBlockedReason){ iBlockedReason.disabled = true; iBlockedReason.value = ""; }
    tagsCache = [];
    renderTagChips();
    populateOwnerSelect(currentUser ? (currentUser.displayName || "") : "", currentUser ? currentUser.id : "");
    fWork.hidden = true; fAttach.hidden = true; fSubtasks.hidden = true; fTimeline.hidden = true;
    if(fComments) fComments.hidden = true;
    commentsCache = [];
    if(commentList) commentList.innerHTML = "";
    if(commentCount) commentCount.textContent = "";
  }
  syncProgVal();
  syncProgByCol();
  fTitle.classList.remove("invalid");
  syncFormSegs();
  openDrawer();
  UI.wireTooltips(taskDrawer);
  setTimeout(function(){ try{ iTitle.focus(); iTitle.select(); }catch(e){ /* noop */ } }, 60);
}
/* O-13：已完成列 = 100% 为唯一展示口径；抽屉里把进度控件置灰只读并说明，离开该列即恢复原值 */
function syncProgByCol(){
  var done = iCol && iCol.value === "done";
  var wrap = $("progWrap");
  if(done){
    iProg.value = 100;
    iProg.disabled = true;
    if(segProg) segProg.classList.add("disabled");
    if(progVal) progVal.textContent = "100%";
    if(wrap) wrap.title = "已完成任务的进度按 100% 计";
    if(hintEl()) hintEl().textContent = "已完成任务的进度按 100% 计" +
      (origProgress && origProgress !== 100 ? "（原记录 " + origProgress + "%）" : "");
  }else{
    iProg.disabled = false;
    iProg.value = origProgress;
    if(segProg) segProg.classList.remove("disabled");
    if(progVal) progVal.textContent = (Number(origProgress) || 0) + "%";
    if(wrap) wrap.title = "";
    if(hintEl()) hintEl().textContent = "0–100，拖到 100% 不会自动标记完成（完成以「移入已完成列」为准）";
  }
}
function hintEl(){ return $("progHint"); }
function tryCloseTaskDrawer(){
  if(!taskDrawer.classList.contains("on")) return;
  if(formDirty){
    UI.showConfirm({
      title:"放弃未保存的改动？",
      msg:"当前表单有未保存的修改，关闭后将会丢失。",
      okText:"放弃改动",
      cancelText:"继续编辑"
    }).then(function(ok){ if(ok) forceCloseTaskDrawer(); });
    return;
  }
  forceCloseTaskDrawer();
}
function forceCloseTaskDrawer(){
  taskFormSeq++;
  closeDrawer();
  clearWorkTick();
  editingId = null;
}
/* 表单交互 */
segPri.addEventListener("click", function(e){
  var b = e.target.closest("[data-fpri]"); if(!b) return;
  formPri = b.dataset.fpri; syncFormSegs(); formDirty = true;
});
segCat.addEventListener("click", function(e){
  var b = e.target.closest("[data-fcat]"); if(!b) return;
  formCat = b.dataset.fcat; syncFormSegs(); formDirty = true;
});
segRecur.addEventListener("click", function(e){
  var b = e.target.closest("[data-recur]"); if(!b) return;
  formRecur = b.dataset.recur; syncFormSegs(); formDirty = true;
});
segDue.addEventListener("click", function(e){
  var b = e.target.closest("[data-due]"); if(!b) return;
  iDue.value = duePresetDate(b.dataset.due) || "";
  syncDateBounds();
  formDirty = true;
});
/* 开始日期 ≤ 截止日期：用 min/max 在原生控件层面先挡一道，保存时还有服务端校验兜底 */
function syncDateBounds(){
  if(!iStart || !iDue) return;
  iStart.max = iDue.value || "";
  iDue.min = iStart.value || "";
}
if(iStart) iStart.addEventListener("change", function(){ syncDateBounds(); formDirty = true; });
/* 改预估时实时更新「实际/预估」的比例，不用保存后才看到 */
if(iEstimate) iEstimate.addEventListener("input", function(){
  formDirty = true;
  var t = editingId ? taskCacheExtra[editingId] : null;
  var act = (t && t.totalMinutes) ? t.totalMinutes : 0;
  var h = Number(this.value);
  renderActualEstimate(act, h > 0 ? Math.round(h * 60) : 0);
});
if(iDue) iDue.addEventListener("change", function(){ syncDateBounds(); formDirty = true; });
/* 开始日期的快捷设置：与截止日期的预设按钮对称 */
if(segStart) segStart.addEventListener("click", function(e){
  var b = e.target.closest("[data-start]");
  if(!b) return;
  iStart.value = startPresetDate(b.dataset.start) || "";
  syncDateBounds();
  /* 快捷按钮可能把开始日期推到截止日期之后（例如截止还停在上周，点了「本周一」）：
     这时把截止日期一起顺延，别让用户点完还得回来改另一个字段 */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    iDue.value = iStart.value;
    syncDateBounds();
    toast("截止日期已同步为与开始日期同一天", "warn");
  }
  formDirty = true;
});
segProg.addEventListener("click", function(e){
  var b = e.target.closest("[data-prog]"); if(!b) return;
  iProg.value = b.dataset.prog; syncProgVal(); formDirty = true;
});
iProg.addEventListener("input", function(){ syncProgVal(); formDirty = true; });
/* 评论区、检查清单、附件属于“任务详情里的附属操作”，不在保存任务的表单字段里：
   在里面输入/勾选/选文件不应该把主表单标脏，否则关闭时会误提示“放弃未保存的改动”。 */
function inTaskAuxSection(target){
  return !!(target && target.closest && target.closest("#fComments, #fSubtasks, #fAttach"));
}
taskForm.addEventListener("input", function(e){
  if(e.target === iProg) return;
  if(!inTaskAuxSection(e.target)) formDirty = true;
  if(e.target === iTitle) fTitle.classList.remove("invalid");
});
taskForm.addEventListener("change", function(e){
  if(!inTaskAuxSection(e.target)) formDirty = true;
});
/* O-13：切换「所在列」时同步进度控件的口径 */
iCol.addEventListener("change", function(){ syncProgByCol(); formDirty = true; });
/* N-4：勾选「被阻塞」时才允许填原因 */
if(iBlocked){
  iBlocked.addEventListener("change", function(){
    if(iBlockedReason){
      iBlockedReason.disabled = !iBlocked.checked;
      if(iBlocked.checked){ try{ iBlockedReason.focus(); }catch(e){ /* noop */ } }
      else iBlockedReason.value = "";
    }
    formDirty = true;
  });
}

/* ==================== 任务评论 / 讨论（N-6） ==================== */
function loadComments(taskId){
  if(!fComments || !commentList) return;
  commentList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/comments").then(function(list){
    if(editingId === taskId) renderComments(list);
  }).catch(function(){
    if(editingId === taskId) renderComments([]);
  });
}
function renderComments(list){
  commentsCache = list || [];
  if(commentCount) commentCount.textContent = commentsCache.length ? (commentsCache.length + " 条") : "";
  if(!commentsCache.length){
    commentList.innerHTML = '<div class="sub-empty">还没有评论。这里是讨论区，与下方「操作时间线」分开：时间线记系统做了什么，评论记人说了什么。</div>';
    return;
  }
  var myId = currentUser ? currentUser.id : "";
  commentList.innerHTML = commentsCache.map(function(c){
    var mine = c.authorId && c.authorId === myId;
    return '<div class="comment-item' + (mine ? " mine" : "") + '" data-cid="' + esc(c.id) + '">' +
      avatarHTML(c.authorName || "?", "sm") +
      '<span class="ci-main">' +
        '<span class="ci-head"><span class="ci-who">' + esc(c.authorName || "未知") + '</span>' +
          '<span class="ci-time">' + esc(fmtTs(c.createdAt)) + '</span>' +
          (mine ? '<button class="ci-del" type="button" data-comment-del="' + esc(c.id) + '">删除</button>' : '') +
        '</span>' +
        '<span class="ci-body">' + esc(c.content) + '</span>' +
      '</span>' +
    '</div>';
  }).join("");
}
function sendComment(){
  if(!editingId || !iComment || commentSending) return;
  var text = iComment.value.trim();
  if(!text) return;
  if(text.length > 500){ toast("评论最多 500 字", "warn"); return; }
  var id = editingId;
  commentSending = true;
  btnCommentSend.disabled = true;
  API.post("/api/tasks/" + encodeURIComponent(id) + "/comments", {content: text}).then(function(){
    commentSending = false;
    btnCommentSend.disabled = false;
    /* 发送期间切到了别的任务：不要把新任务抽屉里的草稿清掉 */
    if(editingId !== id) return;
    iComment.value = "";
    loadComments(id);
  }).catch(function(ex){
    commentSending = false;
    btnCommentSend.disabled = false;
    toast(ex.message || "发送失败", "bad");
  });
}
if(btnCommentSend) btnCommentSend.addEventListener("click", sendComment);
if(iComment){
  iComment.addEventListener("keydown", function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
      e.preventDefault();
      /* 阻止冒泡：否则文档级 Ctrl+Enter 会把评论当成“保存任务”，跟着提交并关闭抽屉 */
      e.stopPropagation();
      sendComment();
    }
  });
}
if(commentList){
  commentList.addEventListener("click", function(e){
    var del = e.target.closest("[data-comment-del]");
    if(!del || !editingId) return;
    var id = editingId;
    API.del("/api/comments/" + encodeURIComponent(del.dataset.commentDel)).then(function(){
      toast("评论已删除", "fs");
      loadComments(id);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
/* O-11：抽屉打开期间命中「此任务刚被他人修改」的轻提示（绝不自动覆盖草稿） */
function showDrawerNotice(text){
  if(!drawerNotice) return;
  drawerNoticeText.textContent = text;
  drawerNotice.hidden = false;
}
if(drawerNoticeReload){
  drawerNoticeReload.addEventListener("click", function(){
    if(!editingId) return;
    var id = editingId;
    drawerNotice.hidden = true;
    API.get("/api/task/" + encodeURIComponent(id)).then(function(t){
      if(!t){ toast("任务不存在或你没有访问权限", "warn"); return; }
      taskCacheExtra[t.id] = t;
      openTaskDrawer(null, t);
    }).catch(function(){ toast("刷新失败，请稍后重试", "bad"); });
  });
}
/* 标签输入 */
iTags.addEventListener("keydown", function(e){
  if(e.isComposing || e.keyCode === 229) return;
  if(e.key === "Enter" || e.key === "," || e.key === "，"){
    e.preventDefault();
    var v = iTags.value.trim().replace(/[,，]/g, "");
    if(!v) return;
    if(tagsCache.length >= 8){ toast("最多 8 个标签", "warn"); return; }
    if(v.length > 16){ toast("单个标签不超过 16 字", "warn"); v = v.slice(0, 16); }
    if(tagsCache.indexOf(v) === -1) tagsCache.push(v);
    iTags.value = "";
    renderTagChips();
    formDirty = true;
  }else if(e.key === "Backspace" && !iTags.value && tagsCache.length){
    tagsCache.pop();
    renderTagChips();
    formDirty = true;
  }
});
iTags.addEventListener("blur", function(){
  var v = iTags.value.trim().replace(/[,，]/g, "");
  if(!v) return;
  if(tagsCache.indexOf(v) === -1 && tagsCache.length < 8) tagsCache.push(v.slice(0, 16));
  iTags.value = "";
  renderTagChips();
});
tagWrap.addEventListener("click", function(e){
  var d = e.target.closest("[data-tag-del]");
  if(!d) return;
  tagsCache.splice(Number(d.dataset.tagDel), 1);
  renderTagChips();
  formDirty = true;
});
/* 区块折叠 */
taskDrawer.querySelectorAll(".drawer-sect-head").forEach(function(h){
  function toggle(){
    var sect = h.closest(".drawer-sect");
    var collapsed = sect.classList.toggle("collapsed");
    h.setAttribute("aria-expanded", String(!collapsed));
  }
  h.addEventListener("click", toggle);
  h.addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
  });
});
/* 更多操作 */
$("btnTaskMore").addEventListener("click", function(){
  if(UI.popOpen($("taskMoreMenu"))){ UI.closeAllPops(); return; }
  UI.openPop($("taskMoreMenu"), $("btnTaskMore"), {align:"left"});
});
$("taskMoreMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-task-more]");
  if(!b) return;
  var kind = b.dataset.taskMore;
  UI.closeAllPops();
  var t = editingId ? taskById(editingId) : null;
  if(kind === "copy-link"){
    copyToClipboard(window.location.origin + "/#/board", "任务链接已复制到剪贴板");
    return;
  }
  if(kind === "copy-title"){
    if(!t) return;
    copyToClipboard(t.title, "标题已复制到剪贴板");
    return;
  }
  if(kind === "trash"){
    if(!t) return;
    /* 确认框取消时抽屉保持打开；成功删除后 deleteTask 内部关闭 */
    deleteTask(t.id);
  }
});
/* 保存 */
taskForm.addEventListener("submit", function(e){
  e.preventDefault();
  var title = iTitle.value.trim();
  if(!title){
    fTitle.classList.add("invalid");
    try{ iTitle.focus(); }catch(err){ /* noop */ }
    return;
  }
  var pendingTag = iTags.value.trim().replace(/[,，]/g, "");
  if(pendingTag && tagsCache.indexOf(pendingTag) === -1 && tagsCache.length < 8) tagsCache.push(pendingTag.slice(0, 16));
  /* 开始日期 ≤ 截止日期（服务端也有同样校验，这里先拦一道省一次往返） */
  if(iStart.value && iDue.value && iStart.value > iDue.value){
    toast("开始日期不能晚于截止日期", "bad");
    try{ iStart.focus(); }catch(err){ /* noop */ }
    return;
  }
  var owner = ownerPick();
  var stillDone = (iCol.value || "backlog") === "done";
  var payload = {
    title: title,
    description: iDesc.value.trim(),
    priority: formPri,
    category: formCat || null,
    owner: owner.name,
    ownerUserId: owner.userId,
    boardColumn: iCol.value || "backlog",
    startDate: iStart.value || null,
    dueDate: iDue.value || null,
    isMilestone: !!(($("iMilestone") || {}).checked),
    reqId: iReq.value || null,
    reqDocId: (($("iReqDoc") || {}).value) || null,
    branchId: (($("iBranch") || {}).value) || null,
    /* O-13：在已完成列里不改动原进度（抽屉显示 100% 只是口径）；离开该列才写回用户设定的值 */
    progress: (startedDone && stillDone) ? origProgress : (Number(iProg.value) || 0),
    /* 小时 → 分钟；空/0 一律视为"没估"，不传 0 去污染系数 */
    estimateMinutes: (function(){
      var h = iEstimate ? Number(iEstimate.value) : 0;
      if(!h || h <= 0) return null;
      return Math.min(10080, Math.round(h * 60));
    })(),
    note: iNote.value.trim(),
    recurType: formRecur,
    remindAt: iRemind.value ? iRemind.value : null,
    remindTarget: iRemindTarget ? iRemindTarget.value : "owner",
    blocked: !!(iBlocked && iBlocked.checked),
    blockedReason: (iBlocked && iBlocked.checked && iBlockedReason)
      ? (iBlockedReason.value.trim() || null) : null,
    tags: tagsCache.slice(0, 8)
  };
  var seq = taskFormSeq;
  var wasEdit = !!editingId;
  var editId = editingId;
  btnSaveTask.disabled = true;
  btnSaveTask.classList.add("loading");
  var req = wasEdit
    ? API.put("/api/tasks/" + encodeURIComponent(editId), payload)
    : API.post("/api/tasks", payload);
  req.then(function(nt){
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
    if(seq !== taskFormSeq) return;   // 抽屉已切换：界面由新的打开流程管理
    formDirty = false;
    forceCloseTaskDrawer();
    if(wasEdit){
      toast("已更新「" + title + "」", "fs");
    }else{
      var tip = "已创建任务「" + nt.title + "」";
      var kind = "fs";
      if(nt.dueDate){
        var d = dayDiff(parseDate(nt.dueDate), TODAY);
        if(d < 0){ tip += "，已逾期 " + Math.abs(d) + " 天"; kind = "warn"; }
        else if(d === 0) tip += "，今天到期";
        else if(d <= 3) tip += "，剩余 " + d + " 天";
      }
      toast(tip, kind);
    }
    loadBoard({animate:true});
    loadReqs();
    refreshCalendarIfOpen();
    refreshListIfOpen();
    refreshGanttIfOpen();
  }).catch(function(ex){
    btnSaveTask.disabled = false;
    btnSaveTask.classList.remove("loading");
    if(seq !== taskFormSeq) return;
    toast(ex.message || "保存失败", "bad");
  });
});
$("btnCloseTask").addEventListener("click", tryCloseTaskDrawer);
$("btnCancelTask").addEventListener("click", tryCloseTaskDrawer);
$("taskScrim").addEventListener("click", tryCloseTaskDrawer);
$("btnDeleteTask").addEventListener("click", function(){
  if(!editingId) return;
  var id = editingId;
  /* 先弹确认：取消时抽屉保持打开，未保存的内容不丢；成功删除后 deleteTask 会关闭抽屉 */
  deleteTask(id);
});
/* 抽屉焦点陷阱（§12.5） */
taskDrawer.addEventListener("keydown", function(e){
  if(e.key !== "Tab") return;
  var root = taskDrawer.querySelector(".drawer");
  if(!root) return;
  var f = Array.prototype.slice.call(root.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )).filter(function(el){ return el.offsetParent !== null; });
  if(!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});
function deleteTask(id){
  var t = taskById(id);
  if(!t) return;
  UI.showConfirm({
    title:"移到回收站",
    msg:"「" + esc(t.title) + "」将移入回收站（30 天内可恢复）。确定删除？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/tasks/" + encodeURIComponent(id)).then(function(){
      if(editingId === id) forceCloseTaskDrawer();
      loadBoard({animate:false});
      loadReqs();
      refreshCalendarIfOpen();
      refreshListIfOpen();
      refreshGanttIfOpen();
      toastAction("已移入回收站「" + t.title + "」", "撤销", function(){
        API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).then(function(){
          toast("已恢复「" + t.title + "」", "fs");
          loadBoard({animate:true, movedId:id});
          loadReqs();
          refreshCalendarIfOpen();
          refreshListIfOpen();
          refreshGanttIfOpen();
        }).catch(function(ex){ toast("恢复失败：" + (ex.message || "网络异常"), "bad"); });
      }, "", 8000);
    }).catch(function(ex){
      toast("删除失败：" + (ex.message || "网络异常"), "bad");
    });
  });
}

/* ==================== 检查清单 ==================== */
function renderSubtasks(list){
  subtasksCache = list || [];
  var doneN = 0;
  subtasksCache.forEach(function(s){ if(s.done) doneN++; });
  if(subCount) subCount.textContent = subtasksCache.length ? (doneN + "/" + subtasksCache.length) : "";
  if(!subtasksCache.length){
    subList.innerHTML = '<div class="sub-empty">暂无检查项，输入后回车即可添加</div>';
    return;
  }
  subList.innerHTML = subtasksCache.map(function(s){
    return '<div class="sub-item' + (s.done ? " done" : "") + '">' +
      '<input type="checkbox" class="cbx" data-sub-toggle="' + s.id + '"' + (s.done ? " checked" : "") +
        ' aria-label="' + esc(s.title) + '" />' +
      '<span class="sub-txt">' + esc(s.title) + '</span>' +
      '<button type="button" class="sub-del" data-sub-del="' + s.id + '" title="删除检查项" aria-label="删除检查项">' +
        icon("close", 12) + '</button>' +
    '</div>';
  }).join("");
}
function loadSubtasks(taskId){
  if(!fSubtasks) return;
  subList.innerHTML = '<div class="sub-empty">加载中…</div>';
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/subtasks").then(function(list){
    if(editingId === taskId) renderSubtasks(list);
  }).catch(function(){
    if(editingId === taskId) renderSubtasks([]);
  });
}
subList.addEventListener("change", function(e){
  var cb = e.target.closest("[data-sub-toggle]");
  if(!cb || !editingId) return;
  var id = editingId;
  subList.classList.add("busy");
  API.put("/api/subtasks/" + cb.dataset.subToggle, {done: cb.checked}).then(function(){
    subList.classList.remove("busy");
    loadSubtasks(id);
    loadBoard({silent:true});
  }).catch(function(ex){
    subList.classList.remove("busy");
    cb.checked = !cb.checked;
    toast(ex.message || "更新失败", "bad");
  });
});
subList.addEventListener("click", function(e){
  var del = e.target.closest("[data-sub-del]");
  if(!del || !editingId) return;
  e.preventDefault();
  e.stopPropagation();
  var id = editingId;
  API.del("/api/subtasks/" + del.dataset.subDel).then(function(){
    loadSubtasks(id);
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
});
iSubNew.addEventListener("keydown", function(e){
  if(e.key !== "Enter") return;
  if(e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  var value = iSubNew.value.trim();
  if(!value || !editingId) return;
  var id = editingId;
  iSubNew.value = "";
  API.post("/api/tasks/" + encodeURIComponent(id) + "/subtasks", {title: value}).then(function(){
    loadSubtasks(id);
    loadBoard({silent:true});
  }).catch(function(ex){
    iSubNew.value = value;
    toast(ex.message || "添加失败", "bad");
  });
});

/* ==================== 附件 ==================== */
function csrfCookie(){
  var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}
function extOfName(filename){
  var idx = String(filename || "").lastIndexOf(".");
  return idx >= 0 ? String(filename).substring(idx + 1) : "";
}
function attUrl(id){
  return "/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
}
function attThumbUrl(id){
  return "/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
}
function loadAttachments(taskId){
  if(!fAttach) return;
  attachList.innerHTML = '<div class="attach-empty">加载中…</div>';
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/attachments").then(function(list){
    if(editingId === taskId) renderAttachments(list);
  }).catch(function(){
    if(editingId === taskId) attachList.innerHTML = '<div class="attach-empty">加载失败</div>';
  });
}
function renderAttachments(list){
  if(attachCount) attachCount.textContent = (list && list.length) ? list.length + " 个" : "";
  if(!list || !list.length){
    attachList.innerHTML = '<div class="attach-empty">暂无附件（图片、PDF、txt、md、zip，单个 ≤10MB）</div>';
    return;
  }
  attachList.innerHTML = list.map(function(a){
    var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
    var url = attUrl(a.id);
    var head = isImg
      ? '<img class="att-thumb" src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" />'
      : '<span class="att-icon">' + esc(extOfName(a.filename).toUpperCase().slice(0,4) || "FILE") + '</span>';
    return '<div class="attach-item">' + head +
      '<span class="att-name"><a href="' + url + '" target="_blank" rel="noopener" title="预览 / 下载">' + esc(a.filename) + '</a></span>' +
      '<span class="att-size">' + fmtSize(a.size) + '</span>' +
      '<span class="att-acts">' +
        '<a class="icon-btn sm" href="' + url + '" download title="下载" aria-label="下载附件">' + icon("download", 14) + '</a>' +
        '<button class="icon-btn sm danger" type="button" data-att-del="' + esc(a.id) + '" title="删除附件" aria-label="删除附件">' + icon("trash", 14) + '</button>' +
      '</span>' +
    '</div>';
  }).join("");
}
$("btnAttach").addEventListener("click", function(){ iAttachFile.click(); });
iAttachFile.addEventListener("change", function(){
  var f = iAttachFile.files && iAttachFile.files[0];
  iAttachFile.value = "";
  if(!f || !editingId) return;
  if(f.size > 10 * 1024 * 1024){ toast("文件超过 10MB，未上传", "warn"); return; }
  if(!/\.(jpe?g|png|gif|webp|pdf|txt|md|zip)$/i.test(f.name)){
    toast("不支持的文件类型（jpg/png/gif/webp/pdf/txt/md/zip）", "warn");
    return;
  }
  var id = editingId;
  var fd = new FormData();
  fd.append("file", f);
  attachList.classList.add("busy");
  var uploadUrl = "/api/tasks/" + encodeURIComponent(id) + "/attachments" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : "");
  fetch(uploadUrl, {
    method:"POST",
    credentials:"same-origin",
    headers:{ "X-XSRF-TOKEN": csrfCookie() },
    body: fd
  }).then(function(res){
    if(res.status === 401){ window.location.href = "/login.html"; throw new Error("未登录"); }
    return res.json().catch(function(){ return null; });
  }).then(function(json){
    attachList.classList.remove("busy");
    if(json && json.code === 0){
      toast("附件已上传", "fs");
      loadAttachments(id);
      loadBoard({silent:true});
    }else{
      toast((json && json.message) || "上传失败", "bad");
    }
  }).catch(function(ex){
    attachList.classList.remove("busy");
    toast(ex && ex.message ? ex.message : "上传失败", "bad");
  });
});
attachList.addEventListener("click", function(e){
  var del = e.target.closest("[data-att-del]");
  if(!del || !editingId) return;
  e.preventDefault();
  var id = editingId;
  API.del("/api/attachments/" + encodeURIComponent(del.dataset.attDel)).then(function(){
    toast("附件已删除", "fs");
    loadAttachments(id);
    loadBoard({silent:true});
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
});

/* ==================== 工时计时 ==================== */
var workTick = null, workSeq = 0, workBusy = false;
function clearWorkTick(){ if(workTick){ clearInterval(workTick); workTick = null; } }
function renderWork(d){
  if(!workVal || !btnTimer) return;
  var running = !!d.running;
  btnTimer.innerHTML = (running ? icon("pause", 14) + " 停止计时" : icon("play", 14) + " 开始计时");
  var mine = (d.myTotalMinutes && d.myTotalMinutes !== d.totalMinutes)
    ? ("（我 " + fmtMinutesShort(d.myTotalMinutes) + "）") : "";
  workVal.textContent = (running ? "计时中 · 已 " + d.elapsedMinutes + " 分钟；" : "") +
    "累计 " + fmtMinutes(d.totalMinutes) + mine;
  workVal.classList.toggle("running", running);
}
function fetchTimer(taskId, seq){
  API.get("/api/tasks/" + encodeURIComponent(taskId) + "/timer").then(function(d){
    if(seq !== workSeq || editingId !== taskId) return;
    renderWork(d);
    if(btnTimer) btnTimer.disabled = false;
  }).catch(function(){
    if(seq !== workSeq || editingId !== taskId) return;
    if(workVal) workVal.textContent = "—";
    if(btnTimer) btnTimer.disabled = true;
  });
}
function loadWorkStatus(taskId){
  if(!fWork) return;
  workSeq++;
  workBusy = false;
  if(workVal){ workVal.textContent = "加载中…"; workVal.classList.remove("running"); }
  if(btnTimer){ btnTimer.textContent = "开始计时"; btnTimer.disabled = true; }
  fetchTimer(taskId, workSeq);
  clearWorkTick();
  workTick = setInterval(function(){
    if(!taskDrawer.classList.contains("on") || !editingId){ clearWorkTick(); return; }
    if(workBusy) return;
    fetchTimer(editingId, workSeq);
  }, 30000);
}
btnTimer.addEventListener("click", function(){
  if(!editingId || btnTimer.disabled) return;
  var taskId = editingId;
  var running = btnTimer.textContent.indexOf("停止") !== -1;
  workSeq++;
  workBusy = true;
  var opSeq = workSeq;
  btnTimer.disabled = true;
  var p = running
    ? API.post("/api/tasks/" + encodeURIComponent(taskId) + "/timer/stop", {})
    : API.post("/api/tasks/" + encodeURIComponent(taskId) + "/timer/start", {});
  p.then(function(d){
    if(opSeq !== workSeq || editingId !== taskId) return;
    workBusy = false;
    btnTimer.disabled = false;
    renderWork(d);
    toast(running ? ("已停止计时，累计 " + fmtMinutes(d.totalMinutes)) : "开始计时", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){
    if(opSeq !== workSeq || editingId !== taskId) return;
    workBusy = false;
    btnTimer.disabled = false;
    toast(ex.message || "操作失败", "bad");
  });
});

/* ==================== 列表视图（§6.4） ==================== */
var listBody = $("listBody"), listMeta = $("listMeta"), listSort = $("listSort"),
    listSelectAll = $("listSelectAll"), btnListBulk = $("btnListBulk");
function enterListView(){ loadList(); }
function refreshListIfOpen(){ if(activeView === "list") loadList(); }
function loadList(opts){
  opts = opts || {};
  var seq = ++listSeq;
  if(!opts.silent){
    listBody.innerHTML = UI.skeletonRows(8);
    listMeta.textContent = "加载中…";
  }
  /* 选中态不在重载时清空：批量操作后会重载，清空让人误以为操作没生效；
     真正失效的 id 在 renderListItems 里按可见行裁剪 */
  syncListSelectionUI();
  API.get("/api/tasks/list", boardParams({sort: listSort.value})).then(function(d){
    if(seq !== listSeq) return;
    listTotal = d.total || 0;
    var shown = (d.items || []).length;
    listMeta.textContent = "共 " + listTotal + " 项" +
      (filterOn() ? " · 已筛选 " + shown + " 项" : "") +
      (listTotal > 500 ? "（仅显示前 500 项，请用筛选缩小范围）"
        : (listTotal > shown ? "（已截断）" : ""));
    renderListItems(d.items || []);
  }).catch(function(ex){
    if(seq !== listSeq) return;
    listMeta.textContent = "";
    listBody.innerHTML = UI.errorState(ex.message);
    bindRetry(listBody, function(){ loadList(); });
  });
}
function renderListItems(items){
  listCache = {};
  if(!items || !items.length){
    listSelected = {};
    listBody.innerHTML = '<div style="padding:8px">' + (filterOn()
      ? UI.emptyState({ icon:"filterOff", title:"没有符合当前筛选的任务", text:"调整或清空筛选条件后重试。", actionLabel:"清空筛选", compact:true })
      : UI.emptyState({ icon:"inbox", title:"这里还没有任务", text:"新建一个任务；或用快捷键 <b>N</b>（会自动切到看板并聚焦列内录入框）。", actionLabel:"新建任务", compact:true })) + '</div>';
    bindRetry(listBody, function(){ if(filterOn()) clearFilters(); else openTaskDrawer("backlog"); });
    syncListSelectionUI();
    return;
  }
  var keepSelected = {};
  listBody.innerHTML = items.map(function(t){
    listCache[t.id] = t;
    if(listSelected[t.id]) keepSelected[t.id] = true;
    var st = dueState(t);
    var p = progressOf(t);
    var dueTxt = t.boardColumn === "done"
      ? (t.completedAt ? ("完成于 " + fmtShortMD(parseDate(t.completedAt))) : "已完成")
      : dueText(t);
    var tagsHTML = catTag(t.category);
    (t.tags || []).slice(0, 3).forEach(function(tg){ tagsHTML += tagChip(tg); });
    var colC = colMeta(t.boardColumn);
    var colColor = colC ? colC.color : CAT_DEFAULT_COLOR;
    return '<div class="list-row" data-list-id="' + esc(t.id) + '" tabindex="0" role="row">' +
      '<span><input type="checkbox" class="cbx" data-row-check="' + esc(t.id) + '" aria-label="选择任务：' + esc(t.title) + '"' +
        (listSelected[t.id] ? ' checked' : '') + ' /></span>' +
      '<span class="lr-task">' +
        '<span class="lr-t">' + esc(t.title) + '</span>' +
        (tagsHTML ? '<span class="lr-tags">' + tagsHTML + '</span>' : '') +
      '</span>' +
      '<span class="cell"><span class="tag" style="background:' + rgbaOf(colColor,.10) + ';color:' + darken(colColor) + '">' +
        esc(colName(t.boardColumn)) + '</span></span>' +
      '<span>' + (t.boardColumn === "done"
        ? '<span class="pdot" style="color:var(--success)">' + icon("check", 13) + '</span>'
        : '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>') + '</span>' +
      '<span class="cell">' + esc(t.owner || "—") + '</span>' +
      '<span class="cell ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' + esc(dueTxt) + '</span>' +
      '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span><span class="pv">' + p + '%</span></span></span>' +
      '<span class="cell">' + (t.reqId ? esc(reqNameById(t.reqId)) : "—") + '</span>' +
      '<span class="cell-act"><button class="icon-btn sm" type="button" data-row-menu="' + esc(t.id) +
        '" aria-label="更多操作" title="更多操作">' + icon("more", 15) + '</button></span>' +
    '</div>';
  }).join("");
  /* 只保留当前可见行的选中态，避免隐藏任务被批量删除 */
  listSelected = keepSelected;
  syncListSelectionUI();
}
function syncListSelectionUI(){
  var checked = listBody.querySelectorAll("[data-row-check]:checked");
  var n = checked.length;
  /* 原「移入回收站」按钮在顶部工具栏、其它批量操作在列表上方，两条并存既重复、
     又让批量入口看起来"只有一个删除"。现在统一收进列表上方那一条（元素保留，仅常驻隐藏）。 */
  btnListBulk.hidden = true;
  if(listBulkBar){
    listBulkBar.hidden = n === 0;
    if(n > 0){
      listBulkBar.innerHTML = '<div class="bulk-bar">' +
        '<span class="bk-n">已选 ' + n + ' 项</span>' +
        '<button class="btn sm" type="button" data-bulk="pri">改优先级</button>' +
        '<button class="btn sm" type="button" data-bulk="owner">改负责人</button>' +
        '<button class="btn sm" type="button" data-bulk="due">改截止</button>' +
        '<button class="btn sm" type="button" data-bulk="col">改所在列</button>' +
        '<button class="btn sm" type="button" data-bulk="tag">加标签</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm danger" type="button" data-bulk="del">' + icon("trash", 13) + ' 移入回收站</button>' +
        '<button class="btn sm ghost" type="button" data-bulk="clear">取消选择</button>' +
      '</div>';
    }else{
      listBulkBar.innerHTML = "";
    }
  }
  var all = listBody.querySelectorAll("[data-row-check]");
  listSelectAll.checked = all.length > 0 && checked.length === all.length;
  listSelectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}
function bulkIds(){
  return Object.keys(listSelected).filter(function(k){ return listSelected[k]; });
}
function bulkApply(patchFor, label){
  var ids = bulkIds();
  if(!ids.length) return;
  var okN = 0, failN = 0;
  UI.syncBusy(true);
  Promise.all(ids.map(function(id){
    var t = listCache[id];
    if(!t) return Promise.resolve();
    var patch = patchFor(t);
    if(!patch || !Object.keys(patch).length) return Promise.resolve();
    return API.put("/api/tasks/" + encodeURIComponent(id), taskPayloadWith(t, patch))
      .then(function(){ okN++; })
      .catch(function(){ failN++; });
  })).then(function(){
    UI.syncBusy(false);
    toast("批量" + label + "完成：" + okN + " 项成功" + (failN ? ("，" + failN + " 项失败") : ""),
      failN ? "warn" : "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  });
}
/* 批量改列走 move 语义（服务端批量接口）：会写移动日志、处理完成归档，
   不会像 PUT 那样绕过流程体检；批量操作也不顺手开始计时。 */
function bulkMoveTo(column){
  var ids = bulkIds();
  if(!ids.length) return;
  UI.syncBusy(true);
  API.post("/api/tasks/bulk-move", {
    ids: ids,
    column: column,
    autoTimer: false,
    autoResume: false
  }).then(function(res){
    UI.syncBusy(false);
    toast("已批量移动到「" + colName(column) + "」：" + ((res && res.moved) || ids.length) + " 项", "fs");
    loadList();
    loadBoard({silent:true});
    loadReqs();
  }).catch(function(ex){
    UI.syncBusy(false);
    toast("批量移动失败：" + (ex.message || "网络异常"), "bad");
  });
}
function openBulkMenu(anchor, kind){
  var el = document.createElement("div");
  el.className = "menu";
  var html = "";
  if(kind === "pri"){
    html = '<div class="menu-title">改为优先级</div>' + PRIORITIES.map(function(p){
      return '<button class="menu-item" type="button" data-bv="pri" data-v="' + p + '">' +
        '<span class="pdot ' + p + '"><i></i>' + p + '</span></button>';
    }).join("");
  }else if(kind === "owner"){
    html = '<div class="menu-title">改为负责人</div>' + ownerOptions().map(function(o){
      return '<button class="menu-item" type="button" data-bv="owner" data-v="' + esc(o.id) + '" data-n="' + esc(o.name) + '">' +
        avatarHTML(o.name, "sm") + esc(o.name) + '</button>';
    }).join("");
  }else if(kind === "due"){
    html = '<div class="menu-title">改为截止日期</div>' +
      [["0","今天"],["1","明天"],["w5","一周后（5 个工作日）"]].map(function(x){
        return '<button class="menu-item" type="button" data-bv="due" data-v="' + x[0] + '">' + x[1] + '</button>';
      }).join("") +
      '<button class="menu-item" type="button" data-bv="due" data-v="">清除截止日期</button>';
  }else if(kind === "col"){
    html = '<div class="menu-title">改为所在列</div>' + COLUMNS.map(function(c){
      return '<button class="menu-item" type="button" data-bv="col" data-v="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    }).join("");
  }
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-bv]");
    if(!b) return;
    var k = b.dataset.bv, v = b.dataset.v, n = b.dataset.n;
    UI.closeAllPops();
    if(k === "pri") bulkApply(function(){ return {priority: v}; }, "改优先级");
    else if(k === "owner") bulkApply(function(){ return {owner: n, ownerUserId: v || null}; }, "改负责人");
    else if(k === "due") bulkApply(function(){ return {dueDate: duePresetDate(v)}; }, "改截止");
    else if(k === "col") bulkMoveTo(v);
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
if(listBulkBar){
  listBulkBar.addEventListener("click", function(e){
    var b = e.target.closest("[data-bulk]");
    if(!b) return;
    var kind = b.dataset.bulk;
    if(kind === "clear"){
      listSelected = {};
      listBody.querySelectorAll("[data-row-check]").forEach(function(cb){ cb.checked = false; });
      syncListSelectionUI();
      return;
    }
    if(kind === "del"){
      /* 复用原有的二次确认 + 撤销 Toast 流程（元素常驻隐藏，但 JS 仍可触发） */
      btnListBulk.click();
      return;
    }
    if(kind === "tag"){
      var name = window.prompt("要批量添加的标签名（≤16 字，已存在则跳过）");
      if(!name) return;
      name = String(name).trim().slice(0, 16);
      if(!name) return;
      bulkApply(function(t){
        var tags = (t.tags || []).slice();
        if(tags.indexOf(name) === -1){
          if(tags.length >= 8) return null;   // 已达上限：跳过该条
          tags.push(name);
        }
        return {tags: tags};
      }, "加标签");
      return;
    }
    openBulkMenu(b, kind);
  });
}
listBody.addEventListener("click", function(e){
  if(e.target.closest("input[type=checkbox]")) return;
  var menuBtn = e.target.closest("[data-row-menu]");
  if(menuBtn){ openRowMenu(menuBtn, menuBtn.dataset.rowMenu); return; }
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  var t = listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listBody.addEventListener("change", function(e){
  var cb = e.target.closest("[data-row-check]");
  if(!cb) return;
  listSelected[cb.dataset.rowCheck] = cb.checked;
  syncListSelectionUI();
});
listBody.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  if(e.target.closest("input,button")) return;
  var row = e.target.closest("[data-list-id]");
  if(!row) return;
  e.preventDefault();
  var t = listCache[row.dataset.listId];
  if(t) openTaskDrawer(null, t);
});
listSelectAll.addEventListener("change", function(){
  listBody.querySelectorAll("[data-row-check]").forEach(function(cb){
    cb.checked = listSelectAll.checked;
    listSelected[cb.dataset.rowCheck] = listSelectAll.checked;
  });
  syncListSelectionUI();
});
btnListBulk.addEventListener("click", function(){
  var ids = Object.keys(listSelected).filter(function(k){ return listSelected[k]; });
  if(!ids.length) return;
  UI.showConfirm({
    title:"批量移入回收站",
    msg:"将把选中的 <b>" + ids.length + "</b> 项任务移入回收站（30 天内可恢复）。确定继续？",
    okText:"移到回收站"
  }).then(function(ok){
    if(!ok) return;
    btnListBulk.disabled = true;
    UI.syncBusy(true);
    Promise.all(ids.map(function(id){
      return API.del("/api/tasks/" + encodeURIComponent(id)).catch(function(){ return null; });
    })).then(function(){
      UI.syncBusy(false);
      btnListBulk.disabled = false;
      toastAction("已移入回收站 " + ids.length + " 项", "撤销", function(){
        Promise.all(ids.map(function(id){
          return API.post("/api/tasks/" + encodeURIComponent(id) + "/restore", {}).catch(function(){ return null; });
        })).then(function(){
          toast("已恢复 " + ids.length + " 项", "fs");
          loadList(); loadBoard({animate:false}); loadReqs();
        });
      }, "", 8000);
      loadList(); loadBoard({animate:false}); loadReqs();
    });
  });
});
function openRowMenu(anchor, id){
  var t = listCache[id];
  if(!t) return;
  var isDone = t.boardColumn === "done";
  var running = !!(state.runningTimer && state.runningTimer.taskId === t.id);
  var html = '<button class="menu-item" type="button" data-row-act="edit">' + icon("edit", 14) + '编辑</button>' +
    '<button class="menu-item" type="button" data-row-act="done">' + icon(isDone ? "undo" : "check", 14) +
      (isDone ? "取消完成" : "标记完成") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="due">' + icon("calSmall", 14) + '改期</button>' +
    '<button class="menu-item" type="button" data-row-act="timer">' +
      icon("timer", 14) + (running ? "停止计时" : "开始计时") + '</button>' +
    '<button class="menu-item" type="button" data-row-act="copy">' + icon("copy", 14) + '复制标题</button>' +
    '<button class="menu-item" type="button" data-row-act="link">' + icon("extlink", 14) + '复制任务链接</button>';
  var others = COLUMNS.filter(function(c){ return c.id !== t.boardColumn; });
  if(others.length){
    html += '<div class="menu-sep"></div><div class="menu-title">移动到</div>';
    others.forEach(function(c){
      html += '<button class="menu-item" type="button" data-row-move="' + esc(c.id) + '">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + esc(c.color || CAT_DEFAULT_COLOR) + '"></span>' +
        esc(c.name) + '</button>';
    });
  }
  html += '<div class="menu-sep"></div>' +
    '<button class="menu-item danger" type="button" data-row-act="del">' + icon("trash", 14) + '移到回收站</button>';
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = html;
  el.addEventListener("click", function(e){
    var act = e.target.closest("[data-row-act]");
    var mv = e.target.closest("[data-row-move]");
    UI.closeAllPops();
    if(act){
      var k = act.dataset.rowAct;
      if(k === "due"){
        setTimeout(function(){ openDuePopover(anchor, t.id); }, 0);
      }else if(k === "edit") openTaskDrawer(null, t);
      else if(k === "done") toggleTaskDone(t.id);
      else if(k === "timer") toggleTaskTimer(t.id);
      else if(k === "link") copyToClipboard(taskLink(t.id), "任务链接已复制（可直接定位到该任务）");
      else if(k === "copy") copyToClipboard(t.title, "标题已复制到剪贴板");
      else if(k === "del") deleteTask(t.id);
      return;
    }
    if(mv){
      var to = mv.dataset.rowMove;
      API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: to}).then(function(res){
        toast("「" + t.title + "」移动到「" + colName(res.to) + "」" +
          (res.autoTimerStarted ? " · 已开始计时" : ""));
        loadList(); loadBoard({silent:true}); loadReqs();
      }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
    }
  });
  UI.openPop(el, anchor, {align:"left", onClose: function(){ el.remove(); }});
}
listSort.addEventListener("change", function(){ loadList(); });

/* ==================== 日历视图（§6.5） ==================== */
var calGrid = $("calGrid"), calLabel = $("calLabel"), calDayList = $("calDayList");
function enterCalendarView(){
  var now = new Date();
  if(calState.year === null){ calState.year = now.getFullYear(); calState.month = now.getMonth() + 1; }
  if(calState.selected === null) calState.selected = iso(TODAY);
  loadCalendar();
}
function refreshCalendarIfOpen(){ if(activeView === "calendar") loadCalendar(); }
function refreshGanttIfOpen(){ if(activeView === "gantt") loadGantt({silent:true}); }
function calShift(delta){
  calState.month += delta;
  if(calState.month < 1){ calState.month = 12; calState.year--; }
  if(calState.month > 12){ calState.month = 1; calState.year++; }
  loadCalendar();
}
function loadCalendar(opts){
  opts = opts || {};
  var seq = ++calState.seq;
  if(!opts.silent){
    calLabel.textContent = "加载中…";
    calGrid.innerHTML = '<div style="grid-column:1/-1;padding:20px">' + UI.skeletonRows(6) + '</div>';
    calDayList.innerHTML = '<div class="skel skel-line" style="width:60%"></div>';
  }
  API.get("/api/calendar", {year: calState.year, month: calState.month}).then(function(d){
    if(seq !== calState.seq) return;
    calState.year = d.year;
    calState.month = d.month;
    calState.tasks = d.tasks || [];
    renderCalendar();
  }).catch(function(ex){
    if(seq !== calState.seq) return;
    calLabel.textContent = "";
    calGrid.innerHTML = '<div style="grid-column:1/-1;padding:20px">' + UI.errorState(ex.message) + '</div>';
    bindRetry(calGrid, function(){ loadCalendar(); });
  });
}
function calFindTask(id){
  for(var i = 0; i < calState.tasks.length; i++) if(calState.tasks[i].id === id) return calState.tasks[i];
  return null;
}
/* 日历上的实际区间：[开始日期, 截止日期]。
   已完成且早于截止日 → 结束日收敛到**完成日**：提前做完的事不该在之后的日期里继续出现。 */
function calRangeOf(t){
  if(!t || !t.dueDate) return null;
  var end = t.dueDate;
  if(t.boardColumn === "done" && t.completedAt && t.completedAt < end) end = t.completedAt;
  var begin = (t.startDate && t.startDate <= end) ? t.startDate : end;
  return {begin: begin, end: end};
}
function renderCalendar(){
  calLabel.textContent = calState.year + " 年 " + calState.month + " 月";
  var first = new Date(calState.year, calState.month - 1, 1);
  var startOffset = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(calState.year, calState.month, 0).getDate();
  var monthFirst = calState.year + "-" + pad2(calState.month) + "-01";
  var monthLast = calState.year + "-" + pad2(calState.month) + "-" + pad2(daysInMonth);

  /* 按 [开始日期, 截止日期] 区间逐日铺开：正在做的任务每天都应该出现在日历上。
     没填开始日期（或开始晚于截止）就只占截止日那一格，与升级前行为一致。 */
  var byDay = {};
  var q = (state.q || "").toLowerCase();
  calState.tasks.forEach(function(t){
    if(q && [t.title, t.description, t.note].join(" ").toLowerCase().indexOf(q) === -1) return;
    var range = calRangeOf(t);
    if(!range) return;
    var begin = range.begin, end = range.end;
    if(end < monthFirst || begin > monthLast) return;
    var from = begin < monthFirst ? monthFirst : begin;
    var to = end > monthLast ? monthLast : end;
    var cur = parseDate(from), lastD = parseDate(to);
    while(cur <= lastD){
      var key = iso(cur);
      (byDay[key] = byDay[key] || []).push({t: t, isStart: key === begin, isEnd: key === end});
      cur = addDays(cur, 1);
    }
  });
  var html = "";
  for(var i = 0; i < startOffset; i++) html += '<div class="cal-day out"></div>';
  for(var day = 1; day <= daysInMonth; day++){
    var dateIso = calState.year + "-" + pad2(calState.month) + "-" + pad2(day);
    var list = byDay[dateIso] || [];
    var cls = "cal-day";
    if(dateIso === TODAY_ISO) cls += " today";
    if(calState.selected === dateIso) cls += " sel";
    var chips = "";
    for(var k = 0; k < Math.min(list.length, 3); k++){
      var it = list[k], t = it.t;
      var kind = dueState(t).kind;
      /* 已完成的任务在区间内每一格都显示完成日；未完成才提示"进行中，截止 X" */
      var tip = (it.isEnd || kind === "done") ? dueText(t) : ("进行中，截止 " + t.dueDate);
      chips += '<button type="button" class="cal-chip p-' + esc(t.priority) +
        (t.boardColumn === "done" ? " done" : "") + (kind === "over" ? " over" : "") +
        (it.isEnd ? "" : " span") +
        '" data-cal-id="' + esc(t.id) + '" title="' + esc(t.title + " · " + tip) + '">' +
        '<i class="cbar"></i>' + esc(t.title) + '</button>';
    }
    if(list.length > 3) chips += '<span class="cal-more">+' + (list.length - 3) + ' 更多</span>';
    html += '<div class="' + cls + '" data-cal-date="' + dateIso + '" role="button" tabindex="0" aria-label="' + dateIso + '">' +
      '<button class="cal-add" type="button" data-cal-add="' + dateIso + '" title="在这一天新建任务" aria-label="在 ' + dateIso + ' 新建任务">' +
        icon("plus", 12) + '</button>' +
      '<span class="cal-dn">' + day + '</span>' +
      '<div class="cal-tasks">' + chips + '</div>' +
    '</div>';
  }
  calGrid.innerHTML = html;
  renderCalDayList();
  loadUnplanned();
}
/* O-19：日期格内就地新建（带日期预填） */
function openNewTaskOnDate(dateIso){
  openTaskDrawer("backlog");
  iDue.value = dateIso;
  syncDateBounds();
  formDirty = false;   // 预填不算用户改动，避免关抽屉时无故挽留
}
/* O-25：本月未排期（没有截止日期 → 在日历里完全隐形） */
function loadUnplanned(){
  if(!unplannedBox) return;
  API.get("/api/tasks/list", {noDue: true, sort: "priority"}).then(function(d){
    var items = (d && d.items) || [];
    items.forEach(function(t){ taskCacheExtra[t.id] = t; });
    if(unplannedCount) unplannedCount.textContent = String(items.length);
    if(unplannedList){
      unplannedList.innerHTML = items.length
        ? items.slice(0, 50).map(function(t){ return cardHTML(t, 0); }).join("") +
          (items.length > 50 ? '<p class="foot-note">仅显示前 50 项，共 ' + items.length + ' 项未排期</p>' : "")
        : '<div class="col-empty">本月没有未排期的任务：所有任务都已有截止日期。</div>';
    }
  }).catch(function(){
    if(unplannedCount) unplannedCount.textContent = "—";
    if(unplannedList) unplannedList.innerHTML = '<div class="col-empty">未排期任务加载失败（该接口需要后端支持）</div>';
  });
}
/* 统一给「非看板容器」里的卡片接上改期/菜单/勾选/打开（日历侧栏、未排期区复用） */
function wireCardContainer(root){
  if(!root || root.__cardWired) return;
  root.__cardWired = true;
  root.addEventListener("click", function(e){
    var due = e.target.closest("[data-due-pop]");
    if(due){ openDuePopover(due, due.dataset.duePop); return; }
    var menu = e.target.closest("[data-card-menu]");
    if(menu){ openCardMenu(menu, menu.dataset.cardMenu); return; }
    var docBtn = e.target.closest("[data-open-reqdoc]");
    if(docBtn){ openReqDocAndJump(docBtn.dataset.openReqdoc); return; }
    var tmr = e.target.closest("[data-timer-toggle]");
    if(tmr){ toggleTaskTimer(tmr.dataset.timerToggle); return; }
    var tick = e.target.closest("[data-done-toggle]");
    if(tick){ toggleTaskDone(tick.dataset.doneToggle); return; }
    if(e.target.closest("button,a")) return;
    var card = e.target.closest(".card");
    if(card && Date.now() > suppressClickUntil) openTaskDrawer(null, taskById(card.dataset.id));
  });
}
function renderCalDayList(){
  if(!calState.selected){
    calDayList.innerHTML = '<div class="empty-state compact"><span class="es-ic">' + icon("calendar", 40) + '</span>' +
      '<p>点击左侧日期查看当天全部截止任务</p></div>';
    return;
  }
  var sel = parseDate(calState.selected);
  var selIso = calState.selected;
  /* 区间包含判断：在 [开始, 实际结束] 内每一天的侧栏里都应该看得到（提前完成的任务不再往后铺） */
  var list = calState.tasks.filter(function(t){
    var range = calRangeOf(t);
    return !!range && selIso >= range.begin && selIso <= range.end;
  });
  list.forEach(function(t){ taskCacheExtra[t.id] = t; });
  var html = '<div class="cal-side-head">' +
      '<h3>' + fmtMD(sel) + ' ' + weekdayCN(sel) + '</h3>' +
      '<span class="foot-note">共 ' + list.length + ' 项任务</span>' +
    '</div>';
  html += '<div class="cal-side-list">' + (list.length
    ? list.map(function(t){ return cardHTML(t, 0); }).join("")
    : '<div class="col-empty">当日没有到期或在做的任务</div>') + '</div>';
  calDayList.innerHTML = html;
  wireCardContainer(calDayList);
  UI.wireTooltips(calDayList);
}
$("calPrev").addEventListener("click", function(){ calShift(-1); });
$("calNext").addEventListener("click", function(){ calShift(1); });
$("calToday").addEventListener("click", function(){
  var now = new Date();
  calState.year = now.getFullYear();
  calState.month = now.getMonth() + 1;
  calState.selected = iso(TODAY);
  loadCalendar();
});
calGrid.addEventListener("click", function(e){
  var addBtn = e.target.closest("[data-cal-add]");
  if(addBtn){ e.stopPropagation(); openNewTaskOnDate(addBtn.dataset.calAdd); return; }
  var chip = e.target.closest("[data-cal-id]");
  if(chip){
    e.stopPropagation();
    var t = calFindTask(chip.dataset.calId);
    if(t) openTaskDrawer(null, t);
    return;
  }
  var cell = e.target.closest("[data-cal-date]");
  if(cell){
    calState.selected = cell.dataset.calDate;
    renderCalendar();
  }
});
calGrid.addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var cell = e.target.closest("[data-cal-date]");
  if(!cell) return;
  e.preventDefault();
  calState.selected = cell.dataset.calDate;
  renderCalendar();
});
calDayList.addEventListener("click", function(e){
  if(e.target.closest("button,a")) return;
  var card = e.target.closest(".card");
  if(!card) return;
  var t = taskById(card.dataset.id);
  if(t) openTaskDrawer(null, t);
});
if(unplannedList) wireCardContainer(unplannedList);

/* ==================== 甘特图视图 ==================== */
var ganttScroll = $("ganttScroll"), ganttMeta = $("ganttMeta"),
    ganttShowDoneEl = $("ganttShowDone"), ganttZoomEl = $("ganttZoom"),
    ganttGroupEl = $("ganttGroup"), ganttRangeModeEl = $("ganttRangeMode"),
    ganttRangeLabelEl = $("ganttRangeLabel"), ganttPrevMonthEl = $("ganttPrevMonth"),
    ganttNextMonthEl = $("ganttNextMonth"), ganttFilterBtn = $("ganttFilterBtn"),
    ganttFilterMenu = $("ganttFilterMenu"), ganttFilterCountEl = $("ganttFilterCount"),
    ganttClearFilterEl = $("ganttClearFilter"), ganttNoticeEl = $("ganttNotice"),
    ganttUnplannedBox = $("ganttUnplannedBox"), ganttUnplannedCount = $("ganttUnplannedCount"),
    ganttUnplannedList = $("ganttUnplannedList"),
    ganttUndoBtn = $("ganttUndo"), ganttNewBtn = $("ganttNew"),
    ganttViewsBtn = $("ganttViewsBtn"), ganttViewsMenu = $("ganttViewsMenu"),
    ganttExportBtn = $("ganttExportBtn"), ganttExportMenu = $("ganttExportMenu"),
    ganttScaleEl = $("ganttScale"), ganttAnalysisBtn = $("ganttAnalysisBtn"),
    ganttAnalysisMenu = $("ganttAnalysisMenu"), ganttDepMenu = $("ganttDepMenu"),
    ganttLoadBox = $("ganttLoad"), ganttLoadBody = $("ganttLoadBody"),
    ganttLoadRangeEl = $("ganttLoadRange"), ganttLoadCloseEl = $("ganttLoadClose"),
    btnTheme = $("btnTheme");
var GANTT_LABEL_W = 280;
/* 行高 / 分组头高度 / 表头高度：依赖线定位与渲染共用，改一处即可 */
var GANTT_ROW_H = 54, GANTT_GROUP_H = 32, GANTT_HEAD_H = 54;
var GANTT_LABEL_W_NARROW = 170;
var GANTT_PAGE = 500;          // 单次拉取条数
var GANTT_MAX_LOAD = 3000;     // 前端最多自动加载条数（超出提示“加载更多”）
var GANTT_MAX_DAYS = 740;   // 自动范围的安全上限；超过就切月视图，避免一次生成数千个日期表头
var GANTT_BC = {
  P0:{c:"var(--p0)", soft:"var(--p0-soft)", bd:"var(--danger-border)"},
  P1:{c:"var(--p1)", soft:"var(--p1-soft)", bd:"var(--warning-border)"},
  P2:{c:"var(--p2)", soft:"var(--p2-soft)", bd:"var(--info-border)"},
  P3:{c:"var(--p3)", soft:"var(--p3-soft)", bd:"var(--border-strong)"}
};
var GANTT_DONE    = {c:"var(--success)", soft:"var(--success-soft)", bd:"var(--success-border)"};
var GANTT_BLOCKED = {c:"var(--warning)", soft:"var(--warning-soft)", bd:"var(--warning-border)"};
var GANTT_OVERDUE = {c:"var(--danger)",  soft:"var(--danger-soft)",  bd:"var(--danger-border)"};
var ganttTipEl = null, ganttDropEl = null;
var ganttSuppressUnplannedClick = 0;
var ganttState = {
  tasks: [], byId: {}, dayW: 28, showDone: false, range: null, seq: 0, drag: null,
  total: 0, scrolled: false, unplannedAuto: false,
  groupBy: "none", collapsed: {}, rangeMode: "auto", anchorMonth: null,
  notice: "", unplannedDrag: null,
  rows: [],               // 当前渲染的已排期行（{t, s, e, rs, re}），CSV 与多选范围共用
  undated: [],            // 未排期任务（左下方抽屉）
  sel: {}, selAnchor: null,
  undo: [], undoBusy: false,   // 改期撤销栈，最多 20 步
  /* ---- V1.4 ---- */
  zoomDayW: 28,           // 「日」刻度下的像素宽度
  scale: "day",           // day | week | month
  sortBy: "start",        // start | due | priority | owner | progress
  groupBy2: "none",       // 第二级分组
  cols: { project: true, owner: true, dates: true, work: true, subtask: true, tags: false, comments: false },
  deps: [], depById: {},
  baseline: {}, baselineAt: null, baselineOn: false,
  showCritical: false, critical: null, criticalDeps: {},
  showLoad: false,
  paging: { total: 0, loaded: 0, hasMore: false, loading: false, nextOffset: 0 },
  layout: [], layoutH: 0, win: { start: -1, end: -1 }, winGeom: {},
  depsLoaded: false,      // false=服务端没返回 deps 字段，渲染时回落 blockedByTaskId
  printAll: false, pendingTop: null,
  loadData: null, loadDoneKey: "", loadKey: "", loadSeq: 0, loadLoading: false,
  serverUnplanned: null, unplannedTasks: [], unscheduledTotal: 0, exportBusy: false, pendingNotice: "",
  wsId: null,
  depDrag: null
};

var GANTT_DEFAULT_COLS = { project: true, owner: true, dates: true, work: true, subtask: true, tags: false, comments: false };

/* 偏好按工作空间保存：换空间各自一套，没有空间 id 时只留在内存里 */
function ganttPrefsKey(){
  var id = currentWs && currentWs.id;
  return id ? ("ds.gantt.prefs." + id) : null;
}
function loadGanttPrefs(){
  /* 先回默认值，避免沿用上一个空间的显示设置 */
  ganttState.showDone = false;
  ganttState.zoomDayW = 28;
  ganttState.dayW = 28;
  ganttState.groupBy = "none";
  ganttState.groupBy2 = "none";
  ganttState.sortBy = "start";
  ganttState.collapsed = {};
  ganttState.scale = "day";
  ganttState.cols = {};
  for(var dk in GANTT_DEFAULT_COLS) ganttState.cols[dk] = GANTT_DEFAULT_COLS[dk];
  ganttState.baselineOn = false;
  ganttState.showCritical = false;
  ganttState.showLoad = false;

  var key = ganttPrefsKey();
  if(!key) return;   // 没有空间 id：保持内存状态，不写/不读错误 key
  var saved = null;
  try{ saved = JSON.parse(localStorage.getItem(key) || "null"); }catch(e){ saved = null; }
  if(!saved || typeof saved !== "object") return;
  if(typeof saved.showDone === "boolean") ganttState.showDone = saved.showDone;
  /* 兼容 P0 时期只存 dayW 的旧偏好 */
  var dw = Number(saved.zoomDayW || saved.dayW);
  if(dw === 20 || dw === 28 || dw === 40) ganttState.zoomDayW = dw;
  if(saved.scale === "day" || saved.scale === "week" || saved.scale === "month") ganttState.scale = saved.scale;
  if(saved.groupBy === "project" || saved.groupBy === "owner") ganttState.groupBy = saved.groupBy;
  if(saved.groupBy2 === "project" || saved.groupBy2 === "owner" || saved.groupBy2 === "status"
    || saved.groupBy2 === "category" || saved.groupBy2 === "priority") ganttState.groupBy2 = saved.groupBy2;
  if(saved.sortBy === "start" || saved.sortBy === "due" || saved.sortBy === "priority"
    || saved.sortBy === "owner" || saved.sortBy === "progress") ganttState.sortBy = saved.sortBy;
  if(saved.collapsed && typeof saved.collapsed === "object") ganttState.collapsed = saved.collapsed;
  /* 一级不分组 = 平铺：忽略历史遗留的二级分组偏好 */
  if(ganttState.groupBy === "none") ganttState.groupBy2 = "none";
  if(saved.cols && typeof saved.cols === "object"){
    for(var ck in GANTT_DEFAULT_COLS){
      if(typeof saved.cols[ck] === "boolean") ganttState.cols[ck] = saved.cols[ck];
    }
  }
  if(typeof saved.baselineOn === "boolean") ganttState.baselineOn = saved.baselineOn;
  if(typeof saved.showCritical === "boolean") ganttState.showCritical = saved.showCritical;
  if(typeof saved.showLoad === "boolean") ganttState.showLoad = saved.showLoad;
}
function saveGanttPrefs(){
  var key = ganttPrefsKey();
  if(!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      showDone: ganttState.showDone,
      zoomDayW: ganttState.zoomDayW,
      scale: ganttState.scale,
      groupBy: ganttState.groupBy,
      groupBy2: ganttState.groupBy2,
      sortBy: ganttState.sortBy,
      collapsed: ganttState.collapsed,
      cols: ganttState.cols,
      baselineOn: ganttState.baselineOn,
      showCritical: ganttState.showCritical,
      showLoad: ganttState.showLoad
    }));
  }catch(e){ /* 隐私模式 / 配额满：偏好只是增强，不打断使用 */ }
}
/* 「日 / 周 / 月」刻度决定每天像素宽度；日刻度再用缩放档位 */
function ganttEffectiveDayW(){
  return GS.scaleDayW(ganttState.scale, ganttState.zoomDayW);
}
function ganttLabelW(){
  return window.innerWidth <= 900 ? GANTT_LABEL_W_NARROW : GANTT_LABEL_W;
}
function ganttReadOnly(){
  return window.matchMedia("(max-width: 900px)").matches;
}

function enterGanttView(){
  /* 切换工作空间时重新定位到今天，同一空间内保留滚动位置 */
  var wsid = currentWs && currentWs.id;
  if(ganttState.wsId !== wsid){
    ganttState.wsId = wsid;
    ganttState.scrolled = false;
    /* 换空间后月视图回到当前月，避免沿用上一个空间的月份 */
    ganttState.anchorMonth = null;
    ganttState.undo = [];
    syncGanttUndoUI();
  }
  loadGanttPrefs();
  syncGanttControls();
  loadGantt();
  loadReqs().then(function(){
    if(activeView === "gantt" && !ganttState.drag && !ganttState.unplannedDrag && ganttState.tasks.length) renderGantt();
  }).catch(function(){ /* 项目名只是展示增强，失败不影响甘特图 */ });
}

function syncGanttControls(){
  if(ganttShowDoneEl) ganttShowDoneEl.checked = ganttState.showDone;
  if(ganttScaleEl) ganttScaleEl.value = ganttState.scale;
  if(ganttZoomEl){
    ganttZoomEl.value = String(ganttState.zoomDayW);
    ganttZoomEl.disabled = ganttState.scale !== "day";
  }
  if(ganttGroupEl) ganttGroupEl.value = ganttState.groupBy;
  if(ganttRangeModeEl){
    ganttRangeModeEl.querySelectorAll("[data-gantt-range]").forEach(function(b){
      b.setAttribute("aria-pressed", b.getAttribute("data-gantt-range") === ganttState.rangeMode ? "true" : "false");
    });
  }
  updateGanttRangeUI();
  renderGanttFilterState();
  renderGanttAnalysisMenu();
  syncGanttLoadPanel();
}

/* 只带 /api/gantt 支持的筛选字段；月视图把区间下推到 SQL */
function ganttLoadRange(){
  if(ganttState.rangeMode !== "month") return null;
  return ganttMonthRange(ganttState.anchorMonth || ganttMonthStart(TODAY));
}
function ganttTaskParams(offset, limit){
  var params = {
    q: state.q || null,
    owners: state.owners.length ? state.owners : null,
    pris: state.pris.length ? state.pris : null,
    cats: state.cats.length ? state.cats : null,
    reqs: state.reqs.length ? state.reqs : null,
    tags: state.tags.length ? state.tags : null,
    due: state.due || null,
    focus: state.focus ? true : null,
    blocked: state.blocked ? true : null,
    sort: "due",
    offset: offset || 0,
    limit: limit || GANTT_PAGE
  };
  var r = ganttLoadRange();
  if(r){ params.from = iso(r.start); params.to = iso(r.end); }
  return params;
}

function loadGantt(opts){
  opts = opts || {};
  if(ganttState.drag || ganttState.unplannedDrag || !ganttScroll) return;
  var silent = !!opts.silent;
  var keepSel = silent ? ganttState.sel : {};
  var keepAnchor = silent ? ganttState.selAnchor : null;
  /* 静默刷新失败时回滚到旧数据，避免页面还显示旧条、状态却已被清空 */
  ganttState.silentBackup = silent ? {
    tasks: ganttState.tasks, byId: ganttState.byId, deps: ganttState.deps,
    depById: ganttState.depById, depsLoaded: ganttState.depsLoaded,
    baseline: ganttState.baseline, baselineAt: ganttState.baselineAt,
    serverUnplanned: ganttState.serverUnplanned, unplannedTasks: ganttState.unplannedTasks,
    unscheduledTotal: ganttState.unscheduledTotal, paging: ganttState.paging,
    loadData: ganttState.loadData, critical: ganttState.critical, criticalDeps: ganttState.criticalDeps
  } : null;
  if(!silent) ganttState.silentBackup = null;
  var seq = ++ganttState.seq;
  ganttState.tasks = [];
  ganttState.byId = {};
  ganttState.deps = [];
  ganttState.depById = {};
  ganttState.depsLoaded = false;
  ganttState.loadData = null;
  ganttState.loadDoneKey = "";
  ganttState.loadLoading = false;
  ganttState.loadSeq++;
  ganttState.serverUnplanned = null;
  ganttState.unplannedTasks = [];
  ganttState.unscheduledTotal = 0;
  if(ganttUnplannedBox) ganttUnplannedBox.hidden = true;
  ganttState.baseline = {};
  ganttState.baselineAt = null;
  ganttState.critical = null;
  ganttState.criticalDeps = {};
  ganttState.sel = keepSel;
  ganttState.selAnchor = keepAnchor;
  ganttState.paging = { total: 0, loaded: 0, hasMore: true, loading: true, nextOffset: 0, silent: silent, present: {} };
  if(!silent && !ganttScroll.querySelector(".gantt-grid")){
    ganttScroll.innerHTML = '<div style="padding:20px">' + UI.skeletonRows(6) + '</div>';
    ganttMeta.textContent = "加载中…";
  }
  ganttLoadPage(seq, 0);
}

function ganttLoadPage(seq, offset){
  API.get("/api/gantt", ganttTaskParams(offset, GANTT_PAGE)).then(function(d){
    if(seq !== ganttState.seq) return;
    var fetched = (d && d.items) || [];
    var items = fetched;
    /* 分页边界排到空页时立即停住，避免 hasMore 异常导致无限递归 */
    if(offset > 0 && !fetched.length){
      ganttState.paging.hasMore = false;
      ganttState.paging.loading = false;
      if(ganttState.paging.silent){ ganttPruneSelection(); renderGantt(); ganttState.silentBackup = null; }
      return;
    }
    if(offset === 0){
      ganttState.tasks = items.slice();
      var deps = (d && d.deps) || [];
      ganttState.deps = deps;
      ganttState.depById = {};
      deps.forEach(function(dep){ ganttState.depById[dep.id] = dep; });
      ganttState.baseline = (d && d.baseline) || {};
      ganttState.baselineAt = (d && d.baselineAt) || null;
      /* 服务端返回 deps 字段（哪怕空数组）就说明迁移过，不再回落到 blockedByTaskId */
      ganttState.depsLoaded = !!(d && d.deps);
      ganttState.serverUnplanned = (d && Array.isArray(d.unscheduled)) ? d.unscheduled : null;
      ganttState.unplannedTasks = (d && d.unscheduled) || [];
      ganttState.unscheduledTotal = (d && typeof d.unscheduledCount === "number")
        ? d.unscheduledCount : ganttState.unplannedTasks.length;
      ganttState.unplannedTasks.forEach(function(t){
        ganttState.byId[t.id] = t;
        taskCacheExtra[t.id] = t;
      });
      if(!ganttState.baselineAt) ganttState.baselineOn = false;
    }else{
      /* 并发改期时 offset 分页可能重复返回同一任务：按 id 去重 */
      var known = {};
      ganttState.tasks.forEach(function(x){ known[x.id] = 1; });
      items = items.filter(function(x){ return !known[x.id]; });
      ganttState.tasks = ganttState.tasks.concat(items);
    }
    ganttState.paging.nextOffset = offset + fetched.length;
    if(!fetched.length) ganttState.paging.hasMore = false;
    var present = {};
    items.forEach(function(t){
      ganttState.byId[t.id] = t;
      taskCacheExtra[t.id] = t;
      present[t.id] = 1;
    });
    if(offset === 0 && !ganttState.paging.silent){
      Object.keys(ganttState.sel).forEach(function(id){ if(!present[id]) delete ganttState.sel[id]; });
      if(ganttState.selAnchor && !present[ganttState.selAnchor]) ganttState.selAnchor = null;
    }
    if(ganttState.paging.silent){
      for(var pid in present) ganttState.paging.present[pid] = 1;
    }
    ganttState.total = (d && typeof d.total === "number") ? d.total : ganttState.tasks.length;
    ganttState.paging.total = ganttState.total;
    ganttState.paging.loaded = ganttState.tasks.length;
    ganttState.paging.hasMore = !!(d && d.hasMore) && fetched.length > 0;
    ganttState.paging.loading = false;
    if(!ganttState.paging.silent) renderGantt();
    /* 自动拉完后续分页，但设上限，避免一次把几万条塞进浏览器 */
    /* 如果渲染过程中切了月视图并重启了加载，seq 会变，旧分页不能再追 */
    if(seq === ganttState.seq && ganttState.paging.hasMore && fetched.length > 0 && ganttState.tasks.length < GANTT_MAX_LOAD){
      ganttLoadPage(seq, ganttState.paging.nextOffset);
    }else if(ganttState.paging.silent){
      /* 静默刷新等全部分页到齐后只渲染一次 */
      ganttPruneSelection();
      renderGantt();
      ganttState.silentBackup = null;
    }
  }).catch(function(ex){
    if(seq !== ganttState.seq) return;
    ganttState.paging.loading = false;
    if(ganttState.silentBackup){
      var b = ganttState.silentBackup;
      ganttState.silentBackup = null;
      ganttState.tasks = b.tasks;
      ganttState.byId = b.byId;
      ganttState.deps = b.deps;
      ganttState.depById = b.depById;
      ganttState.depsLoaded = b.depsLoaded;
      ganttState.baseline = b.baseline;
      ganttState.baselineAt = b.baselineAt;
      ganttState.serverUnplanned = b.serverUnplanned;
      ganttState.unplannedTasks = b.unplannedTasks;
      ganttState.unscheduledTotal = b.unscheduledTotal;
      ganttState.paging = b.paging;
      ganttState.loadData = b.loadData;
      ganttState.critical = b.critical;
      ganttState.criticalDeps = b.criticalDeps;
      toast("甘特图刷新失败：" + (ex.message || "网络异常") + "（保留当前视图）", "bad");
      return;
    }
    if(!ganttState.tasks.length){
      ganttMeta.textContent = "";
      ganttScroll.innerHTML = '<div style="padding:20px">' + UI.errorState(ex.message) + '</div>';
      bindRetry(ganttScroll, function(){ loadGantt(); });
    }else{
      toast("甘特图加载失败：" + (ex.message || "网络异常"), "bad");
    }
  });
}

function ganttPruneSelection(){
  var present = ganttState.paging && ganttState.paging.present;
  if(!present) return;
  Object.keys(ganttState.sel).forEach(function(id){ if(!present[id]) delete ganttState.sel[id]; });
  if(ganttState.selAnchor && !present[ganttState.selAnchor]) ganttState.selAnchor = null;
}

function ganttMonthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function ganttMonthEnd(d){ return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function ganttMonthRange(anchor){
  var m = anchor || TODAY;
  var start = ganttMonthStart(m), end = ganttMonthEnd(m);
  return { start: start, end: end, days: dayDiff(end, start) + 1 };
}
function ganttMonthLabel(d){
  var m = d || TODAY;
  return m.getFullYear() + " 年 " + (m.getMonth() + 1) + " 月";
}

function ganttDateRange(dated){
  var min = dated[0].s, max = dated[0].e;
  dated.forEach(function(x){
    if(x.s < min) min = x.s;
    if(x.e > max) max = x.e;
  });
  /* 今天始终留在时间轴里，方便对照进度 */
  if(TODAY < min) min = TODAY;
  if(TODAY > max) max = TODAY;
  var start = addDays(min, -3), end = addDays(max, 4);
  return { start: start, end: end, days: dayDiff(end, start) + 1 };
}

function ganttMetaText(info){
  var txt = info.count + " 项";
  if(info.hiddenDone) txt += "（已隐藏 " + info.hiddenDone + " 项已完成）";
  if(info.range){
    txt += " · " + (info.mode === "month"
      ? ganttMonthLabel(ganttState.anchorMonth)
      : (fmtShortMD(info.range.start) + " → " + fmtShortMD(info.range.end)));
  }
  if(info.scale && info.scale !== "day") txt += " · " + (info.scale === "week" ? "周刻度" : "月刻度");
  if(info.baselineAt){
    var bd = String(info.baselineAt).substring(0, 10);
    txt += " · 基线 " + fmtShortMD(parseDate(bd));
  }
  var n = selectedFilterCount();
  if(n) txt += " · 已应用 " + n + " 项筛选";
  if(info.paging && info.paging.hasMore){
    txt += info.paging.loaded >= GANTT_MAX_LOAD
      ? (" · 已达加载上限 " + GANTT_MAX_LOAD + " 项，请用筛选缩小范围")
      : (" · 已加载 " + info.paging.loaded + "/" + info.paging.total);
  }
  return txt;
}

/* 状态优先级：done > blocked > overdue > 普通优先级色；阻塞且逾期时底色走阻塞，文字仍标逾期 */
function ganttStatusOf(t){
  var done = t.boardColumn === "done";
  var days = 0;
  if(!done && t.dueDate && t.dueDate < TODAY_ISO){
    days = Math.abs(dayDiff(parseDate(t.dueDate), TODAY));
  }
  if(done) return { key: "done", color: GANTT_DONE, days: 0, badge: "已完成" };
  if(t.blocked) return {
    key: "blocked", color: GANTT_BLOCKED, days: days,
    badge: days ? ("阻塞 · 逾期 " + days + " 天") : "阻塞"
  };
  if(days > 0) return { key: "overdue", color: GANTT_OVERDUE, days: days, badge: "逾期 " + days + " 天" };
  return { key: "doing", color: GANTT_BC[t.priority] || GANTT_BC.P2, days: 0, badge: "" };
}

/* ==================== 分组 / 排序 / 布局 ==================== */
function ganttGroupFieldValue(t, field){
  if(field === "project"){
    if(!t.reqId) return { v: "__none", name: "未关联项目" };
    var rn = reqNameById(t.reqId);
    return { v: t.reqId, name: (rn && rn !== "无") ? rn : "未关联项目" };
  }
  if(field === "owner") return t.owner ? { v: t.owner, name: t.owner } : { v: "__none", name: "未分配" };
  if(field === "status"){
    var st = ganttStatusOf(t);
    var nm = st.key === "done" ? "已完成" : st.key === "blocked" ? "阻塞" : st.key === "overdue" ? "逾期" : "进行中";
    return { v: st.key, name: nm };
  }
  if(field === "category") return { v: t.category || "__none", name: t.category || "未分类" };
  if(field === "priority") return { v: t.priority || "P2", name: t.priority || "P2" };
  return { v: "__all", name: "" };
}
function ganttBuildGroups(rows){
  var f1 = ganttState.groupBy, f2 = ganttState.groupBy2;
  if(f1 === "none" && f2 === "none"){
    return [{ key: "", name: "", depth: 0, rows: rows, children: [], count: rows.length }];
  }
  if(f1 === "none"){ f1 = f2; f2 = "none"; }
  var out = [], map = {};
  rows.forEach(function(x){
    var v1 = ganttGroupFieldValue(x.t, f1);
    var k1 = "1:" + f1 + ":" + v1.v;
    var g1 = map[k1];
    if(!g1){ g1 = map[k1] = { key: k1, name: v1.name, depth: 1, rows: [], children: [], count: 0 }; out.push(g1); }
    g1.rows.push(x);
    g1.count++;
    if(f2 !== "none"){
      var v2 = ganttGroupFieldValue(x.t, f2);
      var k2 = "2:" + f2 + ":" + v2.v;
      var g2 = null;
      for(var i = 0; i < g1.children.length; i++) if(g1.children[i].key === k2) g2 = g1.children[i];
      if(!g2){ g2 = { key: k2, name: v2.name, depth: 2, rows: [], count: 0 }; g1.children.push(g2); }
      g2.rows.push(x);
      g2.count++;
    }
  });
  return out;
}
function ganttSortRows(rows){
  var by = ganttState.sortBy;
  rows.sort(function(a, b){
    var c = 0;
    if(by === "due") c = (a.e - b.e) || (a.s - b.s);
    else if(by === "priority") c = PRIORITIES.indexOf(a.t.priority) - PRIORITIES.indexOf(b.t.priority);
    else if(by === "owner") c = String(a.t.owner || "").localeCompare(String(b.t.owner || ""), "zh");
    else if(by === "progress") c = progressOf(a.t) - progressOf(b.t);
    else c = (a.s - b.s) || (a.e - b.e);
    if(c) return c;
    return (a.s - b.s) || (a.e - b.e) || String(a.t.id).localeCompare(String(b.t.id));
  });
}
/* 把分组摊平成带 top 的布局数组：分组头 32px、任务行 54px */
function ganttBuildLayout(rows){
  var out = [], top = 0;
  ganttBuildGroups(rows).forEach(function(g1){
    var head1 = !!g1.key;
    var col1 = head1 && !!ganttState.collapsed[g1.key];
    if(head1){
      out.push({ type: "group", key: g1.key, name: g1.name, depth: 1, count: g1.count, collapsed: col1, top: top });
      top += GANTT_GROUP_H;
      if(col1) return;
    }
    var children = g1.children.length ? g1.children : [{ key: "", name: "", depth: 0, rows: g1.rows, count: g1.rows.length }];
    children.forEach(function(g2){
      var head2 = !!g2.key;
      var col2 = head2 && !!ganttState.collapsed[g2.key];
      if(head2){
        out.push({ type: "group", key: g2.key, name: g2.name, depth: 2, count: g2.count, collapsed: col2, top: top });
        top += GANTT_GROUP_H;
        if(col2) return;
      }
      g2.rows.forEach(function(x){
        out.push({ type: "row", x: x, top: top });
        top += GANTT_ROW_H;
      });
    });
  });
  ganttState.layoutH = top;
  return out;
}
function ganttGroupHeadHTML(e){
  return '<div class="gantt-group">' +
    '<button class="gantt-group-head' + (e.depth === 2 ? " depth-2" : "") + '" type="button" data-gantt-group-toggle="' + esc(e.key) + '" aria-expanded="' + (!e.collapsed) + '">' +
      '<span class="gantt-group-caret" aria-hidden="true">' + (e.collapsed ? "▸" : "▾") + '</span>' +
      '<span class="gantt-group-name">' + esc(e.name) + '</span>' +
      '<span class="gantt-group-cnt">' + e.count + ' 项</span>' +
    '</button>' +
  '</div>';
}

/* ==================== 任务行 ==================== */
/* 左列第三行：估时/实际、子任务、标签、评论、基线偏差；由「视图」菜单的字段开关控制 */
function ganttBaselineDelta(t){
  var b = ganttState.baseline[t.id];
  if(!b) return null;
  var curEnd = parseDate(t.dueDate) || parseDate(t.startDate);
  var baseEnd = parseDate(b.dueDate) || parseDate(b.startDate);
  if(!curEnd || !baseEnd) return null;
  return dayDiff(curEnd, baseEnd);
}
function ganttBaselineDeviation(t){
  if(!ganttState.baselineOn) return null;
  return ganttBaselineDelta(t);
}
function ganttRowInfoHTML(t){
  var est = Number(t.estimateMinutes) || 0, act = Number(t.totalMinutes) || 0;
  var subAll = Number(t.subtaskTotal) || 0, subDone = Number(t.subtaskDone) || 0;
  var out = "";
  if(ganttState.cols.work && (est || act)){
    var cls = "";
    if(est && act){
      var r = act / est;
      if(r > 1.1) cls = " over";
      else if(r < 0.8) cls = " under";
    }
    var parts = [];
    if(est) parts.push("估 " + fmtMinutesShort(est));
    if(act) parts.push("实 " + fmtMinutesShort(act));
    out += '<span class="wk' + cls + '">' + esc(parts.join(" · ")) + '</span>';
  }
  if(ganttState.cols.subtask && subAll > 0){
    out += '<span class="sub">子任务 ' + subDone + '/' + subAll + '</span>';
  }
  if(ganttState.cols.tags && t.tags && t.tags.length){
    var tl = t.tags.slice(0, 2).join(" · ") + (t.tags.length > 2 ? " +" + (t.tags.length - 2) : "");
    out += '<span class="sub">#' + esc(tl) + '</span>';
  }
  if(ganttState.cols.comments && Number(t.commentCount) > 0){
    out += '<span class="sub">评论 ' + Number(t.commentCount) + '</span>';
  }
  var dev = ganttBaselineDeviation(t);
  if(dev !== null){
    var dcls = dev > 0 ? " over" : (dev < 0 ? " under" : "");
    var dtxt = dev === 0 ? "按基线" : ("基线 " + (dev > 0 ? "+" : "-") + Math.abs(dev) + "d");
    out += '<span class="wk' + dcls + '">' + esc(dtxt) + '</span>';
  }
  return out ? '<span class="gantt-info">' + out + '</span>' : "";
}
function ganttBaselineHTML(t, range, dayW){
  if(!ganttState.baselineOn) return "";
  var b = ganttState.baseline[t.id];
  if(!b) return "";
  var bs = parseDate(b.startDate) || parseDate(b.dueDate);
  var be = parseDate(b.dueDate) || bs;
  if(!bs || !be) return "";
  if(bs > be){ var bsTmp = bs; bs = be; be = bsTmp; }
  if(be < range.start || bs > range.end) return "";
  var s2 = bs < range.start ? range.start : bs;
  var e2 = be > range.end ? range.end : be;
  var off = dayDiff(s2, range.start);
  var span = Math.max(1, dayDiff(e2, s2) + 1);
  return '<span class="gantt-baseline" style="left:' + (off * dayW) + 'px;width:' + (span * dayW) + 'px"></span>';
}

function ganttRowHTML(x, range, dayW, totalW){
  var t = x.t, s = x.rs || x.s, e = x.re || x.e;
  var off = dayDiff(s, range.start);
  var span = Math.max(1, dayDiff(e, s) + 1);
  var left = off * dayW, width = span * dayW;
  var p = progressOf(t);
  var done = t.boardColumn === "done";
  var st = ganttStatusOf(t);
  var bc = st.color;
  var selected = !!ganttState.sel[t.id];
  var isMs = !!t.isMilestone;
  var critical = !!(ganttState.showCritical && ganttState.critical && ganttState.critical[t.id]);
  var rn = t.reqId ? reqNameById(t.reqId) : "";
  if(rn === "无") rn = "";
  var meta = '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>';
  if(ganttState.cols.project && rn) meta += '<span class="ellipsis">' + esc(rn) + '</span>';
  if(ganttState.cols.owner && t.owner) meta += '<span class="ellipsis">' + esc(t.owner) + '</span>';
  var realS = parseDate(t.startDate) || parseDate(t.dueDate);
  var realE = parseDate(t.dueDate) || parseDate(t.startDate) || realS;
  var rangeText = (t.startDate && t.dueDate)
    ? fmtShortMD(realS) + '→' + fmtShortMD(realE)
    : (t.startDate ? '开始 ' + fmtShortMD(realS) : '截止 ' + fmtShortMD(realE));
  if(ganttState.cols.dates) meta += '<span>' + rangeText + '</span>';
  if(isMs) meta += '<span class="meta">里程碑</span>';
  if(st.key === "overdue"){
    meta += '<span class="meta over">逾期 ' + st.days + ' 天</span>';
  }else if(st.key === "blocked"){
    meta += '<span class="meta blocked">' + icon("alert", 12) + '阻塞' +
      (st.days ? ' · 逾期 ' + st.days + ' 天' : '') + '</span>';
  }
  var fullRange = isMs
    ? fmtFull(realS) + "（里程碑）"
    : ((t.startDate && t.dueDate)
      ? fmtFull(realS) + " → " + fmtFull(realE)
      : (t.startDate ? "开始 " + fmtFull(realS) : "截止 " + fmtFull(realE)));
  var statusText = st.key === "done" ? "已完成"
    : st.key === "blocked" ? ("阻塞" + (st.days ? "，逾期 " + st.days + " 天" : ""))
    : st.key === "overdue" ? ("逾期 " + st.days + " 天")
    : "进行中";
  var barTitle = t.title + " · " + fullRange + " · 进度 " + p + "% · " + statusText +
    (rn ? " · " + rn : "") + (t.owner ? " · " + t.owner : "");
  var est = Number(t.estimateMinutes) || 0, act = Number(t.totalMinutes) || 0;
  if(est || act){
    barTitle += " · 估 " + (est ? fmtMinutesShort(est) : "—") + " / 实 " + (act ? fmtMinutesShort(act) : "—");
  }
  if(critical) barTitle += " · 关键路径";
  var dev = ganttBaselineDelta(t);
  if(dev !== null) barTitle += " · 基线" + (dev === 0 ? "一致" : (dev > 0 ? "推迟 " + dev + " 天" : "提前 " + Math.abs(dev) + " 天"));
  var aria = t.title + "，" + fullRange + "，进度 " + p + "%，状态：" + statusText +
    (selected ? "，已选中" : "") + "。按 Enter 打开详情";
  var handles = (!isMs && t.startDate && t.dueDate)
    ? '<span class="gantt-handle l" data-gantt-handle="l"></span><span class="gantt-handle r" data-gantt-handle="r"></span>'
    : "";
  var linkDot = ganttReadOnly() ? "" :
    '<span class="gantt-link-dot" data-gantt-link="' + esc(t.id) + '" title="拖到另一条任务上建立依赖"></span>';
  var ghost = ganttBaselineHTML(t, range, dayW);
  var rowClass = "gantt-row" + (selected ? " is-selected" : "");
  var labelHTML = '<button class="gantt-label" type="button" data-gantt-open="' + esc(t.id) + '">' +
      '<span class="gantt-title">' + esc(t.title) + '</span>' +
      '<span class="gantt-meta">' + meta + '</span>' +
      ganttRowInfoHTML(t) +
    '</button>';

  if(isMs){
    var mw = Math.max(dayW, 18);
    var ml = off * dayW + (dayW - mw) / 2;
    return '<div class="' + rowClass + '" data-gantt-row-id="' + esc(t.id) + '">' +
      labelHTML +
      '<div class="gantt-track" style="width:' + totalW + 'px">' + ghost +
        '<div class="gantt-milestone-wrap' + (selected ? " is-selected" : "") + '"' +
          ' data-gantt-bar="' + esc(t.id) + '" data-gantt-milestone="1" role="button" tabindex="0"' +
          ' aria-label="' + esc(aria) + '" title="' + esc(barTitle) + '"' +
          ' style="left:' + ml + 'px;width:' + mw + 'px">' +
          '<span class="gantt-milestone' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
            (critical ? " is-critical" : "") + '"></span>' + linkDot +
        '</div>' +
      '</div>' +
    '</div>';
  }

  var inner = "";
  var hasStatus = st.key !== "doing";
  if(width >= 110 && !(hasStatus && width < 200)){
    inner += '<span class="gantt-bar-label">' + esc((done ? "✓ " : "") + t.title) + '</span>';
  }
  if(width >= 72){
    inner += '<span class="gantt-bar-stat">' + esc(hasStatus ? st.badge : (p + "%")) + '</span>';
  }else if(width >= 28 && hasStatus){
    inner += '<span class="gantt-bar-flag" aria-hidden="true">' + (done ? "✓" : "!") + '</span>';
  }
  if(hasStatus && !done && width >= 150){
    inner += '<span class="gantt-bar-pct">' + p + '%</span>';
  }
  return '<div class="' + rowClass + '" data-gantt-row-id="' + esc(t.id) + '">' +
    labelHTML +
    '<div class="gantt-track" style="width:' + totalW + 'px">' + ghost +
      '<div class="gantt-bar' + (done ? " is-done" : "") + (t.blocked ? " is-blocked" : "") +
        (st.key === "overdue" ? " is-overdue" : "") + (selected ? " is-selected" : "") +
        (critical ? " is-critical" : "") + '"' +
        ' data-gantt-bar="' + esc(t.id) + '" role="button" tabindex="0" aria-label="' + esc(aria) + '"' +
        ' style="left:' + left + 'px;width:' + width + 'px;--bc:' + bc.c +
        ';--bc-soft:' + bc.soft + ';--bc-bd:' + bc.bd + '"' +
        ' title="' + esc(barTitle) + '">' +
        (inner ? '<span class="gantt-bar-inner">' + inner + '</span>' : '') +
        '<span class="gantt-bar-fill" style="width:' + p + '%"></span>' + handles + linkDot +
      '</div>' +
    '</div>' +
  '</div>';
}

/* ==================== 依赖线（可编辑，只读渲染） ==================== */
function ganttExpectedDeps(){
  /* 依赖表为空时，兼容 P0 的 blockedByTaskId（后端迁移前/旧数据） */
  if(ganttState.depsLoaded) return ganttState.deps;
  var out = [];
  ganttState.tasks.forEach(function(t){
    if(t.blockedByTaskId && t.blockedByTaskId !== t.id){
      out.push({ id: "legacy:" + t.id, fromTaskId: t.blockedByTaskId, toTaskId: t.id, depType: "FS", lagDays: 0 });
    }
  });
  return out;
}
function ganttDepsHTML(geom, range, dayW, totalW, bodyH, headH){
  var all = ganttExpectedDeps();
  if(!all.length) return "";
  var labelW = ganttLabelW();
  var w = labelW + totalW, h = headH + bodyH;
  var out = [];
  all.forEach(function(d){
    var pred = geom[d.fromTaskId], succ = geom[d.toTaskId];
    if(!pred || !succ) return;
    var type = d.depType || "FS", lag = Number(d.lagDays) || 0;
    /* 主页面所有类型都保持 FS 式连线（历史视觉），端点计算与分享页共用同一套函数 */
    var g = GS.depGeometry(type, pred, succ, {
      fsLike: true, dayW: dayW, labelW: labelW, rangeStart: range.start,
      rowH: GANTT_ROW_H, headH: headH, predTop: pred.top, succTop: succ.top
    });
    var x1 = g.x1, y1 = g.y1, x2 = g.x2, y2 = g.y2;
    var conflict = GS.depConflict(
      { s: pred.s, e: pred.e, as: pred.as, ae: pred.ae, done: !!(pred.t && pred.t.boardColumn === "done") },
      { s: succ.s, e: succ.e, as: succ.as, ae: succ.ae },
      type, lag
    );
    var critical = !!(ganttState.showCritical && ganttState.criticalDeps && ganttState.criticalDeps[d.id]);
    var path = GS.depPath(x1, y1, x2, y2);
    var cls = "gantt-dep" + (conflict ? " is-conflict" : "") + (critical ? " is-critical-dep" : "");
    var tip = "「" + succ.t.title + "」依赖「" + pred.t.title + "」(" + type +
      (lag ? (lag > 0 ? "+" : "") + lag + " 天" : "") + ")" +
      (conflict ? "；排期冲突" : "") + (critical ? "；关键路径" : "");
    out.push('<path class="' + cls + '" d="' + path + '"' +
      ' marker-end="url(#' + (conflict ? "ganttDepArrowBad" : "ganttDepArrow") + ')"' +
      ' data-gantt-dep="' + esc(d.id) + '" data-dep-from="' + esc(d.fromTaskId) + '"' +
      ' data-dep-to="' + esc(d.toTaskId) + '">' +
      '<title>' + esc(tip) + '</title></path>');
    if(type !== "FS" || lag){
      var bx = Math.round((x1 + x2) / 2), by = Math.round((y1 + y2) / 2) - 4;
      out.push('<text class="gantt-dep-badge" x="' + bx + '" y="' + by + '" text-anchor="middle">' +
        type + (lag ? ((lag > 0 ? "+" : "") + lag) : "") + '</text>');
    }
  });
  if(!out.length) return "";
  var defs = '<defs>' +
    '<marker id="ganttDepArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)"></path></marker>' +
    '<marker id="ganttDepArrowBad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">' +
      '<path d="M0,0 L8,4 L0,8 Z" fill="var(--danger)"></path></marker>' +
    '</defs>';
  return '<svg class="gantt-deps" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    defs + out.join("") + '</svg>';
}

/* ==================== 关键路径（CPM） ==================== */
function ganttDepStart(dep, from){
  var to = dep.to, lag = dep.lag;
  if(dep.type === "SS") return from.es + lag;
  if(dep.type === "FF") return from.ef + lag - to.dur + 1;
  if(dep.type === "SF") return from.es + lag - to.dur + 1;
  return from.ef + 1 + lag;
}
function ganttDepLimit(dep){
  var from = dep.from, to = dep.to, lag = dep.lag;
  if(dep.type === "SS") return to.ls - lag + from.dur - 1;
  if(dep.type === "FF") return to.lf - lag;
  if(dep.type === "SF") return to.lf - lag + from.dur - 1;
  return to.ls - 1 - lag;
}
/** @return {{tasks:Object, deps:Object}|null} null=有环 */
function ganttComputeCritical(){
  var list = [], map = {};
  ganttState.tasks.forEach(function(t){
    var s = parseDate(t.startDate) || parseDate(t.dueDate);
    var e = parseDate(t.dueDate) || s;
    if(!s || !e) return;
    if(e < s){ var tmp = s; s = e; e = tmp; }
    var item = { id: t.id, s: s, e: e, dur: dayDiff(e, s) + 1, es: 0, ef: 0, ls: 0, lf: 0, indeg: 0, outs: [], ins: [] };
    list.push(item);
    map[t.id] = item;
  });
  if(!list.length) return { tasks: {}, deps: {} };
  var deps = [];
  ganttExpectedDeps().forEach(function(d){
    var a = map[d.fromTaskId], b = map[d.toTaskId];
    if(!a || !b) return;
    var dep = { id: d.id, from: a, to: b, type: d.depType || "FS", lag: Number(d.lagDays) || 0 };
    deps.push(dep);
    a.outs.push(dep);
    b.ins.push(dep);
    b.indeg++;
  });
  if(!deps.length) return { tasks: {}, deps: {} };

  var base = list[0].s;
  list.forEach(function(t){ if(t.s < base) base = t.s; });
  list.forEach(function(t){ t.es = dayDiff(t.s, base); t.ef = t.es + t.dur - 1; });

  var queue = [], topo = [];
  list.forEach(function(t){ if(!t.indeg) queue.push(t); });
  while(queue.length){
    var cur = queue.shift();
    topo.push(cur);
    cur.outs.forEach(function(dep){
      var cand = ganttDepStart(dep, cur);
      if(cand > dep.to.es){
        dep.to.es = cand;
        dep.to.ef = cand + dep.to.dur - 1;
      }
      dep.to.indeg--;
      if(!dep.to.indeg) queue.push(dep.to);
    });
  }
  if(topo.length !== list.length) return null;   // 有环

  var projectEnd = 0;
  list.forEach(function(t){ if(t.ef > projectEnd) projectEnd = t.ef; });
  list.forEach(function(t){ t.lf = projectEnd; });
  topo.slice().reverse().forEach(function(t){
    t.ls = t.lf - t.dur + 1;
    t.ins.forEach(function(dep){
      var lim = ganttDepLimit(dep);
      if(lim < dep.from.lf) dep.from.lf = lim;
    });
  });

  var criticalTasks = {}, criticalDeps = {};
  list.forEach(function(t){
    if(t.ls - t.es <= 0) criticalTasks[t.id] = true;
  });
  deps.forEach(function(dep){
    if(!criticalTasks[dep.from.id] || !criticalTasks[dep.to.id]) return;
    if(ganttDepStart(dep, dep.from) === dep.to.es) criticalDeps[dep.id] = true;
  });
  return { tasks: criticalTasks, deps: criticalDeps };
}
function ganttPrepareCritical(){
  ganttState.critical = null;
  ganttState.criticalDeps = {};
  if(!ganttState.showCritical) return;
  var res = ganttComputeCritical();
  if(res === null){
    ganttState.notice = "依赖存在循环，无法计算关键路径";
    return;
  }
  ganttState.critical = res.tasks;
  ganttState.criticalDeps = res.deps;
}

/* ==================== 多选 / 批量改期 / 多步撤销 ==================== */
function ganttSelCount(){ return Object.keys(ganttState.sel).length; }
function ganttClearSelection(){
  if(!ganttSelCount() && !ganttState.selAnchor) return;
  ganttState.sel = {}; ganttState.selAnchor = null;
  renderGantt();
}
function ganttToggleSelection(id){
  if(ganttState.sel[id]) delete ganttState.sel[id];
  else ganttState.sel[id] = true;
  ganttState.selAnchor = id;
  renderGantt();
}
function ganttSelectRange(id){
  /* 按屏幕上的行顺序取范围（分组/折叠后与 rows 顺序不同） */
  var order = [];
  ganttState.layout.forEach(function(e){ if(e.type === "row") order.push(e.x.t.id); });
  if(!order.length) order = ganttState.rows.map(function(x){ return x.t.id; });
  var a = order.indexOf(ganttState.selAnchor), b = order.indexOf(id);
  ganttState.sel = {};
  if(a === -1 || b === -1){
    ganttState.sel[id] = true;
  }else{
    for(var i = Math.min(a, b); i <= Math.max(a, b); i++) ganttState.sel[order[i]] = true;
  }
  ganttState.selAnchor = id;
  renderGantt();
}
function ganttPushUndo(label, changes){
  if(!changes || !changes.length) return;
  ganttState.undo.push({ label: label, changes: changes });
  if(ganttState.undo.length > 20) ganttState.undo.shift();
  syncGanttUndoUI();
}
function syncGanttUndoUI(){
  if(!ganttUndoBtn) return;
  var n = ganttState.undo.length;
  ganttUndoBtn.disabled = n === 0;
  ganttUndoBtn.textContent = n > 1 ? ("撤销 " + n) : "撤销";
}
/* 串行保存；任一条失败就回滚已成功的，避免“批量改一半” */
function ganttPutSeq(items){
  var i = 0, applied = [];
  function next(){
    if(i >= items.length) return Promise.resolve(applied);
    var it = items[i++];
    return API.put("/api/tasks/" + encodeURIComponent(it.task.id), taskPayloadWith(it.task, it.patch)).then(function(){
      applied.push(it);
      return next();
    });
  }
  return next().catch(function(err){
    var j = 0;
    function back(){
      if(j >= applied.length) return Promise.reject(err);
      var a = applied[j++];
      var restore = { startDate: a.task.startDate || null, dueDate: a.task.dueDate || null };
      return API.put("/api/tasks/" + encodeURIComponent(a.task.id), taskPayloadWith(a.task, restore)).then(back, back);
    }
    return back();
  });
}
function ganttUndoLast(){
  if(ganttState.drag || ganttState.unplannedDrag || ganttState.depDrag || ganttState.undoBusy) return;
  if(!ganttState.undo.length){ toast("没有可撤销的改期", "warn"); return; }
  var entry = ganttState.undo.pop();
  ganttState.undoBusy = true;
  syncGanttUndoUI();
  var skipped = 0, items = [];
  /* 缓存里找不到（比如切换了筛选）就按 id 拉一次最新任务，避免误判“任务已不存在” */
  Promise.all(entry.changes.map(function(c){
    var cur = ganttState.byId[c.id] || taskById(c.id) || null;
    if(cur) return Promise.resolve({ c: c, cur: cur });
    return API.get("/api/task/" + encodeURIComponent(c.id)).then(function(t){
      return { c: c, cur: t };
    }, function(){ return { c: c, cur: null }; });
  })).then(function(list){
    list.forEach(function(x){
      if(!x.cur){ skipped++; return; }
      /* 撤销前确认任务仍是那次操作后的状态，避免覆盖后来在别处做的修改 */
      if(String(x.cur.startDate || "") !== String(x.c.after.startDate || "") ||
         String(x.cur.dueDate || "") !== String(x.c.after.dueDate || "")){ skipped++; return; }
      items.push({ task: x.cur, patch: { startDate: x.c.before.startDate, dueDate: x.c.before.dueDate } });
    });
    if(!items.length){
      ganttState.undoBusy = false;
      toast(skipped ? "任务已被再次修改，未撤销" : "没有可撤销的改期", "bad");
      loadGantt();
      return;
    }
    return ganttPutSeq(items).then(function(){
      ganttState.undoBusy = false;
      toast("已撤销「" + entry.label + "」" + (skipped ? "（" + skipped + " 项已变更，未恢复）" : ""), "fs");
      loadGantt(); loadBoard({silent:true}); refreshListIfOpen(); refreshCalendarIfOpen();
    }).catch(function(ex){
      ganttState.undoBusy = false;
      toast("撤销失败：" + (ex.message || "网络异常"), "bad");
      loadGantt();
    });
  });
}

/* ==================== CSV 导出 ==================== */
function ganttCsvCell(v){
  v = (v === null || v === undefined) ? "" : String(v);
  /* 公式注入：Excel 会把 = + - @ 开头的单元格当公式执行；纯数字（含负数）保持可计算 */
  if(!/^-?\d+(\.\d+)?$/.test(v) && /^\s*[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}
function ganttStatusText(t){
  var st = ganttStatusOf(t);
  if(st.key === "done") return "已完成";
  if(st.key === "blocked") return "阻塞" + (st.days ? " · 逾期 " + st.days + " 天" : "");
  if(st.key === "overdue") return "逾期 " + st.days + " 天";
  return "进行中";
}
function ganttCsvText(scope, rowsOverride){
  var rows = rowsOverride || ((scope === "all") ? ganttAllTasks() : ganttState.rows);
  var lines = [];
  lines.push(["任务","状态","优先级","项目","负责人","开始","截止","工期(天)","进度%","估时(小时)","实际(小时)","子任务","里程碑","基线偏差(天)","标签","看板列"]
    .map(ganttCsvCell).join(","));
  rows.forEach(function(it){
    var t = it.t || it;
    var s = parseDate(t.startDate) || parseDate(t.dueDate);
    var e = parseDate(t.dueDate) || s;
    var rn = t.reqId ? reqNameById(t.reqId) : "";
    if(rn === "无") rn = "";
    var sub = Number(t.subtaskTotal) > 0 ? (Number(t.subtaskDone) || 0) + "/" + t.subtaskTotal : "";
    lines.push([
      t.title,
      ganttStatusText(t),
      t.priority || "",
      rn,
      t.owner || "",
      t.startDate || "",
      t.dueDate || "",
      (s && e) ? (dayDiff(e, s) + 1) : "",
      progressOf(t),
      t.estimateMinutes ? (Number(t.estimateMinutes) / 60).toFixed(1) : "",
      t.totalMinutes ? (Number(t.totalMinutes) / 60).toFixed(1) : "",
      sub,
      t.isMilestone ? "是" : "",
      (function(){ var dv = ganttBaselineDelta(t); return dv === null ? "" : dv; })(),
      (t.tags || []).join(" "),
      colName(t.boardColumn)
    ].map(ganttCsvCell).join(","));
  });
  return lines.join("\r\n");
}
function ganttDownloadCsv(text, name){
  var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){
    URL.revokeObjectURL(url);
    if(a.parentNode) a.parentNode.removeChild(a);
  }, 0);
  toast("已导出 " + name, "fs");
}
/* 月视图只加载了本月；「全部筛选结果」需要另外按无区间分页拉一遍再导出 */
function ganttExportAllRemote(){
  if(ganttState.exportBusy){ toast("正在准备导出…", "warn"); return; }
  ganttState.exportBusy = true;
  var collected = [], unplanned = null, offset = 0, seenIds = {};
  function ingest(list){
    (list || []).forEach(function(t){
      if(!t || !t.id || seenIds[t.id]) return;
      seenIds[t.id] = 1;
      collected.push(t);
    });
  }
  function step(){
    var params = ganttTaskParams(offset, 500);
    delete params.from;
    delete params.to;
    API.get("/api/gantt", params).then(function(d){
      var items = (d && d.items) || [];
      ingest(items);
      if(offset === 0 && Array.isArray(d && d.unscheduled)) unplanned = d.unscheduled;
      if(d && d.hasMore && items.length && collected.length < 20000){
        offset += items.length;
        step();
        return;
      }
      ganttState.exportBusy = false;
      ingest(unplanned || []);
      var all = collected;
      if(!all.length){ toast("当前筛选下没有任务", "warn"); return; }
      ganttDownloadCsv(ganttCsvText("all", all), "甘特图-" + TODAY_ISO + "-全部筛选.csv");
    }).catch(function(ex){
      ganttState.exportBusy = false;
      toast("导出失败：" + (ex.message || "网络异常"), "bad");
    });
  }
  step();
}
function ganttExportCsv(scope){
  /* 月视图只加载本月；自动范围若触及加载上限，也要重新按无区间分页拉全 */
  if(scope === "all" && (ganttState.rangeMode === "month" || ganttState.paging.hasMore)){
    ganttExportAllRemote();
    return;
  }
  if(!ganttAllTasks().length){ toast("当前没有可导出的任务", "warn"); return; }
  if(scope !== "all" && !ganttState.rows.length){ toast("当前范围没有已排期任务", "warn"); return; }
  var name = "甘特图-" + TODAY_ISO + (scope === "all" ? "-全部筛选" : "-当前范围") + ".csv";
  ganttDownloadCsv(ganttCsvText(scope), name);
}

/* ==================== 分析菜单 / 基线 / 关键路径 / 负载 / 分享 ==================== */
function ganttAnalysisItem(attr, label, active, hint){
  return '<button class="menu-item" type="button" ' + attr + '>' +
    '<span class="gantt-analysis-check">' + (active ? "✓" : "") + '</span>' + label +
    (hint ? '<span class="k">' + hint + '</span>' : '') + '</button>';
}
function renderGanttAnalysisMenu(){
  if(!ganttAnalysisMenu) return;
  var hasBaseline = !!ganttState.baselineAt;
  var isOwner = !!(currentWs && currentWs.myRole === "owner");
  ganttAnalysisMenu.innerHTML = '<div class="menu-title">分析</div>' +
    ganttAnalysisItem('data-gantt-critical', '关键路径高亮', ganttState.showCritical, '') +
    ganttAnalysisItem('data-gantt-baseline-toggle', '显示基线', ganttState.baselineOn, hasBaseline ? '' : '未设置') +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-gantt-baseline-set>设为基线（当前计划）</button>' +
    (isOwner ? '<button class="menu-item" type="button" data-gantt-baseline-clear"' + (hasBaseline ? '' : ' disabled') + '>清除基线</button>' : '') +
    '<div class="menu-sep"></div>' +
    ganttAnalysisItem('data-gantt-load', '资源负载面板', ganttState.showLoad, '') +
    (isOwner ? '<button class="menu-item" type="button" data-gantt-share>分享只读链接…</button>' : '');
}
function ganttApplyBaselineInfo(info){
  ganttState.baseline = (info && info.baseline) || {};
  ganttState.baselineAt = (info && info.baselineAt) || null;
  if(!ganttState.baselineAt) ganttState.baselineOn = false;
  saveGanttPrefs();
  renderGanttAnalysisMenu();
}
function ganttToggleCritical(){
  ganttState.showCritical = !ganttState.showCritical;
  saveGanttPrefs();
  renderGantt();
  renderGanttAnalysisMenu();
  if(ganttState.showCritical){
    if(!ganttState.critical || !Object.keys(ganttState.critical).length){
      toast(ganttState.notice || "没有可计算的关键路径（需要依赖关系）", "warn");
    }else{
      toast("已高亮 " + Object.keys(ganttState.critical).length + " 个关键任务", "fs");
    }
  }
}
function ganttToggleBaseline(){
  if(!ganttState.baselineAt){ toast("还没有基线，先点「设为基线」", "warn"); return; }
  ganttState.baselineOn = !ganttState.baselineOn;
  saveGanttPrefs();
  renderGantt();
  renderGanttAnalysisMenu();
}
function ganttCaptureBaseline(){
  if(ganttReadOnly()){ toast("移动端只读，不能设置基线", "warn"); return; }
  API.post("/api/gantt/baseline").then(function(info){
    ganttApplyBaselineInfo(info);
    ganttState.baselineOn = !!ganttState.baselineAt;
    saveGanttPrefs();
    renderGantt();
    toast("已把当前计划设为基线", "fs");
  }).catch(function(ex){ toast("设置基线失败：" + (ex.message || "网络异常"), "bad"); });
}
function ganttClearBaseline(){
  if(ganttReadOnly()){ toast("移动端只读，不能清除基线", "warn"); return; }
  if(!(currentWs && currentWs.myRole === "owner")){ toast("仅空间主可清除基线", "warn"); return; }
  UI.showConfirm({ title:"清除基线", msg:"清除后无法再对比「计划 vs 当前」，确定？", okText:"清除" }).then(function(ok){
    if(!ok) return;
    API.del("/api/gantt/baseline").then(function(){
      ganttState.baseline = {};
      ganttState.baselineAt = null;
      ganttState.baselineOn = false;
      saveGanttPrefs();
      renderGantt();
      renderGanttAnalysisMenu();
      toast("基线已清除", "fs");
    }).catch(function(ex){ toast("清除失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
function ganttToggleLoad(){
  if(!ganttState.showLoad && !ganttState.range){ toast("当前没有可统计的排期范围", "warn"); return; }
  ganttState.showLoad = !ganttState.showLoad;
  saveGanttPrefs();
  if(!ganttState.showLoad){
    ganttState.loadData = null;
    ganttState.loadDoneKey = "";
    ganttState.loadLoading = false;
    ganttState.loadSeq++;
  }
  syncGanttLoadPanel();
  renderGanttAnalysisMenu();
}
function syncGanttLoadPanel(){
  if(!ganttLoadBox) return;
  ganttLoadBox.hidden = !ganttState.showLoad;
  if(ganttState.showLoad) loadGanttLoad();
}
function ganttLoadKey(){
  if(!ganttState.range) return "";
  return iso(ganttState.range.start) + "|" + iso(ganttState.range.end);
}
function loadGanttLoad(){
  var key = ganttLoadKey();
  if(!key || !ganttLoadBody) return;
  if(ganttState.loadData && ganttState.loadDoneKey === key){ renderGanttLoad(); return; }
  if(ganttState.loadLoading && ganttState.loadKey === key) return;
  var seq = ++ganttState.loadSeq;
  ganttState.loadLoading = true;
  ganttState.loadKey = key;
  ganttLoadBody.innerHTML = '<div class="gantt-load-empty">加载中…</div>';
  API.get("/api/gantt/load", { from: iso(ganttState.range.start), to: iso(ganttState.range.end) }).then(function(d){
    if(seq !== ganttState.loadSeq) return;
    ganttState.loadLoading = false;
    ganttState.loadData = d;
    ganttState.loadDoneKey = key;
    if(ganttState.showLoad) renderGanttLoad();
  }).catch(function(ex){
    if(seq !== ganttState.loadSeq) return;
    ganttState.loadLoading = false;
    if(ganttLoadBody) ganttLoadBody.innerHTML = '<div class="gantt-load-empty">负载加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderGanttLoad(){
  var d = ganttState.loadData;
  if(!ganttLoadBody || !d || !d.weeks || !d.weeks.length){
    if(ganttLoadBody) ganttLoadBody.innerHTML = '<div class="gantt-load-empty">当前范围没有可统计的周。</div>';
    return;
  }
  if(ganttLoadRangeEl) ganttLoadRangeEl.textContent = d.from + " → " + d.to + " · 每周容量 40h";
  var html = '<div class="gantt-load-grid" style="--load-weeks:' + d.weeks.length + '">' +
    '<span class="lh">成员</span>' +
    d.weeks.map(function(w){ return '<span class="lh">' + fmtShortMD(parseDate(w)) + '</span>'; }).join("");
  d.members.forEach(function(m){
    html += '<span class="lm" title="' + esc(m.name) + '">' + esc(m.name) + '</span>';
    d.weeks.forEach(function(w){
      var b = null;
      (m.buckets || []).forEach(function(x){ if(x.weekStart === w) b = x; });
      if(!b){ html += '<span class="gantt-load-cell empty"></span>'; return; }
      var ratio = b.capacityMinutes ? b.estimateMinutes / b.capacityMinutes : 0;
      var cls = ratio > 1 ? " over" : (ratio > 0.85 ? " warn" : "");
      html += '<span class="gantt-load-cell' + cls + '" title="预估 ' + fmtMinutes(b.estimateMinutes) +
        ' / 实际 ' + fmtMinutes(b.actualMinutes) + '">' +
        '<b>估 ' + fmtMinutesShort(b.estimateMinutes) + '</b>' +
        '<span>实 ' + fmtMinutesShort(b.actualMinutes) + '</span></span>';
    });
  });
  html += '</div>';
  if(!d.members.length){
    html = '<div class="gantt-load-empty">当前筛选下没有带估时的排期任务。</div>';
  }
  ganttLoadBody.innerHTML = html;
}

/* ---- 只读分享 ---- */
function ganttShareUrl(token){
  if(location.protocol === "file:") return "share.html?token=" + token;
  return location.origin + "/share.html?token=" + encodeURIComponent(token);
}
function ganttFillShare(token){
  var input = $("ganttShareUrl");
  if(!input) return;
  input.value = ganttShareUrl(token);
  $("ganttShareCopy").textContent = "复制链接";
  $("ganttShareRevoke").hidden = false;
}
function openGanttShare(){
  if(!(currentWs && currentWs.myRole === "owner")){ toast("仅空间主可生成或查看分享链接", "warn"); return; }
  var dlg = $("dlgGanttShare");
  if(!dlg){ toast("分享弹窗未加载", "bad"); return; }
  $("ganttShareUrl").value = "";
  $("ganttShareCopy").textContent = "生成链接";
  $("ganttShareRevoke").hidden = true;
  UI.openModal(dlg);
  API.get("/api/gantt/share").then(function(s){
    if(s && s.token) ganttFillShare(s.token);
  }).catch(function(){ /* 没有分享或没权限时保持“生成链接” */ });
}
function ganttCopyShare(){
  var input = $("ganttShareUrl");
  if(!input) return;
  if(!input.value){
    if(ganttReadOnly()){ toast("移动端只读，不能生成分享链接", "warn"); return; }
    API.post("/api/gantt/share").then(function(s){
      ganttFillShare(s.token);
      toast("分享链接已生成（30 天有效）", "fs");
    }).catch(function(ex){ toast("生成失败：" + (ex.message || "网络异常"), "bad"); });
    return;
  }
  try{
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  }catch(e){ /* noop */ }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(input.value).then(function(){ toast("链接已复制", "fs"); },
      function(){ toast("复制失败，请手动选中复制", "bad"); });
    return;
  }
  var ok = false;
  try{ ok = document.execCommand("copy"); }catch(e2){ ok = false; }
  toast(ok ? "链接已复制" : "复制失败，请手动选中复制", ok ? "fs" : "bad");
}
function ganttRevokeShare(){
  if(ganttReadOnly()){ toast("移动端只读，不能停止分享", "warn"); return; }
  UI.showConfirm({ title:"停止分享", msg:"停止后旧链接立即失效，查看者无法再打开。", okText:"停止分享" }).then(function(ok){
    if(!ok) return;
    API.del("/api/gantt/share").then(function(){
      $("ganttShareUrl").value = "";
      $("ganttShareCopy").textContent = "生成链接";
      $("ganttShareRevoke").hidden = true;
      toast("已停止分享", "fs");
    }).catch(function(ex){ toast("操作失败：" + (ex.message || "网络异常"), "bad"); });
  });
}

/* ---- 依赖编辑 ---- */
function refreshGanttDeps(){
  API.get("/api/gantt/deps").then(function(list){
    ganttState.deps = list || [];
    ganttState.depsLoaded = true;
    ganttState.depById = {};
    ganttState.deps.forEach(function(d){ ganttState.depById[d.id] = d; });
    ganttState.critical = null;
    renderGantt();
    renderGanttAnalysisMenu();
  }).catch(function(ex){ toast("依赖刷新失败：" + (ex.message || "网络异常"), "bad"); });
}
function openGanttDepMenu(depId, anchorEl){
  if(ganttReadOnly()){ toast("移动端只读，不能编辑依赖", "warn"); return; }
  var dep = ganttState.depById[depId];
  if(!dep){
    toast("旧版依赖暂不支持编辑，请删除后重新连线", "warn");
    return;
  }
  if(!ganttDepMenu) return;
  UI.closeAllPops();
  var type = dep.depType || "FS";
  var fromT = ganttState.byId[dep.fromTaskId], toT = ganttState.byId[dep.toTaskId];
  ganttDepMenu.innerHTML = '<div class="menu-title">依赖：' +
      esc(fromT ? fromT.title : dep.fromTaskId) + ' → ' + esc(toT ? toT.title : dep.toTaskId) + '</div>' +
    '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">类型</div>' +
      '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
        ["FS","SS","FF","SF"].map(function(t){
          return '<button class="chip" type="button" data-gantt-dep-type="' + t + '" aria-pressed="' + (type === t) + '">' + t + '</button>';
        }).join("") +
      '</div></div>' +
    '<div class="menu-field"><label class="group-label" for="ganttDepLag" style="display:block;margin-bottom:6px">滞后天数（可为负）</label>' +
      '<input class="input" id="ganttDepLag" type="number" min="-365" max="365" step="1" value="' +
      (dep.lagDays == null ? 0 : dep.lagDays) + '" /></div>' +
    '<div class="menu-foot">' +
      '<button class="btn sm danger" type="button" data-gantt-dep-del>删除</button>' +
      '<button class="btn sm primary" type="button" data-gantt-dep-save>保存</button>' +
    '</div>';
  ganttDepMenu.__depId = depId;
  ganttDepMenu.__depType = type;
  UI.openPop(ganttDepMenu, anchorEl, { align: "left", width: 250 });
}

/* ---- 拖拽建依赖 ---- */
function ganttLinkPoint(fromId){
  var geom = ganttState.winGeom || {};
  var g = geom[fromId];
  if(!g || !ganttState.range) return null;
  var labelW = ganttLabelW();
  return {
    x: labelW + (dayDiff(g.e, ganttState.range.start) + 1) * ganttState.dayW,
    y: GANTT_HEAD_H + g.top + GANTT_ROW_H / 2
  };
}
function onGanttLinkDown(e){
  var dot = e.target.closest ? e.target.closest("[data-gantt-link]") : null;
  if(!dot || ganttReadOnly()) return;
  var bar = dot.closest("[data-gantt-bar]");
  if(!bar || !ganttState.range) return;
  var fromId = dot.getAttribute("data-gantt-link");
  if(!ganttState.byId[fromId]) return;
  var grid = ganttScroll.querySelector(".gantt-grid");
  var start = ganttLinkPoint(fromId);
  if(!grid || !start) return;
  e.preventDefault();
  e.stopPropagation();
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "gantt-link-temp");
  svg.setAttribute("width", grid.scrollWidth);
  svg.setAttribute("height", grid.scrollHeight);
  var path = document.createElementNS(NS, "path");
  path.setAttribute("d", "M" + start.x + "," + start.y + " L" + start.x + "," + start.y);
  svg.appendChild(path);
  grid.appendChild(svg);
  ganttState.depDrag = { fromId: fromId, x0: start.x, y0: start.y, svg: svg, path: path, target: null };
  document.addEventListener("pointermove", onGanttLinkMove);
  document.addEventListener("pointerup", onGanttLinkEnd);
  document.addEventListener("pointercancel", onGanttLinkCancel);
  document.addEventListener("keydown", onGanttLinkKey);
}
function ganttLinkTargetAt(clientX, clientY, fromId){
  var el = document.elementFromPoint(clientX, clientY);
  var bar = el && el.closest ? el.closest("[data-gantt-bar]") : null;
  if(!bar) return null;
  var id = bar.getAttribute("data-gantt-bar");
  return id && id !== fromId ? bar : null;
}
function onGanttLinkMove(e){
  var d = ganttState.depDrag;
  if(!d) return;
  var grid = ganttScroll.querySelector(".gantt-grid");
  if(!grid) return;
  var gr = grid.getBoundingClientRect();
  var x = e.clientX - gr.left, y = e.clientY - gr.top;
  var bx = d.x0 + 12;
  var path = "M" + d.x0 + "," + d.y0 + " H" + bx + " V" + y + " H" + x;
  d.path.setAttribute("d", path);
  var target = ganttLinkTargetAt(e.clientX, e.clientY, d.fromId);
  if(d.target && d.target !== target) d.target.classList.remove("drop-target");
  if(target) target.classList.add("drop-target");
  d.target = target;
}
function cleanupGanttLink(){
  var d = ganttState.depDrag;
  ganttState.depDrag = null;
  if(d){
    if(d.target) d.target.classList.remove("drop-target");
    if(d.svg && d.svg.parentNode) d.svg.parentNode.removeChild(d.svg);
  }
  document.removeEventListener("pointermove", onGanttLinkMove);
  document.removeEventListener("pointerup", onGanttLinkEnd);
  document.removeEventListener("pointercancel", onGanttLinkCancel);
  document.removeEventListener("keydown", onGanttLinkKey);
}
function onGanttLinkEnd(){
  var d = ganttState.depDrag;
  if(!d) return;
  var target = d.target;
  var fromId = d.fromId;
  cleanupGanttLink();
  if(!target) return;
  var toId = target.getAttribute("data-gantt-bar");
  if(!toId || toId === fromId) return;
  API.post("/api/gantt/deps", { fromTaskId: fromId, toTaskId: toId, depType: "FS", lagDays: 0 }).then(function(){
    toast("已建立依赖（FS）", "fs");
    refreshGanttDeps();
  }).catch(function(ex){
    toast("建立依赖失败：" + (ex.message || "网络异常"), "bad");
  });
}
function onGanttLinkCancel(){ if(ganttState.depDrag) cleanupGanttLink(); }
function onGanttLinkKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  cleanupGanttLink();
}

/* ---- 主题 ---- */
function applyTheme(dark){
  if(dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try{ localStorage.setItem("ds.theme", dark ? "dark" : "light"); }catch(e){ /* noop */ }
  if(btnTheme){
    btnTheme.setAttribute("aria-pressed", dark ? "true" : "false");
    btnTheme.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }
}
function initTheme(){
  var saved = null;
  try{ saved = localStorage.getItem("ds.theme"); }catch(e){ saved = null; }
  applyTheme(saved === "dark");
}
if(btnTheme){
  btnTheme.addEventListener("click", function(){
    applyTheme(document.documentElement.getAttribute("data-theme") !== "dark");
  });
}

function ganttUnplannedSuffix(){
  /* 计数以当前可见（showDone 过滤后）为准，避免“列表 1 条、角标 3” */
  var n = ganttState.undated ? ganttState.undated.length : 0;
  return n ? (" · 未排期 " + n + " 项") : "";
}
function ganttAllTasks(){
  var list = ganttState.tasks.slice();
  if(ganttState.serverUnplanned !== null) list = list.concat(ganttState.unplannedTasks);
  return list;
}

function renderGanttUnplanned(list, openIt){
  if(!ganttUnplannedBox) return;
  var total = ganttState.serverUnplanned !== null ? ganttState.unscheduledTotal : list.length;
  ganttUnplannedBox.hidden = !list.length;
  if(!list.length){
    ganttUnplannedList.innerHTML = "";
    ganttUnplannedCount.textContent = String(list.length);
    return;
  }
  ganttUnplannedCount.textContent = String(list.length);
  if(openIt && !ganttState.unplannedAuto){
    ganttUnplannedBox.open = true;
    ganttState.unplannedAuto = true;
  }
  ganttUnplannedList.innerHTML = list.slice(0, 50).map(function(t){
    var rn = t.reqId ? reqNameById(t.reqId) : "";
    if(rn === "无") rn = "";
    var meta = [];
    if(rn) meta.push(esc(rn));
    if(t.owner) meta.push(esc(t.owner));
    meta.push(esc(colName(t.boardColumn)));
    var cat = catTag(t.category);
    return '<button class="gantt-unplanned-row" type="button" data-gantt-open="' + esc(t.id) + '" title="拖到时间轴即可排期">' +
      '<span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
      '<span class="gantt-unplanned-main">' +
        '<span class="gantt-unplanned-t">' + esc(t.title) + '</span>' +
        '<span class="gantt-unplanned-m">' + (cat ? cat + ' · ' : '') + meta.join(" · ") + '</span>' +
      '</span>' +
      '<span class="tag tag-ghost">未排期</span>' +
    '</button>';
  }).join("") +
  (list.length > 50 ? '<p class="foot-note" style="padding:8px 10px">仅显示前 50 项，共 ' + total + ' 项</p>' : "");
}

function renderGantt(){
  if(!ganttScroll) return;
  var prevLeft = ganttScroll.scrollLeft, prevTop = ganttScroll.scrollTop;
  var all = ganttState.tasks;
  var visible = ganttState.showDone ? all.slice() : all.filter(function(t){ return t.boardColumn !== "done"; });
  var hiddenDone = all.length - visible.length;
  var dated = [], undated = [];
  var serverUnplanned = ganttState.serverUnplanned;
  visible.forEach(function(t){
    var s = parseDate(t.startDate), e = parseDate(t.dueDate);
    if(!s && !e){ if(serverUnplanned === null) undated.push(t); return; }
    if(!s) s = e;
    if(!e) e = s;
    if(s > e){ var tmp = s; s = e; e = tmp; }
    dated.push({ t: t, s: s, e: e, rs: s, re: e });
  });
  if(serverUnplanned !== null){
    var upVisible = ganttState.showDone ? serverUnplanned.slice()
      : serverUnplanned.filter(function(t){ return t.boardColumn !== "done"; });
    hiddenDone += serverUnplanned.length - upVisible.length;
    undated = upVisible;
  }
  ganttState.undated = undated;
  renderGanttUnplanned(undated, dated.length === 0);
  ganttState.notice = ganttState.pendingNotice || "";
  ganttState.pendingNotice = "";

  if(!dated.length){
    renderGanttEmpty(all, visible, hiddenDone, undated);
    return;
  }

  ganttState.dayW = ganttEffectiveDayW();
  ganttSortRows(dated);

  var range;
  if(ganttState.rangeMode === "month"){
    if(!ganttState.anchorMonth) ganttState.anchorMonth = ganttMonthStart(TODAY);
    range = ganttMonthRange(ganttState.anchorMonth);
  }else{
    range = ganttDateRange(dated);
    if(range.days > GANTT_MAX_DAYS){
      /* 不能拿“某一页”的数据继续渲染：直接切月视图并重新按区间查询 */
      ganttState.rangeMode = "month";
      ganttState.anchorMonth = ganttMonthStart(TODAY);
      ganttState.pendingNotice = "任务时间跨度超过 2 年，已切换到月视图；可用上一月/下一月查看其他区间。";
      ganttState.scrolled = true;
      syncGanttControls();
      loadGantt();
      if(ganttScroll) ganttScroll.scrollLeft = 0;
      return;
    }
  }
  range = GS.adjustRange(range, ganttState.scale);
  ganttState.range = range;

  var inRange = dated;
  if(ganttState.rangeMode === "month"){
    inRange = dated.filter(function(x){ return x.s <= range.end && x.e >= range.start; });
    inRange.forEach(function(x){
      x.rs = x.s < range.start ? range.start : x.s;
      x.re = x.e > range.end ? range.end : x.e;
    });
  }
  ganttState.rows = inRange;
  ganttPrepareCritical();

  var dayW = ganttState.dayW;
  var labelW = ganttLabelW();
  /* 周/月刻度内容可能比视口窄：向后补几天，避免右侧留一大块空白 */
  var avail = (ganttScroll.clientWidth || 0) - labelW;
  /* 「月视图」必须严格停在自然月，不能用补齐的方式跨月 */
  if(ganttState.rangeMode !== "month" && avail > 0 && range.days * dayW < avail){
    var needDays = Math.ceil((avail - range.days * dayW) / dayW);
    range.end = addDays(range.end, needDays);
    range.days = dayDiff(range.end, range.start) + 1;
  }
  var totalW = range.days * dayW;
  var todayOff = dayDiff(TODAY, range.start);
  var todayIn = todayOff >= 0 && todayOff < range.days;
  ganttState.layout = ganttBuildLayout(inRange);
  ganttState.win = { start: -1, end: -1 };
  ganttState.emptyMonthHTML = (ganttState.rangeMode === "month" && !inRange.length)
    ? '<div class="gantt-month-empty">本月没有排期任务；可以翻到上一月/下一月，或把未排期任务拖进时间轴。</div>'
    : "";

  ganttScroll.innerHTML = '<div class="gantt-grid is-scale-' + ganttState.scale + '" style="--gantt-label-w:' + labelW + 'px;--gantt-day-w:' + dayW +
      'px;--gantt-row-h:' + GANTT_ROW_H + 'px;--gantt-group-h:' + GANTT_GROUP_H + 'px;">' +
    '<div class="gantt-head">' +
      '<div class="gantt-corner">任务 <span class="gantt-corner-meta">' + inRange.length + '</span></div>' +
      '<div class="gantt-axis" style="width:' + totalW + 'px">' + GS.headHTML(range, dayW, ganttState.scale, TODAY_ISO) + '</div>' +
    '</div>' +
    '<div class="gantt-body"></div>' +
    (todayIn
      ? '<div class="gantt-today-col" style="left:calc(' + labelW + 'px + ' + (todayOff * dayW) + 'px);width:' + dayW + 'px"></div>' +
        '<div class="gantt-today" style="left:calc(' + labelW + 'px + ' + (todayOff * dayW) + 'px)"></div>'
      : '') +
  '</div>';
  /* 先按旧滚动位置渲染窗口，再恢复滚动条（空 body 时 scrollTop 会被夹到 0） */
  ganttState.pendingTop = prevTop;
  ganttRenderBody(true);
  ganttState.pendingTop = null;
  ganttScroll.scrollLeft = prevLeft;
  ganttScroll.scrollTop = prevTop;
  if(!ganttState.scrolled){
    ganttState.scrolled = true;
    ganttScrollToToday();
  }
  if(ganttNoticeEl){
    ganttNoticeEl.hidden = !ganttState.notice;
    ganttNoticeEl.textContent = ganttState.notice;
  }
  updateGanttRangeUI();
  ganttMeta.textContent = ganttMetaText({
    count: inRange.length, hiddenDone: hiddenDone, range: range,
    mode: ganttState.rangeMode, total: ganttState.total, allCount: all.length,
    paging: ganttState.paging, baselineAt: ganttState.baselineAt, scale: ganttState.scale
  }) + ganttUnplannedSuffix();
  syncGanttUndoUI();
  if(ganttLoadBox) ganttLoadBox.hidden = !ganttState.showLoad;
  if(ganttState.showLoad) loadGanttLoad();
}

/* 大列表只渲染可视区：上下各留 600px overscan，用两个占位块撑出真实高度 */
function ganttWindowRange(layout, scrollTop, viewH){
  if(ganttState.pendingTop != null) scrollTop = ganttState.pendingTop;
  if(ganttState.printAll) return { start: 0, end: layout.length };
  if(layout.length <= 120) return { start: 0, end: layout.length };
  var from = Math.max(0, scrollTop - 600), to = scrollTop + viewH + 600;
  var lo = 0, hi = layout.length - 1, first = layout.length;
  while(lo <= hi){
    var mid = (lo + hi) >> 1;
    var e = layout[mid];
    var bottom = e.top + (e.type === "group" ? GANTT_GROUP_H : GANTT_ROW_H);
    if(bottom >= from){ first = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  if(first >= layout.length) first = Math.max(0, layout.length - 1);
  var last = first - 1, lo2 = first, hi2 = layout.length - 1;
  while(lo2 <= hi2){
    var mid2 = (lo2 + hi2) >> 1;
    if(layout[mid2].top <= to){ last = mid2; lo2 = mid2 + 1; } else { hi2 = mid2 - 1; }
  }
  return { start: first, end: Math.max(first, last + 1) };
}
function ganttRenderBody(force){
  if(!ganttScroll || !ganttState.range) return;
  var bodyEl = ganttScroll.querySelector(".gantt-body");
  if(!bodyEl) return;
  var layout = ganttState.layout;
  var win = ganttWindowRange(layout, ganttScroll.scrollTop, ganttScroll.clientHeight || 600);
  if(!force && win.start === ganttState.win.start && win.end === ganttState.win.end) return;
  ganttState.win = win;
  var range = ganttState.range, dayW = ganttState.dayW, totalW = range.days * dayW;
  var html = "", geom = {};
  for(var i = win.start; i < win.end; i++){
    var e = layout[i];
    if(e.type === "group"){
      html += ganttGroupHeadHTML(e);
    }else{
      html += ganttRowHTML(e.x, range, dayW, totalW);
      geom[e.x.t.id] = { top: e.top, s: e.x.rs || e.x.s, e: e.x.re || e.x.e, as: e.x.s, ae: e.x.e, t: e.x.t };
    }
  }
  var topPad = layout.length ? layout[win.start].top : 0;
  var last = layout[win.end - 1];
  var lastH = last ? (last.type === "group" ? GANTT_GROUP_H : GANTT_ROW_H) : 0;
  var bottomPad = Math.max(0, ganttState.layoutH - (last ? last.top + lastH : 0));
  bodyEl.innerHTML = (topPad ? '<div style="height:' + topPad + 'px"></div>' : "") + html +
    (bottomPad ? '<div style="height:' + bottomPad + 'px"></div>' : "") +
    (ganttState.emptyMonthHTML || "");
  ganttState.winGeom = geom;
  var old = ganttScroll.querySelector(".gantt-deps");
  if(old && old.parentNode) old.parentNode.removeChild(old);
  if(layout.length){
    var svg = ganttDepsHTML(geom, range, dayW, totalW, ganttState.layoutH, GANTT_HEAD_H);
    if(svg){
      var grid = ganttScroll.querySelector(".gantt-grid");
      if(grid) grid.insertAdjacentHTML("beforeend", svg);
    }
  }
  syncGanttUndoUI();
}

function renderGanttEmpty(all, visible, hiddenDone, undated){
  ganttState.range = null;
  ganttState.rows = [];
  ganttState.layout = [];
  ganttState.layoutH = 0;
  ganttState.win = { start: -1, end: -1 };
  ganttState.winGeom = {};
  if(ganttLoadBox) ganttLoadBox.hidden = true;
  var title, text, action = "", actionKind = "";
  if(!visible.length && all.length){
    /* 有任务但都被「显示已完成」隐藏了：这条优先于月份空态 */
    title = "当前没有未完成任务";
    text = "已完成任务被隐藏了；勾选上方「显示已完成」可以查看。";
  }else if(ganttState.rangeMode === "month"){
    title = filterOn() ? "本月没有符合筛选的排期任务" : "本月没有排期任务";
    text = "可以翻到上一月/下一月，或把未排期任务拖进时间轴。" +
      (filterOn() ? "当前筛选条件下本月没有任务。" : "");
  }else if(!all.length){
    /* 排期任务为 0 不等于没有任务：未排期区可能还有任务 */
    var anyUnplanned = ganttState.serverUnplanned !== null ? ganttState.unscheduledTotal : undated.length;
    if(anyUnplanned > 0){
      title = "还没有排期任务";
      text = "所有任务都还没有开始/截止日期；在下方「未排期」里拖到时间轴即可排期。";
      action = "去列表"; actionKind = "list";
    }else if(filterOn()){
      title = "没有符合筛选的任务";
      text = "当前筛选条件下没有任务；清除筛选后可查看全部任务。";
      action = "清除筛选"; actionKind = "clear";
    }else{
      title = "还没有任务";
      text = "新建任务并填上开始或截止日期，就会按时间出现在甘特图里。";
      action = "新建任务"; actionKind = "new";
    }
  }else{
    title = "还没有排期任务";
    text = "给任务填上开始或截止日期后，这里会按时间排布。";
    action = "去列表"; actionKind = "list";
  }
  ganttScroll.innerHTML = '<div style="padding:20px">' +
    UI.emptyState({ icon: "calendar", title: title, text: text, actionLabel: action }) + '</div>';
  var btn = ganttScroll.querySelector(".empty-state .btn");
  if(btn) btn.addEventListener("click", function(){
    if(actionKind === "clear") clearFilters();
    else if(actionKind === "new") openTaskDrawer("backlog");
    else showView("list");
  });
  if(ganttNoticeEl){ ganttNoticeEl.hidden = true; ganttNoticeEl.textContent = ""; }
  updateGanttRangeUI();
  ganttMeta.textContent = ganttMetaText({
    count: 0, hiddenDone: hiddenDone, range: null, mode: ganttState.rangeMode,
    total: ganttState.total, allCount: all.length, scale: ganttState.scale
  }) + ganttUnplannedSuffix();
  syncGanttUndoUI();
}

function updateGanttRangeUI(){
  var monthMode = ganttState.rangeMode === "month";
  if(ganttRangeLabelEl){
    ganttRangeLabelEl.textContent = monthMode
      ? ganttMonthLabel(ganttState.anchorMonth || TODAY)
      : "自动范围";
  }
  if(ganttPrevMonthEl) ganttPrevMonthEl.disabled = false;
  if(ganttNextMonthEl) ganttNextMonthEl.disabled = false;
  if(ganttRangeModeEl){
    ganttRangeModeEl.querySelectorAll("[data-gantt-range]").forEach(function(b){
      b.setAttribute("aria-pressed", b.getAttribute("data-gantt-range") === ganttState.rangeMode ? "true" : "false");
    });
  }
}

function ganttScrollToToday(){
  if(!ganttState.range || !ganttScroll) return;
  var off = dayDiff(TODAY, ganttState.range.start);
  if(off < 0) off = 0;
  ganttScroll.scrollLeft = Math.max(0, off * ganttState.dayW - 160);
}

function showGanttTip(text, x, y){
  if(!ganttTipEl){
    ganttTipEl = document.createElement("div");
    ganttTipEl.className = "gantt-tip";
    document.body.appendChild(ganttTipEl);
  }
  ganttTipEl.textContent = text;
  ganttTipEl.hidden = false;
  ganttTipEl.style.left = (x + 14) + "px";
  ganttTipEl.style.top = (y + 14) + "px";
}
function hideGanttTip(){
  if(ganttTipEl) ganttTipEl.hidden = true;
}

/* ==================== 筛选 / 分组 / 范围控件 ==================== */
function renderGanttFilterState(){
  var n = selectedFilterCount();
  if(ganttFilterCountEl){
    ganttFilterCountEl.hidden = n === 0;
    ganttFilterCountEl.textContent = String(n);
  }
  if(ganttClearFilterEl) ganttClearFilterEl.hidden = n === 0;
  if(ganttFilterBtn) ganttFilterBtn.classList.toggle("filter-on", n > 0);
}
function ganttFilterSourceTasks(){
  var list = ganttState.tasks;
  if(ganttState.serverUnplanned !== null && ganttState.unplannedTasks.length) list = list.concat(ganttState.unplannedTasks);
  return list;
}
function ganttFilterOwners(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.owners){
    meta.owners.forEach(function(o){
      if(o && o.name && !seen[o.name]){ seen[o.name] = 1; out.push(o.name); }
    });
  }
  ganttFilterSourceTasks().forEach(function(t){
    if(t.owner && !seen[t.owner]){ seen[t.owner] = 1; out.push(t.owner); }
  });
  return out;
}
/* 分类 / 标签优先用看板 meta（带计数），meta 还没加载时从当前任务里兜底收集 */
function ganttFilterCats(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.cats){
    meta.cats.forEach(function(c){ if(c && c.name && !seen[c.name]){ seen[c.name] = 1; out.push(c.name); } });
  }
  ganttFilterSourceTasks().forEach(function(t){
    if(t.category && !seen[t.category]){ seen[t.category] = 1; out.push(t.category); }
  });
  return out;
}
function ganttFilterTags(){
  var out = [], seen = {};
  var meta = state.board && state.board.meta;
  if(meta && meta.tags){
    meta.tags.forEach(function(x){ if(x && x.name && !seen[x.name]){ seen[x.name] = 1; out.push(x.name); } });
  }
  ganttFilterSourceTasks().forEach(function(t){
    (t.tags || []).forEach(function(n){ if(!seen[n]){ seen[n] = 1; out.push(n); } });
  });
  return out;
}
function ganttFilterChip(attr, value, label, on){
  return '<button class="chip" type="button" ' + attr + '="' + esc(value) + '" aria-pressed="' +
    (on ? "true" : "false") + '">' + label + '</button>';
}
function ganttFilterSection(title, inner){
  return '<div class="menu-field"><div class="group-label" style="margin-bottom:6px">' + title + '</div>' +
    '<div class="row row-gap" style="flex-wrap:wrap;gap:6px">' + inner + '</div></div>';
}
function renderGanttFilterMenu(){
  if(!ganttFilterMenu) return;
  var owners = ganttFilterOwners();
  var ownerHTML = owners.map(function(o){
    return ganttFilterChip("data-gantt-owner", o, esc(o), state.owners.indexOf(o) !== -1);
  }).join("");
  var priHTML = PRIORITIES.map(function(p){
    return ganttFilterChip("data-gantt-pri", p,
      '<i class="cdot" style="background:' + PRIORITY_COLOR[p] + '"></i>' + p,
      state.pris.indexOf(p) !== -1);
  }).join("");
  var projHTML = reqList.map(function(r){
    return ganttFilterChip("data-gantt-req", r.id, esc(r.name), state.reqs.indexOf(r.id) !== -1);
  }).join("");
  if(state.reqs.indexOf("__none") !== -1){
    projHTML += ganttFilterChip("data-gantt-req", "__none", "未归类", true);
  }
  var catHTML = ganttFilterCats().map(function(c){
    return ganttFilterChip("data-gantt-cat", c, esc(c), state.cats.indexOf(c) !== -1);
  }).join("");
  var tagHTML = ganttFilterTags().map(function(n){
    return ganttFilterChip("data-gantt-tag", n, esc(n), state.tags.indexOf(n) !== -1);
  }).join("");
  var dueHTML = [{v:"over",n:"已逾期"},{v:"today",n:"今天到期"},{v:"soon",n:"3 天内"}].map(function(d){
    return ganttFilterChip("data-gantt-due", d.v, d.n, state.due === d.v);
  }).join("");
  var blockedHTML = ganttFilterChip("data-gantt-blocked", "1", "仅看被阻塞", state.blocked);
  var html = '<div class="menu-title">筛选任务</div>' +
    '<div class="menu-field"><input class="input" type="search" id="ganttFilterQ" placeholder="关键词：标题 / 项目 / 标签" aria-label="关键词筛选" value="' + esc(state.q) + '" /></div>' +
    ganttFilterSection("负责人", ownerHTML || '<span class="foot-note">当前空间没有负责人可选</span>') +
    ganttFilterSection("优先级", priHTML) +
    ganttFilterSection("项目", projHTML || '<span class="foot-note">还没有项目，可到「项目」页新建</span>') +
    (catHTML ? ganttFilterSection("分类", catHTML) : "") +
    (tagHTML ? ganttFilterSection("标签", tagHTML) : "") +
    ganttFilterSection("到期", dueHTML) +
    ganttFilterSection("状态", blockedHTML) +
    '<div class="menu-foot">' +
      '<button class="btn sm" type="button" data-gantt-filter-reset>重置</button>' +
      '<button class="btn sm primary" type="button" data-gantt-filter-save>保存视图</button>' +
    '</div>';
  ganttFilterMenu.innerHTML = html;
}
function afterGanttFilterChange(){
  renderGanttFilterMenu();
  renderGanttFilterState();
  reloadFilteredViews();
}
/* 甘特内关键词：不走 applySearch（那会把非看板视图切到看板），只同步全局搜索框并防抖刷新 */
var ganttQueryTimer = null;
function ganttSetQuery(kw){
  state.q = kw || "";
  searchInput.value = state.q;
  searchWrap.classList.toggle("has", state.q.length > 0);
  if(ganttQueryTimer) clearTimeout(ganttQueryTimer);
  ganttQueryTimer = setTimeout(function(){ reloadFilteredViews(); }, 300);
}
function renderGanttViewsMenu(){
  if(!ganttViewsMenu) return;
  var html = '<div class="menu-title">保存的视图</div>';
  if(!savedViews.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的视图；先设置筛选，再保存。</p></div>';
  }else{
    html += savedViews.map(function(v){
      return '<button class="menu-item" type="button" data-gantt-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' +
        esc(v.name) + '</button>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-gantt-view-save>保存当前筛选为视图</button></div>';
  html += '<div class="menu-sep"></div><div class="menu-title">排序</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["start", "开始"], ["due", "截止"], ["priority", "优先级"], ["owner", "负责人"], ["progress", "进度"]].map(function(o){
      return ganttFilterChip("data-gantt-sort", o[0], o[1], ganttState.sortBy === o[0]);
    }).join("") + '</div></div>';
  html += '<div class="menu-title">第二级分组</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["none", "无"], ["project", "项目"], ["owner", "负责人"], ["status", "状态"], ["category", "分类"], ["priority", "优先级"]].map(function(o){
      return ganttFilterChip("data-gantt-group2", o[0], o[1], ganttState.groupBy2 === o[0]);
    }).join("") + '</div></div>';
  html += '<div class="menu-title">左列字段</div><div class="menu-field"><div class="row row-gap" style="flex-wrap:wrap;gap:6px">' +
    [["project", "项目"], ["owner", "负责人"], ["dates", "日期"], ["work", "工时"], ["subtask", "子任务"], ["tags", "标签"], ["comments", "评论"]].map(function(o){
      return ganttFilterChip("data-gantt-col", o[0], o[1], !!ganttState.cols[o[0]]);
    }).join("") + '</div></div>';
  ganttViewsMenu.innerHTML = html;
}
/* 导出菜单：范围/全部两份 CSV + 打印 */
function renderGanttExportMenu(){
  if(!ganttExportMenu) return;
  var allLabel = ganttState.rangeMode === "month"
    ? "全部筛选结果 CSV（跨月拉取）"
    : ("全部筛选结果 CSV（" + ganttAllTasks().length + " 项）");
  ganttExportMenu.innerHTML = '<div class="menu-title">导出</div>' +
    '<button class="menu-item" type="button" data-gantt-export="range">当前范围 CSV（' + ganttState.rows.length + ' 项）</button>' +
    '<button class="menu-item" type="button" data-gantt-export="all">' + allLabel + '</button>' +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-gantt-print>打印 / 另存 PDF（A3 横向）</button>';
}

function ganttSetRangeMode(mode){
  if(mode !== "auto" && mode !== "month") return;
  if(ganttState.rangeMode === mode) return;
  ganttState.rangeMode = mode;
  if(mode === "month" && !ganttState.anchorMonth) ganttState.anchorMonth = ganttMonthStart(TODAY);
  syncGanttControls();
  if(mode === "month"){
    ganttState.scrolled = true;
    loadGantt();
    if(ganttScroll) ganttScroll.scrollLeft = 0;
  }else{
    ganttState.scrolled = false;
    loadGantt();
  }
}
function ganttShiftMonth(delta){
  if(ganttState.rangeMode !== "month"){
    ganttState.rangeMode = "month";
    ganttState.anchorMonth = ganttMonthStart(TODAY);
  }
  var a = ganttState.anchorMonth || ganttMonthStart(TODAY);
  ganttState.anchorMonth = new Date(a.getFullYear(), a.getMonth() + delta, 1);
  syncGanttControls();
  ganttState.scrolled = true;
  loadGantt();
  if(ganttScroll) ganttScroll.scrollLeft = 0;
}
function ganttGoToday(){
  if(ganttState.rangeMode === "month"){
    ganttState.anchorMonth = ganttMonthStart(TODAY);
    syncGanttControls();
    ganttState.scrolled = false;
    loadGantt();
    return;
  }
  ganttScrollToToday();
}
function ganttToggleGroup(key){
  if(!key) return;
  if(ganttState.collapsed[key]) delete ganttState.collapsed[key];
  else ganttState.collapsed[key] = true;
  saveGanttPrefs();
  renderGantt();
}

/* ==================== 拖拽坐标与自动横滚 ==================== */
function ganttAxisEl(){ return ganttScroll ? ganttScroll.querySelector(".gantt-axis") : null; }
function ganttAxisDayIndex(clientX){
  var axis = ganttAxisEl();
  if(!axis || !ganttState.range) return null;
  var r = axis.getBoundingClientRect();
  if(r.width <= 0) return null;
  return (clientX - r.left) / ganttState.dayW;
}
function ganttDayAtClientX(clientX, clientY, timelineOnly){
  if(!ganttState.range) return null;
  if(timelineOnly){
    if(!ganttScroll) return null;
    var sr = ganttScroll.getBoundingClientRect();
    if(clientX < sr.left + ganttLabelW() || clientX > sr.right) return null;
    if(clientY < sr.top || clientY > sr.bottom) return null;
  }
  var idx = ganttAxisDayIndex(clientX);
  if(idx === null) return null;
  idx = Math.floor(idx);
  if(idx < 0) idx = 0;
  if(idx > ganttState.range.days - 1) idx = ganttState.range.days - 1;
  return addDays(ganttState.range.start, idx);
}
function ganttEdgeCalc(clientX, clientY){
  var r = ganttScroll.getBoundingClientRect();
  if(clientY === null || clientY === undefined || clientY < r.top || clientY > r.bottom){
    return { dir: 0, speed: 0 };
  }
  var left = r.left + ganttLabelW(), right = r.right, zone = 32, max = 18;
  var dir = 0, dist = 0;
  if(clientX < left + zone){ dir = -1; dist = left + zone - clientX; }
  else if(clientX > right - zone){ dir = 1; dist = clientX - (right - zone); }
  if(dist < 0) dist = 0;
  if(dist > zone) dist = zone;
  return { dir: dir, speed: dir ? dir * Math.max(2, Math.round((dist / zone) * max)) : 0 };
}
function showGanttDropHint(dayIdx){
  var grid = ganttScroll && ganttScroll.querySelector(".gantt-grid");
  if(!grid || !ganttState.range || dayIdx === null || dayIdx === undefined) return;
  if(!ganttDropEl){
    ganttDropEl = document.createElement("div");
    ganttDropEl.className = "gantt-drop-col";
  }
  if(ganttDropEl.parentNode !== grid) grid.appendChild(ganttDropEl);
  ganttDropEl.style.left = "calc(" + ganttLabelW() + "px + " + (dayIdx * ganttState.dayW) + "px)";
  ganttDropEl.style.width = ganttState.dayW + "px";
  ganttDropEl.hidden = false;
}
function hideGanttDropHint(){
  if(ganttDropEl){ ganttDropEl.hidden = true; ganttDropEl.remove(); }
}

function ganttClampTimelineX(clientX){
  var sr = ganttScroll.getBoundingClientRect();
  var min = sr.left + ganttLabelW();
  if(clientX < min) return min + 1;
  if(clientX > sr.right) return sr.right - 1;
  return clientX;
}

function onGanttPointerDown(e){
  /* 条尾圆点 = 建依赖，不走改期拖拽 */
  var linkDot = e.target.closest ? e.target.closest("[data-gantt-link]") : null;
  if(linkDot){ onGanttLinkDown(e); return; }
  if(ganttReadOnly()) return;
  var bar = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
  if(!bar) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  var t = ganttState.byId[bar.dataset.ganttBar];
  if(!t || !ganttState.range) return;

  /* Ctrl/⌘ 点选、Shift 连选：只改选择，不开始拖动 */
  if(e.ctrlKey || e.metaKey){ e.preventDefault(); ganttToggleSelection(t.id); return; }
  if(e.shiftKey){ e.preventDefault(); ganttSelectRange(t.id); return; }

  var handle = e.target.closest("[data-gantt-handle]");
  var mode = handle ? handle.dataset.ganttHandle : "move";
  var s = parseDate(t.startDate) || parseDate(t.dueDate);
  var d = parseDate(t.dueDate) || s;
  if(!s || !d) return;
  /* 历史数据可能有开始晚于截止：先归一化，否则任何一次拖动都会被服务端校验拒绝 */
  if(s > d){ var tmpDate = s; s = d; d = tmpDate; }

  var items = [];
  if(mode === "move"){
    /* 拖的是已选中的条 → 整体平移；否则只拖这一条 */
    var ids = ganttState.sel[t.id] ? Object.keys(ganttState.sel) : [t.id];
    ids.forEach(function(id){
      var tt = ganttState.byId[id];
      if(!tt) return;
      var ss = parseDate(tt.startDate) || parseDate(tt.dueDate);
      var ee = parseDate(tt.dueDate) || ss;
      if(!ss || !ee) return;   // 未排期任务不参与批量平移
      if(ss > ee){ var tmp2 = ss; ss = ee; ee = tmp2; }
      items.push({
        id: tt.id, task: tt,
        bar: ganttScroll.querySelector('[data-gantt-bar="' + tt.id + '"]'),
        os: tt.startDate || null, oe: tt.dueDate || null,
        s0: ss, e0: ee, ns: ss, ne: ee,
        hasStart: !!tt.startDate, hasDue: !!tt.dueDate,
        milestone: !!tt.isMilestone
      });
    });
  }else{
    var hasStart = !!t.startDate, hasDue = !!t.dueDate;
    if(!(hasStart && hasDue)) return;
    items.push({
      id: t.id, task: t, bar: bar,
      os: t.startDate || null, oe: t.dueDate || null,
      s0: s, e0: d, ns: s, ne: d,
      hasStart: true, hasDue: true,
      milestone: !!t.isMilestone
    });
  }
  if(!items.length) return;

  e.preventDefault();
  e.stopPropagation();
  ganttState.drag = {
    mainId: t.id, mode: mode, items: items, bar: bar,
    x0: e.clientX, y0: e.clientY,
    pointerDay0: ganttAxisDayIndex(ganttClampTimelineX(e.clientX)) || 0,
    lastX: e.clientX, lastY: e.clientY,
    dayW: ganttState.dayW, start: ganttState.range.start,
    moved: false, delta: 0, edgeDir: 0, edgeSpeed: 0, raf: 0
  };
  items.forEach(function(it){ if(it.bar) it.bar.classList.add("dragging"); });
  document.addEventListener("pointermove", onGanttDragMove);
  document.addEventListener("pointerup", onGanttDragEnd);
  document.addEventListener("pointercancel", onGanttDragCancel);
  document.addEventListener("keydown", onGanttDragKey);
}

function ganttDragApply(clientX){
  var d = ganttState.drag;
  if(!d) return;
  var idx = ganttAxisDayIndex(ganttClampTimelineX(clientX));
  if(idx === null) idx = d.pointerDay0;
  var delta = Math.round(idx - d.pointerDay0);
  if(!d.moved && Math.abs(clientX - d.x0) > 3) d.moved = true;
  d.delta = delta;
  d.items.forEach(function(it){
    var ns = it.s0, ne = it.e0;
    if(d.mode === "move"){
      ns = addDays(it.s0, delta);
      ne = addDays(it.e0, delta);
    }else if(d.mode === "l"){
      ns = addDays(it.s0, delta);
      if(ns > it.e0) ns = it.e0;
      ne = it.e0;
    }else{
      ne = addDays(it.e0, delta);
      if(ne < it.s0) ne = it.s0;
      ns = it.s0;
    }
    it.ns = ns;
    it.ne = ne;
    if(it.bar){
      var off = dayDiff(ns, d.start);
      var span = Math.max(1, dayDiff(ne, ns) + 1);
      var bw = span * d.dayW, bl = off * d.dayW;
      if(it.milestone){ bw = Math.max(d.dayW, 18); bl = off * d.dayW + (d.dayW - bw) / 2; }
      it.bar.style.left = bl + "px";
      it.bar.style.width = bw + "px";
    }
  });
  var prim = d.items[0];
  var spanDays = Math.max(1, dayDiff(prim.ne, prim.ns) + 1);
  var suffix = d.items.length > 1 ? (" · " + d.items.length + " 项") : "";
  showGanttTip(fmtShortMD(prim.ns) + " → " + fmtShortMD(prim.ne) + " · " + spanDays + " 天" + suffix, d.lastX, d.lastY);
}

function ganttEdgeTick(){
  var d = ganttState.drag;
  if(!d || !d.edgeDir){ if(d) d.raf = 0; return; }
  var before = ganttScroll.scrollLeft;
  ganttScroll.scrollLeft = before + d.edgeSpeed;
  if(ganttScroll.scrollLeft === before){ d.edgeDir = 0; d.raf = 0; return; }
  ganttDragApply(d.lastX);
  d.raf = requestAnimationFrame(ganttEdgeTick);
}

function onGanttDragMove(e){
  var d = ganttState.drag;
  if(!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  ganttDragApply(e.clientX);
  var edge = ganttEdgeCalc(e.clientX, e.clientY);
  d.edgeDir = edge.dir;
  d.edgeSpeed = edge.speed;
  if(d.edgeDir && !d.raf) d.raf = requestAnimationFrame(ganttEdgeTick);
  if(!d.edgeDir && d.raf){ cancelAnimationFrame(d.raf); d.raf = 0; }
}

function cleanupGanttDrag(){
  var d = ganttState.drag;
  ganttState.drag = null;
  if(d){
    if(d.items) d.items.forEach(function(it){ if(it.bar) it.bar.classList.remove("dragging"); });
    else if(d.bar) d.bar.classList.remove("dragging");
    if(d.raf) cancelAnimationFrame(d.raf);
  }
  document.removeEventListener("pointermove", onGanttDragMove);
  document.removeEventListener("pointerup", onGanttDragEnd);
  document.removeEventListener("pointercancel", onGanttDragCancel);
  document.removeEventListener("keydown", onGanttDragKey);
  hideGanttTip();
}

function onGanttDragKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  var d = ganttState.drag;
  cleanupGanttDrag();
  if(d) renderGantt();
}

function onGanttDragEnd(e){
  var d = ganttState.drag;
  if(!d) return;
  if(e && e.clientX !== undefined){
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    ganttDragApply(e.clientX);
  }
  cleanupGanttDrag();
  if(!d.moved){
    openTaskById(d.mainId);
    return;
  }
  if(!d.delta){
    renderGantt();
    return;
  }
  var items = [], changes = [];
  d.items.forEach(function(it){
    var patch = {};
    if(d.mode === "move"){
      if(it.hasStart) patch.startDate = iso(it.ns);
      if(it.hasDue) patch.dueDate = iso(it.ne);
      if(!it.hasStart && !it.hasDue) patch.dueDate = iso(it.ne);
    }else if(d.mode === "l"){
      patch.startDate = iso(it.ns);
    }else{
      patch.dueDate = iso(it.ne);
    }
    items.push({ task: it.task, patch: patch });
    changes.push({
      id: it.id,
      before: { startDate: it.os, dueDate: it.oe },
      after: {
        startDate: patch.startDate !== undefined ? patch.startDate : it.os,
        dueDate: patch.dueDate !== undefined ? patch.dueDate : it.oe
      }
    });
  });
  var first = d.items[0];
  var label = (first.hasStart ? fmtShortMD(first.ns) : "—") + " → " + (first.hasDue ? fmtShortMD(first.ne) : "—");
  var undoLabel = d.items.length > 1 ? (d.items.length + " 项改期") : ("「" + first.task.title + "」" + label);
  var msg = d.items.length > 1 ? ("已调整 " + d.items.length + " 项排期") : ("已调整「" + first.task.title + "」：" + label);
  ganttPutSeq(items).then(function(){
    toast(msg, "fs");
    ganttPushUndo(undoLabel, changes);
    loadGantt();
    loadBoard({silent:true});
    refreshListIfOpen();
    refreshCalendarIfOpen();
  }).catch(function(ex){
    toast("调整失败：" + (ex.message || "网络异常") + (d.items.length > 1 ? "（已回滚）" : ""), "bad");
    loadGantt();
  });
}

function onGanttDragCancel(){
  if(!ganttState.drag) return;
  cleanupGanttDrag();
  renderGantt();
}

/* ==================== 未排期拖入时间轴 ==================== */
function onGanttUnplannedPointerDown(e){
  if(ganttReadOnly()) return;
  var row = e.target.closest ? e.target.closest(".gantt-unplanned-row") : null;
  if(!row) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;
  var t = ganttState.byId[row.dataset.ganttOpen];
  if(!t) return;
  ganttState.unplannedDrag = {
    task: t, row: row, x0: e.clientX, y0: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    moved: false, date: null, edgeDir: 0, edgeSpeed: 0, raf: 0
  };
  document.addEventListener("pointermove", onGanttUnplannedMove);
  document.addEventListener("pointerup", onGanttUnplannedEnd);
  document.addEventListener("pointercancel", onGanttUnplannedCancel);
  document.addEventListener("keydown", onGanttUnplannedKey);
}

function ganttUnplannedApply(clientX, clientY){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  var date = ganttDayAtClientX(clientX, clientY, true);
  d.date = date;
  if(date){
    showGanttDropHint(dayDiff(date, ganttState.range.start));
    showGanttTip("排期到 " + fmtFull(date), clientX, clientY);
  }else{
    hideGanttDropHint();
    showGanttTip("拖到时间轴上松手即可排期", clientX, clientY);
  }
}

function ganttUnplannedTick(){
  var d = ganttState.unplannedDrag;
  if(!d || !d.edgeDir){ if(d) d.raf = 0; return; }
  var before = ganttScroll.scrollLeft;
  ganttScroll.scrollLeft = before + d.edgeSpeed;
  if(ganttScroll.scrollLeft === before){ d.edgeDir = 0; d.raf = 0; return; }
  ganttUnplannedApply(d.lastX, d.lastY);
  d.raf = requestAnimationFrame(ganttUnplannedTick);
}

function onGanttUnplannedMove(e){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  if(!d.moved){
    if(Math.abs(e.clientX - d.x0) <= 5 && Math.abs(e.clientY - d.y0) <= 5) return;
    d.moved = true;
    d.row.classList.add("dragging");
  }
  e.preventDefault();
  ganttUnplannedApply(e.clientX, e.clientY);
  var edge = ganttEdgeCalc(e.clientX, e.clientY);
  d.edgeDir = edge.dir;
  d.edgeSpeed = edge.speed;
  if(d.edgeDir && !d.raf) d.raf = requestAnimationFrame(ganttUnplannedTick);
  if(!d.edgeDir && d.raf){ cancelAnimationFrame(d.raf); d.raf = 0; }
}

function cleanupGanttUnplannedDrag(){
  var d = ganttState.unplannedDrag;
  ganttState.unplannedDrag = null;
  if(d){
    if(d.row) d.row.classList.remove("dragging");
    if(d.raf) cancelAnimationFrame(d.raf);
  }
  document.removeEventListener("pointermove", onGanttUnplannedMove);
  document.removeEventListener("pointerup", onGanttUnplannedEnd);
  document.removeEventListener("pointercancel", onGanttUnplannedCancel);
  document.removeEventListener("keydown", onGanttUnplannedKey);
  hideGanttTip();
  hideGanttDropHint();
}

function onGanttUnplannedEnd(e){
  var d = ganttState.unplannedDrag;
  if(!d) return;
  if(d.moved && e && e.clientX !== undefined){
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    ganttUnplannedApply(e.clientX, e.clientY);
  }
  var date = d.date, moved = d.moved;
  cleanupGanttUnplannedDrag();
  if(!moved) return;   // 小位移当作点击，交给 click 打开详情
  ganttSuppressUnplannedClick = Date.now() + 400;
  if(!date){
    toast("拖到时间轴上的某一天再松手，才能排期", "bad");
    return;
  }
  var t = d.task;
  API.put("/api/tasks/" + encodeURIComponent(t.id), taskPayloadWith(t, {
    startDate: iso(date), dueDate: iso(date)
  })).then(function(nt){
    if(nt && nt.id){
      ganttState.byId[nt.id] = nt;
      taskCacheExtra[nt.id] = nt;
    }
    toast("已排期「" + nt.title + "」：" + fmtFull(date), "fs");
    ganttPushUndo("「" + nt.title + "」排期", [{
      id: nt.id,
      before: { startDate: t.startDate || null, dueDate: t.dueDate || null },
      after: { startDate: iso(date), dueDate: iso(date) }
    }]);
    loadGantt(); loadBoard({silent:true}); refreshListIfOpen(); refreshCalendarIfOpen();
  }).catch(function(ex){
    toast("排期失败：" + (ex.message || "网络异常"), "bad");
  });
}

function onGanttUnplannedCancel(){
  if(!ganttState.unplannedDrag) return;
  ganttSuppressUnplannedClick = Date.now() + 400;
  cleanupGanttUnplannedDrag();
}

function onGanttUnplannedKey(e){
  if(e.key !== "Escape") return;
  e.preventDefault();
  var d = ganttState.unplannedDrag;
  cleanupGanttUnplannedDrag();
  if(d && d.moved) renderGantt();
}

/* ==================== 事件绑定 ==================== */
if(ganttScroll){
  ganttScroll.addEventListener("click", function(e){
    var grp = e.target.closest("[data-gantt-group-toggle]");
    if(grp){ ganttToggleGroup(grp.dataset.ganttGroupToggle); return; }
    var dep = e.target.closest("[data-gantt-dep]");
    if(dep){ openGanttDepMenu(dep.getAttribute("data-gantt-dep"), dep); return; }
    /* 移动端只读：点条直接看详情（不启动拖拽） */
    var barEl = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
    if(ganttReadOnly() && barEl){ openTaskById(barEl.getAttribute("data-gantt-bar")); return; }
    var open = e.target.closest("[data-gantt-open]");
    if(open){ openTaskById(open.dataset.ganttOpen); return; }
    /* 点空白处取消多选 */
    if(!e.target.closest("[data-gantt-bar],[data-gantt-row-id],.gantt-group-head") && ganttSelCount()){
      ganttClearSelection();
    }
  });
  ganttScroll.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var bar = e.target.closest ? e.target.closest("[data-gantt-bar]") : null;
    if(!bar) return;
    e.preventDefault();
    openTaskById(bar.dataset.ganttBar);
  });
  /* 双击时间轴空白：按点击那天新建任务（预填起止，不直接落库） */
  ganttScroll.addEventListener("dblclick", function(e){
    if(e.target.closest("[data-gantt-bar],[data-gantt-handle],[data-gantt-open],.gantt-group-head,.gantt-unplanned-row,.gantt-dep")) return;
    var date = ganttDayAtClientX(e.clientX, e.clientY, true);
    if(!date) return;
    e.preventDefault();
    openTaskDrawer("backlog", null, { startDate: iso(date), dueDate: iso(date) });
  });
  ganttScroll.addEventListener("pointerdown", onGanttPointerDown);
}
if(ganttUnplannedList){
  ganttUnplannedList.addEventListener("click", function(e){
    if(Date.now() < ganttSuppressUnplannedClick) return;
    var open = e.target.closest("[data-gantt-open]");
    if(open) openTaskById(open.dataset.ganttOpen);
  });
  ganttUnplannedList.addEventListener("pointerdown", onGanttUnplannedPointerDown);
}
if(ganttShowDoneEl){
  ganttShowDoneEl.addEventListener("change", function(){
    ganttState.showDone = this.checked;
    saveGanttPrefs();
    renderGantt();
  });
}
if(ganttZoomEl){
  ganttZoomEl.addEventListener("change", function(){
    var dayIndex = ganttScroll.scrollLeft / Math.max(1, ganttState.dayW);
    ganttState.zoomDayW = Number(this.value) || 28;
    if(ganttState.scale === "day") ganttState.dayW = ganttState.zoomDayW;
    saveGanttPrefs();
    renderGantt();
    ganttScroll.scrollLeft = dayIndex * ganttState.dayW;
  });
}
if(ganttScaleEl){
  ganttScaleEl.addEventListener("change", function(){
    var v = this.value;
    ganttState.scale = (v === "week" || v === "month") ? v : "day";
    ganttState.dayW = ganttEffectiveDayW();
    saveGanttPrefs();
    renderGantt();
    if(ganttState.scale === "day") ganttScrollToToday();
    else ganttScroll.scrollLeft = 0;
  });
}
if(ganttGroupEl){
  ganttGroupEl.addEventListener("change", function(){
    var v = this.value;
    ganttState.groupBy = ["project","owner","status","category","priority"].indexOf(v) !== -1 ? v : "none";
    /* 一级选「不分组」= 彻底平铺：二级分组也一起清掉，避免下拉显示不分组却仍在分组 */
    if(ganttState.groupBy === "none") ganttState.groupBy2 = "none";
    saveGanttPrefs();
    renderGantt();
    renderGanttViewsMenu();
  });
}
if(ganttRangeModeEl){
  ganttRangeModeEl.addEventListener("click", function(e){
    var b = e.target.closest("[data-gantt-range]");
    if(b) ganttSetRangeMode(b.getAttribute("data-gantt-range"));
  });
}
if(ganttPrevMonthEl) ganttPrevMonthEl.addEventListener("click", function(){ ganttShiftMonth(-1); });
if(ganttNextMonthEl) ganttNextMonthEl.addEventListener("click", function(){ ganttShiftMonth(1); });
if(ganttFilterBtn){
  ganttFilterBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttFilterMenu)){ UI.closeAllPops(); return; }
    renderGanttFilterMenu();
    UI.openPop(ganttFilterMenu, ganttFilterBtn, {align:"left", width:340});
  });
}
if(ganttFilterMenu){
  ganttFilterMenu.addEventListener("click", function(e){
    var reset = e.target.closest("[data-gantt-filter-reset]");
    if(reset){ clearFilters(); renderGanttFilterMenu(); return; }
    var save = e.target.closest("[data-gantt-filter-save]");
    if(save){ UI.closeAllPops(); promptSaveView(); return; }
    var o = e.target.closest("[data-gantt-owner]");
    if(o){ toggleIn(state.owners, o.getAttribute("data-gantt-owner")); afterGanttFilterChange(); return; }
    var p = e.target.closest("[data-gantt-pri]");
    if(p){ toggleIn(state.pris, p.getAttribute("data-gantt-pri")); afterGanttFilterChange(); return; }
    var r = e.target.closest("[data-gantt-req]");
    if(r){ toggleIn(state.reqs, r.getAttribute("data-gantt-req")); afterGanttFilterChange(); return; }
    var c = e.target.closest("[data-gantt-cat]");
    if(c){ toggleIn(state.cats, c.getAttribute("data-gantt-cat")); afterGanttFilterChange(); return; }
    var tg = e.target.closest("[data-gantt-tag]");
    if(tg){ toggleIn(state.tags, tg.getAttribute("data-gantt-tag")); afterGanttFilterChange(); return; }
    var due = e.target.closest("[data-gantt-due]");
    if(due){
      var v = due.getAttribute("data-gantt-due");
      state.due = (state.due === v) ? null : v;
      afterGanttFilterChange();
      return;
    }
    if(e.target.closest("[data-gantt-blocked]")){ state.blocked = !state.blocked; afterGanttFilterChange(); return; }
  });
  /* 关键词防抖：只刷新数据，不重建菜单（否则输入框会丢焦点） */
  ganttFilterMenu.addEventListener("input", function(e){
    if(e.target && e.target.id === "ganttFilterQ") ganttSetQuery(e.target.value);
  });
}
if(ganttUndoBtn) ganttUndoBtn.addEventListener("click", ganttUndoLast);
if(ganttNewBtn) ganttNewBtn.addEventListener("click", function(){ openTaskDrawer("backlog"); });
if(ganttViewsBtn){
  ganttViewsBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttViewsMenu)){ UI.closeAllPops(); return; }
    renderGanttViewsMenu();
    UI.openPop(ganttViewsMenu, ganttViewsBtn, {align:"left", width:260});
  });
}
if(ganttViewsMenu){
  ganttViewsMenu.addEventListener("click", function(e){
    if(e.target.closest("[data-gantt-view-save]")){ UI.closeAllPops(); promptSaveView(); return; }
    var sortEl = e.target.closest("[data-gantt-sort]");
    if(sortEl){
      ganttState.sortBy = sortEl.getAttribute("data-gantt-sort");
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var g2El = e.target.closest("[data-gantt-group2]");
    if(g2El){
      ganttState.groupBy2 = g2El.getAttribute("data-gantt-group2");
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var colEl = e.target.closest("[data-gantt-col]");
    if(colEl){
      var ck = colEl.getAttribute("data-gantt-col");
      ganttState.cols[ck] = !ganttState.cols[ck];
      saveGanttPrefs();
      renderGantt();
      renderGanttViewsMenu();
      return;
    }
    var ap = e.target.closest("[data-gantt-view]");
    if(!ap) return;
    for(var i = 0; i < savedViews.length; i++){
      if(String(savedViews[i].id) === String(ap.getAttribute("data-gantt-view"))){
        UI.closeAllPops();
        applyView(savedViews[i]);
        return;
      }
    }
  });
}
if(ganttExportBtn){
  ganttExportBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttExportMenu)){ UI.closeAllPops(); return; }
    renderGanttExportMenu();
    UI.openPop(ganttExportMenu, ganttExportBtn, {align:"right", width:260});
  });
}
if(ganttExportMenu){
  ganttExportMenu.addEventListener("click", function(e){
    var ex = e.target.closest("[data-gantt-export]");
    if(ex){ UI.closeAllPops(); ganttExportCsv(ex.getAttribute("data-gantt-export")); return; }
    if(e.target.closest("[data-gantt-print]")){ UI.closeAllPops(); window.print(); }
  });
}
if(ganttClearFilterEl) ganttClearFilterEl.addEventListener("click", function(){ clearFilters(); });
if($("ganttToday")) $("ganttToday").addEventListener("click", ganttGoToday);
if($("ganttRefresh")) $("ganttRefresh").addEventListener("click", function(){ loadGantt(); });
/* 里程碑只占一天：勾选后把另一端补齐；已勾选时改任一端，另一端跟随 */
if($("iMilestone")){
  $("iMilestone").addEventListener("change", function(){
    if(!this.checked) return;
    if(iStart.value) iDue.value = iStart.value;
    else if(iDue.value) iStart.value = iDue.value;
    syncDateBounds();
  });
  iStart.addEventListener("change", function(){
    if($("iMilestone").checked && iStart.value){ iDue.value = iStart.value; syncDateBounds(); }
  });
  iDue.addEventListener("change", function(){
    if($("iMilestone").checked && iDue.value){ iStart.value = iDue.value; syncDateBounds(); }
  });
}

/* ---- 分析菜单 ---- */
if(ganttAnalysisBtn){
  ganttAnalysisBtn.addEventListener("click", function(){
    if(UI.popOpen(ganttAnalysisMenu)){ UI.closeAllPops(); return; }
    renderGanttAnalysisMenu();
    UI.openPop(ganttAnalysisMenu, ganttAnalysisBtn, {align:"left", width:250});
  });
}
if(ganttAnalysisMenu){
  ganttAnalysisMenu.addEventListener("click", function(e){
    if(e.target.closest("[data-gantt-critical]")){ UI.closeAllPops(); ganttToggleCritical(); return; }
    if(e.target.closest("[data-gantt-baseline-toggle]")){ UI.closeAllPops(); ganttToggleBaseline(); return; }
    if(e.target.closest("[data-gantt-baseline-set]")){ UI.closeAllPops(); ganttCaptureBaseline(); return; }
    if(e.target.closest("[data-gantt-baseline-clear]")){ UI.closeAllPops(); ganttClearBaseline(); return; }
    if(e.target.closest("[data-gantt-load]")){ UI.closeAllPops(); ganttToggleLoad(); return; }
    if(e.target.closest("[data-gantt-share]")){ UI.closeAllPops(); openGanttShare(); }
  });
}
if(ganttLoadCloseEl){
  ganttLoadCloseEl.addEventListener("click", function(){
    ganttState.showLoad = false;
    saveGanttPrefs();
    syncGanttLoadPanel();
    renderGanttAnalysisMenu();
  });
}

/* ---- 依赖菜单 ---- */
if(ganttDepMenu){
  ganttDepMenu.addEventListener("click", function(e){
    var typeBtn = e.target.closest("[data-gantt-dep-type]");
    if(typeBtn){
      ganttDepMenu.__depType = typeBtn.getAttribute("data-gantt-dep-type");
      ganttDepMenu.querySelectorAll("[data-gantt-dep-type]").forEach(function(b){
        b.setAttribute("aria-pressed", b === typeBtn ? "true" : "false");
      });
      return;
    }
    var depId = ganttDepMenu.__depId;
    if(!depId) return;
    if(e.target.closest("[data-gantt-dep-save]")){
      var lagInput = $("ganttDepLag");
      var lag = Number(lagInput && lagInput.value) || 0;
      API.put("/api/gantt/deps/" + encodeURIComponent(depId), { depType: ganttDepMenu.__depType || "FS", lagDays: lag }).then(function(){
        UI.closeAllPops();
        toast("依赖已更新", "fs");
        refreshGanttDeps();
      }).catch(function(ex){ toast("更新失败：" + (ex.message || "网络异常"), "bad"); });
      return;
    }
    if(e.target.closest("[data-gantt-dep-del]")){
      UI.closeAllPops();
      UI.showConfirm({ title:"删除依赖", msg:"删除后两条任务不再有先后约束，确定？", okText:"删除" }).then(function(ok){
        if(!ok) return;
        API.del("/api/gantt/deps/" + encodeURIComponent(depId)).then(function(){
          toast("依赖已删除", "fs");
          refreshGanttDeps();
        }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
      });
    }
  });
}

/* ---- 分享弹窗 ---- */
if($("ganttShareCopy")) $("ganttShareCopy").addEventListener("click", ganttCopyShare);
if($("ganttShareRevoke")) $("ganttShareRevoke").addEventListener("click", ganttRevokeShare);
if($("ganttShareClose")) $("ganttShareClose").addEventListener("click", function(){ UI.closeModal($("dlgGanttShare")); });

/* ---- 滚动：大列表只重绘可视区 ---- */
var ganttScrollRaf = 0;
if(ganttScroll){
  ganttScroll.addEventListener("scroll", function(){
    if(ganttState.drag || ganttState.unplannedDrag || ganttState.depDrag) return;
    if(!ganttState.layout.length || ganttScrollRaf) return;
    ganttScrollRaf = requestAnimationFrame(function(){
      ganttScrollRaf = 0;
      ganttRenderBody(false);
    });
  }, { passive: true });
}
/* 打印时把窗口化渲染临时展开为全量，避免只打出可视区 */
window.addEventListener("beforeprint", function(){
  if(activeView !== "gantt" || !ganttState.range) return;
  ganttState.printAll = true;
  ganttRenderBody(true);
});
window.addEventListener("afterprint", function(){
  if(!ganttState.printAll) return;
  ganttState.printAll = false;
  ganttRenderBody(true);
});

/* 窗口宽度跨越 900px（移动端只读）时重算左列宽度 */
var ganttResizeTimer = 0;
window.addEventListener("resize", function(){
  if(activeView !== "gantt") return;
  if(ganttResizeTimer) clearTimeout(ganttResizeTimer);
  ganttResizeTimer = setTimeout(function(){
    ganttResizeTimer = 0;
    if(activeView === "gantt" && !ganttState.drag) renderGantt();
  }, 180);
});

/* ==================== 项目视图（§6.6） ==================== */
var rName = $("rName"), rDesc = $("rDesc"), fReqName = $("fReqName"),
    segReqStatus = $("segReqStatus"), btnSaveReq = $("btnSaveReq"),
    btnCancelReqEdit = $("btnCancelReqEdit"), reqFormTitle = $("reqFormTitle");
function syncReqStatusSeg(){
  segReqStatus.querySelectorAll("[data-rst]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.rst === formReqStatus);
  });
}
function resetReqForm(){
  editingReqId = null;
  rName.value = ""; rDesc.value = "";
  formReqStatus = "active";
  fReqName.classList.remove("invalid");
  syncReqStatusSeg();
  reqFormTitle.textContent = "新增项目";
  btnSaveReq.textContent = "添加项目";
  btnCancelReqEdit.hidden = true;
  renderReqList();
}
function renderReqList(){
  var countEl = $("reqCount");
  if(countEl) countEl.textContent = reqList.length ? "共 " + reqList.length + " 个" : "";
  if(!reqList.length){
    reqListEl.innerHTML = UI.emptyState({
      icon:"folder", title:"还没有项目",
      text:"用右侧表单新建第一个项目；把任务归入项目后，可在筛选栏按项目查看全部工作。"
    });
    return;
  }
  reqListEl.innerHTML = reqList.map(function(r){
    return '<div class="req-item' + (editingReqId === r.id ? " editing" : "") + '" data-req-id="' + esc(r.id) + '">' +
      '<div class="req-top">' +
        '<span class="req-name">' + esc(r.name) + '</span>' +
        '<span class="tag tag-' + (r.status === "done" ? "success" : (r.status === "hold" ? "ghost" : "info")) + '">' +
          reqStatusName(r.status) + '</span>' +
        '<span class="req-acts">' +
          '<button class="icon-btn sm" type="button" data-edit-req="' + esc(r.id) + '" title="编辑项目" aria-label="编辑项目">' + icon("edit", 14) + '</button>' +
          (currentWs && currentWs.myRole === "owner"
            ? '<button class="icon-btn sm danger" type="button" data-del-req="' + esc(r.id) + '" title="删除项目" aria-label="删除项目">' + icon("trash", 14) + '</button>'
            : '') +
        '</span>' +
      '</div>' +
      (r.description ? '<div class="req-desc">' + esc(r.description) + '</div>' : '') +
      '<div class="req-meta">' +
        '<span class="progress" style="width:140px"><span class="bar"><i style="width:' + r.progressPct +
          '%;background:' + (r.status === "done" ? "var(--success)" : "var(--primary)") + '"></i></span></span>' +
        '<span style="font-weight:600;color:var(--text-2)">' + r.progressPct + '%</span>' +
        '<span>' + r.taskCount + ' 任务 · ' + r.doneCount + ' 完成' +
          (Number(r.docCount) ? (' · ' + r.docCount + ' 需求文档') : '') + '</span>' +
      '</div>' +
      '<div class="req-taskbar">' +
        '<input type="text" maxlength="60" data-req-new-input="' + esc(r.id) + '"' +
          ' placeholder="在此项目下新建任务，回车确认" aria-label="在项目 ' + esc(r.name) + ' 下新建任务" />' +
        '<button class="icon-btn sm" type="button" data-req-open="' + esc(r.id) + '" title="打开完整新建抽屉" aria-label="打开完整新建抽屉">' +
          icon("edit", 14) + '</button>' +
      '</div>' +
    '</div>';
  }).join("");
}
function enterProjectsView(){
  if(reqsLoaded) renderReqList();
  else reqListEl.innerHTML = UI.skeletonRows(3);
  loadReqs();
}
function saveReq(){
  var name = rName.value.trim();
  if(!name){
    fReqName.classList.add("invalid");
    try{ rName.focus(); }catch(e){ /* noop */ }
    return;
  }
  var body = { name: name, description: rDesc.value.trim(), status: formReqStatus };
  var editing = !!editingReqId;
  var p = editing ? API.put("/api/reqs/" + encodeURIComponent(editingReqId), body) : API.post("/api/reqs", body);
  btnSaveReq.disabled = true;
  p.then(function(){
    btnSaveReq.disabled = false;
    toast(editing ? ("已更新项目「" + name + "」") : ("已新增项目「" + name + "」"), "fs");
    resetReqForm();
    loadReqs().then(function(){
      renderReqList();
      loadBoard({silent:true});
    });
  }).catch(function(ex){
    btnSaveReq.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function deleteReq(id){
  var r = null;
  for(var i = 0; i < reqList.length; i++) if(reqList[i].id === id) r = reqList[i];
  if(!r) return;
  if(!(currentWs && currentWs.myRole === "owner")){ toast("仅空间主可删除项目", "warn"); return; }
  /* 后端删除项目会连带删除其下需求文档；确认框必须把这件事说清楚。
     docCount 来自项目列表，reqDocList 是本会话已加载的需求，取较大值防止列表快照过期。 */
  var liveDocs = (reqDocList || []).filter(function(d){ return d.reqId === id; }).length;
  var docs = Math.max(Number(r.docCount) || 0, liveDocs);
  var msg = "删除项目「" + esc(r.name) + "」？其下任务会保留，仅解除关联。";
  if(docs){
    msg += "<br><br>其下 <b>" + docs + "</b> 份需求文档会一并删除，<b>不可恢复</b>。";
  }
  UI.showConfirm({
    title:"删除项目",
    msg: msg,
    okText: docs ? "删除项目与需求文档" : "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/reqs/" + encodeURIComponent(id)).then(function(res){
      var deletedDocs = res && typeof res.docs === "number" ? res.docs : docs;
      toast("已删除项目「" + r.name + "」，其下任务已解除关联" +
        (res && res.unlinked ? "（" + res.unlinked + " 项）" : "") +
        (deletedDocs ? "；同时删除 " + deletedDocs + " 份需求文档" : ""), "fs");
      if(editingReqId === id) resetReqForm();
      loadReqDocs(true);
      loadReqs().then(function(){
        renderReqList();
        loadBoard({silent:true});
      });
    }).catch(function(ex){ toast("删除失败：" + (ex.message || "网络异常"), "bad"); });
  });
}
btnSaveReq.addEventListener("click", saveReq);
btnCancelReqEdit.addEventListener("click", resetReqForm);
rName.addEventListener("input", function(){ fReqName.classList.remove("invalid"); });
segReqStatus.addEventListener("click", function(e){
  var b = e.target.closest("[data-rst]"); if(!b) return;
  formReqStatus = b.dataset.rst; syncReqStatusSeg();
});
reqListEl.addEventListener("click", function(e){
  var openNew = e.target.closest("[data-req-open]");
  if(openNew){
    var rid = openNew.dataset.reqOpen;
    openTaskDrawer("backlog");
    populateReqSelect();
    iReq.value = rid;
    return;
  }
  var ed = e.target.closest("[data-edit-req]");
  if(ed){
    var r = null;
    for(var i = 0; i < reqList.length; i++) if(reqList[i].id === ed.dataset.editReq) r = reqList[i];
    if(r){
      editingReqId = r.id;
      rName.value = r.name;
      rDesc.value = r.description || "";
      formReqStatus = r.status || "active";
      fReqName.classList.remove("invalid");
      syncReqStatusSeg();
      reqFormTitle.textContent = "编辑项目";
      btnSaveReq.textContent = "保存修改";
      btnCancelReqEdit.hidden = false;
      renderReqList();
      try{ rName.focus(); }catch(e2){ /* noop */ }
    }
    return;
  }
  var dl = e.target.closest("[data-del-req]");
  if(dl) deleteReq(dl.dataset.delReq);
});
/* O-20：项目页就地新建任务（自动带 reqId） */
reqListEl.addEventListener("keydown", function(e){
  var inp = e.target.closest("[data-req-new-input]");
  if(!inp) return;
  if(e.key !== "Enter") return;
  if(e.isComposing || e.keyCode === 229) return;
  var v = inp.value.trim();
  if(!v) return;
  e.preventDefault();
  var reqId = inp.dataset.reqNewInput;
  inp.disabled = true;
  API.post("/api/tasks", {
    title: v.slice(0, 60), boardColumn: "backlog", priority: "P2", progress: 0, reqId: reqId
  }).then(function(nt){
    inp.disabled = false;
    inp.value = "";
    taskCacheExtra[nt.id] = nt;
    toast("已在项目中新建「" + nt.title + "」", "fs");
    loadReqs().then(function(){ renderReqList(); loadBoard({silent:true}); });
  }).catch(function(ex){
    inp.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});

/* ==================== 我的任务（跨空间聚合，N-3） ==================== */
function wsNameById(id){
  for(var i = 0; i < allWorkspaces.length; i++) if(allWorkspaces[i].id === id) return allWorkspaces[i].name;
  return "该空间";
}
/**
 * 切换空间的统一入口：先二次确认，再 POST select + reload。
 * 为什么必须问一次：切空间会重新加载页面，当前空间的筛选条件、抽屉里未保存的编辑都会丢；
 * 而「我的任务」/ 通知中心点别的空间的任务是"点一下就走"，最容易误触。
 * @param {string} wsId
 * @param {string} wsName
 * @param {{taskTitle?:string, openTaskId?:string, title?:string}} [opts]
 */
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
  if(mineScope) mineScope.value = state.mineScope;
  syncMineFilters();
  loadMine();
}
/* 复评 §5.3：「我的任务」原来只有"范围"一个开关，任务一多就是一条长列表。
   这里补空间/优先级/被阻塞三个筛选，在客户端过滤（后端一次返回全量，交互即时）。 */
function mineFiltered(items){
  var q = (state.q || "").toLowerCase();
  return (items || []).filter(function(t){
    if(state.mineSpace && t.workspaceId !== state.mineSpace) return false;
    if(state.minePri && t.priority !== state.minePri) return false;
    if(state.mineBlocked && !t.blocked) return false;
    if(q && [t.title, t.description, t.note].join(" ").toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}
function mineFiltering(){
  return !!(state.mineSpace || state.minePri || state.mineBlocked || state.q);
}
function syncMineFilters(){
  if(minePriFilter) minePriFilter.value = state.minePri || "";
  if(mineBlockedChip) mineBlockedChip.setAttribute("aria-pressed", state.mineBlocked ? "true" : "false");
}
function populateMineSpaces(spaces){
  if(!mineSpaceFilter) return;
  var cur = state.mineSpace || "";
  var html = '<option value="">全部空间</option>' + (spaces || []).map(function(s){
    return '<option value="' + esc(s.id) + '">' + esc(s.name || s.id) + '</option>';
  }).join("");
  if(mineSpaceFilter.innerHTML !== html) mineSpaceFilter.innerHTML = html;
  mineSpaceFilter.value = cur;
  /* 此前选中的空间若已不在列表里（例如退出了该空间），回落到"全部" */
  if(mineSpaceFilter.value !== cur){
    state.mineSpace = "";
    mineSpaceFilter.value = "";
  }
}
var mineCache = {};
/* 缓存上一次的服务端返回，供"只改筛选条件"时本地重渲染（不再打接口） */
var mineAll = [], mineSpaces = [], mineNameOnly = 0;
function rerenderMine(){
  renderMine({items: mineAll, spaces: mineSpaces, matchedByNameOnly: mineNameOnly, total: mineAll.length});
}
function loadMine(opts){
  opts = opts || {};
  if(!mineBody) return;
  if(!opts.silent){
    mineBody.innerHTML = UI.skeletonRows(6);
    if(mineMeta) mineMeta.textContent = "加载中…";
  }
  /* my-tasks 的语义是"我跨全部空间的任务"，因此显式跳过自动附加的 workspace 参数 */
  API.getGlobal("/api/my-tasks", {scope: state.mineScope}).then(function(d){
    renderMine(d || {});
  }).catch(function(ex){
    if(mineMeta) mineMeta.textContent = "";
    mineBody.innerHTML = UI.errorState(ex.message);
    bindRetry(mineBody, function(){ loadMine(); });
  });
}
function renderMine(d){
  var all = d.items || [];
  var spaces = d.spaces || [];
  mineAll = all;
  mineSpaces = spaces;
  mineNameOnly = Number(d.matchedByNameOnly) || 0;
  populateMineSpaces(spaces);
  syncMineFilters();
  mineCache = {};
  all.forEach(function(t){ mineCache[t.workspaceId + "|" + t.id] = t; });
  var items = mineFiltered(all);
  var filtering = mineFiltering();
  if(mineMeta){
    var nameOnly = mineNameOnly;
    mineMeta.textContent = (filtering ? ("筛选出 " + items.length + " / " + all.length + " 项") : ("共 " + all.length + " 项")) +
      " · 覆盖 " + spaces.length + " 个空间" +
      (state.mineScope === "open" ? "（未完成）" : "（含已完成）") +
      (nameOnly > 0 ? ("　·　其中 " + nameOnly + " 项仅按显示名匹配（未绑定账号）") : "");
  }
  if(mineDot){
    var n = all.length;
    mineDot.textContent = n > 99 ? "99+" : n;
    mineDot.hidden = n === 0;
  }
  if(!all.length){
    mineBody.innerHTML = UI.emptyState({
      icon:"checkCircle", title:"没有分派给你的任务",
      text:"被指派到你账号的任务会汇总在这里（跨你参与的全部空间）。若老数据只填了显示名、没有绑定账号，请先在任务里重新指定负责人。"
    });
    return;
  }
  if(!items.length){
    mineBody.innerHTML = UI.emptyState({
      icon:"filterOff", title:"当前筛选下没有任务", compact:true,
      text:"试着放宽空间 / 优先级 / 被阻塞条件。",
      actionLabel:"清除筛选"
    });
    var btn = mineBody.querySelector(".empty-state .btn");
    if(btn) btn.addEventListener("click", function(){
      state.mineSpace = ""; state.minePri = ""; state.mineBlocked = false;
      rerenderMine();
    });
    return;
  }
  mineBody.innerHTML = '<div class="list-scroll"><div class="list-head" style="grid-template-columns:minmax(0,1fr) 140px 96px 92px 84px 128px">' +
      '<span>任务</span><span>空间</span><span>列</span><span>优先级</span><span>截止</span><span>进度</span>' +
    '</div><div class="list-body">' + items.map(function(t){
      var st = dueState(t);
      var p = progressOf(t);
      return '<div class="list-row" data-mine-id="' + esc(t.id) + '" data-mine-ws="' + esc(t.workspaceId || "") + '"' +
          ' tabindex="0" role="row" style="grid-template-columns:minmax(0,1fr) 140px 96px 92px 84px 128px">' +
        '<span class="lr-task"><span class="lr-t">' + esc(t.title) + '</span>' +
          '<span class="lr-tags">' + catTag(t.category) +
            ((t.tags || []).slice(0, 2).map(tagChip).join("")) +
            (t.blocked ? '<span class="blocked-tag">' + icon("alert", 12) + '被阻塞</span>' : '') + '</span></span>' +
        '<span class="cell">' + esc(t.workspaceName || "—") + '</span>' +
        '<span class="cell">' + esc(colName(t.boardColumn)) + '</span>' +
        '<span><span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span></span>' +
        '<span class="cell ' + (st.kind === "over" ? "over" : (st.kind === "today" ? "today" : "")) + '">' +
          esc(dueText(t)) + '</span>' +
        '<span><span class="progress mini"><span class="bar"><i style="width:' + p + '%"></i></span>' +
          '<span class="pv">' + p + '%</span></span></span>' +
      '</div>';
    }).join("") + '</div></div>';
}
if(mineBody){
  mineBody.addEventListener("click", function(e){
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    var id = row.dataset.mineId;
    var wsId = row.dataset.mineWs;
    if(wsId && currentWs && wsId !== currentWs.id){
      /* 跨空间任务：先二次确认，确认后切空间 + 接力打开该任务 */
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
    var row = e.target.closest("[data-mine-id]");
    if(!row) return;
    e.preventDefault();
    row.click();
  });
}
if(mineScope){
  mineScope.addEventListener("change", function(){
    state.mineScope = mineScope.value;
    loadMine();
  });
}
if(mineSpaceFilter){
  mineSpaceFilter.addEventListener("change", function(){
    state.mineSpace = mineSpaceFilter.value || "";
    rerenderMine();
  });
}
if(minePriFilter){
  minePriFilter.addEventListener("change", function(){
    state.minePri = minePriFilter.value || "";
    rerenderMine();
  });
}
if(mineBlockedChip){
  mineBlockedChip.addEventListener("click", function(){
    state.mineBlocked = !state.mineBlocked;
    rerenderMine();
  });
}
if(btnMineRefresh) btnMineRefresh.addEventListener("click", function(){ loadMine(); });

/* ==================== 周回顾（§6.7） ==================== */
function reviewTitle(off){
  return off === -1 ? "上周工作回顾" : (off === 0 ? "本周工作回顾" : "工作回顾");
}
function setReviewLoading(){
  $("summaryText").innerHTML = "加载中…";
  $("statGrid").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
    '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  if(reviewHoursEl) reviewHoursEl.innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  if(reviewPendingBox) reviewPendingBox.hidden = true;
  $("peopleBox").innerHTML = '<span class="skel skel-line" style="width:120px"></span>';
  $("catDist").innerHTML = UI.skeletonRows(3);
  $("progList").innerHTML = UI.skeletonRows(3);
  $("reqDist").innerHTML = UI.skeletonRows(3);
  $("doneList").innerHTML = UI.skeletonRows(4);
}
function enterReviewView(){
  setReviewLoading();
  loadReqs();
  var seq = ++reviewSeq;
  reviewTarget = null;
  API.get("/api/review").then(function(d){
    if(seq !== reviewSeq) return;
    state.reviewData = d;
    reviewTarget = d.weekOffset;
    renderReview(d);
  }).catch(function(ex){
    if(seq !== reviewSeq) return;
    reviewTarget = null;
    $("summaryText").innerHTML = '<span style="color:var(--danger)">加载失败：' + esc(ex.message || "网络异常") + '</span>';
  });
}
function navWeek(delta){
  var base = reviewTarget !== null ? reviewTarget : (state.reviewData ? state.reviewData.weekOffset : -1);
  var off = base + delta;
  reviewTarget = off;
  var seq = ++reviewSeq;
  API.get("/api/review", {weekOffset: off}).then(function(d){
    if(seq !== reviewSeq) return;
    state.reviewData = d;
    reviewTarget = d.weekOffset;
    renderReview(d);
  }).catch(function(ex){
    if(seq !== reviewSeq) return;
    reviewTarget = state.reviewData ? state.reviewData.weekOffset : null;
    toast("加载失败：" + (ex.message || "网络异常"), "bad");
  });
}
function buildSummary(d){
  var list = d.completed || [];
  var n = list.length;
  var label = d.label || "该周期";
  var rangeTxt = fmtMD(parseDate(d.weekStart)) + " — " + fmtMD(parseDate(d.weekEnd));
  var progTasks = d.progressTasks || [];
  if(!n && !progTasks.length && !d.doing && !d.backlog){
    return label + "（" + rangeTxt + "）暂无工作记录。把卡片拖入「已完成」列会自动记录完成时间；在任务里填上进度，回顾里就能看到这一周你做了什么。";
  }
  var parts = [];
  if(n){
    var rate = d.stats.onTimeRate;
    var withDue = d.stats.withDue || 0;
    var p0 = list.filter(function(t){ return t.priority === "P0"; }).length;
    var rateTxt = (withDue === 0)
      ? "，完成项均未设置截止日期"
      : "，按期完成率 <b>" + rate + "%</b>" + (rate < 100 ? "（延期 " + d.stats.late + " 项）" : "，全部按期交付");
    parts.push("<b>" + label + "（" + rangeTxt + "）</b>共交付 <b>" + n + "</b> 项任务" + rateTxt +
      (p0 ? "，其中紧急 P0 <b>" + p0 + "</b> 项。" : "。"));
  }else{
    parts.push("<b>" + label + "（" + rangeTxt + "）</b>没有已交付的任务记录。");
  }
  if(n){
    var items = list.slice(0, 12).map(function(t){
      var late = t.completedAt && t.dueDate && t.completedAt > t.dueDate;
      var dt = t.completedAt ? (fmtMD(parseDate(t.completedAt)) + " " + weekdayCN(parseDate(t.completedAt))) : "";
      return "· " + esc(t.title) + "（" + esc(t.category) + " · " + esc(t.owner) +
        (dt ? " · " + dt : "") + (late ? " · <span class='up'>延期</span>" : "") + "）";
    });
    parts.push("完成的工作：" + (list.length > 1 ? "<br>" : "") + items.join("<br>") +
      (list.length > 12 ? "<br>…等共 " + n + " 项" : ""));
  }
  if(progTasks.length){
    var pl = progTasks.slice(0, 8).map(function(t){
      return "· " + esc(t.title) + "（" + progressOf(t) + "%" +
        (t.boardColumn === "done" ? " · 已完成" : " · " + esc(colName(t.boardColumn))) +
        (t.note ? " · " + esc(t.note) : "") + "）";
    });
    parts.push("进行中的工作（" + progTasks.length + " 项）：" + (progTasks.length > 1 ? "<br>" : "") +
      pl.join("<br>") + (progTasks.length > 8 ? "<br>…等" : ""));
  }
  if(d.doing || d.backlog){
    parts.push("当前看板：进行中 <b>" + d.doing + "</b> 项、待处理 <b>" + d.backlog + "</b> 项" +
      (progTasks.length ? "，详细进度见下方「进行中」。" : "。"));
  }
  var c = d.counts || {over:0, today:0};
  if(d.openP0 || c.over){
    parts.push("需关注：" + (d.openP0 ? "<b>" + d.openP0 + "</b> 项 P0 未关闭" : "") +
      (c.over ? (d.openP0 ? "，" : "") + "<b>" + c.over + "</b> 项已逾期" : "") +
      (c.today ? "、<b>" + c.today + "</b> 项今日到期" : "") + "，建议优先处理。");
  }
  return parts.join("<br><br>");
}
function summaryPlain(d){
  var el = document.createElement("div");
  el.innerHTML = buildSummary(d).replace(/<br\s*\/?>/gi, "\n");
  return el.textContent || "";
}
function distHTML(list, colorOf, valueOf){
  if(!list || !list.length) return '<div class="col-empty">暂无数据</div>';
  var max = 1;
  list.forEach(function(x){ if(x.count > max) max = x.count; });
  return list.map(function(x){
    return '<div class="dist-row">' +
      '<span class="lb">' + esc(x.name) + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(x.count/max*100) + '%;background:' + colorOf(x) + '"></i></span>' +
      '<span class="vl">' + valueOf(x) + '</span></div>';
  }).join("");
}
function renderReview(d){
  $("reviewTitle").textContent = reviewTitle(d.weekOffset);
  $("weekLabel").textContent = fmtMD(parseDate(d.weekStart)) + " — " + fmtMD(parseDate(d.weekEnd));
  $("weekNext").disabled = d.weekOffset >= 0;
  $("summaryText").innerHTML = buildSummary(d);

  var s = d.stats;
  var overN = (d.counts && d.counts.over) || 0;
  var stats = [
    {k:"完成", v:s.done, u:"项", cls:""},
    {k:"按期率", v:s.onTimeRate, u:"%", cls:(s.onTimeRate < 60 ? "warn" : "good")},
    {k:"延期", v:s.late, u:"项", cls:(s.late > 0 ? "warn" : "")},
    {k:"参与成员", v:s.members, u:"人", cls:""},
    {k:"逾期", v:overN, u:"项", cls:(overN > 0 ? "bad" : "")},
    {k:"进行中", v:d.doing || 0, u:"项", cls:"info"}
  ];
  $("statGrid").innerHTML = stats.map(function(x){
    return '<div class="stat ' + x.cls + '"><div class="k">' + x.k + '</div><div class="v">' + x.v +
      '<small>' + x.u + '</small></div></div>';
  }).join("");

  /* N-5：工时区（全空间 / 我的） */
  if(reviewHoursEl){
    var w = d.workMinutes || {};
    var hcards = [
      {k:"全空间累计", v:fmtMinutesShort(w.space || 0)},
      {k:"我的累计", v:fmtMinutesShort(w.mine || 0)},
      {k:"本周·全空间", v:fmtMinutesShort(w.spaceWeek || 0)}
    ];
    reviewHoursEl.innerHTML = hcards.map(function(x){
      return '<div class="stat"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div></div>';
    }).join("");
  }
  /* O-10：进度 100% 但未入已完成列的任务单独成组，不静默漏统计 */
  var pending = d.pendingDone || [];
  if(reviewPendingBox){
    reviewPendingBox.hidden = pending.length === 0;
    if(pendingCount) pendingCount.textContent = pending.length ? ("共 " + pending.length + " 项") : "";
    if(pendingList){
      pendingList.innerHTML = pending.map(function(t){
        return '<div class="done-item">' + avatarHTML(t.owner) +
          '<span class="di-main">' +
            '<span class="di-t">' + esc(t.title) + '</span>' +
            '<span class="di-m"><span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
              catTag(t.category) + '<span>' + esc(t.owner) + '</span></span>' +
          '</span>' +
          '<span class="di-d">' + esc(colName(t.boardColumn)) + ' · 进度 ' + progressOf(t) + '%</span>' +
        '</div>';
      }).join("");
    }
  }

  $("catDist").innerHTML = distHTML(d.catDist,
    function(c){ return catColor(c.name); },
    function(c){ return c.count; });

  var members = d.members || [];
  $("peopleBox").innerHTML = members.length ? members.map(function(m){
    return '<span class="person">' + avatarHTML(m.name) + '<span class="pn">' + esc(m.name) + '</span>' +
      '<span class="pc">' + m.count + ' 项' + (m.minutes ? (' · ' + fmtMinutesShort(m.minutes)) : '') + '</span></span>';
  }).join("") : '<span class="foot-note">该周期暂无成员交付记录</span>';

  var list = d.completed || [];
  $("doneList").innerHTML = list.length ? list.map(function(t){
    /* completedAt 可能为空（历史数据 / 异常恢复）：那就显示「完成时间未记录」，不能让渲染崩掉 */
    var doneAt = t.completedAt ? parseDate(t.completedAt) : null;
    var due = t.dueDate ? parseDate(t.dueDate) : null;
    var late = !!(doneAt && due && t.completedAt > t.dueDate);
    var n = late ? dayDiff(doneAt, due) : 0;
    var badge = late ? ("延期 " + n + " 天") : ((doneAt && due) ? "按期" : "—");
    var badgeKind = late ? "warning" : ((doneAt && due) ? "success" : "ghost");
    return '<div class="done-item">' +
      '<span class="meta full">' + icon("check", 15) + '</span>' +
      '<span class="di-main">' +
        '<span class="di-t">' + esc(t.title) + '</span>' +
        '<span class="di-m"><span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
          catTag(t.category) + '<span>' + esc(t.owner) + '</span></span>' +
      '</span>' +
      '<span class="di-d">' + (doneAt ? (esc(fmtShortMD(doneAt)) + " " + weekdayCN(doneAt)) : "完成时间未记录") + '</span>' +
      '<span class="tag tag-' + badgeKind + '">' + badge + '</span>' +
    '</div>';
  }).join("") : '<div class="col-empty">该周期没有已完成的任务</div>';
  if(doneCountEl) doneCountEl.textContent = list.length ? ("共 " + list.length + " 项") : "";

  var progTasks = d.progressTasks || [];
  $("progList").innerHTML = progTasks.length ? progTasks.map(function(t){
    return '<div class="done-item">' + avatarHTML(t.owner) +
      '<span class="di-main">' +
        '<span class="di-t">' + esc(t.title) + '</span>' +
        '<span class="di-m"><span class="pdot ' + esc(t.priority) + '"><i></i>' + esc(t.priority) + '</span>' +
          catTag(t.category) + (t.reqId ? tagChip(reqNameById(t.reqId)) : '') +
          '<span>进度 ' + progressOf(t) + '%</span></span>' +
        (t.note ? '<span class="di-note">备注：' + esc(t.note) + '</span>' : '') +
      '</span>' +
      '<span class="di-d">' + esc(colName(t.boardColumn)) + '</span>' +
    '</div>';
  }).join("") : '<div class="col-empty">当前没有进行中的任务（把任务拖到「进行中」列即可）</div>';
  if(progCountEl) progCountEl.textContent = progTasks.length ? ("共 " + progTasks.length + " 项") : "";

  var reqDist = d.reqDist || [];
  $("reqDist").innerHTML = reqDist.length
    ? distHTML(reqDist.map(function(r){ return {name:r.name, count:r.progressPct, extra:r}; }),
        function(r){ return r.extra.status === "done" ? "var(--success)" : "var(--primary)"; },
        function(r){ return r.count + "% · " + r.extra.doneCount + "/" + r.extra.taskCount; })
    : '<div class="col-empty">暂无项目</div>';

  /* AI 周报跟着「当前这一周」走：有缓存还原，没有则空态（函数定义在下方，靠声明提升） */
  syncAiReport(d);
}
$("weekPrev").addEventListener("click", function(){ navWeek(-1); });
$("weekNext").addEventListener("click", function(){
  if(state.reviewData && state.reviewData.weekOffset >= 0) return;
  navWeek(1);
});
$("btnCopy").addEventListener("click", function(){
  var d = state.reviewData;
  if(!d){ toast("回顾还没加载完成", "warn"); return; }
  var progTasks = d.progressTasks || [];
  var doneTasks = d.completed || [];
  /* 复制口径与页面一致：先「进行中」（已开工未完成），再「本周完成」。
     不再叫「完成明细」—— 页面上的区块也叫「本周完成」。 */
  var text = "工作台 · " + (d.label || "") + "工作回顾（" + d.weekStart + " — " + d.weekEnd + "）\n\n"
    + summaryPlain(d) + "\n\n"
    + "进行中（" + progTasks.length + " 项）：\n"
    + (progTasks.length ? progTasks.map(function(t){
        var rn = t.reqId ? reqNameById(t.reqId) : null;
        return "· " + colName(t.boardColumn) + "　" + t.title + "　" + progressOf(t) + "%"
          + (rn ? "（" + rn + "）" : "") + (t.note ? "　备注：" + t.note : "");
      }).join("\n") : "（当前没有进行中的任务）")
    + "\n\n本周完成（" + doneTasks.length + " 项）：\n"
    + (doneTasks.length ? doneTasks.map(function(t){
        return "· [" + t.priority + "][" + t.category + "] " + t.title + " — " + t.owner
          + (t.completedAt ? "（" + t.completedAt + "）" : "（完成时间未记录）");
      }).join("\n") : "（本周没有完成的任务）");
  copyToClipboard(text, "已复制本周总结", "复制失败，请手动选择文本");
});

/* ==================== 周回顾 · AI 周报 ==================== */
/* 口径：AI 只负责措辞 —— 完成数/按期率/工时这些数字全部由 /api/review 算好再喂给模型，
   并且要求它只能引用、不得加总（后端 AiReviewService 里有同样的注释）。
   结果按「周偏移」缓存在内存里：来回翻周不会把周报弄丢，也不会把上周的周报误认成这周的。 */
var aiReportCache = {};   // { "空间id#周偏移": AiReviewResponse }
var aiReportBusy = false;

/** 缓存键要带空间：换空间后同一个 weekOffset 是完全不同的一批任务，不能复用 */
function aiKey(off){
  return String(window.CURRENT_WORKSPACE || "") + "#" + off;
}

function aiReportIdle(){
  var body = $("reviewAiBody");
  if(!body) return;
  body.hidden = true;
  body.innerHTML = "";
  $("reviewAiUsage").textContent = "";
  $("btnAiReportCopy").hidden = true;
  $("reviewAiHint").hidden = false;
  $("reviewAiMeta").textContent = "用你自己的模型额度";
}

/** 切周/切空间后同步面板：有缓存就还原，没有就回到空态 */
function syncAiReport(d){
  if(!d || !$("reviewAiBody")) return;
  var hit = aiReportCache[aiKey(d.weekOffset)];
  if(hit) renderAiReport(hit); else aiReportIdle();
}

/** 只把「## 小节」那一行加重，其余原样；全程 escape —— 模型输出绝不进 innerHTML */
function reportHTML(text){
  return String(text || "").split("\n").map(function(line){
    var m = /^#{1,3}\s+(.*)$/.exec(line);
    return m ? ('<span class="rp-h">' + esc(m[1]) + '</span>') : esc(line);
  }).join("\n");
}

function renderAiReport(r){
  var body = $("reviewAiBody");
  body.hidden = false;
  body.innerHTML = reportHTML(r.report);
  $("reviewAiHint").hidden = true;
  $("btnAiReportCopy").hidden = false;
  $("reviewAiMeta").textContent = (r.label || "该周期") + "（" + (r.weekStart || "") + " — " + (r.weekEnd || "") + "）";
  var s = r.source || {};
  var based = "基于 " + (s.completed || 0) + " 项完成 / " + (s.progress || 0) + " 项进行中";
  if(s.pendingDone) based += " / " + s.pendingDone + " 项待确认完成";
  if(s.truncated) based += "（任务太多，只取了前若干条）";
  $("reviewAiUsage").textContent = based + " · " + aiUsageText(r.usage);
}

function runAiReport(){
  var d = state.reviewData;
  if(!d || aiReportBusy) return;
  var btn = $("btnAiReport");
  var noteEl = $("reviewAiNote");
  var body = $("reviewAiBody");
  var week = d.weekOffset;
  aiReportBusy = true;
  aiBtnBusy(btn, true, "生成中…");
  $("reviewAiMeta").textContent = "正在写…（10–30 秒）";
  $("reviewAiHint").hidden = true;
  $("btnAiReportCopy").hidden = true;
  body.hidden = false;
  body.innerHTML = '<div class="rp-loading">' + UI.skeletonRows(4) + '</div>';
  $("reviewAiUsage").textContent = "";
  API.post("/api/ai/review/polish", {
    weekOffset: week,
    note: noteEl ? String(noteEl.value || "").trim() : ""
  }).then(function(r){
    aiReportCache[aiKey(r.weekOffset == null ? week : r.weekOffset)] = r;
    /* 生成过程中可能已经翻到别的周：存进缓存就好，不要覆盖当前这一周的界面 */
    if(state.reviewData && state.reviewData.weekOffset === week) renderAiReport(r);
  }).catch(function(ex){
    if(state.reviewData && state.reviewData.weekOffset === week){
      body.hidden = true;
      $("reviewAiHint").hidden = false;
      $("reviewAiMeta").textContent = "生成失败";
    }
    toast(aiErrMsg(ex && ex.message), "bad");
  }).then(function(){
    aiReportBusy = false;
    aiBtnBusy(btn, false);
  });
}
if($("btnAiReport")) $("btnAiReport").addEventListener("click", runAiReport);
if($("btnAiReportCopy")) $("btnAiReportCopy").addEventListener("click", function(){
  var d = state.reviewData;
  var hit = d ? aiReportCache[aiKey(d.weekOffset)] : null;
  if(!hit || !hit.report){ toast("先点「生成周报」", "warn"); return; }
  copyToClipboard(hit.report, "已复制周报", "复制失败，请手动选择文本");
});

/* ==================== 侧边栏收起（可见按钮 + Ctrl+B / Ctrl+\） ==================== */
function toggleRail(){
  var on = document.body.classList.toggle("side-rail");
  try{ localStorage.setItem("ds.rail", on ? "1" : "0"); }catch(err){ /* 隐私模式忽略 */ }
}
if($("btnRail")) $("btnRail").addEventListener("click", toggleRail);

/* 收起态下鼠标移到导航图标上，浮出名称气泡
   （原生 title 要等 1 秒才出，且 .side-nav 是 overflow:auto 会把伪元素气泡裁掉，所以用 fixed 层） */
(function railTips(){
  var nav = $("sideNav");
  if(!nav) return;
  var tip = document.createElement("div");
  tip.className = "rail-tip";
  document.body.appendChild(tip);
  var show = function(item){
    var label = item.querySelector(".nl");
    if(!label) return;
    var r = item.getBoundingClientRect();
    tip.textContent = label.textContent.trim();
    tip.style.top = Math.round(r.top + r.height / 2 - 11) + "px";
    tip.style.left = Math.round(r.right + 10) + "px";
    tip.classList.add("on");
  };
  var hide = function(){ tip.classList.remove("on"); };
  nav.addEventListener("mousemove", function(e){
    if(!document.body.classList.contains("side-rail")){ hide(); return; }
    var item = e.target.closest(".nav-item");
    if(item) show(item); else hide();
  });
  nav.addEventListener("mouseleave", hide);
  nav.addEventListener("click", hide);
  document.addEventListener("click", function(e){
    if(!nav.contains(e.target)) hide();
  });
})();

/* 静态图标占位：HTML 里写 <span data-icon="bold"></span>，这里统一填充 SVG */
(function hydrateIcons(){
  document.querySelectorAll("[data-icon]").forEach(function(el){
    el.innerHTML = icon(el.getAttribute("data-icon"), 16);
  });
})();

/* ==================== 需求（列表树 + 独立编辑页 + SunEditor 编辑器） ==================== */
var reqDocList = [];        // 列表（含项目名、创建时间、任务数、摘要），不含正文
var reqDocDirty = false;    // 编辑页有未保存修改
var reqEditor = null;       // SunEditor 实例（第一次打开编辑页时创建）
var reqCollapsed = {};      // 项目折叠状态 {reqId: true}
var editingDocId = null;    // 编辑页当前需求
var reqDocOpenSeq = 0;      // 连续打开多份需求时，只认最后一次请求的结果
/* 标题 / 项目 / 状态在「新增需求」时就确定了，编辑页只写正文 —— 这里缓存住，保存时带回去 */
var editingMeta = { title: "", reqId: "", status: "draft" };

function reqDocNameById(id){
  if(!id) return null;
  for(var i = 0; i < reqDocList.length; i++) if(reqDocList[i].id === id) return reqDocList[i].title;
  return null;
}
function reqDocStatusLabel(s){
  if(s === "active") return "进行中";
  if(s === "done") return "已完成";
  return "草稿";
}
function reqDocProjectName(reqId){
  for(var i = 0; i < reqList.length; i++) if(reqList[i].id === reqId) return reqList[i].name;
  for(var j = 0; j < reqDocList.length; j++) if(reqDocList[j].reqId === reqId && reqDocList[j].reqName) return reqDocList[j].reqName;
  return "未归属项目";
}

/**
 * SunEditor 按需加载（2.5 MB，不能跟着首屏一起下）。
 * 首次打开需求正文时才插入 CSS/JS；失败可重试，Promise 结果缓存。
 */
var sunEditorPromise = null;
function loadSunEditor(){
  if(typeof window.SUNEDITOR !== "undefined") return Promise.resolve();
  if(sunEditorPromise) return sunEditorPromise;
  sunEditorPromise = new Promise(function(resolve, reject){
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/suneditor/suneditor.min.css";
    document.head.appendChild(css);
    var s = document.createElement("script");
    s.src = "vendor/suneditor/suneditor.min.js";
    s.onload = function(){ resolve(); };
    s.onerror = function(){
      sunEditorPromise = null;
      reject(new Error("富文本编辑器加载失败，请检查网络后重试"));
    };
    document.head.appendChild(s);
  });
  return sunEditorPromise;
}

var editorPromise = null;
/** 取（或创建）编辑器实例；返回 Promise，未就绪时不要保存正文，避免把内容清空 */
function ensureEditor(){
  if(reqEditor) return Promise.resolve(reqEditor);
  if(!$("reqDocCanvas")) return Promise.resolve(null);
  if(editorPromise) return editorPromise;
  editorPromise = loadSunEditor().then(function(){
    /* 加载期间用户已经退出编辑页：不要对着隐藏容器创建（尺寸会算成 0） */
    if(!$("reqDocEditPage") || $("reqDocEditPage").hidden){
      editorPromise = null;
      return null;
    }
    reqEditor = SUNEDITOR.create("reqDocCanvas", {
      buttonList: [
        ["undo", "redo"],
        ["formatBlock", "font", "fontSize"],
        ["bold", "underline", "italic", "strike"],
        ["fontColor", "hiliteColor"],
        ["align", "list", "lineHeight"],
        ["outdent", "indent"],
        ["table", "link", "image"],
        ["removeFormat"],
        ["codeView"]
      ],
      mode: "classic",
      /* auto：不内滚，内容多高就多高，靠外层整页滚动 */
      height: "auto",
      minHeight: "360px",
      placeholder: "在这里写需求：目标、范围、验收标准…",
      charCounter: false,
      resizingBar: false,
      showPathLabel: false
    });
    reqEditor.onChange = function(){ markReqDocDirty(); scheduleTocRebuild(); };
    return reqEditor;
  }).catch(function(e){
    editorPromise = null;
    throw e;
  });
  return editorPromise;
}

var reqDocsLoaded = false;
/** force=true 时强制重拉（增删改后调用）；否则每个会话只拉一次 */
function loadReqDocs(force){
  if(reqDocsLoaded && !force) return Promise.resolve(reqDocList);
  return API.get("/api/req-docs").then(function(rows){
    reqDocList = rows || [];
    reqDocsLoaded = true;
    if(activeView === "requirements") renderReqDocTree();
    populateReqDocSelect();
    if(state.board) render({animate:false});
  }).catch(function(){ /* 需求模块不可用时静默降级 */ });
}

/* ---------------- 列表页 ---------------- */

function enterRequirementsView(){
  fillReqDocProjectSelect();
  loadReqs().then(function(){ fillReqDocProjectSelect(); });
  showReqDocList();
  loadReqDocs().then(function(){ renderReqDocTree(); });
}

function showReqDocList(){
  reqDocOpenSeq++;
  editingDocId = null;
  state.reqDocId = null;
  reqDocDirty = false;
  tocItems = [];
  tocActive = null;
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
}

/** 按项目分组的树：项目可展开/收起；每条显示标题 / 创建人 / 创建时间 / 任务数 / 摘要 */
function renderReqDocTree(){
  var box = $("reqDocTree");
  if(!box) return;
  if(!reqDocList.length){
    box.innerHTML = '<div class="reqdoc-empty2">还没有需求。点右上角「新增需求」，先选项目再填需求名称。</div>';
    return;
  }
  var kw = (($("reqDocSearch") || {}).value || "").trim().toLowerCase();
  var rows = reqDocList.filter(function(r){
    return !kw || String(r.title || "").toLowerCase().indexOf(kw) !== -1;
  });
  if(!rows.length){
    box.innerHTML = '<div class="reqdoc-empty2">没有匹配的需求</div>';
    return;
  }

  var groups = [], index = {};
  rows.forEach(function(r){
    var key = r.reqId || "__none";
    if(!index[key]){
      index[key] = { key: key, reqId: r.reqId, name: r.reqName || "未归属项目", items: [] };
      groups.push(index[key]);
    }
    index[key].items.push(r);
  });
  /* 按「项目」里的顺序排，未在列表中的排最后 */
  var order = {};
  reqList.forEach(function(r, i){ order[r.id] = i; });
  groups.sort(function(a, b){
    var oa = order[a.reqId] == null ? 9999 : order[a.reqId];
    var ob = order[b.reqId] == null ? 9999 : order[b.reqId];
    return oa - ob;
  });

  box.innerHTML = groups.map(function(g){
    var collapsed = !!reqCollapsed[g.key];
    return '<div class="reqdoc-proj' + (collapsed ? " collapsed" : "") + '">' +
      '<button class="reqdoc-proj-head" type="button" data-toggle-proj="' + esc(g.key) + '"' +
        ' aria-expanded="' + (collapsed ? "false" : "true") + '">' +
        '<span class="rp-caret">' + icon("down", 14) + '</span>' +
        '<span class="rp-name">' + esc(g.name) + '</span>' +
        '<span class="rp-count">' + g.items.length + '</span>' +
      '</button>' +
      '<div class="reqdoc-proj-body">' +
        g.items.map(function(r){
          var meta = [esc(r.owner || "—") + " 创建"];
          if(r.createdAt) meta.push(esc(fmtTs(r.createdAt)));
          if(r.status && r.status !== "draft") meta.push(reqDocStatusLabel(r.status));
          if(r.taskCount) meta.push(r.doneCount + "/" + r.taskCount + " 任务");
          return '<button class="reqdoc-row" type="button" data-reqdoc="' + esc(r.id) + '">' +
            '<span class="rr-main">' +
              '<span class="rr-title">' + esc(r.title) + '</span>' +
              '<span class="rr-meta">' + meta.join(" · ") + '</span>' +
              (r.excerpt ? '<span class="rr-excerpt">' + esc(r.excerpt) + '</span>' : '') +
            '</span>' +
            '<span class="rr-go">' + icon("chevronRight", 14) + '</span>' +
          '</button>';
        }).join("") +
      '</div>' +
    '</div>';
  }).join("");
}

function toggleReqProj(key){
  reqCollapsed[key] = !reqCollapsed[key];
  renderReqDocTree();
}

/* ---------------- 新增需求弹窗 ---------------- */

function openNewReqDocDialog(){
  var sel = $("newReqDocProject");
  if(!sel) return;
  sel.innerHTML = reqList.length
    ? reqList.map(function(r){ return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join("")
    : '<option value="">（还没有项目，请先去「项目」建一个）</option>';
  $("newReqDocTitle").value = "";
  $("dlgNewReqDoc").classList.add("open");
  setTimeout(function(){ $("newReqDocTitle").focus(); }, 40);
}
function closeNewReqDocDialog(){
  var d = $("dlgNewReqDoc");
  if(d) d.classList.remove("open");
}
function submitNewReqDoc(){
  var reqId = $("newReqDocProject").value;
  var title = ($("newReqDocTitle").value || "").trim();
  if(!reqId){ toast("还没有项目，请先到「项目」里建一个", "warn"); return; }
  if(!title){ toast("请填写需求名称", "warn"); $("newReqDocTitle").focus(); return; }
  API.post("/api/req-docs", { reqId: reqId, title: title, content: "", status: "draft" })
    .then(function(doc){
      closeNewReqDocDialog();
      loadReqDocs(true);
      openReqDocEditor(doc.id);
      toast("已创建「" + doc.title + "」，接着写正文", "fs");
    })
    .catch(function(ex){ toast(ex.message || "创建失败", "bad"); });
}

/* ---------------- 编辑页 ---------------- */

function openReqDocEditor(id){
  var seq = ++reqDocOpenSeq;
  API.get("/api/req-docs/" + encodeURIComponent(id)).then(function(doc){
    if(seq !== reqDocOpenSeq) return;   // 连续点开多份：丢弃过期的响应
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    editingMeta = { title: doc.title || "", reqId: doc.reqId || "", status: doc.status || "draft" };
    /* 先让编辑页可见，再创建编辑器：隐藏容器里量出来的宽高是 0 */
    if($("reqDocListPage")) $("reqDocListPage").hidden = true;
    if($("reqDocEditPage")) $("reqDocEditPage").hidden = false;
    fillReqDocEditor(doc);
    setTocVisible(tocVisiblePref());
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名需求");
    /* 打开时停在顶部：目录高亮与滚动位置对齐 */
    try{ window.scrollTo(0, 0); }catch(e){ /* 忽略 */ }
    setTimeout(refreshTocActive, 60);
  }).catch(function(ex){ toast(ex.message || "需求加载失败", "bad"); });
}

/** 返回列表（silent=true 时不动 DOM 之外的状态，用于进视图时复位） */
function closeReqDocEditor(){
  if($("reqDocEditPage")) $("reqDocEditPage").hidden = true;
  if($("reqDocListPage")) $("reqDocListPage").hidden = false;
  editingDocId = null;
  reqDirtyReset();
  renderReqDocTree();
}

function reqDirtyReset(){
  reqDocDirty = false;
  state.reqDocId = null;
}

/** 点返回 / Esc：有未保存修改就弹三选一 */
function tryCloseReqDocEditor(){
  if(!reqDocDirty){ closeReqDocEditor(); return; }
  $("dlgReqDocClose").classList.add("open");
}
function closeReqDocCloseDialog(){
  var d = $("dlgReqDocClose");
  if(d) d.classList.remove("open");
}

/* ==================== 需求页 · AI 拆分 / 完成度检查 ==================== */
/* 三次交互，原则一致：AI 只给草稿和判断，落库永远要人点确认。 */
var aiSplitDrafts = [];
var aiBusy = false;

/** AI 读的是**已保存**的正文：有未保存的修改先存，否则拆出来的和屏幕上看到的不是同一份 */
function ensureReqDocSaved(fn){
  if(!reqDocDirty){ fn(); return; }
  saveReqDoc().then(function(doc){ if(doc) fn(); });
}
function aiBtnBusy(btn, busy, label){
  if(!btn) return;
  btn.disabled = busy;
  if(busy){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = label || "处理中…";
  }else if(btn.dataset.label){
    btn.textContent = btn.dataset.label;
  }
}
/** 配置类错误直接把"去哪改"带上，别让人对着 400 发呆 */
function aiErrMsg(msg){
  var m = msg || "AI 调用失败";
  if(m.indexOf("个人设置") < 0 &&
     (m.indexOf("AI 设置") >= 0 || m.indexOf("API Key") >= 0 || m.indexOf("AI 开关") >= 0
      || m.indexOf("AI 配置") >= 0)){
    m += "（到「个人设置 → AI 设置」里配一下）";
  }
  return m;
}
function aiUsageText(u){
  if(!u) return "";
  return "本次 " + (u.totalTokens || 0) + " tokens（输入 " + (u.promptTokens || 0)
    + " / 输出 " + (u.completionTokens || 0) + "）· 模型 " + (u.model || "—")
    + (u.jsonMode ? "" : " · 该模型不支持 JSON 模式，已降级解析");
}

function runAiSplit(){
  if(!editingDocId || aiBusy) return;
  var btn = $("reqDocAiSplit");
  ensureReqDocSaved(function(){
    aiBusy = true;
    aiBtnBusy(btn, true, "拆分中…");
    API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/split", {}).then(function(d){
      aiSplitDrafts = d.tasks || [];
      renderAiSplit(d);
      $("dlgAiSplit").classList.add("open");
    }).catch(function(ex){
      toast(aiErrMsg(ex && ex.message), "bad");
    }).then(function(){
      aiBusy = false;
      aiBtnBusy(btn, false);
    });
  });
}

function renderAiSplit(d){
  $("dlgAiSplitMsg").textContent = "「" + (d.reqDocTitle || "") + "」正文 " + (d.docChars || 0)
    + " 字，AI 拆出 " + aiSplitDrafts.length + " 条。勾选要创建的，标题可以直接改；没勾的不会落库。";
  $("aiSplitList").innerHTML = aiSplitDrafts.map(function(t, i){
    var p = String(t.priority || "P2").toUpperCase();
    var pcls = p === "P0" ? "p0" : (p === "P1" ? "p1" : "");
    return '<div class="ai-item on" data-i="' + i + '">' +
      '<input type="checkbox" checked data-pick="' + i + '" aria-label="选择任务">' +
      '<div class="ai-main">' +
        '<input class="ai-title" type="text" maxlength="60" value="' + esc(t.title) + '" data-title="' + i + '" aria-label="任务标题">' +
        (t.description ? '<div class="ai-desc">' + esc(t.description) + '</div>' : '') +
        '<div class="ai-meta">' +
          '<span class="ai-tag ' + pcls + '">' + esc(p) + '</span>' +
          (t.dependsOnIndex >= 0 ? '<span>依赖第 ' + (t.dependsOnIndex + 1) + ' 条</span>' : '') +
          (t.reason ? '<span class="ai-reason">' + esc(t.reason) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");
  $("aiSplitUsage").textContent = aiUsageText(d.usage);
}

function applyAiSplit(){
  var picked = [];
  var nodes = document.querySelectorAll("#aiSplitList .ai-item");
  for(var i = 0; i < nodes.length; i++){
    var cb = nodes[i].querySelector("input[type=checkbox]");
    if(!cb || !cb.checked) continue;
    var idx = Number(nodes[i].dataset.i);
    var src = aiSplitDrafts[idx] || {};
    var titleEl = nodes[i].querySelector(".ai-title");
    var title = (titleEl ? titleEl.value : src.title || "").trim();
    if(!title) continue;
    picked.push({
      title: title,
      description: src.description || "",
      priority: src.priority || "P2",
      dependsOnIndex: src.dependsOnIndex == null ? -1 : src.dependsOnIndex
    });
  }
  if(!picked.length){ toast("至少选一条要创建的任务", "warn"); return; }

  var btn = $("dlgAiSplitOk");
  btn.disabled = true;
  API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/tasks", { tasks: picked }).then(function(r){
    btn.disabled = false;
    $("dlgAiSplit").classList.remove("open");
    var msg = "已创建 " + r.created + " 个任务";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 个同名任务";
    if(r.failed && r.failed.length) msg += "，" + r.failed.length + " 个失败";
    toast(msg, r.failed && r.failed.length ? "warn" : "fs");
    if(r.failed && r.failed.length){
      console.warn("AI 拆分落库失败项", r.failed);
    }
    /* 任务数变了：列表页的「任务/完成」计数要跟着动 */
    loadReqDocs(true);
  }).catch(function(ex){
    btn.disabled = false;
    toast(aiErrMsg(ex && ex.message), "bad");
  });
}

function runAiAudit(){
  if(!editingDocId || aiBusy) return;
  var btn = $("reqDocAiAudit");
  ensureReqDocSaved(function(){
    aiBusy = true;
    aiBtnBusy(btn, true, "检查中…");
    API.post("/api/ai/reqdoc/" + encodeURIComponent(editingDocId) + "/audit", {}).then(function(d){
      renderAiAudit(d);
      $("dlgAiAudit").classList.add("open");
    }).catch(function(ex){
      toast(aiErrMsg(ex && ex.message), "bad");
    }).then(function(){
      aiBusy = false;
      aiBtnBusy(btn, false);
    });
  });
}

function renderAiAudit(d){
  var V = { done: "已完成", mostly: "基本完成", partial: "做了一部分", not_started: "基本没开始" };
  /* 配色跟结论文字走同一套档位：done→绿 / mostly·partial→橙 / not_started→红 */
  var cls = d.verdict === "done" ? "good" : (d.verdict === "not_started" ? "bad" : "warn");
  var color = cls === "good" ? "var(--success)" : (cls === "warn" ? "var(--warning)" : "var(--danger)");

  $("dlgAiAuditTitle").textContent = "完成度检查 · " + (d.reqDocTitle || "");
  $("dlgAiAuditSummary").textContent = d.summary || "—";

  $("aiAuditScore").className = "ai-score " + cls;
  $("aiAuditScore").innerHTML =
    '<div class="big">' + d.coverage + '<small>%</small></div>' +
    '<div class="sc-main">' +
      '<div class="bar"><i style="width:' + Math.max(2, d.coverage) + '%;--c:' + color + '"></i></div>' +
      '<div class="sc-lbl">' + (V[d.verdict] || d.verdict) + ' · 共拆出 ' + d.totalPoints + ' 个功能点，按状态加权计算</div>' +
      '<div class="sc-cnt">已完成 ' + d.donePoints + ' · 进行中 ' + d.doingPoints
        + ' · 未开始 ' + d.todoPoints + ' · <b>缺任务 ' + d.missingPoints + '</b></div>' +
    '</div>';

  var S = { done: "已完成", doing: "进行中", todo: "未开始", missing: "缺任务" };
  /* 缺任务的排最前面：那才是用户真正要动手的地方 */
  var order = { missing: 0, todo: 1, doing: 2, done: 3 };
  var pts = (d.points || []).slice().sort(function(a, b){
    return (order[a.status] == null ? 9 : order[a.status]) - (order[b.status] == null ? 9 : order[b.status]);
  });
  $("aiAuditList").innerHTML = pts.map(function(p){
    var st = p.status || "missing";
    return '<div class="ai-item' + (st === "missing" ? " on" : "") + '">' +
      '<div class="ai-main">' +
        '<div class="ai-meta">' +
          '<span class="ai-tag ' + st + '">' + (S[st] || st) + '</span>' +
          (p.taskTitle ? '<span>对应任务：' + esc(p.taskTitle) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);line-height:19px">' + esc(p.point) + '</div>' +
        (p.note ? '<div class="ai-reason">' + esc(p.note) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join("");

  var extra = d.nextStep ? "建议下一步：" + d.nextStep + "　·　" : "";
  $("aiAuditUsage").textContent = extra + aiUsageText(d.usage);
}

if($("reqDocAiSplit")){
  $("reqDocAiSplit").addEventListener("click", runAiSplit);
  $("reqDocAiAudit").addEventListener("click", runAiAudit);
  $("dlgAiSplitCancel").addEventListener("click", function(){ $("dlgAiSplit").classList.remove("open"); });
  $("dlgAiSplitOk").addEventListener("click", applyAiSplit);
  $("dlgAiAuditClose").addEventListener("click", function(){ $("dlgAiAudit").classList.remove("open"); });
  /* 勾选态与卡片底色联动：一眼看出哪几条会被创建 */
  $("aiSplitList").addEventListener("change", function(e){
    var cb = e.target;
    if(!cb || cb.type !== "checkbox") return;
    var item = cb.closest(".ai-item");
    if(item) item.classList.toggle("on", cb.checked);
  });
}


function fillReqDocEditor(doc){
  var id = doc.id;
  if(reqEditor){
    reqEditor.setContents(doc.content || "", false);
    updateReqDocCount();
    rebuildToc();
  }else{
    /* 首次打开：编辑器按需下载，下载完再灌正文（期间用户切走就丢弃结果） */
    ensureEditor().then(function(ed){
      if(!ed || editingDocId !== id) return;
      ed.setContents(doc.content || "", false);
      updateReqDocCount();
      rebuildToc();
    }).catch(function(ex){ toast(ex.message || "编辑器加载失败", "bad"); });
  }
  $("reqDocSaved").textContent = doc.updatedAt ? ("最后保存 " + fmtTs(doc.updatedAt)) : "尚未保存";
  reqDocDirty = false;
  /* 正文换人了：目录要跟着换（重建前先清掉旧的高亮） */
  tocActive = null;
  rebuildToc();
}

function fillReqDocProjectSelect(selected){
  var sel = $("reqDocProject");
  if(!sel) return;
  var cur = selected === undefined ? sel.value : selected;
  sel.innerHTML = '<option value="">选择项目</option>' + reqList.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
  }).join("");
  if(cur) sel.value = cur;
}

function markReqDocDirty(){
  updateReqDocCount();
  if(reqDocDirty) return;
  reqDocDirty = true;
  if($("reqDocSaved")) $("reqDocSaved").textContent = "有未保存的修改";
}

/** 字数：去掉空白后的字符数（中文场景比英文单词数好用） */
function updateReqDocCount(){
  var el = $("reqDocCount");
  if(!el) return;
  var n = (reqEditor ? reqEditor.getText() : "").replace(/\s+/g, "").length;
  el.textContent = n ? (n + " 字") : "";
}

/** 复制全文：优先 Clipboard API，失败退回"全选 + execCommand('copy')" */
function copyReqDoc(){
  var text = (reqEditor ? reqEditor.getText() : "").trim();
  if(!text){ toast("正文是空的，没有可复制的内容", "warn"); return; }
  var ok = function(){ toast("已复制全文（" + text.length + " 字）", "fs"); };
  var fail = function(){
    /* 降级：选中正文后走 execCommand */
    var area = reqEditor && reqEditor.core ? reqEditor.core.getFrameElement && reqEditor.core.getFrameElement() : null;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        toast("复制失败，请手动选中后按 Ctrl+C", "warn");
      }else{
        toast("当前浏览器不支持一键复制，请手动选中后按 Ctrl+C", "warn");
      }
    }catch(e){ toast("复制失败，请手动选中后按 Ctrl+C", "warn"); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(ok).catch(fail);
  }else{
    fail();
  }
}

/* ---------------- 大纲（右侧目录，从正文标题自动生成） ---------------- */

var tocItems = [];        // [{anchor, level, depth, text, parent, hasChild}]
var tocCollapsed = {};    // anchor -> true
var tocActive = null;
var tocBuildTimer = null;

function reqTocRoot(){
  return document.querySelector(".reqdoc-editbody .sun-editor-editable");
}

/** 扫描正文标题，重建目录数据（不渲染）。锚点写在标题的 data-toc 上，供点击跳转 */
function collectToc(){
  var root = reqTocRoot();
  var items = [];
  if(root){
    var hs = root.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for(var i = 0; i < hs.length; i++){
      var el = hs[i];
      var lv = parseInt(el.tagName.charAt(1), 10) || 1;
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if(!text) continue;
      var anchor = "t" + items.length;
      el.setAttribute("data-toc", anchor);
      items.push({ anchor: anchor, level: lv, text: text, depth: 0, parent: null, hasChild: false });
    }
  }
  /* 层级按"标题级别栈"算，不按级别差：H1 后面直接跟 H3 时不该多缩进两层 */
  var stack = [];
  items.forEach(function(t){
    while(stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    t.depth = Math.min(stack.length, 3);
    t.parent = stack.length ? stack[stack.length - 1].anchor : null;
    stack.push(t);
  });
  var byAnchor = {};
  items.forEach(function(t){ byAnchor[t.anchor] = t; });
  items.forEach(function(t){
    if(t.parent && byAnchor[t.parent]) byAnchor[t.parent].hasChild = true;
  });
  tocItems = items;
}

function renderToc(){
  var body = $("reqDocTocBody");
  if(!body) return;
  if(!tocItems.length){
    body.innerHTML = '<div class="rt-empty">正文里用标题样式写几段（一级/二级标题），这里会自动生成大纲。</div>';
    return;
  }
  /* 折叠：父项收起时，它的所有后代一起隐藏 */
  var hidden = {};
  tocItems.forEach(function(t){
    if(t.parent && (tocCollapsed[t.parent] || hidden[t.parent])) hidden[t.anchor] = true;
  });
  var html = "";
  tocItems.forEach(function(t){
    if(hidden[t.anchor]) return;
    var lv = Math.min(t.depth + 1, 4);
    var caret = t.hasChild
      ? '<span class="rt-caret' + (tocCollapsed[t.anchor] ? " collapsed" : "") + '" data-toc-fold="' + t.anchor + '">' + icon("down", 11) + '</span>'
      : '<span class="rt-caret"></span>';
    html += '<button class="rt-item rt-lv' + lv + (t.anchor === tocActive ? " active" : "") + '"' +
      ' type="button" data-toc-go="' + t.anchor + '" title="' + esc(t.text) + '">' +
      caret + '<span class="rt-text">' + esc(t.text) + '</span></button>';
  });
  body.innerHTML = html;
}

function rebuildToc(){
  collectToc();
  renderToc();
  refreshTocActive();
}

/** 输入时防抖重建（SunEditor 每次编辑都会 onChange） */
function scheduleTocRebuild(){
  if(tocBuildTimer) clearTimeout(tocBuildTimer);
  tocBuildTimer = setTimeout(function(){ tocBuildTimer = null; rebuildToc(); }, 400);
}

function markTocActive(anchor){
  if(!anchor || anchor === tocActive) return;
  tocActive = anchor;
  var body = $("reqDocTocBody");
  if(!body) return;
  var prev = body.querySelector(".rt-item.active");
  if(prev) prev.classList.remove("active");
  var next = body.querySelector('[data-toc-go="' + anchor + '"]');
  if(next) next.classList.add("active");
}

/** 页面滚动容器：视图区 `.view` 自己滚动（不是 window），找不到才退回 window */
function reqScrollRoot(){
  var el = $("reqDocEditPage");
  while(el && el !== document.body && el !== document.documentElement){
    var cs = window.getComputedStyle(el);
    if(/(auto|scroll)/.test(cs.overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

function scrollToToc(anchor){
  var root = reqTocRoot();
  if(!root) return;
  var el = root.querySelector('[data-toc="' + anchor + '"]');
  if(!el) return;
  var bar = $("reqDocEditPage") ? $("reqDocEditPage").querySelector(".reqdoc-editbar") : null;
  var offset = (bar ? bar.getBoundingClientRect().height : 0) + 40;
  var sc = reqScrollRoot();
  if(sc){
    var top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset;
    if(top < 0) top = 0;
    try{ sc.scrollTo({ top: top, behavior: "smooth" }); }
    catch(e){ sc.scrollTop = top; }
  }else{
    var top2 = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0) - offset;
    if(top2 < 0) top2 = 0;
    try{ window.scrollTo({ top: top2, behavior: "smooth" }); }
    catch(e){ window.scrollTo(0, top2); }
  }
  markTocActive(anchor);
}

/** 滚动同步：视口上方最后一个标题 = 当前章节 */
function refreshTocActive(){
  if(!tocItems.length) return;
  var page = $("reqDocEditPage");
  if(!page || page.hidden) return;
  var root = reqTocRoot();
  if(!root) return;
  var line = 96;   // 判定线：标题越过它就算"已经读到这一节"
  var cur = tocItems[0].anchor;
  for(var i = 0; i < tocItems.length; i++){
    var el = root.querySelector('[data-toc="' + tocItems[i].anchor + '"]');
    if(!el) continue;
    if(el.getBoundingClientRect().top <= line) cur = tocItems[i].anchor;
    else break;
  }
  markTocActive(cur);
}

function setTocVisible(on){
  var page = $("reqDocEditPage");
  if(!page) return;
  if(on) page.classList.remove("no-toc"); else page.classList.add("no-toc");
  try{ localStorage.setItem("ds.reqToc", on ? "1" : "0"); }catch(e){ /* 隐私模式忽略 */ }
}
function tocVisiblePref(){
  try{ return localStorage.getItem("ds.reqToc") !== "0"; }catch(e){ return true; }
}

/** 保存（返回 Promise，供"保存并关闭"链式调用） */
function saveReqDoc(){
  var title = (editingMeta.title || "").trim();
  var reqId = editingMeta.reqId;
  if(!title || !reqId){
    toast("这份需求缺少标题或项目，请回到列表重新创建", "warn");
    return Promise.resolve(null);
  }
  if(!reqEditor){
    toast("正文编辑器还在加载，请稍候再保存", "warn");
    return Promise.resolve(null);
  }
  var body = {
    reqId: reqId,
    title: title,
    content: reqEditor ? reqEditor.getContents(true) : "",
    status: editingMeta.status || "draft"
  };
  var id = editingDocId;
  var p = id ? API.put("/api/req-docs/" + encodeURIComponent(id), body)
             : API.post("/api/req-docs", body);
  return p.then(function(doc){
    editingDocId = doc.id;
    state.reqDocId = doc.id;
    editingMeta = { title: doc.title || "", reqId: doc.reqId || "", status: doc.status || "draft" };
    reqDocDirty = false;
    fillReqDocEditor(doc);
    if($("reqDocCrumb")) $("reqDocCrumb").textContent = reqDocProjectName(doc.reqId) + " / " + (doc.title || "未命名需求");
    toast("需求已保存", "fs");
    loadReqDocs(true);
    return doc;
  }).catch(function(ex){
    toast(ex.message || "保存失败", "bad");
    return null;
  });
}

function deleteReqDoc(){
  var id = editingDocId || state.reqDocId;
  if(!id){ toast("先打开一份已保存的需求", "warn"); return; }
  UI.showConfirm({
    title: "删除需求",
    msg: "关联到它的任务会自动解除关联（任务本身不会被删除）。确定删除？",
    okText: "删除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/req-docs/" + encodeURIComponent(id)).then(function(){
      toast("需求已删除");
      closeReqDocEditor();
      loadReqDocs(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/** 从看板卡片 / 任务清单点需求名：切到需求视图并直接打开编辑页 */
function openReqDocAndJump(id){
  showView("requirements");
  state.reqDocId = id;
  openReqDocEditor(id);
}

/* ---------------- 抽屉里的「关联需求」下拉 ---------------- */
function populateReqDocSelect(keep){
  var sel = $("iReqDoc");
  if(!sel) return;
  var reqId = $("iReq") ? $("iReq").value : "";
  var cur = (keep === undefined ? sel.value : keep) || "";
  var opts = reqId ? reqDocList.filter(function(d){ return d.reqId === reqId; }) : [];
  sel.innerHTML = '<option value="">不关联</option>' + opts.map(function(d){
    return '<option value="' + esc(d.id) + '">' + esc(d.title) + '</option>';
  }).join("");
  var ok = false;
  for(var i = 0; i < opts.length; i++) if(opts[i].id === cur) ok = true;
  sel.value = ok ? cur : "";
  sel.disabled = !reqId;
  var hint = $("iReqDocHint");
  if(hint){
    hint.textContent = !reqId ? "先选项目，再从该项目的需求里挑"
      : (opts.length ? "从该项目的需求里挑" : "该项目还没有需求");
  }
}

/* ---------------- 事件绑定 ---------------- */
(function wireRequirementView(){
  var tree = $("reqDocTree");
  if(tree){
    tree.addEventListener("click", function(e){
      var t = e.target.closest("[data-toggle-proj]");
      if(t){ toggleReqProj(t.dataset.toggleProj); return; }
      var row = e.target.closest("[data-reqdoc]");
      if(row){ openReqDocEditor(row.dataset.reqdoc); }
    });
  }
  if($("reqDocNew")) $("reqDocNew").addEventListener("click", openNewReqDocDialog);
  if($("dlgNewReqDocCancel")) $("dlgNewReqDocCancel").addEventListener("click", closeNewReqDocDialog);
  if($("dlgNewReqDocOk")) $("dlgNewReqDocOk").addEventListener("click", submitNewReqDoc);
  if($("newReqDocTitle")){
    $("newReqDocTitle").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitNewReqDoc(); }
    });
  }
  if($("reqDocBack")) $("reqDocBack").addEventListener("click", tryCloseReqDocEditor);
  if($("dlgReqDocCloseCancel")) $("dlgReqDocCloseCancel").addEventListener("click", closeReqDocCloseDialog);
  if($("dlgReqDocCloseDiscard")){
    $("dlgReqDocCloseDiscard").addEventListener("click", function(){
      closeReqDocCloseDialog();
      reqDocDirty = false;
      closeReqDocEditor();
    });
  }
  if($("dlgReqDocCloseSave")){
    $("dlgReqDocCloseSave").addEventListener("click", function(){
      saveReqDoc().then(function(doc){
        closeReqDocCloseDialog();
        if(doc) closeReqDocEditor();
      });
    });
  }
  if($("reqDocCopy")) $("reqDocCopy").addEventListener("click", copyReqDoc);
  if($("reqDocSave")) $("reqDocSave").addEventListener("click", saveReqDoc);
  if($("reqDocDelete")) $("reqDocDelete").addEventListener("click", deleteReqDoc);

  /* 大纲：工具条上的「大纲」按钮开关；面板标题栏的折叠按钮收起 */
  if($("reqDocTocToggle")){
    $("reqDocTocToggle").addEventListener("click", function(){
      var page = $("reqDocEditPage");
      setTocVisible(page ? page.classList.contains("no-toc") : true);
    });
  }
  /* 折叠按钮：收起大纲；再打开点工具条上的「大纲」按钮 */
  if($("reqDocTocFold")) $("reqDocTocFold").addEventListener("click", function(){ setTocVisible(false); });
  if($("reqDocTocBody")){
    $("reqDocTocBody").addEventListener("click", function(e){
      var f = e.target.closest("[data-toc-fold]");
      if(f){
        e.preventDefault(); e.stopPropagation();
        tocCollapsed[f.dataset.tocFold] = !tocCollapsed[f.dataset.tocFold];
        renderToc();
        return;
      }
      var g = e.target.closest("[data-toc-go]");
      if(g){ e.preventDefault(); scrollToToc(g.dataset.tocGo); }
    });
  }
  window.addEventListener("scroll", function(){ refreshTocActive(); }, { passive: true });
  window.addEventListener("resize", function(){ refreshTocActive(); });
  if($("reqDocSearch")) $("reqDocSearch").addEventListener("input", renderReqDocTree);
  if($("iReq")) $("iReq").addEventListener("change", function(){ populateReqDocSelect(""); });

  /* Esc：先关弹窗，再问是否保存并关闭编辑页 */
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgReqDocClose") && $("dlgReqDocClose").classList.contains("open")){ closeReqDocCloseDialog(); return; }
    if($("dlgNewReqDoc") && $("dlgNewReqDoc").classList.contains("open")){ closeNewReqDocDialog(); return; }
    if(activeView === "requirements" && $("reqDocEditPage") && !$("reqDocEditPage").hidden){ tryCloseReqDocEditor(); }
  });

  /* 编辑器改成打开需求时按需加载，这里不再预初始化（首屏省下 2.5 MB） */

  /* Ctrl/Cmd+S 保存（SunEditor 内部会接管键盘，这里在文档级兜住） */
  document.addEventListener("keydown", function(e){
    if((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")){
      if(activeView !== "requirements") return;
      if(!$("reqDocEditPage") || $("reqDocEditPage").hidden) return;
      e.preventDefault();
      saveReqDoc();
    }
  });
})();

/* ==================== 分支管理（空间级分支池） ====================
   状态：开发中 → 待测试 → 待合并 → 已发布。允许来回切 —— 打回重做是常态，
   强行单向只会逼人删分支重建，反而丢时间。
   时间口径有两套（后端也这么分）：
     · 分支上的 4 个时间点只记「首次进入」，用来算停留和发布周期；
     · 操作记录记每一次变更，用来还原「谁在什么时候把它退回了开发中」。 */
var BRANCH_STATUS = [
  { id:"dev",      name:"开发中", cls:"br-st-dev",      timeKey:"devAt",      hint:"代码还在写" },
  { id:"testing",  name:"待测试", cls:"br-st-testing",  timeKey:"testAt",     hint:"开发完成，等测试验证" },
  { id:"merging",  name:"待合并", cls:"br-st-merging",  timeKey:"mergeAt",    hint:"测过了，等合并窗口" },
  { id:"released", name:"已发布", cls:"br-st-released", timeKey:"releasedAt", hint:"已上线" }
];
var branchList = [], branchesLoaded = false;
var branchFilter = "";     // 当前只看某一档状态（空 = 全部）
var brDrawerId = null;     // 抽屉里正在看的分支
var brEditingId = null;    // 弹窗里正在编辑的分支（null = 新建）

function branchStatusMeta(id){
  for(var i = 0; i < BRANCH_STATUS.length; i++) if(BRANCH_STATUS[i].id === id) return BRANCH_STATUS[i];
  return { id: id, name: id || "未知", cls: "", timeKey: "", hint: "" };
}
function branchById(id){
  for(var i = 0; i < branchList.length; i++) if(branchList[i].id === id) return branchList[i];
  return null;
}
function branchNameById(id){
  var b = branchById(id);
  return b ? b.name : "";
}
/** 毫秒 → 「3 天 / 5 小时 / 刚刚」 */
function branchDurText(ms){
  if(!ms || ms < 0) return "刚刚";
  var h = Math.floor(ms / 3600000);
  if(h < 1) return "刚刚";
  if(h < 24) return h + " 小时";
  var d = Math.floor(h / 24);
  if(d < 60) return d + " 天";
  return Math.floor(d / 30) + " 个月";
}
/** 卡片右下角那行：当前状态待了多久；已发布的分支显示从创建到发布的总周期 */
function branchStay(b){
  if(b.status === "released"){
    if(!b.releasedAt || !b.createdAt) return { text:"周期 —", tip:"缺少发布或创建时间" };
    var span = new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime();
    return { text:"周期 " + branchDurText(span),
             tip:"创建 " + fmtTs(b.createdAt) + " → 发布 " + fmtTs(b.releasedAt) };
  }
  var meta = branchStatusMeta(b.status);
  var from = b[meta.timeKey] || b.createdAt;
  if(!from) return { text:"—", tip:"没有进入该状态的时间" };
  var ms = Date.now() - new Date(from).getTime();
  var q = branchDurText(ms);
  return { text: (q === "刚刚" ? "刚刚进入" : "已 " + q), tip: meta.name + "自 " + fmtTs(from) };
}

/** force=true 强制重拉（增删改后）；否则每个会话只拉一次 */
function loadBranches(force){
  if(branchesLoaded && !force) return Promise.resolve(branchList);
  return API.get("/api/branches").then(function(rows){
    branchList = rows || [];
    branchesLoaded = true;
    if(activeView === "branches") renderBranches();
    populateBranchSelect();
    updateBranchDot();
    /* 看板卡片上带着分支标签，数据回来后要重画一次（render 会重建 DOM，所以只在看板停留时做） */
    if(state.board && activeView === "board") render({animate:false});
  }).catch(function(){ /* 分支模块不可用时静默降级，不影响主流程 */ });
}
/** 侧栏角标：还在进行中的分支数（开发中 + 待测试 + 待合并），全发布完就不显示 */
function updateBranchDot(){
  if(!branchDot) return;
  var n = 0;
  branchList.forEach(function(b){ if(b.status !== "released") n++; });
  branchDot.hidden = n === 0;
  branchDot.textContent = n > 99 ? "99+" : String(n);
  branchDot.title = n ? (n + " 条分支还没发布") : "";
}

function enterBranchesView(){
  renderBranches();                       // 先用缓存出一版，避免空白
  loadBranches().then(function(){ renderBranches(); });
}

function branchStat(){
  var s = { total: 0 };
  BRANCH_STATUS.forEach(function(x){ s[x.id] = 0; });
  branchList.forEach(function(b){
    s.total++;
    if(s[b.status] === undefined) s[b.status] = 0;
    s[b.status]++;
  });
  return s;
}
/** 已发布分支的平均发布周期（天）；没有已发布的分支就返回 null */
function branchCycleAvg(){
  var sum = 0, n = 0;
  branchList.forEach(function(b){
    if(b.status !== "released" || !b.releasedAt || !b.createdAt) return;
    var ms = new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime();
    if(ms >= 0){ sum += ms; n++; }
  });
  if(!n) return null;
  return (sum / n / 86400000).toFixed(sum / n / 86400000 >= 10 ? 0 : 1);
}

function renderBranches(){
  var box = $("branchGroups");
  if(!box) return;
  var st = branchStat();
  var meta = $("branchMeta");
  if(meta){
    meta.textContent = st.total
      ? ("共 " + st.total + " 条 · 开发中 " + st.dev + " · 待测试 " + st.testing +
         " · 待合并 " + st.merging + " · 已发布 " + st.released)
      : "";
  }
  renderBranchFlow(st);

  if(!st.total){
    box.innerHTML = '<div class="br-emptyall">' +
      '还没有分支。点右上角「新建分支」把正在开发的分支记下来 —— 之后每次改状态都会自动留下时间，' +
      '谁在什么时候把它推到哪一步一目了然。</div>';
    return;
  }

  var kw = (($("branchSearch") || {}).value || "").trim().toLowerCase();
  var rows = branchList.filter(function(b){
    if(branchFilter && b.status !== branchFilter) return false;
    if(!kw) return true;
    return String(b.name || "").toLowerCase().indexOf(kw) !== -1
        || String(b.targetBranch || "").toLowerCase().indexOf(kw) !== -1
        || String(b.owner || "").toLowerCase().indexOf(kw) !== -1;
  });
  if(!rows.length){
    box.innerHTML = '<div class="br-emptyall">没有匹配的分支' +
      (branchFilter ? '（当前只看「' + esc(branchStatusMeta(branchFilter).name) + '」）' : '') + '。</div>';
    return;
  }

  box.innerHTML = BRANCH_STATUS.map(function(s){
    var items = rows.filter(function(b){ return b.status === s.id; });
    return '<div class="br-group" data-status="' + s.id + '">' +
      '<div class="br-group-head">' +
        '<i class="br-dot ' + s.cls + '"></i>' +
        '<span class="br-group-name">' + s.name + '</span>' +
        '<span class="br-group-n">' + items.length + '</span>' +
        '<span class="br-group-hint">' + s.hint + '</span>' +
      '</div>' +
      '<div class="br-group-body">' +
        (items.length ? items.map(branchCardHTML).join("") : '<div class="br-empty">暂无</div>') +
      '</div>' +
    '</div>';
  }).join("");
}

function renderBranchFlow(st){
  var box = $("branchFlow");
  if(!box) return;
  var cycle = branchCycleAvg();
  box.innerHTML = BRANCH_STATUS.map(function(s){
    var on = branchFilter === s.id;
    return '<button class="br-flow-cell' + (on ? " on" : "") + '" type="button" data-br-filter="' + s.id + '"' +
        ' aria-pressed="' + on + '">' +
        '<i class="br-dot ' + s.cls + '"></i>' +
        '<span class="bf-n">' + (st[s.id] || 0) + '</span>' +
        '<span class="bf-l">' + s.name + '</span>' +
      '</button>';
  }).join("") +
    '<div class="br-flow-cell static" title="已发布分支从创建到发布的平均天数">' +
      '<span class="bf-n">' + (cycle === null ? "—" : cycle) + '</span>' +
      '<span class="bf-l">平均发布周期' + (cycle === null ? "" : "（天）") + '</span>' +
    '</div>';
}

function branchCardHTML(b){
  var sm = branchStatusMeta(b.status);
  var stay = branchStay(b);
  var taskTxt = b.taskCount
    ? ((b.doneCount || 0) + "/" + b.taskCount + " 任务")
    : "无关联任务";
  return '<article class="br-card" data-branch="' + esc(b.id) + '" tabindex="0" role="button"' +
      ' aria-label="' + esc(b.name) + '，' + esc(sm.name) + '">' +
    '<div class="br-card-top">' +
      '<button class="br-badge ' + sm.cls + '" type="button" data-br-status-menu="' + esc(b.id) + '"' +
        ' title="点击切换状态">' + sm.name + icon("down", 11) + '</button>' +
      (b.owner ? '<span class="br-owner" title="负责人：' + esc(b.owner) + '">' + avatarHTML(b.owner) + '</span>' : '') +
    '</div>' +
    '<div class="br-name" title="' + esc(b.name) + '">' + esc(b.name) + '</div>' +
    (b.targetBranch ? '<div class="br-target" title="目标分支：' + esc(b.targetBranch) + '">→ ' + esc(b.targetBranch) + '</div>' : '') +
    (b.note ? '<div class="br-note" title="' + esc(b.note) + '">' + esc(b.note) + '</div>' : '') +
    '<div class="br-card-foot">' +
      '<span class="br-tasks">' + icon("checklist", 12) + taskTxt + '</span>' +
      '<span class="br-age" title="' + esc(stay.tip) + '">' + esc(stay.text) + '</span>' +
    '</div>' +
  '</article>';
}

/** 状态浮层：四档状态 + 编辑 / 删除入口 */
function openBranchStatusMenu(anchor, id){
  var b = branchById(id);
  if(!b) return;
  var el = document.createElement("div");
  el.className = "menu br-status-menu";
  el.innerHTML = BRANCH_STATUS.map(function(s){
    var cur = s.id === b.status;
    return '<button class="menu-item' + (cur ? " on" : "") + '" type="button" data-br-set="' + s.id + '">' +
        '<i class="br-dot ' + s.cls + '"></i>' + s.name +
        (cur ? '<span class="k">当前</span>' : '') +
      '</button>';
  }).join("") +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-br-edit="1">编辑分支信息</button>' +
    (currentWs && currentWs.myRole === "owner"
      ? '<button class="menu-item danger" type="button" data-br-del="1">删除分支</button>' : '');
  el.addEventListener("click", function(e){
    var set = e.target.closest("[data-br-set]");
    if(set){
      UI.closeAllPops();
      setBranchStatus(id, set.dataset.brSet);
      return;
    }
    if(e.target.closest("[data-br-edit]")){ UI.closeAllPops(); openBranchDialog(id); return; }
    if(e.target.closest("[data-br-del]")){ UI.closeAllPops(); deleteBranch(id); }
  });
  UI.openPop(el, anchor, { align: "left" });
}

/** 改状态：成功后刷新列表；抽屉开着就一起刷新 */
function setBranchStatus(id, status){
  var b = branchById(id);
  if(!b || b.status === status) return;
  API.post("/api/branches/" + encodeURIComponent(id) + "/status", { status: status })
    .then(function(nb){
      toast("「" + nb.name + "」→ " + branchStatusMeta(nb.status).name, "fs");
      return loadBranches(true);
    })
    .then(function(){
      if(brDrawerId === id) openBranchDrawer(id);
    })
    .catch(function(ex){ toast(ex.message || "状态切换失败", "bad"); });
}

/* ---------------- 新建 / 编辑弹窗 ---------------- */

function fillBranchStatusOptions(sel, cur){
  if(!sel) return;
  sel.innerHTML = BRANCH_STATUS.map(function(s){
    return '<option value="' + s.id + '"' + (s.id === cur ? " selected" : "") + '>' + s.name + '</option>';
  }).join("");
}

function openBranchDialog(id){
  brEditingId = id || null;
  var b = brEditingId ? branchById(brEditingId) : null;
  $("dlgBranchTitle").textContent = b ? "编辑分支" : "新建分支";
  $("dlgBranchMsg").textContent = b
    ? "状态不在这里改 —— 点分支卡片上的状态标签切换，那样才会记进时间线。"
    : "分支名照 git 里的写法填，建好之后就能跟状态和时间。";
  $("dlgBranchOk").textContent = b ? "保存" : "创建分支";
  /* 编辑时隐藏「初始状态」（状态只能走状态切换接口） */
  if($("brStatusField")) $("brStatusField").hidden = !!b;
  $("brName").value = b ? (b.name || "") : "";
  $("brTarget").value = b ? (b.targetBranch || "") : "";
  $("brNote").value = b ? (b.note || "") : "";
  fillBranchStatusOptions($("brStatus"), b ? b.status : "dev");

  /* 负责人：沿用任务抽屉的口径（成员列表 + 账号绑定） */
  var sel = $("brOwner");
  if(sel){
    var opts = ownerOptions();
    var curName = b ? (b.owner || "") : (currentUser ? (currentUser.displayName || "") : "");
    var curId = b ? (b.ownerUserId || "") : (currentUser ? currentUser.id : "");
    var html = "", matched = false;
    opts.forEach(function(o){
      var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
      if(on) matched = true;
      html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (on ? " selected" : "") + '>' +
        esc(o.name) + '</option>';
    });
    if(curName && !matched){
      html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
    }
    sel.innerHTML = html;
  }

  $("dlgBranch").classList.add("open");
  setTimeout(function(){ try{ $("brName").focus(); }catch(e){ /* noop */ } }, 40);
}
function closeBranchDialog(){
  var d = $("dlgBranch");
  if(d) d.classList.remove("open");
  brEditingId = null;
}
function submitBranchDialog(){
  var name = ($("brName").value || "").trim();
  if(!name){ toast("请填写分支名", "warn"); try{ $("brName").focus(); }catch(e){} return; }
  if(!/^[\p{L}\p{N}._/-]{1,80}$/u.test(name)){
    toast("分支名只允许字母、数字、点、下划线、中划线、斜杠", "warn");
    try{ $("brName").focus(); }catch(e){}
    return;
  }
  var sel = $("brOwner");
  var picked = sel && sel.options[sel.selectedIndex];
  var payload = {
    name: name,
    targetBranch: ($("brTarget").value || "").trim() || null,
    note: ($("brNote").value || "").trim() || null,
    owner: picked ? (picked.dataset.name || picked.textContent || null) : null,
    ownerUserId: picked && picked.value !== "__text__" ? picked.value : null
  };
  if(!brEditingId) payload.status = ($("brStatus") || {}).value || "dev";

  var req = brEditingId
    ? API.put("/api/branches/" + encodeURIComponent(brEditingId), payload)
    : API.post("/api/branches", payload);
  var wasEdit = !!brEditingId;
  var btn = $("dlgBranchOk");
  btn.disabled = true;
  req.then(function(b){
    btn.disabled = false;
    closeBranchDialog();
    toast(wasEdit ? ("已更新「" + b.name + "」") : ("已创建分支「" + b.name + "」"), "fs");
    loadBranches(true).then(function(){
      if(brDrawerId === b.id) openBranchDrawer(b.id);
    });
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}

function deleteBranch(id){
  var b = branchById(id);
  if(!b) return;
  if(!(currentWs && currentWs.myRole === "owner")){ toast("仅空间主可删除分支", "warn"); return; }
  var n = b.taskCount || 0;
  UI.showConfirm({
    title: "删除分支",
    msg: "「" + esc(b.name) + "」将被删除，操作记录一起清掉" +
      (n ? ("；挂在它上面的 " + n + " 个任务会解除关联（任务本身保留）") : "") + "。确定删除？",
    okText: "删除分支"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/branches/" + encodeURIComponent(id)).then(function(){
      if(brDrawerId === id) closeBranchDrawer();
      toast("已删除「" + b.name + "」", "fs");
      loadBranches(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* ---------------- 分支详情抽屉 ---------------- */

function openBranchDrawer(id){
  API.get("/api/branches/" + encodeURIComponent(id)).then(function(b){
    brDrawerId = b.id;
    renderBranchDrawer(b);
    $("branchDrawer").classList.add("on");
    loadBranchLogs(b.id);
    loadBranchTasks(b.id);
  }).catch(function(ex){ toast(ex.message || "分支加载失败", "bad"); });
}
function closeBranchDrawer(){
  var d = $("branchDrawer");
  if(d) d.classList.remove("on");
  brDrawerId = null;
}

function renderBranchDrawer(b){
  var body = $("brDrawerBody");
  if(!body) return;
  $("brDrawerTitle").textContent = b.name;
  var stay = branchStay(b);
  var segs = BRANCH_STATUS.map(function(s){
    return '<button type="button" class="' + (s.id === b.status ? "on" : "") + '"' +
      ' data-br-drawer-status="' + s.id + '" aria-pressed="' + (s.id === b.status) + '">' + s.name + '</button>';
  }).join("");
  var times = BRANCH_STATUS.map(function(s){
    var at = b[s.timeKey];
    return '<div class="br-tnode' + (at ? " on" : "") + '">' +
      '<i class="br-dot ' + s.cls + '"></i>' +
      '<span class="bt-name">' + s.name + '</span>' +
      '<span class="bt-time">' + (at ? esc(fmtTs(at)) : "未进入") + '</span>' +
    '</div>';
  }).join("");

  body.innerHTML =
    '<div class="br-drawer-seg seg grid4">' + segs + '</div>' +
    '<div class="br-drawer-stay">' + esc(stay.text) + ' · ' + esc(stay.tip) + '</div>' +
    '<div class="br-kv">' +
      '<div><span>目标分支</span><b>' + (b.targetBranch ? esc(b.targetBranch) : "—") + '</b></div>' +
      '<div><span>负责人</span><b>' + (b.owner ? esc(b.owner) : "—") + '</b></div>' +
      '<div><span>创建时间</span><b>' + esc(fmtTs(b.createdAt)) + '</b></div>' +
      '<div><span>关联任务</span><b>' + (b.taskCount ? ((b.doneCount || 0) + " / " + b.taskCount + " 已完成") : "—") + '</b></div>' +
    '</div>' +
    (b.note ? '<p class="br-drawer-note">' + esc(b.note) + '</p>' : '') +
    '<div class="br-sect"><h4>状态时间</h4><div class="br-times">' + times + '</div></div>' +
    '<div class="br-sect"><h4>关联任务</h4><div id="brTaskList" class="br-tasklist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-sect"><h4>操作记录</h4><div id="brLogList" class="br-loglist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-drawer-foot">' +
      (currentWs && currentWs.myRole === "owner"
        ? '<button class="btn ghost danger-text" type="button" id="brDrawerDelete">删除分支</button>' : '') +
      '<span style="flex:1 1 auto"></span>' +
      '<button class="btn" type="button" id="brDrawerEdit">编辑信息</button>' +
    '</div>';

  var del = $("brDrawerDelete");
  if(del) del.addEventListener("click", function(){ deleteBranch(b.id); });
  var ed = $("brDrawerEdit");
  if(ed) ed.addEventListener("click", function(){ openBranchDialog(b.id); });
}

function loadBranchLogs(id){
  API.get("/api/branches/" + encodeURIComponent(id) + "/logs").then(function(logs){
    var box = $("brLogList");
    if(!box || brDrawerId !== id) return;
    if(!logs || !logs.length){
      box.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
      return;
    }
    box.innerHTML = logs.map(function(l){
      var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
      return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
        '<span class="tl-detail">' + actor + esc(l.detail || l.action || "") + '</span></div>';
    }).join("");
  }).catch(function(){
    var box = $("brLogList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">操作记录加载失败</div>';
  });
}

function loadBranchTasks(id){
  API.get("/api/branches/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    var box = $("brTaskList");
    if(!box || brDrawerId !== id) return;
    if(!tasks || !tasks.length){
      box.innerHTML = '<div class="tl-empty">还没有任务关联到这条分支。在任务详情的「所属分支」里挂上来。</div>';
      return;
    }
    box.innerHTML = tasks.map(function(t){
      var done = t.boardColumn === "done";
      return '<button class="br-task" type="button" data-br-task="' + esc(t.id) + '">' +
        '<span class="bt-dot' + (done ? " done" : "") + '"></span>' +
        '<span class="bt-title' + (done ? " done" : "") + '">' + esc(t.title) + '</span>' +
        '<span class="bt-pri ' + esc(t.priority || "") + '">' + esc(t.priority || "") + '</span>' +
      '</button>';
    }).join("");
  }).catch(function(){
    var box = $("brTaskList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">关联任务加载失败</div>';
  });
}

/* ---------------- 任务抽屉里的「所属分支」下拉 ---------------- */

function populateBranchSelect(keep){
  var sel = $("iBranch");
  if(!sel) return;
  var cur = (keep === undefined ? sel.value : keep) || "";
  var html = '<option value="">不关联分支</option>';
  BRANCH_STATUS.forEach(function(s){
    var items = branchList.filter(function(b){ return b.status === s.id; });
    if(!items.length) return;
    html += '<optgroup label="' + esc(s.name) + '">';
    items.forEach(function(b){
      html += '<option value="' + esc(b.id) + '">' + esc(b.name) +
        (b.targetBranch ? " → " + esc(b.targetBranch) : "") + '</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  var ok = false;
  for(var i = 0; i < branchList.length; i++) if(branchList[i].id === cur) ok = true;
  sel.value = ok ? cur : "";
  var hint = $("iBranchHint");
  if(hint){
    hint.textContent = branchList.length
      ? "分支在「分支」页里建，这里只负责挂上去"
      : "还没有分支 —— 先去「分支」页建一条，再回来挂";
  }
}

/* ---------------- 事件绑定 ---------------- */

(function wireBranchView(){
  var box = $("branchGroups");
  if(box){
    box.addEventListener("click", function(e){
      var menu = e.target.closest("[data-br-status-menu]");
      if(menu){ e.stopPropagation(); openBranchStatusMenu(menu, menu.dataset.brStatusMenu); return; }
      var card = e.target.closest("[data-branch]");
      if(card) openBranchDrawer(card.dataset.branch);
    });
    box.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest("[data-branch]");
      if(card){ e.preventDefault(); openBranchDrawer(card.dataset.branch); }
    });
  }
  if($("branchFlow")){
    $("branchFlow").addEventListener("click", function(e){
      var c = e.target.closest("[data-br-filter]");
      if(!c) return;
      branchFilter = (branchFilter === c.dataset.brFilter) ? "" : c.dataset.brFilter;
      renderBranches();
    });
  }
  if($("branchNew")) $("branchNew").addEventListener("click", function(){ openBranchDialog(null); });
  if($("branchSearch")) $("branchSearch").addEventListener("input", renderBranches);
  if($("dlgBranchCancel")) $("dlgBranchCancel").addEventListener("click", closeBranchDialog);
  if($("dlgBranchOk")) $("dlgBranchOk").addEventListener("click", submitBranchDialog);
  if($("brName")){
    $("brName").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitBranchDialog(); }
    });
  }

  if($("branchDrawer")){
    /* 抽屉内的状态切换与任务跳转：动态内容，统一委托 */
    $("branchDrawer").addEventListener("click", function(e){
      var st = e.target.closest("[data-br-drawer-status]");
      if(st){
        var b = branchById(brDrawerId);
        if(b && branchStatusMeta(b.status).id !== st.dataset.brDrawerStatus){
          setBranchStatus(brDrawerId, st.dataset.brDrawerStatus);
        }
        return;
      }
      var task = e.target.closest("[data-br-task]");
      if(task){
        /* 任务抽屉是另一层浮层，先收起分支抽屉再打开，避免两层遮罩叠在一起 */
        var tid = task.dataset.brTask;
        closeBranchDrawer();
        openTaskById(tid);
      }
    });
    $("branchScrim").addEventListener("click", closeBranchDrawer);
  }
  if($("brDrawerClose")) $("brDrawerClose").addEventListener("click", closeBranchDrawer);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgBranch") && $("dlgBranch").classList.contains("open")){ closeBranchDialog(); return; }
    if($("branchDrawer") && $("branchDrawer").classList.contains("on")){ closeBranchDrawer(); }
  });
})();

/* ==================== 任务清单（完成快照 · 月度统计） ==================== */
var compSeq = 0, compRowsCache = [];
function enterCompletionsView(){ loadCompletions(); }

function currentCompMonth(){
  if(!state.compMonth){
    var d = new Date();
    state.compMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  return state.compMonth;
}
function shiftCompMonth(delta){
  var p = currentCompMonth().split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
  state.compMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  loadCompletions();
}
function loadCompletions(opts){
  opts = opts || {};
  var month = currentCompMonth();
  var seq = ++compSeq;
  $("compMonth").textContent = month.replace("-", " 年 ") + " 月";
  if(!opts.silent){
    $("compCount").textContent = "";
    $("compWrap").innerHTML = UI.skeletonRows(4);
    $("compStats").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
      '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
  }
  API.get("/api/completions", {month: month}).then(function(rows){
    if(seq !== compSeq) return;
    compRowsCache = rows || [];
    renderCompletions(compRowsCache, month);
  }).catch(function(ex){
    if(seq !== compSeq) return;
    compRowsCache = [];
    $("compWrap").innerHTML = UI.errorState(ex.message || "加载失败");
  });
}
function renderCompletions(rows, month){
  var n = rows.length;
  var totalMin = rows.reduce(function(a, r){ return a + (Number(r.totalMinutes) || 0); }, 0);
  var ownerCount = {};
  rows.forEach(function(r){
    var o = r.owner || "未指派";
    ownerCount[o] = (ownerCount[o] || 0) + 1;
  });
  var ownerKeys = Object.keys(ownerCount);
  var topOwner = ownerKeys.slice().sort(function(a, b){ return ownerCount[b] - ownerCount[a]; })[0];

  $("compCount").textContent = n ? ("共 " + n + " 条") : "";
  $("compStats").innerHTML = [
    { k: "完成任务", v: n + " 项" },
    { k: "总耗时", v: fmtMinutesShort(totalMin) || "—" },
    { k: "平均每项", v: n ? (fmtMinutesShort(Math.round(totalMin / n)) || "—") : "—" },
    { k: "参与成员", v: ownerKeys.length ? (ownerKeys.length + " 人") : "—",
      s: topOwner ? ("最多：" + topOwner + " " + ownerCount[topOwner] + " 项") : "" }
  ].map(function(x){
    return '<div class="stat"><div class="k">' + esc(x.k) + '</div><div class="v">' + esc(x.v) + '</div>' +
      (x.s ? '<div class="comp-stat-s">' + esc(x.s) + '</div>' : '') + '</div>';
  }).join("");

  if(!n){
    $("compWrap").innerHTML = '<div class="col-empty">' + esc(month) +
      ' 还没有完成记录。把任务拖进「已完成」列就会自动归档到这里。</div>';
    return;
  }
  /* 列只留统计用得上的：「开始时间 / 结束时间」成对（结束时间 = 任务完成日期），
     计时的首次/最后时间属于内部数据，不展示 */
  var head = "<tr><th>任务</th><th>项目</th><th>需求</th><th>负责人</th><th>分类</th>" +
    "<th>优先级</th><th>开始时间</th><th>结束时间</th><th>总耗时</th></tr>";
  var body = rows.map(function(r){
    return "<tr>" +
      '<td><span class="comp-t">' + esc(r.title) + "</span>" +
        (r.description ? '<span class="comp-d">' + esc(r.description) + "</span>" : "") + "</td>" +
      "<td>" + (r.reqName ? esc(r.reqName) : '<span class="comp-dim">—</span>') + "</td>" +
      "<td>" + compDocCell(r) + "</td>" +
      "<td>" + esc(r.owner || "—") + "</td>" +
      "<td>" + (r.category ? catTag(r.category) : '<span class="comp-dim">—</span>') + "</td>" +
      '<td><span class="pdot ' + esc(r.priority || "P2") + '"><i></i>' + esc(r.priority || "") + "</span></td>" +
      '<td class="nowrap" title="任务开始日期">' + esc(r.startDate || "—") + "</td>" +
      '<td class="nowrap" title="任务完成日期">' + esc(r.completedAt || "—") + "</td>" +
      '<td class="nowrap"><b>' + (fmtMinutesShort(r.totalMinutes) || "—") + "</b></td>" +
    "</tr>";
  }).join("");
  $("compWrap").innerHTML = '<div class="comp-scroll"><table class="comp-table"><thead>' + head +
    "</thead><tbody>" + body + "</tbody></table></div>";
}
/** 任务清单里的「需求」单元格：需求还在就渲染成可点击的链接，已删除则只显示当时的名字 */
function compDocCell(r){
  if(!r.reqDocTitle) return '<span class="comp-dim">—</span>';
  /* 需求列表还没加载完（reqDocList 为空）时不要急着判定"已删除"，否则点了没反应 */
  var loaded = reqDocList.length > 0;
  var alive = r.reqDocId && (!loaded || reqDocNameById(r.reqDocId));
  if(alive){
    return '<button type="button" class="link-cell" data-open-reqdoc="' + esc(r.reqDocId) + '"' +
      ' title="打开需求：' + esc(r.reqDocTitle) + '">' + esc(r.reqDocTitle) + '</button>';
  }
  return '<span class="comp-dim" title="该需求已被删除">' + esc(r.reqDocTitle) + '</span>';
}

/** 导出 CSV：加 BOM 防 Excel 中文乱码，字段一律加引号并转义内部双引号 */
function exportCompCSV(){
  var rows = compRowsCache || [];
  if(!rows.length){ toast("这个月还没有完成记录", "warn"); return; }
  var month = currentCompMonth();
  var lines = [["任务名称","详情","归属项目","关联需求","负责人","分类","优先级",
    "开始时间","结束时间","总耗时(分钟)","总耗时"]];
  rows.forEach(function(r){
    lines.push([r.title, r.description, r.reqName, r.reqDocTitle, r.owner, r.category, r.priority,
      r.startDate, r.completedAt, r.totalMinutes || 0, fmtMinutesShort(r.totalMinutes)]);
  });
  var csv = "\uFEFF" + lines.map(function(cols){
    return cols.map(ganttCsvCell).join(",");
  }).join("\r\n");
  triggerDownload("任务清单-" + month + ".csv", csv, "text/csv;charset=utf-8;");
  toast("已导出 " + rows.length + " 条记录", "fs");
}
/* 任务清单里点需求名 → 跳到需求正文 */
if($("compWrap")) $("compWrap").addEventListener("click", function(e){
  var b = e.target.closest("[data-open-reqdoc]");
  if(b) openReqDocAndJump(b.dataset.openReqdoc);
});
$("compPrev").addEventListener("click", function(){ shiftCompMonth(-1); });
$("compNext").addEventListener("click", function(){ shiftCompMonth(1); });
$("btnCompExport").addEventListener("click", exportCompCSV);

/* ==================== 报表（§6.8） ==================== */
function enterStatsView(){ loadStats(); }
function loadStats(opts){
  opts = opts || {};
  var weeks = Number(state.statsWeeks) || 8;
  if(!opts.silent){
    $("chartWeeks").innerHTML = '<div class="skel skel-chart"></div>';
    $("statsCurrent").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
      '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
    if(statsHoursEl) statsHoursEl.innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
    $("statsCat").innerHTML = UI.skeletonRows(3);
    $("statsOwner").innerHTML = UI.skeletonRows(3);
  }
  $("statsRange1").textContent = "近 " + weeks + " 周 · 全空间";
  $("statsRange2").textContent = "近 " + weeks + " 周 · 全空间";
  API.get("/api/stats", {weeks: weeks}).then(renderStats).catch(function(ex){
    $("chartWeeks").innerHTML = UI.errorState(ex.message);
    bindRetry($("chartWeeks"), function(){ loadStats(); });
  });
}
/* O-12 / N-5：工时卡支持「仅我 / 全空间」切换，并在卡片上明示口径 */
function renderStatsHours(c){
  if(!statsHoursEl) return;
  var scope = state.workScope;
  var mine = Number(c.workMinutes) || 0;
  var mineWeek = Number(c.workMinutesWeek) || 0;
  var all = (c.workMinutesAll === undefined || c.workMinutesAll === null) ? null : Number(c.workMinutesAll);
  var allWeek = (c.workMinutesWeekAll === undefined || c.workMinutesWeekAll === null) ? null : Number(c.workMinutesWeekAll);
  var base = (scope === "all") ? (all === null ? mine : all) : mine;
  var week = (scope === "all") ? (allWeek === null ? mineWeek : allWeek) : mineWeek;
  var doneCount = c.done || 0;
  var cards = [
    {k:"累计工时", v:fmtMinutesShort(base)},
    {k:"本周工时", v:fmtMinutesShort(week)},
    {k:"平均每项", v:fmtMinutesShort(doneCount ? Math.round(base / doneCount) : 0)}
  ];
  statsHoursEl.innerHTML = cards.map(function(x){
    return '<div class="stat"><div class="k">' + x.k + '</div><div class="v">' + x.v + '</div></div>';
  }).join("");
  if(workScopeTag) workScopeTag.textContent = (scope === "all") ? "全空间" : "仅我";
  if(hoursNote){
    if(scope === "all" && all === null){
      hoursNote.textContent = "服务端暂未返回全空间工时，当前回退显示我的工时（需后端支持）。";
    }else{
      hoursNote.textContent = (scope === "all")
        ? "「全空间」= 空间内全部成员的计时合计，用于评估协作总投入。"
        : "「仅我」= 我在本空间的计时记录；切到「全空间」可看协作总投入。";
    }
  }
}
function syncWorkScopeSeg(){
  if(!segWorkScope) return;
  segWorkScope.querySelectorAll("[data-wscope]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.wscope === state.workScope ? "true" : "false");
  });
}
if(segWorkScope){
  segWorkScope.addEventListener("click", function(e){
    var b = e.target.closest("[data-wscope]");
    if(!b) return;
    state.workScope = b.dataset.wscope;
    syncWorkScopeSeg();
    if(state.lastStats) renderStatsHours(state.lastStats.current || {});
  });
}
function renderStats(d){
  state.lastStats = d;
  var maxV = 1;
  (d.weeks || []).forEach(function(w){
    if(w.created > maxV) maxV = w.created;
    if(w.completed > maxV) maxV = w.completed;
  });
  var chart;
  if(!d.weeks || !d.weeks.length){
    chart = '<div class="col-empty" style="margin:20px 0">暂无统计数据</div>';
  }else{
    chart = '<div class="chart">' + d.weeks.map(function(w){
      var parts = w.start.split("-");
      return '<div class="c" title="' + w.start + ' ~ ' + w.end + '：新增 ' + w.created + ' / 完成 ' + w.completed + '">' +
        '<div class="bars">' +
          '<i class="b-new" style="height:' + Math.round(w.created/maxV*100) + '%"></i>' +
          '<i class="b-done" style="height:' + Math.round(w.completed/maxV*100) + '%"></i>' +
        '</div>' +
        '<span class="cl">' + parts[1] + "-" + parts[2] + '</span>' +
      '</div>';
    }).join("") + '</div>' +
    '<div class="chart-legend"><span><i class="b-new"></i>新增</span><span><i class="b-done"></i>完成</span></div>';
  }
  $("chartWeeks").innerHTML = chart;

  var c = d.current || {};
  var overN = c.overdue || 0;
  var cards = [
    {k:"待处理", v:c.backlog || 0, cls:""},
    {k:"进行中", v:c.doing || 0, cls:"info"},
    {k:"已完成", v:c.done || 0, cls:"good"}
  ];
  if(c.other > 0) cards.push({k:"其他列", v:c.other, cls:""});
  cards.push({k:"逾期", v:overN, cls:(overN > 0 ? "bad" : "")});
  $("statsCurrent").innerHTML = cards.map(function(x){
    return '<div class="stat ' + x.cls + '"><div class="k">' + x.k + '</div><div class="v">' + x.v +
      '<small>项</small></div></div>';
  }).join("");

  var wm = c.workMinutes || 0;
  renderStatsHours(c);
  syncWorkScopeSeg();

  $("statsCat").innerHTML = distHTML(d.byCategory,
    function(){ return "var(--primary)"; },
    function(x){ return x.count; });
  $("statsOwner").innerHTML = distHTML(d.byOwner,
    function(x){ return avatarColor(x.name); },
    function(x){ return x.count; });
}
$("statsWeeks").addEventListener("change", function(){
  state.statsWeeks = $("statsWeeks").value;
  loadStats();
});

/* ==================== 流程体检 ==================== */
/* 口径全部由后端算好（FlowHealthService），前端只负责让它一眼能读懂：
   瓶颈列、返工率、一次通过率、需求开工延迟 —— 都是日志里能追溯的事实，不做预测。 */
function enterFlowView(){ loadFlowHealth(); }

function spanParts(sec){
  var s = Number(sec) || 0;
  if(s <= 0) return {n:"—", u:""};
  if(s < 3600) return {n:String(Math.max(1, Math.round(s/60))), u:"分钟"};
  if(s < 86400) return {n:(s/3600).toFixed(1), u:"小时"};
  return {n:(s/86400).toFixed(1), u:"天"};
}
function fmtSpan(sec){
  var p = spanParts(sec);
  return p.n === "—" ? "—" : p.n + " " + p.u;
}
function fmtPct(v){
  return Math.round((Number(v) || 0) * 100) + "%";
}
function flowCard(k, html, cls){
  return '<div class="stat ' + (cls || "") + '"><div class="k">' + k + '</div><div class="v">' + html + '</div></div>';
}
function flowRow(label, value, widthPct, color){
  var w = Math.max(0, Math.min(100, Math.round(Number(widthPct) || 0)));
  return '<div class="dist-row">' +
    '<span class="lb">' + esc(label) + '</span>' +
    '<span class="bar"><i style="width:' + w + '%;--c:' + color + '"></i></span>' +
    '<span class="vl">' + value + '</span></div>';
}
function loadFlowHealth(opts){
  opts = opts || {};
  var days = Number(state.flowDays) || 90;
  if($("flowDays")) $("flowDays").value = String(days);
  if(!opts.silent){
    $("flowInsights").innerHTML = UI.skeletonRows(3);
    $("flowKpi").innerHTML = '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>' +
      '<div class="skel skel-stat"></div><div class="skel skel-stat"></div>';
    $("flowBars").innerHTML = UI.skeletonRows(3);
    $("flowRework").innerHTML = UI.skeletonRows(2);
    $("flowPriority").innerHTML = UI.skeletonRows(2);
  }
  $("flowReqs").innerHTML = UI.skeletonRows(2);
  $("flowRange").textContent = "近 " + days + " 天 · 全空间";
  /* 估时区块单独取：口径和流程瓶颈无关，各算各的，一个失败不影响另一个 */
  if($("flowEstTop")){
    $("flowEstTop").innerHTML = UI.skeletonRows(1);
    API.get("/api/estimate/stats", {}).then(renderFlowEstimate).catch(function(ex){
      $("flowEstTop").innerHTML = UI.errorState(ex.message);
    });
  }
  API.get("/api/flow-health", {days: days}).then(renderFlowHealth).catch(function(ex){
    $("flowInsights").innerHTML = UI.errorState(ex.message);
    bindRetry($("flowInsights"), function(){ loadFlowHealth(); });
  });
}
function renderFlowHealth(d){
  var cov = d.coverage || {}, rw = d.rework || {}, rs = d.reqDocs || {};
  var cols = d.columns || [], ins = d.insights || [];

  /* ---- 结论：这是整个页面的重点，放最上面 ---- */
  $("flowInsights").innerHTML = ins.length ? ins.map(function(x){
    return '<div class="flow-ins ' + (x.level || "info") + '">' +
      '<span class="fi-dot" aria-hidden="true"></span>' +
      '<div class="fi-main"><div class="fi-t">' + esc(x.title) + '</div>' +
      '<div class="fi-x">' + esc(x.text) + '</div></div></div>';
  }).join("") : '<div class="col-empty" style="margin:16px 0">暂无结论</div>';
  $("flowCoverage").textContent = cov.note || "";

  /* ---- KPI ---- */
  var leadP = spanParts(rs.avgLeadHours == null ? 0 : rs.avgLeadHours * 3600);
  var passCls = !rw.completedTasks ? "" : (rw.firstPassRate >= 0.8 ? "good" : (rw.firstPassRate < 0.6 ? "bad" : ""));
  var backCls = !rw.totalMoves ? "" : (rw.backRate >= 0.2 ? "bad" : "");
  $("flowKpi").innerHTML =
    flowCard("瓶颈列", d.bottleneckName ? esc(d.bottleneckName) : "—",
      d.bottleneckName ? "warn" : "") +
    flowCard("一次通过率", rw.completedTasks ? fmtPct(rw.firstPassRate) +
      '<small> · ' + rw.firstPassTasks + "/" + rw.completedTasks + ' 项</small>' : "—",
      passCls) +
    flowCard("回退率", rw.totalMoves ? fmtPct(rw.backRate) +
      '<small> · ' + rw.backMoves + "/" + rw.totalMoves + ' 次</small>' : "—", backCls) +
    flowCard("需求开工延迟", leadP.n === "—" ? "—" :
      leadP.n + '<small> ' + leadP.u + '</small>', "");
  if($("flowKpi").children[0] && d.bottleneckName){
    $("flowKpi").children[0].querySelector(".v").insertAdjacentHTML("beforeend",
      '<small> · 占 ' + fmtPct(d.bottleneckShare) + '</small>');
  }

  /* ---- 各列停留 ---- */
  if(!cols.length){
    $("flowBars").innerHTML = '<div class="col-empty" style="margin:16px 0">当前空间还没有看板列</div>';
  }else{
    var maxShare = 0;
    cols.forEach(function(c){ if((c.share || 0) > maxShare) maxShare = c.share; });
    $("flowBars").innerHTML = cols.map(function(c){
      var w = maxShare > 0 ? Math.max(1, Math.round((c.share || 0) / maxShare * 100)) : 0;
      var ongoing = c.ongoingCount
        ? '现 ' + c.ongoingCount + ' 个在制 · 最久 ' + fmtSpan(c.ongoingMaxSeconds)
        : '当前无在制';
      return '<div class="flow-bar' + (c.bottleneck ? " is-bn" : "") + '">' +
        '<div class="fb-row">' +
          '<span class="fb-name">' + esc(c.name) +
            (c.bottleneck ? '<i class="fb-tag">瓶颈</i>' : '') + '</span>' +
          '<span class="fb-v">平均 ' + fmtSpan(c.avgSeconds) + '</span>' +
          '<span class="fb-share">' + fmtPct(c.share) + '</span>' +
        '</div>' +
        '<div class="bar"><i style="width:' + w + '%;--c:' + (c.color || "var(--primary)") + '"></i></div>' +
        '<div class="fb-meta"><span>' + (c.segments || 0) + ' 段已离开 · 中位 ' +
          fmtSpan(c.medianSeconds) + ' · P90 ' + fmtSpan(c.p90Seconds) + '</span>' +
          '<span class="' + (c.ongoingCount ? '' : 'muted') + '">' + ongoing + '</span></div>' +
      '</div>';
    }).join("");
  }

  /* ---- 返工 ---- */
  if(!rw.totalMoves){
    $("flowRework").innerHTML = '<div class="col-empty" style="margin:16px 0">这段时间没有跨列移动</div>';
  }else{
    $("flowRework").innerHTML = '<div class="dist">' +
      flowRow("跨列移动", rw.totalMoves + " 次", 100, "var(--info)") +
      flowRow("其中回退", rw.backMoves + " 次 · " + fmtPct(rw.backRate), rw.backRate * 100, "var(--warning)") +
      flowRow("一次通过", rw.firstPassTasks + "/" + rw.completedTasks + " 项",
        rw.completedTasks ? rw.firstPassRate * 100 : 0, "var(--success)") +
      '</div>' +
      '<p class="flow-note">回退 = 目标列在列顺序里比来源列更靠前。退回多半说明"进入下一列的门槛"没写清楚。</p>';
  }

  /* ---- 优先级 ---- */
  var prio = d.priority || [];
  if(!prio.length){
    $("flowPriority").innerHTML = '<div class="col-empty" style="margin:16px 0">还没有任务</div>';
  }else{
    var maxMv = 0;
    prio.forEach(function(p){ if(p.avgMoves > maxMv) maxMv = p.avgMoves; });
    $("flowPriority").innerHTML = '<div class="dist">' + prio.map(function(p){
      return flowRow(p.priority + " · " + p.tasks + " 项", p.avgMoves + " 次",
        maxMv > 0 ? p.avgMoves / maxMv * 100 : 0,
        p.priority === "P0" ? "var(--danger)" : (p.priority === "P1" ? "var(--warning)" : "var(--text-3)"));
    }).join("") + '</div>' +
      '<p class="flow-note">数字是每个任务平均被移动多少次列。优先级立得住的话，P0 应该<b>更少</b>被来回拖。</p>';
  }

  /* ---- 需求 → 开工 ---- */
  if(!rs.total){
    $("flowReqMeta").textContent = "—";
    $("flowReqs").innerHTML = '<div class="col-empty" style="margin:16px 0">当前空间还没有需求文档</div>';
  }else{
    $("flowReqMeta").textContent = rs.withTasks + " / " + rs.total + " 份已开工";
    var html = '<div class="stat-grid" style="margin-bottom:14px">' +
      flowCard("需求总数", rs.total + '<small>份</small>', "") +
      flowCard("已拆出任务", rs.withTasks + '<small>份</small>', "") +
      flowCard("还没拆任务", rs.noTask + '<small>份</small>', rs.noTask ? "warn" : "good") +
      flowCard("平均开工延迟", leadP.n === "—" ? "—" : leadP.n + '<small>' + leadP.u + '</small>', "") +
      '</div>';
    if(rs.noTaskList && rs.noTaskList.length){
      html += '<div class="flow-orphans">' + rs.noTaskList.map(function(x){
        return '<div class="done-item">' +
          '<div class="di-main"><button class="link-cell" type="button" data-open-reqdoc="' + esc(x.id) + '">' +
            esc(x.title) + '</button>' +
          '<div class="di-m"><span>已挂 ' + x.ageDays + ' 天，还没有任务</span></div></div></div>';
      }).join("") + '</div>';
    }
    $("flowReqs").innerHTML = html;
  }
}
/* 估时准不准：系数 + 偏差分布 + 超支预警。数字全由后端算，这里只排版。
   刻意不拿 start_date 推工期 —— 开始日期是"接到任务的那天"，不是"动手的那天"。 */
function renderFlowEstimate(d){
  if($("flowEstMeta")){
    $("flowEstMeta").textContent = d.tasksWithEstimate + " / " + d.tasksTotal + " 个任务填了预估";
  }
  var top = $("flowEstTop");
  if(!top) return;

  if(!d.sampleCount){
    top.innerHTML = '<div class="fe-main"><div class="fe-sug">'
      + esc(d.suggestion || "还没有可对比的样本") + '</div></div>';
    if($("flowEstRisk")) $("flowEstRisk").innerHTML = "";
    if($("flowEstNote")) $("flowEstNote").textContent = d.note || "";
    return;
  }

  var f = d.overallFactor || 0;
  /* 偏乐观（实际超预估）和偏保守都值得提醒，只有落在中间才算"准" */
  var cls = (f >= 1.15 || f <= 0.87) ? "warn" : "good";
  var n = d.sampleCount;
  var wu = Math.round(d.underCount / n * 100);
  var wa = Math.round(d.accurateCount / n * 100);
  var wo = Math.max(0, 100 - wu - wa);
  top.innerHTML =
    '<div class="fe-factor ' + cls + '">' +
      '<div class="big">' + f.toFixed(2) + '<small>×</small></div>' +
      '<div class="lbl">实际 / 预估</div>' +
    '</div>' +
    '<div class="fe-main">' +
      '<div class="fe-bar" title="按任务数分布">' +
        '<i class="under" style="width:' + wu + '%"></i>' +
        '<i class="ok" style="width:' + wa + '%"></i>' +
        '<i class="over" style="width:' + wo + '%"></i>' +
      '</div>' +
      '<div class="fe-dist">' +
        '<span>高估 <b>' + d.underCount + '</b></span>' +
        '<span>准确 <b>' + d.accurateCount + '</b></span>' +
        '<span>低估 <b>' + d.overCount + '</b></span>' +
        '<span>样本 <b>' + n + '</b> 项已完成</span>' +
        (d.noTimeCount ? '<span title="没开过计时的任务没有实际耗时，不参与系数">未计时 <b>' + d.noTimeCount + '</b> 项</span>' : '') +
      '</div>' +
      '<div class="fe-sug">' + esc(d.suggestion || "") + '</div>' +
    '</div>';

  var html = "";
  /* 进行中且已消耗 80% 以上：唯一还来得及处理的清单 */
  if(d.atRisk && d.atRisk.length){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">'
      + d.atRisk.length + ' 个进行中的任务已用掉预估的 80% 以上</div>';
    for(var i = 0; i < d.atRisk.length && i < 8; i++){
      var t = d.atRisk[i];
      var hi = t.level === "danger";
      html += '<div class="done-item"><div class="di-main">' +
        '<div class="di-t">' + esc(t.title) + '</div>' +
        '<div class="di-m">' +
          '<span class="ai-tag ' + (hi ? "risk-hi" : "risk-lo") + '">' + (hi ? "已超预估" : "接近预估") + '</span>' +
          '<span>实际 ' + fmtMinutesShort(t.actualMinutes) + ' / 预估 ' + fmtMinutesShort(t.estimateMinutes)
            + '（' + Math.round(t.ratio * 100) + '%）</span>' +
        '</div></div></div>';
    }
    html += '</div>';
  }
  /* 已完成但超预估：复盘用，别和"还能救"的混一起 */
  if(d.overrun && d.overrun.length){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">已完成但超出预估（复盘）</div>';
    for(var j = 0; j < d.overrun.length; j++){
      var o = d.overrun[j];
      html += '<div class="done-item"><div class="di-main">' +
        '<div class="di-t">' + esc(o.title) + '</div>' +
        '<div class="di-m"><span>实际 ' + fmtMinutesShort(o.actualMinutes) + ' / 预估 '
          + fmtMinutesShort(o.estimateMinutes) + '（' + Math.round(o.ratio * 100) + '%）</span></div>' +
      '</div></div>';
    }
    html += '</div>';
  }
  /* 分类系数：只有一个分类时没有对比意义 */
  if(d.byCategory && d.byCategory.length > 1){
    html += '<div class="flow-est-cat"><div class="foot-note" style="margin:0">按分类看系数</div>';
    d.byCategory.forEach(function(c){
      var cf = c.factor || 0;
      html += flowRow(c.category + " · " + c.sampleCount + " 项", cf.toFixed(2) + "×",
        Math.min(100, cf * 50),
        cf >= 1.15 ? "var(--danger)" : (cf >= 0.87 ? "var(--info)" : "var(--success)"));
    });
    html += '</div>';
  }
  if($("flowEstRisk")) $("flowEstRisk").innerHTML = html;
  if($("flowEstNote")) $("flowEstNote").textContent = d.note || "";
}

if($("flowDays")){
  $("flowDays").addEventListener("change", function(){
    state.flowDays = Number(this.value) || 90;
    loadFlowHealth();
  });
}
/* 需求名可点：跳到需求编辑页（和任务清单里的交互一致） */
if($("view-flow")){
  $("view-flow").addEventListener("click", function(e){
    var b = e.target.closest("[data-open-reqdoc]");
    if(b) openReqDocAndJump(b.dataset.openReqdoc);
  });
}

/* ==================== 回收站（§6.9） ==================== */
var trashList = $("trashList");
function enterTrashView(){ loadTrash(); }
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
  return Math.max(0, 30 - dayDiff(TODAY, startOfDay(d)));
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
  var canPurge = !!(currentWs && currentWs.myRole === "owner");
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
    if(!(currentWs && currentWs.myRole === "owner")){ toast("仅空间主可彻底删除任务", "warn"); return; }
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

/* ==================== 设置视图（§6.10） ==================== */
var wsNameInput = $("wsNameInput"), wsWebhook = $("wsWebhook"),
    wsMemberList = $("wsMemberList"), wsMemberName = $("wsMemberName"),
    catCfgList = $("catCfgList"), catNewName = $("catNewName"), catNewColor = $("catNewColor"),
    colCfgList = $("colCfgList"), colNewName = $("colNewName"), colNewColor = $("colNewColor");

function enterSettingsView(){
  if(!currentWs || !wsNameInput) return;
  settingsReady = true;
  var isOwner = currentWs.myRole === "owner";
  var isPersonal = currentWs.type === "personal";
  $("wsTypeHint").textContent = isPersonal
    ? "个人空间 · 仅自己可见"
    : ("共享空间 · " + (isOwner ? "你是空间主" : "你是成员") + "（" + (currentWs.memberCount || 0) + " 人）");
  wsNameInput.value = currentWs.name;
  wsNameInput.disabled = isPersonal || !isOwner;
  wsWebhook.value = currentWs.notifyWebhook || "";
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
  var isAdmin = !!(currentUser && currentUser.role === "admin");
  $("wsMemberAdd").hidden = !(isOwner && isAdmin);
  if($("wsMemberHint")) $("wsMemberHint").hidden = !(isOwner && !isPersonal && !isAdmin);
  var canInvite = !isPersonal && isOwner;
  $("inviteBox").hidden = !canInvite;
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
  initSetAnchor();
}
function initSetAnchor(){
  var links = document.querySelectorAll("#setAnchor a");
  if(!document.getElementById("setAnchor").__wired){
    document.getElementById("setAnchor").__wired = true;
    links.forEach(function(a){
      a.addEventListener("click", function(e){
        e.preventDefault();
        var el = document.querySelector(a.getAttribute("href"));
        if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
      });
    });
  }
  var view = $("view-settings");
  function spy(){
    var panels = document.querySelectorAll(".set-panels .panel[id]");
    var cur = panels.length ? panels[0].id : null;
    var best = -1e9;
    panels.forEach(function(p){
      var top = p.getBoundingClientRect().top;
      if(top - 140 <= 0 && top > best){ best = top; cur = p.id; }
    });
    links.forEach(function(a){ a.classList.toggle("on", a.getAttribute("href") === "#" + cur); });
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
function loadWsMemberList(){
  wsMemberList.innerHTML = UI.skeletonRows(2);
  API.get("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/members").then(function(list){
    wsMembersCache = list || [];
    $("wsMemberCount").textContent = "共 " + wsMembersCache.length + " 人";
    var isOwner = currentWs.myRole === "owner";
    wsMemberList.innerHTML = wsMembersCache.map(function(m){
      var isSelf = currentUser && m.userId === currentUser.id;
      var canRemove = isOwner ? m.role !== "owner" : isSelf;
      return '<div class="member-row" data-mid="' + esc(m.userId) + '">' +
        avatarHTML(m.displayName, "lg") +
        '<span class="mi"><span class="nm">' + esc(m.displayName) + '</span>' +
          '<span class="sub">@' + esc(m.username) + '</span></span>' +
        '<span class="tag ' + (m.role === "owner" ? "tag-primary" : "tag-ghost") + '">' +
          (m.role === "owner" ? "空间主" : "成员") + '</span>' +
        (canRemove ? '<span class="acts"><button class="btn sm danger" type="button" data-mid-del="' +
          esc(m.userId) + '">' + (isSelf ? "退出" : "移出") + '</button></span>' : '') +
      '</div>';
    }).join("");
  }).catch(function(ex){
    wsMemberList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function inviteLink(code){
  return window.location.origin + "/join.html?code=" + encodeURIComponent(code);
}
function loadInvites(){
  var listEl = $("inviteList");
  if(!listEl || !currentWs) return;
  listEl.innerHTML = UI.skeletonRows(1);
  API.get("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/invites").then(function(list){
    inviteCache = list || [];
    renderInvites();
  }).catch(function(ex){
    listEl.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderInvites(){
  var listEl = $("inviteList");
  if(!listEl) return;
  if(!inviteCache.length){
    listEl.innerHTML = '<div class="col-empty">还没有邀请链接，点上方按钮生成</div>';
    return;
  }
  listEl.innerHTML = inviteCache.map(function(v){
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
    colDefsCache = (defs || []).filter(function(d){ return !d.done; });
    renderColCfg();
  }).catch(function(ex){
    colCfgList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderColCfg(){
  var canEdit = currentWs && currentWs.myRole === "owner";
  colCfgList.innerHTML = colDefsCache.map(function(d, idx){
    var fixed = (d.id === "backlog" || d.id === "doing");
    var delDisabled = fixed || !canEdit;
    return '<div class="cfg-row" data-col-id="' + esc(d.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(d.color || CAT_DEFAULT_COLOR) + '" data-col-color aria-label="列颜色" />' +
      '<input type="text" value="' + esc(d.name) + '" maxlength="12" data-col-name aria-label="列名" />' +
      (fixed ? '<span class="sysmark">系统列</span>' : '') +
      '<button class="cc-act" type="button" data-col-up title="上移"' + (idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-col-down title="下移"' + (idx === colDefsCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
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
    for(var i = 0; i < colDefsCache.length; i++) if(colDefsCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-col-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= colDefsCache.length) return;
    var moved = colDefsCache.splice(idx, 1)[0];
    colDefsCache.splice(to, 0, moved);
    API.put("/api/columns/order", { ids: colDefsCache.map(function(d){ return d.id; }) }).then(function(){
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
    for(var j = 0; j < colDefsCache.length; j++) if(colDefsCache[j].id === id) col = colDefsCache[j];
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
    catDefsCache = list || [];
    renderCatCfg();
  }).catch(function(ex){
    catCfgList.innerHTML = '<div class="foot-note">加载失败：' + esc(ex.message || "网络异常") + '</div>';
  });
}
function renderCatCfg(){
  $("catCount").textContent = catDefsCache.length ? "共 " + catDefsCache.length + " 个" : "";
  var canDel = currentWs && currentWs.myRole === "owner";
  catCfgList.innerHTML = catDefsCache.map(function(c, idx){
    return '<div class="cfg-row" data-cat-id="' + esc(c.id) + '">' +
      '<span class="handle" title="使用右侧箭头调整顺序">' + icon("grip", 14) + '</span>' +
      '<input type="color" value="' + esc(c.color || CAT_DEFAULT_COLOR) + '" data-cat-color aria-label="分类颜色" />' +
      '<input type="text" value="' + esc(c.name) + '" maxlength="12" data-cat-name aria-label="分类名称" />' +
      '<button class="cc-act" type="button" data-cat-up title="上移"' + (idx === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>' +
      '<button class="cc-act" type="button" data-cat-down title="下移"' + (idx === catDefsCache.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>' +
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
    for(var i = 0; i < catDefsCache.length; i++) if(catDefsCache[i].id === id) idx = i;
    if(idx < 0) return;
    var to = e.target.closest("[data-cat-up]") ? idx - 1 : idx + 1;
    if(to < 0 || to >= catDefsCache.length) return;
    var moved = catDefsCache.splice(idx, 1)[0];
    catDefsCache.splice(to, 0, moved);
    API.put("/api/categories/order", { ids: catDefsCache.map(function(c){ return c.id; }) }).then(function(){
      loadCatCfg();
    }).catch(function(ex){ toast(ex.message || "排序失败", "bad"); loadCatCfg(); });
    return;
  }
  if(e.target.closest("[data-cat-del]")){
    var cat = null;
    for(var j = 0; j < catDefsCache.length; j++) if(catDefsCache[j].id === id) cat = catDefsCache[j];
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

/* ---- 通知推送（O-1）：渠道选择 + 真实生效状态 + 诚实的测试推送 ---- */
var CHANNEL_LABEL = { webhook:"企业微信 / 钉钉 webhook", serverchan:"Server 酱", pushplus:"PushPlus" };
function loadNotifyStatus(){
  if(!notifyStatusText) return;
  API.get("/api/notify/status").then(function(d){
    notifyInfo = d || {};
    if(!pickedChannel) pickedChannel = notifyInfo.channel || "webhook";
    fillNotifyForm(d);
    renderNotifyStatus();
  }).catch(function(){
    notifyInfo = null;
    if(notifyStatus) notifyStatus.className = "notify-status off";
    if(notifyStatusText) notifyStatusText.textContent = "无法读取推送状态（该接口需要后端支持）";
  });
}
/* 只在“读服务端状态”时回填表单；切渠道只更新渠道和提示，不能把用户刚勾/刚填的内容冲掉 */
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
  var d = notifyInfo || {};
  var parts = [];
  if(d.enabled){
    parts.push('服务端推送总开关：<b style="color:var(--success)">已开启</b>');
  }else{
    parts.push('服务端推送总开关：<b style="color:var(--warning)">未开启</b>（定时提醒不会发送）');
  }
  parts.push('<span class="sep">|</span>渠道：' + esc(CHANNEL_LABEL[d.channel] || d.channel || "未配置"));
  if(d.workspaceHasAddress === false){
    parts.push('<span class="sep">|</span><b style="color:var(--warning)">本空间还没填地址</b>');
  }
  if(d.lastAttemptAt){
    parts.push('<span class="sep">|</span>上次推送：' + esc(fmtTs(d.lastAttemptAt)) + ' ' +
      (d.lastResult === "success"
        ? '<b style="color:var(--success)">成功</b>'
        : '<b style="color:var(--danger)">失败</b>' + (d.lastError ? '（' + esc(d.lastError) + '）' : '')));
  }else{
    parts.push('<span class="sep">|</span>还没有推送记录');
  }
  if(notifyStatus) notifyStatus.className = "notify-status " + (d.enabled ? "on" : "off");
  if(notifyStatusText) notifyStatusText.innerHTML = parts.join(" ");

  if(channelCards){
    channelCards.querySelectorAll(".channel-card").forEach(function(card){
      var on = card.dataset.channel === pickedChannel;
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
/* 渠道 ↔ 输入框的显式映射，避免「地址填了但渠道其实是另一个」的静默错配 */
function updateWebhookField(){
  var ch = pickedChannel || "webhook";
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
/* 地址与渠道不匹配时前端直接拦下（pushplus 不解析地址语义） */
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
  if(!val || !notifyInfo) return true;
  if(pickedChannel === "pushplus") return true;
  var guess = channelOfAddress(val);
  if(guess && guess !== pickedChannel){
    if(f) f.classList.add("invalid");
    if(wsWebhookHint) wsWebhookHint.textContent = "该地址看起来属于「" + (CHANNEL_LABEL[guess] || guess) +
      "」，与当前选中的「" + (CHANNEL_LABEL[pickedChannel] || pickedChannel) + "」不一致。";
    return false;
  }
  return true;
}
if(channelCards){
  channelCards.addEventListener("click", function(e){
    var card = e.target.closest("[data-channel]");
    if(!card) return;
    pickedChannel = card.dataset.channel;
    renderNotifyStatus();
    if(btnNotifySave) btnNotifySave.disabled = !(currentWs && currentWs.myRole === "owner");
  });
}
if(btnNotifySave){
  btnNotifySave.addEventListener("click", function(){
    if(!currentWs) return;
    if(!validateWebhookInput()){ toast("推送地址与所选渠道不匹配，请检查", "warn"); return; }
    var body = {
      /* 推送面板只保存推送字段：名称由「空间信息」面板单独保存，两个入口互不覆盖 */
      notifyWebhook: ($("wsWebhook") ? $("wsWebhook").value.trim() : ""),
      notifyChannel: pickedChannel || "webhook",
      notifyEnabled: !!($("wsNotifyEnabled") && $("wsNotifyEnabled").checked),
      /* BUG-12：站内通知独立开关，默认开启 */
      notifyInAppEnabled: !!($("wsNotifyInAppEnabled") && $("wsNotifyInAppEnabled").checked),
      /* Token 留空 + clearToken=false 表示“保持原值”，不再把已保存的 Token 静默写空 */
      notifyToken: ($("wsNotifyToken") ? $("wsNotifyToken").value.trim() : "") || null,
      clearToken: !!($("wsNotifyClearToken") && $("wsNotifyClearToken").checked)
    };
    btnNotifySave.disabled = true;
    API.put("/api/workspaces/" + encodeURIComponent(currentWs.id), body).then(function(ws){
      btnNotifySave.disabled = false;
      currentWs = ws;
      if(!currentWs.myRole) currentWs.myRole = "owner";
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

/* ---- 空间级活动流（O-9） ---- */
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

/* ---- 空间信息 / 成员 / 邀请 / 退出 / 删除 ---- */
$("btnWsSave").addEventListener("click", function(){
  if(!currentWs) return;
  var body = {
    name: currentWs.type === "personal" ? currentWs.name : wsNameInput.value.trim()
  };
  if(!body.name){ toast("空间名称不能为空", "warn"); return; }
  var btn = $("btnWsSave");
  btn.disabled = true;
  API.put("/api/workspaces/" + encodeURIComponent(currentWs.id), body).then(function(ws){
    btn.disabled = false;
    toast("空间设置已保存", "fs");
    currentWs = ws;
    if(!currentWs.myRole) currentWs.myRole = "owner";
    var nameEl = $("wsName");
    if(nameEl) nameEl.textContent = ws.name;
    loadWorkspaces(currentUser);
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
$("btnWsMemberAdd").addEventListener("click", function(){
  var un = wsMemberName.value.trim();
  if(!un){ toast("请输入成员登录名", "warn"); return; }
  API.post("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/members", { username: un }).then(function(){
    toast("已添加成员 @" + un, "fs");
    wsMemberName.value = "";
    loadWsMemberList();
    loadWorkspaces(currentUser);
  }).catch(function(ex){ toast(ex.message || "添加失败", "bad"); });
});
wsMemberList.addEventListener("click", function(e){
  var del = e.target.closest("[data-mid-del]");
  if(!del) return;
  var uid = del.dataset.midDel;
  var isSelf = currentUser && uid === currentUser.id;
  UI.showConfirm({
    title: isSelf ? "退出空间" : "移除成员",
    msg: isSelf ? "确定退出该空间？你的任务会保留在空间里。" : "确定移除该成员？",
    okText: isSelf ? "退出空间" : "移除"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/members/" + encodeURIComponent(uid)).then(function(){
      if(isSelf){ toast("已退出空间", "fs"); window.location.reload(); }
      else { toast("已移除成员", "fs"); loadWsMemberList(); loadWorkspaces(currentUser); }
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
});
$("btnWsLeave").addEventListener("click", function(){
  if(!currentWs || !currentUser) return;
  UI.showConfirm({
    title:"退出空间",
    msg:"确定退出空间「" + esc(currentWs.name) + "」？你的任务会保留在空间里。",
    okText:"退出空间"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/members/" + encodeURIComponent(currentUser.id)).then(function(){
      toast("已退出空间", "fs");
      window.location.reload();
    }).catch(function(ex){ toast(ex.message || "退出失败", "bad"); });
  });
});
$("btnWsDelete").addEventListener("click", function(){
  if(!currentWs) return;
  $("dlgWsDeleteName").textContent = "「" + currentWs.name + "」";
  $("dlgWsDeleteInput").value = "";
  $("fDlgWsDelete").classList.remove("invalid");
  $("dlgWsDeleteOk").disabled = true;
  UI.openModal($("dlgWsDelete"));
});
$("dlgWsDeleteInput").addEventListener("input", function(){
  $("dlgWsDeleteOk").disabled = !currentWs || this.value !== currentWs.name;
  $("fDlgWsDelete").classList.remove("invalid");
});
$("dlgWsDeleteForm").addEventListener("submit", function(e){
  e.preventDefault();
  var inp = $("dlgWsDeleteInput");
  if(!currentWs || inp.value !== currentWs.name){
    $("fDlgWsDelete").classList.add("invalid");
    return;
  }
  var btn = $("dlgWsDeleteOk");
  btn.disabled = true;
  API.del("/api/workspaces/" + encodeURIComponent(currentWs.id)).then(function(){
    toast("空间已删除", "fs");
    window.location.reload();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "删除失败", "bad");
  });
});
$("btnInviteGen").addEventListener("click", function(){
  if(!currentWs) return;
  var btn = $("btnInviteGen");
  btn.disabled = true;
  API.post("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/invites", {}).then(function(res){
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
  if(!row || !currentWs) return;
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
      API.del("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/invites/" + encodeURIComponent(id)).then(function(){
        toast("已撤销邀请链接", "fs");
        loadInvites();
      }).catch(function(ex){ toast(ex.message || "撤销失败", "bad"); });
    });
  }
});

/* ---- 数据：导出 / 导入 / CSV / 清空 ---- */
$("btnExport").addEventListener("click", function(){
  API.get("/api/export").then(function(data){
    triggerDownload(BACKUP_NAME, JSON.stringify(data, null, 2), "application/json");
    toast("已导出任务备份（含任务/项目/评论/甘特依赖与基线/需求文档/分支）", "fs");
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
      "<br><br>v6 备份会连同<b>需求文档与分支</b>一起覆盖恢复；旧备份不含这两类数据时保留现状。旧备份不含依赖/基线（v4 之前也不含评论）：缺失的部分导入后会被清空。建议先导出一份当前任务备份。导入后当前空间的只读分享链接会失效。",
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
          (res.reqDocs ? " / " + res.reqDocs + " 份需求文档" : "") +
          (res.branches ? " / " + res.branches + " 个分支" : "") +
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
    a.download = "workbench-tasks-" + TODAY_ISO + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
    toast("已导出 CSV", "fs");
  }).catch(function(ex){ toast("导出失败：" + (ex.message || "网络异常"), "bad"); });
});
var btnReset = $("btnReset"), resetLabel = $("resetLabel");
function disarmReset(){
  if(resetArmed){ clearTimeout(resetArmed); resetArmed = null; }
  btnReset.classList.remove("armed");
  resetLabel.textContent = "清空任务数据";
  btnReset.title = "删除任务、回收站、项目、子任务、标签、工时、评论、甘特依赖/基线、任务通知与完成归档、需求文档（随项目）、分享链接失效；分支、附件、时间线、视图、看板列与分类保留";
}
disarmReset();
btnReset.addEventListener("click", function(){
  if(resetArmed){
    disarmReset();
    var n = totalTaskCount(), m = reqList.length;
    API.post("/api/import", {v:6, tasks:[], reqs:[], comments:[], deps:[], baseline:[], reqDocs:[]}).then(function(){
      state.q = ""; state.owners = []; state.pris = []; state.cats = []; state.reqs = [];
      state.tags = []; state.due = null; state.focus = false;
      searchInput.value = "";
      searchWrap.classList.remove("has");
      toast((n + m > 0)
        ? ("已清空 " + n + " 项任务与 " + m + " 个项目（含回收站、评论、任务通知、完成归档与需求文档）")
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
  toast("再次点击确认：删除任务/回收站/项目/评论/甘特依赖与基线/任务通知/完成归档/需求文档，分享链接失效；分支、附件、时间线保留", "warn");
  resetArmed = setTimeout(disarmReset, 3500);
});

/* ---- 快捷键说明面板（O-16 / C6：与实现、与 UI 规范三处对齐） ---- */
$("kbdBody").innerHTML = [
  ["N","聚焦快速录入：在列表或其他视图按下会先切到看板，再落在列内录入框"],
  ["C","新建任务（打开详情抽屉）"],
  ["/ 或 Ctrl/⌘ + K","聚焦全局搜索：任意视图都可用，结果统一在看板呈现"],
  ["Space","卡片/列表行聚焦时打开详情抽屉"],
  ["D","卡片/列表行聚焦时改期（今天 / 明天 / 一周后＝5 个工作日 / 无期限，或选具体日期）"],
  ["X","卡片/列表行聚焦时标记完成；在已完成列内按 X 则取消完成"],
  ["1 / 2 / 3 / 4","卡片/列表行聚焦时设置优先级 P0–P3"],
  ["← / →","卡片/列表行聚焦时移动到相邻列"],
  ["↑ / ↓","看板内卡片之间上下移动焦点"],
  ["Delete","卡片/列表行聚焦时移入回收站（可在提示里撤销）"],
  ["Esc","逐层关闭：拖拽 → 确认框 → 浮层 → 抽屉 → 弹窗 → 内联输入 → 搜索"],
  ["Ctrl/⌘ + Enter","保存抽屉或弹窗表单；在评论框内为发送评论"],
  ["T","日历视图回到今天"],
  ["Ctrl/⌘ + B","收起 / 展开侧边栏"],
  ["录入语法","!P0 优先级 · #项目 · @负责人 · +标签 · %进度 · ~每周 循环 · 明天 / 3天后 / 10-20 日期"]
].map(function(r){
  return '<div class="done-item">' +
    '<span class="tag tag-ghost" style="font-family:var(--font-mono)">' + esc(r[0]) + '</span>' +
    '<span class="di-main"><span class="di-m">' + esc(r[1]) + '</span></span></div>';
}).join("");

/* ==================== 用户管理（§6.11） ==================== */
var userListEl = $("userList");
function enterUsersView(){
  if(currentUser && currentUser.role !== "admin"){
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
    if(currentUser && currentUser.role !== "admin"){
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
    var isMe = currentUser && u.id === currentUser.id;
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
      msg:"删除用户「" + esc(display) + "」？该账号个人空间的任务/项目需已清空；个人空间剩余的需求文档、附件与配置会随账号一并删除，不可恢复。",
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

/* ==================== 空间切换 / 当前用户 / 个人资料 ==================== */
var wsMenuEl = $("wsMenu"), wsListEl = $("wsList"), wsSwitchBtn = $("wsSwitch");
function loadWorkspaces(meUser){
  return API.get("/api/workspaces").then(function(list){
    allWorkspaces = list || [];
    var target = null;
    if(meUser && meUser.lastWorkspaceId){
      for(var i = 0; i < allWorkspaces.length; i++) if(allWorkspaces[i].id === meUser.lastWorkspaceId) target = allWorkspaces[i];
    }
    if(!target && allWorkspaces.length) target = allWorkspaces[0];
    if(target){
      currentWs = target;
      window.CURRENT_WORKSPACE = target.id;
      var nameEl = $("wsName");
      if(nameEl) nameEl.textContent = target.name;
      var av = $("wsAvatar");
      if(av){
        av.textContent = target.name ? target.name.charAt(0) : "空";
        av.style.setProperty("--a", avatarColor(target.name || "空"));
      }
      var kindEl = $("wsKind");
      if(kindEl) kindEl.textContent = target.type === "personal"
        ? "个人空间"
        : ("共享 · " + (target.memberCount || 1) + " 人" + (target.myRole === "owner" ? " · 空间主" : ""));
    }
    renderWsMenu();
    applyWsRoleGating();
    loadWsMembers();
    updateBrand();
    /* 深链直达甘特图时，空间在首屏之后才确定：偏好与请求都要按新空间补跑一次 */
    if(activeView === "gantt"){
      loadGanttPrefs();
      syncGanttControls();
      loadGantt();
    }
    if(activeView === "settings" && !settingsReady) enterSettingsView();
    return target;
  }).catch(function(){ return null; });
}
function applyWsRoleGating(){
  var owner = !currentWs || currentWs.myRole === "owner";
  [["btnExport","导出任务备份"],["btnImport","导入任务备份"],["btnReset","清空任务数据"],["btnNotifyTest","测试推送"]].forEach(function(pair){
    var b = $(pair[0]);
    if(!b) return;
    if(b.dataset.ownerTitle === undefined) b.dataset.ownerTitle = b.title || "";
    b.disabled = !owner;
    b.title = owner ? b.dataset.ownerTitle : ("仅空间主可" + pair[1]);
  });
}
function loadWsMembers(){
  wsMembersCache = [];
  refreshOwnerSelect();
  if(!currentWs || currentWs.type !== "shared") return;
  API.get("/api/workspaces/" + encodeURIComponent(currentWs.id) + "/members").then(function(list){
    wsMembersCache = list || [];
    refreshOwnerSelect();
  }).catch(function(){});
}
function renderWsMenu(){
  if(!wsListEl) return;
  wsListEl.innerHTML = allWorkspaces.map(function(w){
    var on = currentWs && w.id === currentWs.id;
    return '<button class="ws-item' + (on ? " on" : "") + '" type="button" data-ws="' + esc(w.id) + '" data-ws-name="' + esc(w.name) + '">' +
      icon(w.type === "personal" ? "user" : "users", 14) +
      '<span class="ellipsis">' + esc(w.name) + '</span>' +
      '<span class="ws-kind">' + (w.type === "personal" ? "个人" : "共享") + '</span>' +
      (on ? '<span class="ws-check">' + icon("check", 12) + '</span>' : '') +
    '</button>';
  }).join("");
}
wsListEl.addEventListener("click", function(e){
  var b = e.target.closest("[data-ws]");
  if(!b) return;
  var id = b.dataset.ws;
  if(currentWs && id === currentWs.id){ UI.closeAllPops(); return; }
  var name = b.dataset.wsName || wsNameById(id);
  UI.closeAllPops();
  /* 切空间会 reload：先确认，避免误点后丢掉当前筛选与未保存的编辑 */
  askSwitchWorkspace(id, name);
});
wsSwitchBtn.addEventListener("click", function(){
  if(UI.popOpen(wsMenuEl)){ UI.closeAllPops(); return; }
  UI.openPop(wsMenuEl, wsSwitchBtn, {align:"left", width:232});
});
$("btnWsCreate").addEventListener("click", function(){
  UI.closeAllPops();
  $("dlgWsName").value = "";
  $("fDlgWsName").classList.remove("invalid");
  UI.openModal($("dlgWsCreate"));
});
$("btnWsSettings").addEventListener("click", function(){
  UI.closeAllPops();
  showView("settings");
});
$("dlgWsCreateForm").addEventListener("submit", function(e){
  e.preventDefault();
  var name = $("dlgWsName").value.trim();
  if(!name){ $("fDlgWsName").classList.add("invalid"); return; }
  if(name.length > 20) name = name.slice(0, 20);
  var btn = $("dlgWsCreateOk");
  btn.disabled = true;
  API.post("/api/workspaces", { name: name }).then(function(){
    btn.disabled = false;
    UI.closeModal($("dlgWsCreate"));
    toast("已创建空间「" + name + "」", "fs");
    loadWorkspaces(currentUser).then(function(){
      loadBoard({animate:true});
      loadReqs();
    });
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "创建失败", "bad");
  });
});
function loadMe(){
  API.get("/api/auth/me").then(function(u){
    currentUser = u;
    if(u.displayName) OWNER_DEFAULT = u.displayName;
    var navAU = $("navAdminUsers");
    if(navAU) navAU.hidden = u.role !== "admin";
    if(u.role !== "admin" && activeView === "users" && userListEl){
      userListEl.innerHTML = '<div class="foot-note">仅管理员可访问用户管理</div>';
    }
    renderSideUser(u);
    /* me 回来了：把等它的视图初始化补跑一遍（深链直达 #/profile 时靠这个） */
    flushMeReady();
    return loadWorkspaces(u);
  }).catch(function(){ /* 未登录由 api.js 统一跳转 */ });
}
function renderSideUser(u){
  var name = (u && (u.displayName || u.username)) || "?";
  var av = $("sideUserAv"), nm = $("sideUserName");
  if(av){ av.textContent = initial(name); av.style.setProperty("--a", avatarColor(name)); }
  if(nm) nm.textContent = name;
}
/* ==================== 个人设置（独立页，不再是挤在一起的弹窗） ==================== */

/* 深链直达（#/profile）时 /api/auth/me 可能还没回来，视图拿不到 currentUser。
   把这类"要等当前用户"的初始化排到 me 返回之后再跑，而不是直接 return 留一屏空白。 */
var meReadyCbs = [];
function afterMeReady(fn){
  if(currentUser){ fn(); return; }
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
  if(!currentUser){
    afterMeReady(enterProfileView);
    return;
  }
  var name = currentUser.displayName || currentUser.username || "?";
  if($("meAvatar")){
    $("meAvatar").textContent = initial(name);
    $("meAvatar").style.setProperty("--a", avatarColor(name));
  }
  if($("meName")) $("meName").textContent = name;
  if($("meUsername")) $("meUsername").textContent = "@" + (currentUser.username || "");
  if($("meRoleHint")) $("meRoleHint").textContent = (currentUser.role === "admin") ? "平台管理员" : "普通成员";
  if($("meNameInput")){
    $("meNameInput").value = currentUser.displayName || "";
    $("fMeName").classList.remove("invalid");
  }
  fillMeSelects();
  ["meOldPwd","meNewPwd","meAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.value = ""; });
  ["fMeNewPwd","fMeAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.classList.remove("invalid"); });
  wireMeAnchor();
  updateMePreview();
  /* AI 配置每次进页面都重新拉：可能在别的设备上改过 */
  loadAiConfig();
}

/** 计时设置下拉：上班 0-23 / 下班 1-24（24 = 当天 24:00）/ 每天上限 1-24 小时 */
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
  s.value = String(currentUser.workStartHour == null ? 9 : currentUser.workStartHour);
  e.value = String(currentUser.workEndHour == null ? 18 : currentUser.workEndHour);
  m.value = String(currentUser.workMaxHours == null ? 8 : currentUser.workMaxHours);
}

/** 把当前选择翻成一句人话（时段比上限还短时直接点出来，免得用户以为设了 8 小时就有 8 小时） */
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
  if(!name){ $("fMeName").classList.add("invalid"); toast("请填写显示名", "warn"); return; }
  if(currentUser && name === currentUser.displayName){ toast("显示名没有变化"); return; }
  var btn = $("meNameSave");
  btn.disabled = true;
  API.put("/api/auth/profile", { displayName: name }).then(function(res){
    btn.disabled = false;
    currentUser.displayName = (res && res.displayName) || name;
    OWNER_DEFAULT = currentUser.displayName;
    renderSideUser(currentUser);
    refreshOwnerSelect();
    enterProfileView();
    toast("显示名已更新为「" + currentUser.displayName + "」", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});

["meStart","meEnd","meMax"].forEach(function(id){
  var el = $(id);
  if(el) el.addEventListener("change", updateMePreview);
});

$("meTimerSave") && $("meTimerSave").addEventListener("click", function(){
  if(!currentUser) return;
  var sh = Number($("meStart").value), eh = Number($("meEnd").value), mh = Number($("meMax").value);
  if(eh <= sh){ toast("下班时间要晚于上班时间", "warn"); return; }
  var btn = $("meTimerSave");
  btn.disabled = true;
  API.put("/api/auth/work-hours", { startHour: sh, endHour: eh, maxHours: mh }).then(function(res){
    btn.disabled = false;
    currentUser.workStartHour = res && res.workStartHour != null ? res.workStartHour : sh;
    currentUser.workEndHour = res && res.workEndHour != null ? res.workEndHour : eh;
    currentUser.workMaxHours = res && res.workMaxHours != null ? res.workMaxHours : mh;
    updateMePreview();
    toast("已保存：" + pad2(sh) + ":00–" + pad2(eh) + ":00，每天最多 " + mh + " 小时（只影响之后的计时）", "fs");
    /* 运行中的计时按新口径重算 */
    loadRunningTimer();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});

/* ==================== 个人设置 · AI（走每个人自己的额度） ==================== */
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
  if($("meAiState")){
    $("meAiState").textContent = d.status || "";
    $("meAiState").className = "meta-right" + (d.enabled && d.hasKey ? "" : " muted");
  }
  var p = findAiPreset(sel.value);
  if(p && $("meAiKeyHint")) $("meAiKeyHint").textContent = p.keyHint || "";
}
function aiFormBody(clearKey){
  var key = $("meAiKey") ? $("meAiKey").value.trim() : "";
  return {
    provider: $("meAiProvider").value,
    baseUrl: $("meAiBase").value.trim(),
    model: $("meAiModel").value.trim(),
    apiKey: key,
    clearKey: !!clearKey,
    enabled: $("meAiEnabled").checked
  };
}
function saveAiConfig(clearKey){
  return API.put("/api/ai/config", aiFormBody(clearKey)).then(function(d){
    aiCfg = d;
    renderAiConfig(d);
    return d;
  });
}
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
        $("meAiResult").textContent = "连通正常：模型 " + (r.model || "—")
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
    toast("密码已修改（已登录的设备保持有效，直到会话过期）", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "修改失败", "bad");
  });
});
$("btnLogout").addEventListener("click", function(){
  UI.showConfirm({ title:"退出登录", msg:"确定退出当前账号？", okText:"退出", danger:false }).then(function(ok){
    if(!ok) return;
    API.post("/api/auth/logout", {}).then(function(){
      window.location.href = "/login.html";
    }).catch(function(){ window.location.href = "/login.html"; });
  });
});

/* ==================== 分类数据 ==================== */
var lastCatLoad = 0;
function loadCategories(force){
  if(!force && Date.now() - lastCatLoad < 30000) return Promise.resolve();
  lastCatLoad = Date.now();
  return API.get("/api/categories").then(function(list){
    var next = list || [];
    var changed = JSON.stringify(next) !== JSON.stringify(categoriesCache);
    categoriesCache = next;
    if(changed){
      syncCatSeg();
      if(state.board) render({animate:false});
    }
  }).catch(function(){});
}
function updateTagDatalist(){
  var el = $("tagOptions");
  if(!el || !state.board || !state.board.meta) return;
  el.innerHTML = (state.board.meta.tags || []).map(function(t){
    return '<option value="' + esc(t.name) + '"></option>';
  }).join("");
}
function pruneStaleFilters(meta){
  if(!meta) return false;
  var changed = false;
  var catNames = {};
  (meta.cats || []).forEach(function(c){ catNames[c.name] = 1; });
  var keptCats = state.cats.filter(function(c){ return catNames[c]; });
  if(keptCats.length !== state.cats.length){ state.cats = keptCats; changed = true; }
  var reqIds = {};
  (meta.reqs || []).forEach(function(r){ reqIds[r.id] = 1; });
  var keptReqs = state.reqs.filter(function(v){ return v === "__none" || reqIds[v]; });
  if(keptReqs.length !== state.reqs.length){ state.reqs = keptReqs; changed = true; }
  var tagNames = {};
  (meta.tags || []).forEach(function(t){ tagNames[t.name] = 1; });
  var keptTags = state.tags.filter(function(t){ return tagNames[t]; });
  if(keptTags.length !== state.tags.length){ state.tags = keptTags; changed = true; }
  if(changed) toast("部分筛选条件已失效，已自动清理", "warn");
  return changed;
}

/* ==================== 通用小工具 ==================== */
function triggerDownload(filename, text, mime){
  var blob = new Blob([text], {type: mime || "application/json"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}
function bindRetry(root, fn){
  var b = root.querySelector("[data-empty-action]");
  if(b) b.addEventListener("click", fn);
}
function stripFirst(s, find){
  var i = s.indexOf(find);
  if(i < 0) return s;
  return (s.substring(0, i) + " " + s.substring(i + find.length)).replace(/\s+/g, " ").trim();
}
/* 快速录入解析（!P0 / #项目 / @负责人 / +标签 / %进度 / ~循环 / 日期词） */
var RECUR_LABEL = {daily:"每天", weekly:"每周", monthly:"每月"};
function parseQuickAdd(text){
  var out = { title:"", dueDate:null, priority:null, reqId:null, reqName:null,
              owner:null, ownerUserId:null, tags:[], progress:null, recurType:null,
              invalidDate:null, unmatchedReq:null, unmatchedOwner:null };
  var s = String(text || "");
  var pm = s.match(/[!！](P[0-3])/i);
  if(pm){ out.priority = pm[1].toUpperCase(); s = stripFirst(s, pm[0]); }
  var rm = s.match(/[#＃]([^\s#!，,！＃]+)/);
  if(rm){
    var key = rm[1], hit = null;
    for(var i = 0; i < reqList.length; i++){ if(reqList[i].name === key){ hit = reqList[i]; break; } }
    if(!hit){ for(var j = 0; j < reqList.length; j++){ if(reqList[j].name.indexOf(key) === 0){ hit = reqList[j]; break; } } }
    if(hit){ out.reqId = hit.id; out.reqName = hit.name; s = stripFirst(s, rm[0]); }
    else { out.unmatchedReq = key; }   // O-24：未命中时不静默留在标题里，交给界面提示
  }
  /* 借鉴 #2：@负责人 —— 只匹配空间成员显示名（含自己），未命中同样不吞掉原文 */
  var om = s.match(/[@＠]([^\s@＃#!！+＋%％~～，,]+)/);
  if(om){
    var okey = om[1], ohit = null;
    var cands = ownerOptions();
    for(var oi = 0; oi < cands.length; oi++) if(cands[oi].name === okey){ ohit = cands[oi]; break; }
    if(!ohit) for(var oj = 0; oj < cands.length; oj++) if(cands[oj].name.indexOf(okey) === 0){ ohit = cands[oj]; break; }
    if(ohit){ out.owner = ohit.name; out.ownerUserId = ohit.id || null; s = stripFirst(s, om[0]); }
    else { out.unmatchedOwner = okey; }
  }
  /* 借鉴 #2：+标签（最多 8 个、每个 ≤16 字，与任务标签上限一致） */
  var tagPattern = /[+＋]([^\s+＋＃#!！@＠%％~～，,]+)/g;
  var tm;
  while((tm = tagPattern.exec(s))){
    var tg = tm[1].slice(0, 16);
    if(tg && out.tags.indexOf(tg) === -1 && out.tags.length < 8) out.tags.push(tg);
  }
  if(out.tags.length) s = s.replace(/[+＋][^\s+＋＃#!！@＠%％~～，,]+/g, " ");
  /* 借鉴 #2：%进度 */
  var gm = s.match(/[%％](\d{1,3})(?!\d)/);
  if(gm){
    out.progress = Math.max(0, Math.min(100, Number(gm[1])));
    s = stripFirst(s, gm[0]);
  }
  /* 借鉴 #2：~循环 */
  var cm = s.match(/[~～](每天|每日|每周|每月|daily|weekly|monthly)/i);
  if(cm){
    var rmap = {"每天":"daily","每日":"daily","每周":"weekly","每月":"monthly",
                "daily":"daily","weekly":"weekly","monthly":"monthly"};
    out.recurType = rmap[cm[1].toLowerCase()] || rmap[cm[1]] || null;
    if(out.recurType) s = stripFirst(s, cm[0]);
  }
  var today = startOfDay(new Date());
  var dateVal = null, badDate = null, dm;
  function mkDate(y, m, d){
    var dt = new Date(y, m-1, d);
    return (dt.getFullYear() === y && dt.getMonth() === m-1 && dt.getDate() === d) ? dt : null;
  }
  function take(token, dt){
    if(dt){ dateVal = dt; s = stripFirst(s, token); } else { badDate = token; }
  }
  if((dm = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/))){ take(dm[0], mkDate(Number(dm[1]), Number(dm[2]), Number(dm[3]))); }
  else if((dm = s.match(/(\d{1,2})月(\d{1,2})日?/))){ take(dm[0], mkDate(today.getFullYear(), Number(dm[1]), Number(dm[2]))); }
  else if((dm = s.match(/(\d{1,2})天后/))){ dateVal = addDays(today, Number(dm[1])); s = stripFirst(s, dm[0]); }
  else if((dm = s.match(/(今天|明天|后天)/))){
    var word = dm[1];
    dateVal = word === "今天" ? today : (word === "明天" ? addDays(today, 1) : addDays(today, 2));
    s = stripFirst(s, dm[0]);
  }
  else if((dm = s.match(/(下)?(?:周|星期)([一二三四五六日天])/))){
    var wd = "一二三四五六日".indexOf(dm[2] === "天" ? "日" : dm[2]) + 1;
    if(wd > 0){
      var cur = today.getDay() === 0 ? 7 : today.getDay();
      dateVal = dm[1] ? addDays(today, 7 + wd - cur) : addDays(today, ((wd - cur) + 7) % 7);
      s = stripFirst(s, dm[0]);
    }
  }
  else if((dm = s.match(/(\d{1,2})[-/](\d{1,2})(?!\d)/))){
    var mm = Number(dm[1]), dd = Number(dm[2]);
    if(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) take(dm[0], mkDate(today.getFullYear(), mm, dd));
  }
  if(dateVal) out.dueDate = iso(dateVal);
  out.invalidDate = badDate;
  out.title = s.replace(/\s+/g, " ").trim();
  return out;
}

/* ==================== 顶栏交互 ==================== */
$("btnNew").addEventListener("click", function(){
  if(UI.popOpen($("newMenu"))){ UI.closeAllPops(); return; }
  UI.openPop($("newMenu"), $("btnNew"), {align:"left"});
});
$("newMenu").addEventListener("click", function(e){
  var b = e.target.closest("[data-new]");
  if(!b) return;
  UI.closeAllPops();
  if(b.dataset.new === "task") openTaskDrawer("backlog");
  else showView("projects");
});
$("btnAlert").addEventListener("click", function(){
  if(UI.popOpen($("alertPanel"))){ UI.closeAllPops(); return; }
  renderAlertPanel();     // 先用缓存渲染，避免打开瞬间空白
  loadAlertPanel();
  loadUnread();
  UI.openPop($("alertPanel"), $("btnAlert"), {align:"left"});
});
$("alertPanel").addEventListener("click", function(e){
  /* 顶部 tab：通知 / 截止提醒 */
  var tabBtn = e.target.closest("[data-ap-tab]");
  if(tabBtn){
    var next = tabBtn.dataset.apTab === "due" ? "due" : "notice";
    if(next !== alertTab){
      alertTab = next;
      try{ localStorage.setItem("ds.alertTab", alertTab); }catch(err){ /* 受限环境忽略 */ }
      renderAlertPanel();
      loadAlertPanel();
    }
    return;
  }
  /* 全部标为已读 */
  if(e.target.closest("[data-ap-readall]")){
    API.postGlobal("/api/notifications/read-all").then(function(){
      notifyState.items.forEach(function(x){ if(!x.readAt) x.readAt = new Date().toISOString(); });
      notifyState.unread = 0;
      renderBellBadge(); updateBellTitle(); renderAlertPanel();
      toast("已全部标为已读", "fs");
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
    return;
  }
  /* 通知项：标记已读 + 打开关联任务 */
  var apn = e.target.closest("[data-apn]");
  if(apn){
    UI.closeAllPops();
    openFromNotification(apn.dataset);
    return;
  }
  var t = e.target.closest("[data-ap-task]");
  if(t){
    var task = taskById(t.dataset.apTask);
    UI.closeAllPops();
    if(task) openTaskDrawer(null, task);
    return;
  }
  if(e.target.closest("[data-ap-test]")){
    UI.closeAllPops();
    $("btnNotifyTest").click();
  }
});

/* ==================== SSE 实时同步（§8.3 + O-11） ==================== */
var sse = {conn:null, lastMsg:0, retry:0, timer:null, debounce:null, lastRefresh:0,
  pending:false, pendingEntity:"", disconnectedAt:0};
/* 事件载荷：JSON {"w":空间ID,"t":任务ID,"a":操作人,"c":客户端ID,"e":实体}；旧格式（纯空间ID）继续兼容 */
function parseSseData(raw){
  var out = {ws:"", taskId:"", actor:"", clientId:"", entity:""};
  if(!raw) return out;
  var s = String(raw);
  if(s.charAt(0) === "{"){
    try{
      var o = JSON.parse(s);
      out.ws = o.w || o.workspaceId || "";
      out.taskId = o.t || o.taskId || "";
      out.actor = o.a || o.actorName || "";
      out.clientId = o.c || "";
      out.entity = o.e || "";
      return out;
    }catch(e){ /* 解析失败则落回文本口径 */ }
  }
  out.ws = s;
  return out;
}
function sseHealthy(){
  return !!sse.conn && sse.conn.readyState === 1 && (Date.now() - sse.lastMsg < 60000);
}
function updateSseAlert(){
  var el = $("sseAlert");
  if(!el) return;
  el.hidden = !(Date.now() - sse.lastMsg > 60000);
}
function sseTick(){ sse.lastMsg = Date.now(); updateSseAlert(); }
function sseClose(){
  if(sse.conn){
    try{ sse.conn.close(); }catch(e){ /* noop */ }
    sse.conn = null;
  }
}
function sseScheduleReconnect(){
  if(sse.timer) return;
  var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(sse.retry, 5)));
  sse.retry++;
  sse.timer = setTimeout(function(){ sse.timer = null; sseConnect(); }, delay);
}
function refreshByEntity(entity){
  if(!entity || entity === "all" || entity === "task" || entity === "timer"
      || entity === "column" || entity === "category" || entity === "workspace" || entity === "other"){
    refreshBoardPreserving();
    loadReqs();
    refreshActiveView();
    return;
  }
  if(entity === "req" || entity === "reqdoc"){
    loadReqs();
    refreshActiveView();
    return;
  }
  if(entity === "branch"){
    loadBranches(true).then(renderBranches).catch(function(){ /* 忽略 */ });
    refreshActiveView();
    return;
  }
  refreshActiveView();
}
function onSseChanged(event){
  sseTick();
  var info = parseSseData(event && event.data);
  /* F-NET-1：发起者自己的写请求会收到回声，直接忽略，避免同一操作刷新两遍 */
  if(info.clientId && info.clientId === window.DS_CLIENT_ID) return;
  /* 后台标签页不刷新：只记一笔，切回来时补一次 */
  if(document.hidden){
    sse.pending = true;
    var ent = info.entity || "all";
    /* 后台期间可能收到多种实体：合并成 all，切回时一次全刷，避免漏掉 */
    sse.pendingEntity = (sse.pendingEntity && sse.pendingEntity !== ent) ? "all" : ent;
    return;
  }
  /* R-1：未读角标是跨空间的，且与"是否刷新当前看板"无关，因此放在空间判断之前 */
  loadUnread();
  if(info.ws && window.CURRENT_WORKSPACE && info.ws !== window.CURRENT_WORKSPACE) return;
  /* O-11：抽屉正开着这条任务 → 只给轻提示，不自动刷新、不覆盖未保存草稿 */
  if(taskDrawer.classList.contains("on") && editingId && info.taskId && info.taskId === editingId){
    showDrawerNotice("此任务刚被" + (info.actor ? ("「" + info.actor + "」") : "他人") + "修改，点击刷新查看最新内容");
    return;
  }
  if(sse.debounce) clearTimeout(sse.debounce);
  sse.debounce = setTimeout(function(){
    if(drag || pending) return;
    if(UI.anyDialogOpen()) return;                                  // 弹窗打开时不打扰
    if(taskDrawer.classList.contains("on") && formDirty) return;     // 仅在「有未保存改动」时延迟刷新
    if(Date.now() - sse.lastRefresh < 300) return;
    sse.lastRefresh = Date.now();
    refreshByEntity(info.entity);
  }, 300);
}
function sseConnect(){
  if(!window.EventSource) return;
  sseClose();
  try{ sse.conn = new EventSource("/api/events"); }
  catch(e){ sseScheduleReconnect(); return; }
  sse.conn.addEventListener("changed", onSseChanged);
  sse.conn.addEventListener("ping", sseTick);
  sse.conn.onmessage = sseTick;
  sse.conn.onopen = function(){
    var gap = sse.disconnectedAt ? (Date.now() - sse.disconnectedAt) : 0;
    sse.retry = 0;
    sse.disconnectedAt = 0;
    sseTick();
    /* 断开超过 5 秒：期间的事件可能已经丢了，重连后补拉一次 */
    if(gap > 5000 && !document.hidden) refreshByEntity("all");
  };
  sse.conn.onerror = function(){
    if(!sse.disconnectedAt) sse.disconnectedAt = Date.now();
    sseClose();
    updateSseAlert();
    sseScheduleReconnect();
  };
}
function initSSE(){
  if(!window.EventSource) return;
  sse.lastMsg = Date.now();
  sseConnect();
  setInterval(function(){
    updateSseAlert();
    if(!sse.conn){ sseScheduleReconnect(); return; }
    if(Date.now() - sse.lastMsg > 60000){ sseClose(); sseScheduleReconnect(); }
  }, 5000);
}

/* ==================== 轮询兜底 / 跨零点 ==================== */
function refreshIfDayChanged(){
  if(iso(startOfDay(new Date())) !== TODAY_ISO){
    TODAY = startOfDay(new Date());
    TODAY_ISO = iso(TODAY);
    loadBoard({animate:false});
    return true;
  }
  return false;
}
var pollTick = 0;
setInterval(function(){
  if(document.hidden) return;
  if(drag || pending) return;
  if(UI.anyDialogOpen()) return;
  if(taskDrawer.classList.contains("on") && formDirty) return;
  pollTick++;
  /* SSE 健康时不做数据轮询：事件驱动已经够用，只保留跨零点检查 */
  if(sseHealthy()){ refreshIfDayChanged(); return; }
  if(refreshIfDayChanged()) return;
  refreshBoardPreserving();
  loadReqs();
  refreshActiveView();
}, 30000);
document.addEventListener("visibilitychange", function(){
  if(document.hidden) return;
  if(UI.anyDialogOpen() || drag || pending) return;
  if(taskDrawer.classList.contains("on") && formDirty) return;
  if(refreshIfDayChanged()) return;
  /* 后台期间收到的变更在切回来时补一次 */
  if(sse.pending){
    var ent = sse.pendingEntity;
    sse.pending = false;
    sse.pendingEntity = "";
    loadUnread();
    refreshByEntity(ent);
    return;
  }
  refreshBoardPreserving();
});

/* ==================== 快捷键（§8.1） ==================== */
function inEditable(el){
  if(!el) return false;
  var tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
function focusedCard(){
  var el = document.activeElement;
  return (el && el.classList && el.classList.contains("card")) ? el : null;
}
function focusedRow(){
  var el = document.activeElement;
  return (el && el.classList && el.classList.contains("list-row")) ? el : null;
}
function moveTaskCol(t, delta){
  var idx = COL_INDEX[t.boardColumn] + delta;
  if(idx < 0 || idx >= COLUMNS.length) return;
  API.post("/api/tasks/" + encodeURIComponent(t.id) + "/move", {column: COLUMNS[idx].id}).then(function(res){
    toast("「" + res.task.title + "」移动到「" + colName(res.to) + "」" +
      (res.autoTimerStarted ? " · 已开始计时" : ""));
    if(activeView === "list") loadList(); else loadBoard({animate:false, movedId: t.id});
    loadReqs();
  }).catch(function(ex){ toast("移动失败：" + (ex.message || "网络异常"), "bad"); });
}
document.addEventListener("keydown", function(e){
  if(e.isComposing || e.keyCode === 229) return;
  var mod = e.ctrlKey || e.metaKey;

  /* Esc：逐层关闭（优先级：拖拽 > 确认框 > Popover > 抽屉 > 弹窗 > 内联输入 > 搜索） */
  if(e.key === "Escape"){
    if(drag){ cancelDrag(); return; }
    if(ganttState.drag){ onGanttDragCancel(); return; }
    if(ganttState.unplannedDrag){ onGanttUnplannedCancel(); return; }
    if(ganttState.depDrag){ cleanupGanttLink(); return; }
    if(UI.confirmOpen()){ UI.settleConfirm(false); return; }
    if(document.querySelector(".menu:not([hidden]),.ws-menu:not([hidden])")){ UI.closeAllPops(); return; }
    if(taskDrawer.classList.contains("on")){ tryCloseTaskDrawer(); return; }
    if(UI.closeTopModal()) return;
    var inline = board.querySelector(".card-add-input");
    if(inline){
      var restore = inline._restore;
      state.inlineAdd = null;
      if(restore) inline.replaceWith(restore);
      return;
    }
    if(document.activeElement === searchInput) searchInput.blur();
    return;
  }

  /* Ctrl/⌘ + Z：甘特图改期多步撤销（输入框 / 抽屉 / 弹窗内不抢） */
  if(mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && activeView === "gantt" &&
     !inEditable(e.target) && !taskDrawer.classList.contains("on") &&
     !UI.anyModalOpen() && !ganttState.drag && !ganttState.unplannedDrag){
    e.preventDefault();
    ganttUndoLast();
    return;
  }

  /* Ctrl/⌘ + K 或 / ：聚焦全局搜索 */
  if((mod && (e.key === "k" || e.key === "K")) || (e.key === "/" && !inEditable(e.target))){
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  /* Ctrl/⌘ + B 或 Ctrl/⌘ + \ ：侧边栏收起切换
     注意：在输入框 / 富文本编辑器里**不抢 B** —— 那里 Ctrl+B 是"加粗"，交给浏览器原生处理。
     这是一个真实踩过的坑：编辑器里按 Ctrl+B 结果侧边栏收起来了。 */
  if(mod && (e.key === "\\" || ((e.key === "b" || e.key === "B") && !inEditable(e.target)))){
    e.preventDefault();
    toggleRail();
    return;
  }
  /* Ctrl/⌘ + Enter：保存当前表单 */
  if(mod && e.key === "Enter"){
    if(taskDrawer.classList.contains("on")){
      e.preventDefault();
      if(!btnSaveTask.disabled) taskForm.dispatchEvent(new Event("submit", {cancelable:true, bubbles:true}));
      return;
    }
    var openForm = document.querySelector(".modal-layer.open form");
    if(openForm){
      e.preventDefault();
      openForm.dispatchEvent(new Event("submit", {cancelable:true, bubbles:true}));
      return;
    }
  }

  if(inEditable(e.target) || UI.anyModalOpen()) return;

  var card = focusedCard();
  var row = focusedRow();

  /* ← / → 移动所在列（卡片或列表行聚焦时） */
  if(e.key === "ArrowLeft" || e.key === "ArrowRight"){
    var target = card ? taskById(card.dataset.id) : (row ? listCache[row.dataset.listId] : null);
    if(!target) return;
    e.preventDefault();
    moveTaskCol(target, e.key === "ArrowRight" ? 1 : -1);
    return;
  }
  /* ↑ / ↓ 卡片之间移动焦点 */
  if(card && (e.key === "ArrowUp" || e.key === "ArrowDown")){
    e.preventDefault();
    var all = Array.prototype.slice.call(board.querySelectorAll(".card"));
    var i = all.indexOf(card);
    var next = all[i + (e.key === "ArrowDown" ? 1 : -1)];
    if(next){
      next.focus();
      if(next.scrollIntoView) next.scrollIntoView({block:"nearest"});
    }
    return;
  }
  /* 卡片聚焦时的操作（列表行同样支持，O-5 O-6） */
  var kt = card ? taskById(card.dataset.id) : (row ? listCache[row.dataset.listId] : null);
  if(card || row){
    if(e.key === " " || e.key === "Spacebar"){
      e.preventDefault();
      if(kt) openTaskDrawer(null, kt);
      return;
    }
    if(e.key === "d" || e.key === "D"){
      e.preventDefault();
      if(kt) openDuePopover(card || row, kt.id);
      return;
    }
    if(e.key === "x" || e.key === "X"){
      e.preventDefault();
      if(kt) toggleTaskDone(kt.id);
      return;
    }
    if(e.key === "Delete"){
      e.preventDefault();
      if(kt) deleteTask(kt.id);
      return;
    }
    if(e.key >= "1" && e.key <= "4"){
      e.preventDefault();
      if(!kt) return;
      var pri = "P" + (Number(e.key) - 1);
      API.put("/api/tasks/" + encodeURIComponent(kt.id), taskPayloadWith(kt, {priority: pri})).then(function(){
        toast("已设为 " + pri, "fs");
        loadBoard({silent:true});
        refreshListIfOpen();
      }).catch(function(ex){ toast(ex.message || "更新失败", "bad"); });
      return;
    }
    if(card && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      e.preventDefault();
      var all = Array.prototype.slice.call(board.querySelectorAll(".card"));
      var i = all.indexOf(card);
      var next = all[i + (e.key === "ArrowDown" ? 1 : -1)];
      if(next){
        next.focus();
        if(next.scrollIntoView) next.scrollIntoView({block:"nearest"});
      }
      return;
    }
  }

  /* N：聚焦快速录入（看板列内新增） */
  if(!mod && !e.altKey && (e.key === "n" || e.key === "N")){
    e.preventDefault();
    var colId = "backlog";
    if(card){
      var colEl = card.closest(".board-col");
      if(colEl) colId = colEl.dataset.col;
    }
    if(activeView !== "board"){ showView("board"); }
    setTimeout(function(){
      state.inlineAdd = {col: colId, value: ""};
      openInlineAdd(colId, "");
    }, 40);
    return;
  }
  /* C：新建任务抽屉 */
  if(!mod && !e.altKey && (e.key === "c" || e.key === "C")){
    e.preventDefault();
    openTaskDrawer("backlog");
    return;
  }
  /* T：日历回到今天 */
  if(!mod && !e.altKey && (e.key === "t" || e.key === "T")){
    if(activeView === "calendar"){ e.preventDefault(); $("calToday").click(); }
    return;
  }
});
/* 快捷编辑（改期 / 快捷键改优先级 / 批量改字段）走的是 PUT 全量更新，
   必须把任务的全部可编辑字段带上；漏一个字段，后端就会把它写成 null。
   关联需求、所属分支、预估工时曾经就是这样被快捷编辑悄悄清空的。 */
function taskPayloadWith(t, patch){
  var p = {
    title: t.title,
    description: t.description || "",
    priority: t.priority,
    category: t.category || null,
    owner: t.owner || null,
    ownerUserId: t.ownerUserId || null,
    boardColumn: t.boardColumn,
    startDate: t.startDate || null,
    dueDate: t.dueDate || null,
    reqId: t.reqId || null,
    reqDocId: t.reqDocId || null,
    branchId: t.branchId || null,
    progress: Number(t.progress) || 0,
    isMilestone: !!t.isMilestone,
    estimateMinutes: t.estimateMinutes == null ? null : Number(t.estimateMinutes),
    note: t.note || "",
    recurType: t.recurType || "",
    remindAt: t.remindAt || null,
    remindTarget: t.remindTarget || "owner",
    blocked: !!t.blocked,
    blockedReason: t.blockedReason || null,
    blockedByTaskId: t.blockedByTaskId || null,
    tags: t.tags || []
  };
  for(var k in patch) if(Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
  return p;
}

/* ==================== 启动 ==================== */
function boot(){
  function autoRail(){
    var w = window.innerWidth;
    var saved = null;
    try{ saved = localStorage.getItem("ds.rail"); }catch(e){ saved = null; }
    /* 用户手动点过（或按过 Ctrl+B）就听用户的，别让窗口宽度去覆盖他的选择；
       没选过才按宽度自适应：窄屏默认收起，宽屏展开。
       原来这里只读一次 savedRail 并按真值判断，导致"手动展开后一 resize 又被收起"。 */
    if(saved === "1"){ document.body.classList.add("side-rail"); return; }
    if(saved === "0"){ document.body.classList.remove("side-rail"); return; }
    if(w < 1440) document.body.classList.add("side-rail");
    else document.body.classList.remove("side-rail");
  }
  autoRail();
  window.addEventListener("resize", autoRail);

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  $("kbdMod").textContent = isMac ? "⌘" : "Ctrl";
  initTheme();

  buildFormControls();
  syncFormSegs();
  syncProgVal();
  renderTagChips();
  UI.wireTooltips(document);

  var deepTaskId = hashParam("task");   // 必须在任何 hash 改写之前抓取（O-3）
  var startView = viewFromHash();
  try{
    var saved = localStorage.getItem("ds.view");
    if(!window.location.hash && saved && VIEWS[saved]) startView = saved;
  }catch(e){ /* noop */ }
  try{ history.replaceState(null, "", "#/" + startView); }
  catch(e){ /* file:// 等受限环境：跳过，不影响功能 */ }
  showView(startView);

  /* O-21：快捷键面板首次登录自动展开一次，之后尊重用户的折叠状态。
     注意 localStorage 在 file:// / 隐私模式下会抛错，因此把"读写 localStorage"与"DOM 展开"分开，
     避免读失败连带跳过展开。 */
  try{
    var kbdSeen = null;
    try{ kbdSeen = localStorage.getItem("ds.kbdSeen"); }catch(e2){ kbdSeen = null; }
    if(kbdSeen !== "1"){
      var ks = $("kbdSect");
      if(ks && ks.classList.contains("collapsed")){
        ks.classList.remove("collapsed");
        var kh = ks.querySelector(".drawer-sect-head");
        if(kh) kh.setAttribute("aria-expanded", "true");
      }
      try{ localStorage.setItem("ds.kbdSeen", "1"); }catch(e3){ /* 受限环境：忽略 */ }
    }
  }catch(e){ /* noop */ }

  showBoardSkeleton();
  loadBoard({animate:true}).then(function(){
    /* O-3：深链任务；跨空间时（从「我的任务」切过来）用 sessionStorage 接力 */
    var pendingTask = deepTaskId;
    if(!pendingTask){
      try{
        pendingTask = sessionStorage.getItem("ds.openTask") || "";
        if(pendingTask) sessionStorage.removeItem("ds.openTask");
      }catch(e){ pendingTask = ""; }
    }
    if(pendingTask) openTaskById(pendingTask);
  });
  loadReqs();
  loadBranches();
  loadViews();
  loadMe();
  initSSE();
  /* R-1：未读角标。SSE 之外再兜一层低频轮询，SSE 断连时也能拿到新通知 */
  loadUnread(true);
  setInterval(function(){
    if(document.hidden) return;
    loadUnread();
  }, 60000);

  /* O-4：注册 Service Worker（离线只读：静态壳可离线打开，/api/ 永不缓存） */
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw.js").catch(function(){ /* http 直连不支持 SW，忽略 */ });
    });
  }
  updateOnlineBadge();
  window.addEventListener("online", updateOnlineBadge);
  window.addEventListener("offline", updateOnlineBadge);
}
function updateOnlineBadge(){
  if(!offlineBadge) return;
  offlineBadge.hidden = navigator.onLine !== false;
}
/* 已打开的页面里粘贴深链（hash 变化）也要能定位 */
window.addEventListener("hashchange", function(){ handleDeepLink(); });
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

})();
