/* core/nav-telemetry · 导航使用埋点（只写本机 localStorage，不上传）
   记录每次进入某个视图的时间与停留时长，用于回答“大家实际在用哪些入口”。
   设置页「数据」面板可导出 CSV；清空浏览器数据即清空记录。 */

import { VIEWS } from "./router.js";

var KEY = "ds.navTelemetry.v1";
var MAX = 600;              /* 环形缓冲：只留最近 600 段，避免 localStorage 无限增长 */
var MAX_SEGMENT_MS = 30 * 60 * 1000;  /* 单段最多记 30 分钟：页面挂后台过夜不应拉高均值 */
var started = false;
var current = null;         /* { view, start } */

function load(){
  try{
    var raw = localStorage.getItem(KEY);
    var data = raw ? JSON.parse(raw) : null;
    if(data && data.segments && data.segments.length !== undefined) return data;
  }catch(e){ /* 隐私模式 / 存储被禁用：降级为内存记录 */ }
  return { v: 1, segments: [] };
}

function save(data){
  try{
    if(data.segments.length > MAX) data.segments = data.segments.slice(data.segments.length - MAX);
    localStorage.setItem(KEY, JSON.stringify(data));
  }catch(e){ /* 写不进去就只保留在内存里，不影响页面 */ }
}

function closeSegment(now){
  if(!current) return;
  var ms = Math.min(Math.max(0, now - current.start), MAX_SEGMENT_MS);
  if(ms >= 1000 && current.view){
    var data = load();
    data.segments.push({ view: current.view, start: current.start, ms: Math.round(ms) });
    save(data);
  }
  current = null;
}

function onViewChange(view){
  var now = Date.now();
  if(current && current.view === view) return;
  closeSegment(now);
  if(view && document.visibilityState === "visible"){
    current = { view: view, start: now };
  }
}

function initNavTelemetry(startView){
  if(started) return;
  started = true;

  var body = document.body;
  if(startView && document.visibilityState === "visible"){
    current = { view: startView, start: Date.now() };
  }else{
    onViewChange(body.getAttribute("data-view") || "");
  }
  if(typeof MutationObserver === "function"){
    new MutationObserver(function(){
      onViewChange(body.getAttribute("data-view") || "");
    }).observe(body, { attributes: true, attributeFilter: ["data-view"] });
  }

  /* 切到后台先截断：用户离开页面后的时间不算“使用” */
  document.addEventListener("visibilitychange", function(){
    if(document.visibilityState === "hidden"){
      closeSegment(Date.now());
    }else{
      onViewChange(body.getAttribute("data-view") || "");
    }
  });
  window.addEventListener("pagehide", function(){ closeSegment(Date.now()); });
}

function labelOf(view){
  var meta = VIEWS[view];
  return (meta && meta.title) || view || "未知";
}

function flush(){
  var view = current && current.view;
  closeSegment(Date.now());
  if(view && document.visibilityState === "visible"){
    current = { view: view, start: Date.now() };
  }
}

function navTelemetrySummary(){
  flush();
  var data = load();
  var byView = Object.create(null);
  data.segments.forEach(function(seg){
    var item = byView[seg.view] || (byView[seg.view] = { view: seg.view, visits: 0, totalMs: 0, lastAt: 0 });
    item.visits += 1;
    item.totalMs += seg.ms || 0;
    if(seg.start > item.lastAt) item.lastAt = seg.start;
  });
  return Object.keys(byView).map(function(k){
    var item = byView[k];
    return {
      view: item.view,
      label: labelOf(item.view),
      visits: item.visits,
      totalMs: item.totalMs,
      avgMs: item.visits ? Math.round(item.totalMs / item.visits) : 0,
      lastAt: item.lastAt
    };
  }).sort(function(a, b){ return b.totalMs - a.totalMs; });
}

function csvCell(v){
  var s = String(v == null ? "" : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function fmtTime(ms){
  if(!ms) return "";
  var d = new Date(ms);
  function pad(n){ return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function navTelemetryCsv(){
  var rows = [["视图", "进入次数", "累计停留(分钟)", "平均停留(秒)", "最近访问"]];
  navTelemetrySummary().forEach(function(it){
    rows.push([it.label, it.visits, Math.round(it.totalMs / 6000) / 10, Math.round(it.avgMs / 1000), fmtTime(it.lastAt)]);
  });
  return rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n");
}

function clearNavTelemetry(){
  try{ localStorage.removeItem(KEY); }catch(e){ /* 忽略 */ }
  current = null;
}

export { initNavTelemetry, navTelemetrySummary, navTelemetryCsv, clearNavTelemetry };
