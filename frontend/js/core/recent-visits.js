/* core/recent-visits · 最近访问（本机记录，按账号+空间隔离）
   记录用户实际打开过的工作项/文档/需求/用例等实体，供全局搜索空态展示。
   只写 localStorage，不上传；清空浏览器数据即清空。 */

import { rt } from "./state.js";

var PREFIX = "ds.recentVisits.v1:";
var MAX = 8;

function key(){
  var uid = (rt.currentUser && rt.currentUser.id) || "anon";
  var ws = (rt.currentWs && rt.currentWs.id) || "none";
  return PREFIX + uid + ":" + ws;
}

function read(){
  try{
    var rows = JSON.parse(localStorage.getItem(key()) || "[]");
    if(!Array.isArray(rows)) return [];
    return rows.filter(function(r){ return r && r.type && r.id && r.title; });
  }catch(e){ return []; }
}

function write(rows){
  try{ localStorage.setItem(key(), JSON.stringify(rows.slice(0, MAX))); }
  catch(e){ /* 隐私模式 / 存储被禁用：忽略，不影响页面 */ }
}

/* 同一类型同一 id 只留最新一条；切换空间/账号后各看各的 */
function recordRecentVisit(item){
  if(!item || !item.type || !item.id) return;
  var rows = read().filter(function(r){
    return !(r.type === item.type && String(r.id) === String(item.id));
  });
  rows.unshift({
    type: String(item.type),
    id: String(item.id),
    title: String(item.title || "").slice(0, 120),
    meta: String(item.meta || "").slice(0, 80),
    reqId: item.reqId ? String(item.reqId) : "",
    head: item.head == null ? null : item.head,
    ts: Date.now()
  });
  write(rows);
}

function recentVisits(){ return read(); }

function clearRecentVisits(){
  try{ localStorage.removeItem(key()); }catch(e){ /* 忽略 */ }
}

export { clearRecentVisits, recentVisits, recordRecentVisit };