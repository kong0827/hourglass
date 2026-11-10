/* lib/format · 日期、格式化、颜色与只读派生（无 DOM、无请求） */

import { rt } from "../core/state.js";
import { esc } from "../core/ui.js";
import { GS } from "./gantt-shared.js";

var COLUMNS = [
  {id:"backlog", name:"待处理", color:"#98A2B3", processingRule:"backlog"},
  {id:"doing",   name:"进行中", color:"#2E90FA", processingRule:"normal"},
  {id:"test",    name:"待测试", color:"#8b6fb5", processingRule:"waiting"},
  {id:"testing", name:"测试中", color:"#b06f9a", processingRule:"normal"},
  {id:"done",    name:"已完成", color:"#12B76A", processingRule:"done", done:true}
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
    /* processingRule 决定计时与逾期口径，必须随列定义一起缓存，否则前端只能按 normal 兜底 */
    COLUMNS.push({ id:d.id, name:d.name, color:d.color || "#98A2B3",
      processingRule: d.processingRule || (d.done ? "done" : "normal"), done: !!d.done });
  });
  rebuildColIndex();
}
var PRIORITIES = ["P0","P1","P2","P3"];
var PRIORITY_DEFAULTS = {
  P0:{name:"紧急", color:"#F04438"},
  P1:{name:"高", color:"#F79009"},
  P2:{name:"中", color:"#2E90FA"},
  P3:{name:"低", color:"#98A2B3"}
};
var CURRENT_PRIORITIES = {};
var WORKSPACE_PRIORITIES = {};
function buildPriorityMeta(defs){
  var meta = {};
  PRIORITIES.forEach(function(code){
    meta[code] = {name:PRIORITY_DEFAULTS[code].name, color:PRIORITY_DEFAULTS[code].color};
  });
  (defs || []).forEach(function(d){
    if(!d || !meta[d.code]) return;
    var name = String(d.name == null ? "" : d.name).trim();
    var color = String(d.color || "");
    meta[d.code] = {
      name:name || PRIORITY_DEFAULTS[d.code].name,
      color:/^#[0-9a-fA-F]{6}$/.test(color) ? color : PRIORITY_DEFAULTS[d.code].color
    };
  });
  return meta;
}
function syncPriorities(defs, workspaceId){
  var meta = buildPriorityMeta(defs);
  if(workspaceId) WORKSPACE_PRIORITIES[workspaceId] = meta;
  if(!workspaceId || (rt.currentWs && rt.currentWs.id === workspaceId)) CURRENT_PRIORITIES = meta;
}
function priMeta(code, workspaceId){
  var meta = workspaceId ? WORKSPACE_PRIORITIES[workspaceId] : CURRENT_PRIORITIES;
  return (meta && meta[code]) || PRIORITY_DEFAULTS[code] || {name:code || "", color:"#98A2B3"};
}
function priName(code, workspaceId){ return priMeta(code, workspaceId).name; }
function priColor(code, workspaceId){ return priMeta(code, workspaceId).color; }
function priTagHTML(code, workspaceId, dotOnly){
  var p = code || "P2";
  return '<span class="pdot ' + esc(p) + '" style="--p-c:' + esc(priColor(p, workspaceId)) + '"><i></i>' +
    (dotOnly ? "" : esc(priName(p, workspaceId))) + '</span>';
}
CURRENT_PRIORITIES = buildPriorityMeta();
var PALETTE = ["#2563EB","#12B76A","#F79009","#F04438","#7A5AF8","#0E9384","#DD2590","#98A2B3"];
var AVATAR_COLORS = PALETTE.slice();
var CAT_DEFAULT_COLOR = "#98A2B3";
var BACKUP_NAME = "hourglass-backup.json";
var DOC_TYPES = [
  {id:"requirement", name:"需求文档"},
  {id:"technical", name:"技术方案"},
  {id:"acceptance", name:"测试验收"},
  {id:"other", name:"其他"}
];
function docTypeName(type){
  var item = DOC_TYPES.find(function(t){ return t.id === type; });
  return item ? item.name : (type || "其他");
}
var REQ_STATUS = [
  {id:"active", name:"进行中"},
  {id:"done",   name:"已交付"},
  {id:"hold",   name:"已搁置"}
];
function startOfDay(d){ return GS.startOfDay(d); }
function addDays(d, n){ return GS.addDays(d, n); }
function addWorkdays(from, n){
  var d = startOfDay(from), left = Number(n) || 0;
  while(left > 0){
    d = addDays(d, 1);
    var w = d.getDay();
    if(w !== 0 && w !== 6) left--;
  }
  return d;
}
function duePresetDate(v){
  if(v === "" || v == null) return null;
  if(v === "w5") return iso(addWorkdays(rt.TODAY, 5));
  return iso(addDays(rt.TODAY, Number(v)));
}
function startPresetDate(v){
  if(v === "" || v == null) return null;
  if(v === "week"){
    var w = rt.TODAY.getDay();
    if(w === 0) w = 7;
    return iso(addDays(rt.TODAY, 1 - w));
  }
  return iso(addDays(rt.TODAY, Number(v)));
}
function iso(d){ return GS.iso(d); }
function pad2(n){ return GS.pad2(n); }
function parseDate(s){ return GS.parseDate(s); }
function dayDiff(a, b){ return GS.dayDiff(a, b); }
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
/* Task 的版本关系只接受数组；null 保存语义由调用方保留。 */
function normalizedIds(ids){
  return Array.isArray(ids) ? Array.from(new Set(ids.filter(function(id){ return typeof id === "string" && id.trim(); }))) : [];
}
function taskVersionIds(task){ return normalizedIds((task || {}).versionIds); }
function taskVersionsText(task){
  var names = Array.isArray((task || {}).versionNames) ? task.versionNames.filter(function(n){ return typeof n === "string" && n; }) : [];
  return (names.length ? names : taskVersionIds(task)).join("、");
}
function sameIds(a, b){ return JSON.stringify(normalizedIds(a).sort()) === JSON.stringify(normalizedIds(b).sort()); }
function selectedVersionIds(select){
  if(!select) return [];
  var retained = [];
  try{ retained = normalizedIds(JSON.parse((select.dataset || {}).retainedIds || '[]')); }catch(ex){ /* 无保留项 */ }
  return normalizedIds(retained.concat(Array.from(select.options).filter(function(o){ return o.selected && o.value; }).map(function(o){ return o.value; })));
}
function fmtReleaseTime(s){
  if(!s) return "—";
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return String(s);
  var d = new Date(s);
  if(isNaN(d.getTime())) return String(s);
  return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}
function localDatetime(s){
  var d = s ? new Date(s) : new Date();
  if(isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}
function taskPublicationHTML(task){
  if(!task) return "";
  var state = task.publicationState || "unpublished";
  var meta = {effective:["生产生效", "tag-success"], partial:["生产部分生效", "tag-neutral"], rolled_back:["生产已回滚", "tag-neutral"], unknown:["生产覆盖未知", "tag-neutral"]}[state];
  var html = meta ? '<span class="tag task-published-badge ' + meta[1] + '" title="仅来自正式生产发布记录">' + meta[0] + '</span>' : "";
  if(task.everPublished === true) html += '<span class="tag tag-neutral" title="历史发布事实，不代表当前生产生效">曾生产发布</span>';
  return html;
}
function releaseEnvironmentName(env){ return {production:"生产", staging:"预发布", test:"测试"}[env] || env || "未记录环境"; }
function releaseOperationName(op){ return {deploy:"部署", redeploy:"重部署", rollback:"回滚"}[op] || op || "未记录操作"; }
function releasePlanTime(record){
  if(record.plannedAt) return record.plannedAt;
  var plan = record.planSnapshot;
  try{ if(typeof plan === "string") plan = JSON.parse(plan); }catch(ex){ return null; }
  return plan && typeof plan === "object" ? plan.plannedAt || null : null;
}
function releaseSnapshotHTML(record, taskId){
  var items = (record.items || []).filter(function(item){ return !taskId || item.taskId === taskId; });
  var rows = items.map(function(item){
    return '<tr><td>' + esc(item.taskId || "") + '<br>' + esc(item.title || "—") + '</td><td>' + esc(item.demandId || "") + '<br>' + esc(item.demandTitle || "—") + '</td><td>' + esc(item.ownerName || item.ownerUserId || "—") + '</td><td>' + esc(record.versionName || record.versionId || "—") + '</td><td>' + esc(fmtReleaseTime(item.completedAt)) + '</td><td>' + esc(item.disposition || "—") + '</td></tr>';
  }).join("");
  return '<details class="release-record"><summary><span class="tag ' + (record.result === "success" ? "tag-success" : "tag-neutral") + '">' + esc(record.result === "success" ? "成功" : record.result === "failed" ? "失败" : record.result || "未记录结果") + '</span> ' + esc(releaseEnvironmentName(record.environment)) + ' · ' + esc(releaseOperationName(record.operation)) + ' · ' + esc(fmtReleaseTime(record.occurredAt)) + ' · ' + esc(record.versionName || record.versionId || "") + '</summary>'
    + '<p class="hint">记录 #' + esc(record.id) + ' · 计划时间 ' + esc(fmtReleaseTime(releasePlanTime(record))) + ' · 记录时间 ' + esc(fmtReleaseTime(record.recordedAt)) + '</p>'
    + '<p class="release-text">目标：' + esc(normalizedIds(record.targetKeys).join("、") || "未记录") + ' · 覆盖：' + esc(record.coverage || "unknown") + '<br>制品：' + esc(record.artifactRef || "未记录") + '<br>SHA256：' + esc(record.artifactDigest || "未记录") + '<br>记录人：' + esc(record.recordedByName || record.recordedByUserId || record.releasedByName || record.releasedBy || "未记录") + ' · 实际执行人：' + esc(record.executorName || record.executorUserId || "未记录") + '<br>关联事件：' + esc(record.relatedReleaseId || "—") + '</p>'
    + (record.notes ? '<p class="release-text">说明：' + esc(record.notes) + '</p>' : "") + (record.deviationReason ? '<p class="release-text">偏差理由：' + esc(record.deviationReason) + '</p>' : "") + (record.failureReason ? '<p class="release-error">失败原因：' + esc(record.failureReason) + '</p>' : "")
    + (!taskId ? '<button class="btn sm" type="button" data-release-export="' + esc(record.id) + '">导出快照 CSV</button>' : "")
    + '<div class="tbl-wrap"><table class="phase-tbl"><thead><tr><th>工作项快照</th><th>需求快照</th><th>负责人快照</th><th>实际记录版本</th><th>完成时间</th><th>处理结果</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">未留工作项快照</td></tr>') + '</tbody></table></div></details>';
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
function typeName(itemType){
  return { story:"用户故事", task:"任务", bug:"缺陷", epic:"史诗" }[itemType || "task"] || "任务";
}
/* 工作项类型徽标：task 是默认类型不亮徽标，避免满屏噪音 */
function typeBadgeHTML(itemType){
  var cls = { story:"type-story", bug:"type-bug", epic:"type-epic" }[itemType];
  if(!cls) return "";
  return '<span class="mini-tag ' + cls + '">' + typeName(itemType) + '</span>';
}
var SEVERITY_LABELS = { blocker:"阻断", critical:"严重", major:"一般", minor:"轻微" };
function severityBadgeHTML(severity){
  var label = SEVERITY_LABELS[severity];
  if(!label) return "";
  return '<span class="mini-tag sev-' + severity + '">' + label + '</span>';
}
/* 工作项类型的通用敏捷定义（「工作项类型」旁 ! 说明弹层的文案源） */
var ITEM_TYPE_DESCS = [
  { key:"task",  desc:"具体的工作单元，通常由需求/故事拆解而来，粒度小（约 1–2 天），面向执行" },
  { key:"story", desc:"从用户视角描述的一条功能需求，惯用格式「作为〈角色〉，我希望〈功能〉，以便〈价值〉」，一个迭代内可交付" },
  { key:"bug",   desc:"已交付功能与预期行为不符的问题，来自测试或使用反馈，需修复并验证" },
  { key:"epic",  desc:"大粒度需求集合，即通用的 Epic 概念；一个迭代内做不完，需拆解为多个用户故事/任务后再排期" }
];
function itemTypeInfoHTML(){
  var badgeCls = { story:"type-story", bug:"type-bug", epic:"type-epic" };
  return '<div class="menu-title">类型区别说明</div><div class="type-help-list">' +
    ITEM_TYPE_DESCS.map(function(o){
      var cls = badgeCls[o.key] || "mute";
      return '<div class="type-help-row"><span class="mini-tag ' + cls + '">' + typeName(o.key) + '</span>' +
        '<span class="type-help-desc">' + esc(o.desc) + '</span></div>';
    }).join("") + '</div>';
}
/* 版本与首版/迭代的区分口径：抽屉「计划版本」和版本页顶部共用同一份说明 */
function versionPhaseInfoHTML(){
  return '<div class="menu-title">版本与首版 / 迭代</div><div class="type-help-list">' +
    '<div class="type-help-row"><span class="mini-tag type-story">版本</span>' +
      '<span class="type-help-desc">显式多选。一个工作项可同时关联多个版本；增减当前版本不会移走其他关联，全部取消即「待规划」。需求目标版本是独立的排期身份。已有成功正式（生产）发布的版本内容只读，工作项仍可有因关联其他活动版本；执行状态与生产发布事实独立。</span></div>' +
    '<div class="type-help-row"><span class="mini-tag type-epic">首版 / 迭代</span>' +
      '<span class="type-help-desc">不是可选项，也不单独存表。系统按项目的「首版上线日」实时归组：完成日（未完成取开始日，再取截止日）不晚于上线日算首版，晚于上线日算迭代；未标记上线日时全部算首版。</span></div>' +
    '<div class="type-help-row"><span class="mini-tag mute">关系</span>' +
      '<span class="type-help-desc">版本和阶段是两个维度：工作项可以属于 V1.1，但完成日在首版上线前，阶段仍算首版。首版上线日由空间主在「版本 &gt; 按阶段」标记。</span></div>' +
    '</div>';
}
/* 需求池甘特的计算口径：甘特页「?」说明弹层的文案源 */
function demandGanttInfoHTML(){
  var stages = [
    ["review", "评审", "需求创建 → 最后一次评审通过；待评审算到今天，已拒绝停在最后一次拒绝", "区间"],
    ["plan", "排期", "评审通过 → 最后一次排期或调期决定；撤排后这段历史仍保留", "区间或单点"],
    ["design", "设计", "关联文档最早创建 → 最晚发布；还有文档未发布就画到今天并标「+」", "区间"],
    ["dev", "开发", "工作项首次离开「待处理」或首次计时 → 最后一个工作项完成；计划开始日不参与", "区间"],
    ["test", "测试", "用例执行记录与工作项「测试中」窗口合并，取最早开始、最晚结束", "区间"],
    ["complete", "完成", "工作项全部完成且用例无未执行、未通过时，取开发与测试较晚的收口日", "单点"],
    ["release", "发布", "成功生产发布记录中的本需求快照，不按目标版本日期推算", "单点或短条"]
  ];
  return '<div class="menu-title">需求池甘特 · 阶段口径</div>' +
    '<div class="demg-help-stages">' +
      stages.map(function(s){
        return '<div class="demg-help-row">' +
          '<i class="demg-legend-dot st-' + s[0] + '"></i>' +
          '<b class="demg-help-name">' + s[1] + '</b>' +
          '<span class="demg-help-method">' + s[2] + '</span>' +
          '<em class="demg-help-form">' + s[3] + '</em>' +
        '</div>';
      }).join("") +
    '</div>' +
    '<div class="type-help-list demg-help-rules">' +
      '<div class="type-help-row"><span class="mini-tag type-story">缺失不补</span>' +
        '<span class="type-help-desc">没有记录就不画，也不补 0 天；相邻阶段之间没有记录覆盖的日期画虚线缺口；最后一段结束到今天仍缺记录时，按卡点标出「已排期未开工 / 未执行用例 / 待发布」。</span></div>' +
      '<div class="type-help-row"><span class="mini-tag mute">天数口径</span>' +
        '<span class="type-help-desc">条形标注的是阶段首尾的自然日天数，含周末和中间缺口，不是投入工时；进行中显示「N 天+」，不随缩放或可视范围裁剪。条形太窄时不标，悬停可看完整起止与天数。</span></div>' +
      '<div class="type-help-row"><span class="mini-tag type-bug">并行与取消</span>' +
        '<span class="type-help-desc">时间重叠的阶段自动上下分层；已取消的需求工作阶段停在取消日，不再往今天生长，既有发布事实仍保留。</span></div>' +
      '<div class="type-help-row"><span class="mini-tag type-epic">范围与计划</span>' +
        '<span class="type-help-desc">默认自动适配已加载需求并包含今天，甘特按页加载，加载越多范围越宽；跨度超过 2 年切到按月查看。左侧「计划」是计划日期，不参与阶段计算。</span></div>' +
    '</div>';
}
function recurLabel(type){
  if(type === "daily") return "每天";
  if(type === "weekly") return "每周";
  if(type === "monthly") return "每月";
  return "";
}
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
function avatarColorIndex(name){
  name = name || "?";
  var h = 0;
  for(var i = 0; i < name.length; i++) h = (h*31 + name.charCodeAt(i)) % 9973;
  return (h % 8) + 1;
}
function initial(name){ return name ? String(name).charAt(0) : "?"; }
function avatarHTML(name, cls){
  var idx = avatarColorIndex(name);
  return '<span class="avatar avatar-c' + idx + (cls ? " " + cls : "") + '" aria-hidden="true">' +
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
function hexToRgb(hex){
  var h = String(hex || "").replace("#","");
  if(h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
  if(!/^[0-9a-fA-F]{6}$/.test(h)) return {r:152,g:162,b:179};
  return {r:parseInt(h.substr(0,2),16), g:parseInt(h.substr(2,2),16), b:parseInt(h.substr(4,2),16)};
}
function rgbaOf(hex, a){ var c = hexToRgb(hex); return "rgba("+c.r+","+c.g+","+c.b+","+a+")"; }

export { normalizedIds, taskVersionIds, taskVersionsText, sameIds, selectedVersionIds, taskPublicationHTML, fmtReleaseTime, localDatetime, releaseEnvironmentName, releaseOperationName, releasePlanTime, releaseSnapshotHTML, BACKUP_NAME, CAT_DEFAULT_COLOR, COLUMNS, COL_INDEX, DOC_TYPES, ITEM_TYPE_DESCS, PALETTE, PRIORITIES, SEVERITY_LABELS, demandGanttInfoHTML, docTypeName, addDays, avatarColor, avatarColorIndex, avatarHTML, colMeta, colName, dayDiff, duePresetDate, fmtElapsed, fmtFull, fmtMD, fmtMinutes, fmtMinutesShort, fmtShortMD, fmtSize, fmtTs, initial, iso, itemTypeInfoHTML, mdLite, pad2, parseDate, priColor, priName, priTagHTML, recurLabel, reqStatusName, rgbaOf, severityBadgeHTML, startOfDay, startPresetDate, syncColumns, syncPriorities, typeBadgeHTML, typeName, versionPhaseInfoHTML, weekdayCN };
