/* core/env-dict · 环境字典：执行环境 / 发现环境共用的候选来源。
   常用浏览器·设备预设 + 最近使用（localStorage），仍允许自由输入。
   候选挂在共享 <datalist id="envDictList">，由 combo.js 自绘浮层展示。 */

import { attachCombo } from "./combo.js";

var LIST_ID = "envDictList";
var STORE_KEY = "hg-env-recents";
var MAX_RECENTS = 12;

/* 常用预设：浏览器 / 版本 / 设备口径，覆盖桌面与移动主流组合 */
var PRESETS = [
  "Chrome 最新版 / Windows 11",
  "Chrome 最新版 / macOS",
  "Edge 最新版 / Windows 11",
  "Safari 最新版 / macOS",
  "Firefox 最新版 / Windows 11",
  "Chrome / Android 14",
  "Safari / iOS 17",
  "微信内置浏览器 / iOS",
  "微信内置浏览器 / Android",
  "测试环境 staging",
  "预发布环境 pre",
  "生产环境 prod"
];

function readRecents(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(function(x){ return typeof x === "string" && x.trim(); }) : [];
  }catch(e){ return []; }
}
function writeRecents(list){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))); }catch(e){ /* 隐私模式等场景忽略 */ }
}

function ensureDatalist(){
  var dl = document.getElementById(LIST_ID);
  if(!dl){
    dl = document.createElement("datalist");
    dl.id = LIST_ID;
    document.body.appendChild(dl);
  }
  return dl;
}

/* 最近使用在前，预设补其后，去重 */
function populate(){
  var dl = ensureDatalist();
  var seen = Object.create(null);
  var vals = [];
  readRecents().concat(PRESETS).forEach(function(v){
    v = String(v || "").trim();
    if(!v || seen[v]) return;
    seen[v] = 1;
    vals.push(v);
  });
  dl.innerHTML = vals.map(function(v){
    return '<option value="' + v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") + '"></option>';
  }).join("");
}

/** 记录一次实际使用的环境值，刷新候选 */
function recordEnv(value){
  var v = String(value || "").trim();
  if(!v) return;
  var list = readRecents().filter(function(x){ return x !== v; });
  list.unshift(v);
  writeRecents(list);
  populate();
}

/** 给环境输入框挂上共享候选（自由输入仍允许）；返回 combo 句柄 */
function attachEnvDict(input){
  if(!input) return null;
  populate();
  input.setAttribute("list", LIST_ID);
  return attachCombo(input, { chevron: true });
}

export { PRESETS, recordEnv, attachEnvDict, populate as refreshEnvDict };