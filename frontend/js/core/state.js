/* core/state · 全局可变状态（跨视图共享的写入统一走 rt） */

import { esc } from "./ui.js";
import { CAT_DEFAULT_COLOR, COLUMNS, dayDiff, fmtFull, fmtShortMD, iso, parseDate, startOfDay, weekdayCN } from "../lib/format.js";

/* 跨视图共享的可变状态：import 绑定只读，写入一律走 rt */
export const rt = {};
rt.TODAY = startOfDay(new Date());
rt.TODAY_ISO = iso(rt.TODAY);
rt.OWNER_DEFAULT = "我";
rt.categoriesCache = [];
rt.reqList = [];
/* 项目集（可选归组）：项目列表分组与项目表单下拉共用；只在项目视图加载 */
rt.projectSets = [];
rt.reqsLoaded = false;
rt.formReqStatus = "active";
rt.editingReqId = null;
rt.formPri = "P2";
rt.formCat = "";
rt.formRecur = "";
rt.tagsCache = [];
rt.editingId = null;
rt.taskFormSeq = 0;
rt.formDirty = false;
rt.drawerOnClose = null;
rt.resetArmed = null;
rt.suppressClickUntil = 0;
rt.currentUser = null;
rt.currentWs = null;
rt.allWorkspaces = [];
rt.wsMembersCache = [];
rt.savedViews = [];
rt.inviteCache = [];
rt.colDefsCache = [];
rt.doneColDef = null;
rt.settingsReady = false;
rt.subtasksCache = [];
rt.listCache = {};
rt.listSeq = 0;
rt.listSelected = {};
rt.listTotal = 0;
rt.reviewSeq = 0;
rt.reviewTarget = null;
rt.analysisTab = "stats";
rt.boardDirty = false;
rt.notifyInfo = null;
rt.pickedChannel = "";
rt.commentSending = false;
rt.alertTab = "notice";

var state = {
  q:"", owners:[], testOwners:[], pris:[], cats:[], reqs:[], tags:[], types:[], versions:[], columns:[],
  completion:"", pubState:null, due:null, focus:false, doneScope:"week", blocked:false,
  noDue:false, dueFrom:null, dueTo:null, startFrom:null, startTo:null,
  board:null, loadSeq:0, boardGen:0,
  reviewData:null, statsWeeks:8, flowDays:90, workScope:"mine", reviewWork:null,
  mineSpace:"", mineGroup:"due", mineSubgroup:"none", mineSort:"default",
  collapsedCols:{}, inlineAdd:null,
  runningTimer:null, compMonth:null, reqDocId:null
};
var taskCacheExtra = {};
var calState = {year:null, month:null, tasks:[], selected:null, seq:0, showDone:{}};
function safeColor(c){
  return /^#[0-9a-f]{6}$/i.test(String(c == null ? "" : c)) ? c : CAT_DEFAULT_COLOR;
}
function catColor(id){
  for(var i = 0; i < rt.categoriesCache.length; i++){
    if(rt.categoriesCache[i].id === id) return safeColor(rt.categoriesCache[i].color);
  }
  return CAT_DEFAULT_COLOR;
}
/** 分类ID→名称（实时实体只存 ID，展示前先查缓存） */
function catNameById(id){
  for(var i = 0; i < rt.categoriesCache.length; i++){
    if(rt.categoriesCache[i].id === id) return rt.categoriesCache[i].name;
  }
  return "";
}
/** 分类ID→彩色标签；未分类/已删分类返回空串。
    颜色通过 CSS 变量交给样式层派生，浅/深主题各自保证对比度，避免在 JS 里压暗成脏色 */
function catTag(id){
  var name = catNameById(id);
  if(!name) return "";
  return '<span class="tag tag-cat" title="' + esc(name) + '" style="--tag-c:' + catColor(id) + '">' +
    '<i class="dot"></i><span class="tag-txt">' + esc(name) + '</span></span>';
}
/** 直接吃名称的标签：完成快照等历史值没有 ID，只有完成当时的名称 */
function catTagByName(name){
  if(!name) return "";
  var color = CAT_DEFAULT_COLOR;
  for(var i = 0; i < rt.categoriesCache.length; i++){
    if(rt.categoriesCache[i].name === name){ color = safeColor(rt.categoriesCache[i].color); break; }
  }
  return '<span class="tag tag-cat" title="' + esc(name) + '" style="--tag-c:' + color + '">' +
    '<i class="dot"></i><span class="tag-txt">' + esc(name) + '</span></span>';
}
function tagChip(name){
  return '<span class="tag tag-ghost">' + esc(name) + '</span>';
}
/* 进度优先派生：有子任务（检查项）时按完成比自动计算，没有子任务才用手动值。
   已完成一律 100%。历史手动值仍保存在 progress 字段，不被改写。 */
function progressOf(t){
  if(t.boardColumn === "done") return 100;
  var total = Number(t.subtaskTotal) || 0;
  if(total > 0){
    var done = Math.max(0, Math.min(total, Number(t.subtaskDone) || 0));
    return Math.round(done / total * 100);
  }
  return Number(t.progress) || 0;
}
/** 列的有效处理规则：查的是任务当前列时优先任务自带值（跨空间「我的任务」），
    查目标列（如抽屉里改列预览）时必须回落到列定义，否则会拿旧列规则判断新列 */
function colRuleOf(id, task){
  if(task && task.processingRule && (!task.boardColumn || !id || task.boardColumn === id)) return task.processingRule;
  if(!id) return "normal";
  /* 终态「已取消」不落列配置：固定为 canceled，计时与逾期都按不生效处理 */
  if(id === "canceled") return "canceled";
  for(var i = 0; i < COLUMNS.length; i++){
    var c = COLUMNS[i];
    if(c.id === id && c.processingRule) return c.processingRule;
  }
  for(var j = 0; j < rt.colDefsCache.length; j++){
    var d = rt.colDefsCache[j];
    if(d.id === id) return d.processingRule || "normal";
  }
  return "normal";
}
/** 统计分桶：与后端 TaskCalc.statusBucket 同口径（待处理列/等待接续→backlog，执行结束→ended，已完成→done，其余→doing） */
function statusBucket(t){
  if(!t) return "backlog";
  if(t.boardColumn === "done") return "done";
  if(t.boardColumn === "backlog") return "backlog";
  var rule = colRuleOf(t.boardColumn, t);
  if(rule === "waiting") return "backlog";
  if(rule === "ended") return "ended";
  return "doing";
}
function timerAllowed(t){
  if(!t) return false;
  /* 阻塞任务停表不换列 */
  if(t.blocked) return false;
  var col = t.boardColumn;
  if(col === "backlog" || col === "done" || col === "canceled") return false;
  /* 只有「正常计时」列可计时；暂停/结束计时列由后端同样拒绝，前端不再显示计时入口 */
  return colRuleOf(col, t) === "normal";
}
function dueState(t){
  if(!t.dueDate) return {kind:"none"};
  if(t.boardColumn === "done") return {kind:"done"};
  /* 终态不计逾期：已取消只显示取消事实，不再倒计时 */
  if(t.boardColumn === "canceled") return {kind:"canceled"};
  if(colRuleOf(t.boardColumn, t) === "ended") return {kind:"ended"};
  var d = dayDiff(parseDate(t.dueDate), rt.TODAY);
  if(d < 0)   return {kind:"over", n:Math.abs(d)};
  if(d === 0) return {kind:"today", n:0};
  if(d <= 3)  return {kind:"soon", n:d};
  return {kind:"ok", n:d};
}
function dueText(t){
  var s = dueState(t);
  if(s.kind === "none")  return "未设截止";
  if(s.kind === "done")  return "已完成 " + fmtShortMD(parseDate(t.completedAt || t.dueDate));
  if(s.kind === "ended") return "执行结束";
  if(s.kind === "canceled") return "已取消（不计逾期）";
  if(s.kind === "over")  return "逾期 " + s.n + " 天";
  if(s.kind === "today") return "今天到期";
  if(s.kind === "soon")  return "剩余 " + s.n + " 天";
  return fmtShortMD(parseDate(t.dueDate));
}
/* 日期列统一 MM-DD；相对日期另做徽标，避免同一列混排「今天 / 11-12 / 逾期 3 天」 */
function dueDateMD(t){
  if(!t || !t.dueDate) return "";
  var d = parseDate(t.boardColumn === "done" ? (t.completedAt || t.dueDate) : t.dueDate);
  return fmtShortMD(d);
}
function dueDateTip(t){
  if(!t || !t.dueDate) return "";
  var done = t.boardColumn === "done";
  var d = parseDate(done ? (t.completedAt || t.dueDate) : t.dueDate);
  if(!d) return "";
  return (done ? "完成于 " : "截止 ") + fmtFull(d) + " " + weekdayCN(d);
}
/* 相对日期只用于 7 天内；逾期与临期改由状态位徽标表达 */
function dueFlag(t){
  if(!t || !t.dueDate) return null;
  var s = dueState(t);
  if(s.kind === "done" || s.kind === "ended" || s.kind === "canceled" || s.kind === "none") return null;
  var d = dayDiff(parseDate(t.dueDate), rt.TODAY);
  if(d < 0) return { kind:"over", text:"逾期 " + Math.abs(d) + " 天" };
  if(d === 0) return { kind:"today", text:"今天到期" };
  if(d <= 7) return { kind:"soon", text:"剩余 " + d + " 天" };
  return null;
}
function dueMetaClass(kind){
  if(kind === "over") return "meta over";
  if(kind === "today") return "meta today";
  if(kind === "done") return "meta full";
  return "meta ok";
}
function filterOn(){
  return !!(state.q || state.owners.length || state.testOwners.length || state.pris.length || state.cats.length
    || state.reqs.length || state.tags.length || state.types.length || state.versions.length
    || state.columns.length || state.completion
    || state.pubState
    || state.due || state.focus || state.blocked || state.noDue
    || state.dueFrom || state.dueTo || state.startFrom || state.startTo);
}
function selectedFilterCount(){
  var n = 0;
  if(state.q) n++;
  n += state.owners.length + state.testOwners.length + state.pris.length + state.cats.length + state.reqs.length + state.tags.length + state.types.length + state.versions.length + state.columns.length;
  if(state.completion) n++;
  if(state.pubState) n++;
  if(state.due) n++;
  if(state.focus) n++;
  if(state.blocked) n++;
  if(state.noDue) n++;
  if(state.dueFrom || state.dueTo) n++;
  if(state.startFrom || state.startTo) n++;
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
  }
  return rt.listCache[id] || taskCacheExtra[id] || null;
}
function reqNameById(id){
  if(!id) return "无";
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === id) return rt.reqList[i].name;
  return "无";
}
/** 项目集 ID→名称：优先项目集缓存，缓存未就绪时回退项目自带的 setName 快照 */
function setNameById(id){
  if(!id) return "";
  for(var i = 0; i < (rt.projectSets || []).length; i++) if(rt.projectSets[i].id === id) return rt.projectSets[i].name;
  for(var j = 0; j < rt.reqList.length; j++) if(rt.reqList[j].setId === id) return rt.reqList[j].setName || "";
  return "";
}
/** 项目所属项目集：任务只带 reqId，分组到项目集时经项目缓存换算 */
function reqSetId(reqId){
  if(!reqId) return "";
  for(var i = 0; i < rt.reqList.length; i++) if(rt.reqList[i].id === reqId) return rt.reqList[i].setId || "";
  return "";
}
function setSortOf(id){
  for(var i = 0; i < (rt.projectSets || []).length; i++){
    if(rt.projectSets[i].id === id) return Number(rt.projectSets[i].sortOrder) || 0;
  }
  return 9999;
}
/** 项目层级：项目集在前（按 sortOrder），集内容器项目排最后，未分组垫底 */
function projectGroups(list){
  var rows = list || [];
  var buckets = {};
  rows.forEach(function(r){
    var key = r.setId || "";
    (buckets[key] = buckets[key] || []).push(r);
  });
  var sets = (rt.projectSets || []).slice().sort(function(a, b){
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
      || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN");
  });
  var known = {};
  sets.forEach(function(s){ known[s.id] = 1; });
  /* 项目已带集 ID、但项目集接口失败或迟到：按项目自带 setName 兜底成组，不能退化成平铺 */
  Object.keys(buckets).forEach(function(key){
    if(key && !known[key]){
      sets.push({ id:key, name:(buckets[key][0].setName || "未命名项目集"), sortOrder:9999 });
      known[key] = 1;
    }
  });
  var groups = [];
  sets.forEach(function(s){
    var items = buckets[s.id] || [];
    if(!items.length) return;
    groups.push({ set:s, rows:items.slice().sort(function(a, b){
      return (a.containerKind ? 1 : 0) - (b.containerKind ? 1 : 0);
    }) });
  });
  var loose = buckets[""] || [];
  if(loose.length) groups.push({ set:null, rows:loose });
  return groups;
}
/* 外部清单（助手可写项目、看板 meta、版本清单）只带 ID 与名称：
   按 ID 从项目缓存补齐 setId / setName / 容器与归档标记，才能参与项目集分组。
   不新增、不删减候选，只补字段。 */
function projectRefsEnriched(list){
  var byId = {};
  (rt.reqList || []).forEach(function(r){ byId[r.id] = r; });
  return (list || []).map(function(p){
    var src = byId[p.id];
    if(!src) return p;
    var out = {};
    for(var k in p) out[k] = p[k];
    if(out.setId == null) out.setId = src.setId || "";
    if(out.setName == null) out.setName = src.setName || "";
    if(out.containerKind == null) out.containerKind = src.containerKind;
    if(out.archivedAt == null) out.archivedAt = src.archivedAt;
    return out;
  });
}
function projectOptionHTML(r, selected){
  var marks = [];
  if(r.containerKind) marks.push("公共");
  if(r.archivedAt) marks.push("已归档");
  return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(selected || "") ? " selected" : "") +
    ' data-level="2">　' + esc(r.name) + (marks.length ? "（" + esc(marks.join(" · ")) + "）" : "") + '</option>';
}
/** 项目集分组标题：带上组内项目数，原生下拉与自定义菜单共用同一口径 */
function projectGroupLabel(g){
  if(!g.set) return "未分组";
  return g.set.name + "（" + g.rows.length + " 个项目）";
}
/** 项目下拉层级 HTML：集为 optgroup、项目二级缩进；调用方自行补「全部/未指定」首项 */
function projectOptionsHTML(list, selected){
  var groups = projectGroups(list);
  var grouped = groups.length > 1 || (groups.length === 1 && groups[0].set);
  if(!grouped){
    return (list || []).map(function(r){
      return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(selected || "") ? " selected" : "") +
        '>' + esc(r.name) + (r.containerKind ? "（公共）" : "") + (r.archivedAt ? "（已归档）" : "") + '</option>';
    }).join("");
  }
  return groups.map(function(g){
    return '<optgroup label="' + esc(projectGroupLabel(g)) + '">' +
      g.rows.map(function(r){ return projectOptionHTML(r, selected); }).join("") + '</optgroup>';
  }).join("");
}

/* ---- 项目级写权限：与后端 ProjectAccessService 同口径 ---- */
function currentRole(){
  return rt.currentWs && rt.currentWs.myRole ? rt.currentWs.myRole : "";
}
/** 查看者全局只读；其余角色按项目判定 */
function roleReadOnly(){
  return currentRole() === "viewer";
}
/**
 * write / read。判定顺序：查看者 → 空间主/管理员 → 空间下发的 projectAccess
 * → 已加载的 reqList.access；无法判定时按可写，避免误伤默认参与的项目。
 */
function projectAccess(reqId){
  if(roleReadOnly()) return "read";
  var role = currentRole();
  if(role === "owner" || role === "admin") return "write";
  if(reqId){
    var map = rt.currentWs && rt.currentWs.projectAccess;
    if(map && map[reqId]){
      /* none 的项目本应被列表过滤；万一漏到前端也按只读处理，不能按可写放行 */
      return map[reqId] === "read" || map[reqId] === "none" ? "read" : "write";
    }
    for(var i = 0; i < rt.reqList.length; i++){
      if(rt.reqList[i].id === reqId && rt.reqList[i].access === "read") return "read";
    }
  }
  return "write";
}
function canEditReq(reqId){
  return projectAccess(reqId) === "write";
}
/** 项目设置类操作（分类维护等）：空间主/管理员，或项目负责人；仍需具备项目写权限 */
function canManageProject(reqId, ownerUserId){
  if(projectAccess(reqId) !== "write") return false;
  var role = currentRole();
  if(role === "owner" || role === "admin") return true;
  var owner = ownerUserId;
  if(!owner && reqId){
    for(var i = 0; i < rt.reqList.length; i++){
      if(rt.reqList[i].id === reqId){ owner = rt.reqList[i].ownerUserId; break; }
    }
  }
  var me = rt.currentUser && rt.currentUser.id;
  return !!(owner && me && String(owner) === String(me));
}
function canEditTask(t){
  if(!t) return false;
  /* 跨空间「我的任务」由后端逐条下发 write/read，优先采用（rt.currentWs 未必是任务所属空间） */
  if(t.access === "write" || t.access === "read") return t.access === "write";
  return projectAccess(t.reqId) === "write";
}
/**
 * 文档改删（A 创建人保护）：项目/空间可写 + （负责人本人 或 空间主/管理员 或 无负责人回退）。
 * 与后端 assertDocMutate 同口径。排序拖动 / 新建子文档仍用 canEditReq（组织/新增，不改父文档）。
 */
function canEditDoc(d){
  if(!d) return false;
  if(!canEditReq(d.reqId)) return false;
  var role = currentRole();
  if(role === "owner" || role === "admin") return true;
  var owner = d.ownerUserId;
  if(!owner) return true;
  var me = rt.currentUser && rt.currentUser.id;
  return !!(me && String(owner) === String(me));
}

export { calState, canEditDoc, canEditReq, canEditTask, canManageProject, catColor, catNameById, catTag, catTagByName, colRuleOf, currentRole, dueDateMD, dueDateTip, dueFlag, dueMetaClass, dueState, dueText, filterOn, progressOf, projectAccess, projectGroupLabel, projectGroups, projectOptionsHTML, projectRefsEnriched, reqNameById, reqSetId, roleReadOnly, safeColor, selectedFilterCount, setNameById, setSortOf, state, statusBucket, tagChip, taskById, taskCacheExtra, timerAllowed, totalTaskCount };
