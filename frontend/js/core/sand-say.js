/* core/sand-say · 沙漏说：按时段问候、下班倒计时、假日倒计时
 *
 * 三处落点：我的工作页头一行、侧栏摆件悬停气泡、个人设置·外观。
 * 只按本机时间与本地时区计算；偏好只存本机（ds.sandSay.v1），不写空间配置、不走接口。
 * 节假日表见 holidays.js：没有数据覆盖的年份不猜，自动回退到「距周末」。
 */

import { $ } from "./dom.js";
import { holidayOn, isMakeupWorkday, nextHoliday } from "./holidays.js";

var PREF_KEY = "ds.sandSay.v1";
var DEFAULT_OFF = "18:00";
var DAY_MS = 86400000;
var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

var pref = readPref();
var flipKey = "";
var bubblePinned = false;

/* ==================== 模型（可单测） ==================== */
function pad2(n){ return (n < 10 ? "0" : "") + n; }
export function isoDate(d){
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function dayNum(dateStr){
  var p = dateStr.split("-");
  return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS;
}
function dayDiff(from, to){ return dayNum(to) - dayNum(from); }
function parseHM(v){
  var m = /^(\d{1,2}):(\d{2})$/.exec(v || "");
  if(!m) return null;
  var h = +m[1], mi = +m[2];
  return (h > 23 || mi > 59) ? null : h * 60 + mi;
}

function dayPhase(mins){
  if(mins < 10 * 60) return { phase:"early", quote:"来得早，沙还没开始漏", mood:"flow" };
  if(mins < 11 * 60 + 30) return { phase:"morning", quote:"上午的沙，流得最快", mood:"flow" };
  if(mins < 13 * 60 + 30) return { phase:"noon", quote:"快到饭点了，先放下", mood:"slow" };
  if(mins < 18 * 60 + 30) return { phase:"afternoon", quote:"下午的沙，流得最慢", mood:"slow" };
  if(mins < 21 * 60) return { phase:"evening", quote:"", mood:"dim" };
  if(mins < 23 * 60) return { phase:"late", quote:"这么晚了，还在工作", mood:"dim" };
  return { phase:"night", quote:"夜里的沙漏转得慢，先睡吧", mood:"sleep" };
}

function holidayChip(dateStr, dow, nxt){
  if(nxt){
    var d = dayDiff(dateStr, nxt.from);
    if(d === 1) return { text:"明天" + nxt.name, tone:"hot", icon:true };
    if(d > 1) return { text:"距" + nxt.name + " " + d + " 天", tone:"", icon:true };
  }
  /* 数据没覆盖到下一个假期：只说周末，不猜；周末当天不报距离 */
  if(dow !== 0 && dow !== 6) return { text:"距周末 " + ((6 - dow) % 7 || 6) + " 天", tone:"", icon:true };
  return null;
}

/* now: Date；pref: { offWork, ... }。offWork 为 "" 表示不显示下班倒计时。 */
export function computeSay(now, p){
  now = now || new Date();
  p = p || {};
  var dateStr = isoDate(now);
  var mins = now.getHours() * 60 + now.getMinutes();
  var dow = now.getDay();
  var offRaw = p.offWork === undefined ? DEFAULT_OFF : p.offWork;
  var offMins = offRaw === "" ? null : parseHM(offRaw);
  var h = holidayOn(dateStr);
  var makeup = isMakeupWorkday(dateStr);
  var weekend = (dow === 0 || dow === 6) && !makeup;
  var nxt = nextHoliday(dateStr);
  var st = {
    date: dateStr, mins: mins, phase: "work", quote: "", mood: "flow",
    chips: [], label: pad2(now.getHours()) + ":" + pad2(now.getMinutes()),
    next: nxt
  };

  if(h){
    st.phase = "holiday";
    st.quote = h.name + "快乐，沙漏也放假";
    st.label = dateStr.slice(5) + " " + st.label;
    st.chips.push({ text:"今天" + h.name, tone:"fest" });
    return st;
  }

  if(makeup){
    st.phase = "makeup";
    st.quote = "今天调休上班，辛苦了";
  }else if(weekend){
    st.phase = "weekend";
    st.quote = "周末也来了，辛苦了";
    st.mood = "pause";
    st.label = WEEK_CN[dow] + " " + st.label;
  }else if(nxt && dayDiff(dateStr, nxt.from) === 1){
    st.phase = "festeve";
    st.quote = "再坚持一天，就是" + nxt.name;
    st.label = dateStr.slice(5) + " " + st.label;
  }else{
    var offChip = null;
    if(offMins !== null && mins >= offMins && mins < offMins + 30){
      st.phase = "off";
      st.quote = "到点了，沙漏翻转";
      st.mood = "flip";
    }else if(offMins !== null && mins >= offMins - 60 && mins < offMins){
      st.phase = "beforeoff";
      st.quote = "沙漏快漏完了";
      offChip = { text:"距离下班 " + Math.max(1, offMins - mins) + " 分钟", tone:"hot" };
    }else{
      var p2 = dayPhase(mins);
      st.phase = p2.phase;
      st.quote = p2.quote;
      st.mood = p2.mood;
      if(p2.phase === "evening"){
        st.quote = (offMins !== null && mins >= offMins + 30) ? "下班了，还在？" : "还在忙？先喝口水";
      }
    }
    if(offChip) st.chips.push(offChip);
  }

  var hc = holidayChip(dateStr, dow, nxt);
  if(hc) st.chips.push(hc);
  return st;
}

/* ==================== 偏好 ==================== */
export function readPref(){
  var p = { on:true, offWork:DEFAULT_OFF, mode:"always" };
  try{
    var raw = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if(raw && typeof raw === "object"){
      p.on = raw.on !== false;
      if(raw.offWork === "") p.offWork = "";
      else if(parseHM(raw.offWork) !== null) p.offWork = raw.offWork;
      if(raw.mode === "hover") p.mode = "hover";
    }
  }catch(e){ /* 受限环境 / 坏数据：回落默认 */ }
  return p;
}
function savePref(){
  try{ localStorage.setItem(PREF_KEY, JSON.stringify(pref)); }catch(e){ /* 忽略 */ }
}
function setPref(patch){
  pref = {
    on: patch.on !== undefined ? !!patch.on : pref.on,
    offWork: patch.offWork !== undefined ? String(patch.offWork) : pref.offWork,
    mode: patch.mode === "hover" ? "hover" : (patch.mode === "always" ? "always" : pref.mode)
  };
  if(pref.offWork !== "" && parseHM(pref.offWork) === null) pref.offWork = DEFAULT_OFF;
  savePref();
  render();
  syncSettings();
  window.dispatchEvent(new CustomEvent("sandsay:change", { detail:{ on:pref.on, mode:pref.mode } }));
}

/* ==================== 渲染 ==================== */
var IC = {
  hour: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8M6 17h8M7 3v2.2c0 1.6 2.2 2.9 3 4.8.8-1.9 3-3.2 3-4.8V3M7 17v-2.2c0-1.6 2.2-2.9 3-4.8.8 1.9 3 3.2 3 4.8V17"/></svg>',
  moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 11.8A6.2 6.2 0 0 1 8.2 4.5a6.4 6.4 0 1 0 7.3 7.3Z"/></svg>',
  cal: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/></svg>'
};
function iconFor(st){
  if(st.phase === "late" || st.phase === "night") return IC.moon;
  if(st.phase === "weekend" || st.phase === "holiday" || st.phase === "festeve") return IC.cal;
  return IC.hour;
}
function chipsHTML(st){
  return st.chips.map(function(c){
    return '<span class="ss-chip' + (c.tone ? " " + c.tone : "") + '">' +
      (c.icon ? IC.cal : "") + '<span>' + c.text + '</span></span>';
  }).join("");
}

function renderLine(st){
  var line = $("mineSays");
  if(!line) return;
  if(!pref.on || pref.mode === "hover"){ line.hidden = true; return; }
  line.hidden = false;
  line.innerHTML = '<span class="ss-ic">' + iconFor(st) + '</span>' +
    '<span class="ss-tm">' + st.label + '</span>' +
    '<span class="ss-sep" aria-hidden="true"></span>' +
    '<span class="ss-qt">' + st.quote + '</span>' + chipsHTML(st);
}

function renderBubble(st){
  var b = $("sandBubble");
  if(!b) return;
  b.hidden = !pref.on;
  if(!pref.on){ bubblePinned = false; b.classList.remove("show"); return; }
  var txt = $("sandBubbleText"), chip = $("sandBubbleChip");
  if(txt){
    var q = st.quote || "";
    if(q && !/[。！？…]$/.test(q)) q += "。";
    txt.textContent = q;
  }
  if(chip){
    var c = st.chips[0];
    chip.textContent = c ? c.text : "";
    chip.hidden = !c;
    chip.className = "ss-btag" + (c ? " " + c.tone : "");
  }
}

function applyMood(st){
  var slot = $("sideOrnament");
  if(!slot) return;
  ["ss-slow", "ss-pause", "ss-dim", "ss-sleep", "ss-flip"].forEach(function(c){ slot.classList.remove(c); });
  if(!pref.on) return;
  if(st.mood === "slow") slot.classList.add("ss-slow");
  else if(st.mood === "pause") slot.classList.add("ss-pause");
  else if(st.mood === "dim") slot.classList.add("ss-dim");
  else if(st.mood === "sleep") slot.classList.add("ss-sleep");
  else if(st.mood === "flip"){
    /* 一天只翻一次，之后回到常规流淌 */
    if(flipKey !== st.date){
      flipKey = st.date;
      slot.classList.add("ss-flip");
      setTimeout(function(){ slot.classList.remove("ss-flip"); }, 2400);
    }
  }
}

export function render(){
  var st = computeSay(new Date(), pref);
  document.body.classList.toggle("ss-on", pref.on);
  document.body.classList.toggle("ss-night", pref.on && (st.phase === "late" || st.phase === "night"));
  renderLine(st);
  renderBubble(st);
  applyMood(st);
  updatePreview(st);
}

/* ==================== 气泡 ==================== */
function wireBubble(){
  var slot = $("sideOrnament"), b = $("sandBubble");
  if(!slot || !b || slot.__ssWired) return;
  slot.__ssWired = true;
  slot.addEventListener("mouseenter", function(){ b.classList.add("show"); });
  slot.addEventListener("mouseleave", function(){
    if(!bubblePinned) b.classList.remove("show");
  });
  slot.addEventListener("click", function(){
    bubblePinned = !bubblePinned;
    b.classList.toggle("show", bubblePinned);
  });
  /* 摆件让位（导航紧张、移动端、关闭摆放）时，气泡一起收起 */
  if(window.MutationObserver){
    new MutationObserver(function(){
      if(slot.hidden){
        bubblePinned = false;
        b.classList.remove("show");
      }
    }).observe(slot, { attributes:true, attributeFilter:["hidden"] });
  }
}

/* ==================== 个人设置 · 外观 ==================== */
function modeButtons(){
  return document.querySelectorAll("#meSsMode [data-ssmode]");
}
function syncSettings(){
  var sw = $("meSsOn"), off = $("meSsOff");
  if(!sw || !off) return;
  sw.checked = pref.on;
  off.value = pref.offWork;
  off.disabled = !pref.on;
  modeButtons().forEach(function(b){
    var on = b.getAttribute("data-ssmode") === pref.mode;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.disabled = !pref.on;
  });
  var seg = $("meSsMode");
  if(seg) seg.setAttribute("aria-disabled", pref.on ? "false" : "true");
  updatePreview(computeSay(new Date(), pref));
}
function updatePreview(st){
  var pv = $("meSsPreview");
  if(!pv || !pv.offsetParent) return;
  pv.innerHTML = '<span class="ss-ic">' + iconFor(st) + '</span>' +
    '<span class="ss-tm">' + st.label + '</span>' +
    '<span class="ss-qt">' + st.quote + '</span>' + chipsHTML(st);
}

export function mountSandSaySettings(){
  var sw = $("meSsOn");
  if(!sw) return;
  if(!sw.__wired){
    sw.__wired = true;
    sw.addEventListener("change", function(){ setPref({ on:sw.checked }); });
    var off = $("meSsOff");
    if(off){
      off.addEventListener("change", function(){ setPref({ offWork:off.value }); });
    }
    var seg = $("meSsMode");
    if(seg){
      seg.addEventListener("click", function(e){
        var b = e.target.closest("[data-ssmode]");
        if(!b || b.disabled) return;
        setPref({ mode:b.getAttribute("data-ssmode") });
      });
    }
    var reset = $("meSsReset");
    if(reset){
      reset.addEventListener("click", function(){
        setPref({ on:true, offWork:DEFAULT_OFF, mode:"always" });
      });
    }
    window.addEventListener("sandsay:change", syncSettings);
  }
  syncSettings();
}

/* ==================== 生命周期 ==================== */
var timer = null;
export function initSandSay(){
  if(!$("mineSays") && !$("sideOrnament")) return;
  mountSandSaySettings();
  wireBubble();
  render();
  timer = timer || setInterval(function(){
    if(!document.hidden) render();
  }, 30000);
  document.addEventListener("visibilitychange", function(){
    if(!document.hidden) render();
  });
  window.addEventListener("storage", function(e){
    if(e.key !== PREF_KEY) return;
    pref = readPref();
    render();
    syncSettings();
  });
}
