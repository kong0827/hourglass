/* lib/format · 日期、格式化、颜色与只读派生（无 DOM、无请求） */

import { rt } from "../core/state.js";
import { esc } from "../core/ui.js";
import { GS } from "./gantt-shared.js";

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
var PALETTE = ["#2563EB","#12B76A","#F79009","#F04438","#7A5AF8","#0E9384","#DD2590","#98A2B3"];
var AVATAR_COLORS = PALETTE.slice();
var CAT_DEFAULT_COLOR = "#98A2B3";
var BACKUP_NAME = "devstudio-kanban-backup.json";
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
  return { story:"用户故事", task:"任务", bug:"缺陷", epic:"Epic" }[itemType || "task"] || "任务";
}
/* 工作项类型徽标：task 是默认类型不亮徽标，避免满屏噪音 */
function typeBadgeHTML(itemType){
  var cls = { story:"type-story", bug:"type-bug", epic:"type-epic" }[itemType];
  if(!cls) return "";
  return '<span class="mini-tag ' + cls + '">' + typeName(itemType) + '</span>';
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

export { BACKUP_NAME, CAT_DEFAULT_COLOR, COLUMNS, COL_INDEX, DOC_TYPES, PALETTE, PRIORITIES, PRIORITY_COLOR, docTypeName, addDays, avatarColor, avatarHTML, colMeta, colName, darken, dayDiff, duePresetDate, fmtElapsed, fmtFull, fmtMD, fmtMinutes, fmtMinutesShort, fmtShortMD, fmtSize, fmtTs, initial, iso, mdLite, pad2, parseDate, recurLabel, reqStatusName, rgbaOf, startOfDay, startPresetDate, syncColumns, typeBadgeHTML, typeName, weekdayCN };
