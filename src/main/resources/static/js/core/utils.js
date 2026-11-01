/* core/utils · 通用小工具（错误态 / 快速录入 / 全量更新载荷） */

import { $ } from "./dom.js";
import { rt } from "./state.js";
import { ownerOptions } from "./task-drawer.js";
import { UI } from "./ui.js";
import { addDays, iso, startOfDay } from "../lib/format.js";

function bindRetry(root, fn){  var b = root.querySelector("[data-empty-action]");
  if(b) b.addEventListener("click", fn);
}
function setPageError(err, ids, retry){
  var msg = (err && err.message) || "网络异常，请稍后重试";
  var first = null;
  ids.forEach(function(id){
    var el = $(id);
    if(!el) return;
    el.innerHTML = UI.errorState(msg);
    if(!first) first = el;
  });
  if(first) bindRetry(first, retry);
}
function stripFirst(s, find){
  var i = s.indexOf(find);
  if(i < 0) return s;
  return (s.substring(0, i) + " " + s.substring(i + find.length)).replace(/\s+/g, " ").trim();
}
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
    for(var i = 0; i < rt.reqList.length; i++){ if(rt.reqList[i].name === key){ hit = rt.reqList[i]; break; } }
    if(!hit){ for(var j = 0; j < rt.reqList.length; j++){ if(rt.reqList[j].name.indexOf(key) === 0){ hit = rt.reqList[j]; break; } } }
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

export { RECUR_LABEL, bindRetry, parseQuickAdd, setPageError };
