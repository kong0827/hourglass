/* core/side-ornament · 侧栏 72px 装饰摆件
 *
 * 纯装饰，不是控件：容器 aria-hidden + pointer-events:none，不带进度、不带入口。
 * 个人偏好只存本机（ds.ornament.v1），不写空间配置、不走接口。
 * 形态：经典流淌 + 弹跳 / 水母 / 蜗牛 / 奔跑 / 潮汐 / 喷嚏。
 * 导航一旦需要滚动就让位（不挤导航）；矮窗口、收起态、移动端由 ornament.css 处理。
 */

import { $ } from "./dom.js";

var PREF_KEY = "ds.ornament.v1";
var seq = 0;

var ORN_OPTIONS = [
  { key:"classic", name:"经典流淌", dur:"默认 · 14s 换沙" },
  { key:"hop", name:"弹跳小沙漏", dur:"2.6s / 跳" },
  { key:"jelly", name:"沙漏水母", dur:"5.2s / 漂" },
  { key:"snail", name:"沙漏蜗牛", dur:"3.2s / 步" },
  { key:"run", name:"奔跑的沙漏", dur:"0.6s / 步" },
  { key:"tide", name:"潮汐沙漏", dur:"6.4s / 涨落" },
  { key:"sneeze", name:"打喷嚏的沙漏", dur:"5.2s / 次" }
];

var orn = readPref();

function readPref(){
  var next = { on:true, pick:"classic" };
  try{
    var raw = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if(raw && typeof raw === "object"){
      next.on = raw.on !== false;
      if(raw.pick) next.pick = raw.pick;
    }
  }catch(e){ /* 受限环境 / 坏数据：回落默认 */ }
  if(!ORN_OPTIONS.some(function(o){ return o.key === next.pick; })) next.pick = "classic";
  return next;
}
function savePref(){
  try{ localStorage.setItem(PREF_KEY, JSON.stringify(orn)); }catch(e){ /* 忽略 */ }
}

function setOrnamentPref(patch){
  var next = { on:patch && patch.on !== undefined ? !!patch.on : orn.on,
               pick:patch && patch.pick || orn.pick };
  if(!ORN_OPTIONS.some(function(o){ return o.key === next.pick; })) next.pick = "classic";
  orn = next;
  savePref();
  renderSlot(true);
  syncSettings();
  window.dispatchEvent(new CustomEvent("ornament:change", { detail:{ on:orn.on, pick:orn.pick } }));
}

/* ==================== SVG 构造 ==================== */
function uid(){ seq++; return "orn" + seq; }

var TOP = "M2 4C3.53 10.6 9.64 20.8 18.04 31C19.9 33.1 20.7 34 21.1 34L24.9 34C25.3 34 25.9 33.1 27.96 31C36.36 20.8 42.47 10.6 44 4Z";
var BOT = "M2 64C3.53 57.4 9.64 47.2 18.04 37C19.9 34.9 20.7 34 21.1 34L24.9 34C25.3 34 25.9 34.9 27.96 37C36.36 47.2 42.47 57.4 44 64Z";
var WL = "M2 4C3.53 10.6 9.64 20.8 18.04 31C19.9 33.1 20.7 34 21.1 34C20.7 34 19.9 34.9 18.04 37C9.64 47.2 3.53 57.4 2 64";
var WR = "M44 4C42.47 10.6 36.36 20.8 27.96 31C25.9 33.1 25.3 34 24.9 34C25.3 34 25.9 34.9 27.96 37C36.36 47.2 42.47 57.4 44 64";

function hourglassSVG(){
  var id = uid();
  var t = id + "t", b = id + "b", sg = id + "s", gf = id + "f", gs = id + "g";
  return "<svg class=\"hg\" viewBox=\"0 0 46 68\" aria-hidden=\"true\" focusable=\"false\" style=\"--hg-sg:url(#" + sg + ")\">" +
    "<defs>" +
      "<clipPath id=\"" + t + "\"><path d=\"" + TOP + "\"/></clipPath>" +
      "<clipPath id=\"" + b + "\"><path d=\"" + BOT + "\"/></clipPath>" +
      "<linearGradient id=\"" + sg + "\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"hg-sf\" offset=\"0\"/><stop class=\"hg-ss\" offset=\"1\"/></linearGradient>" +
      "<linearGradient id=\"" + gf + "\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"hg-fa\" offset=\"0\"/><stop class=\"hg-fb\" offset=\"1\"/></linearGradient>" +
      "<linearGradient id=\"" + gs + "\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"hg-aa\" offset=\"0\"/><stop class=\"hg-bb\" offset=\"1\"/></linearGradient>" +
    "</defs>" +
    "<ellipse class=\"hg-shadow\" cx=\"23\" cy=\"67\" rx=\"16.4\" ry=\".95\"/>" +
    "<g class=\"hg-body\">" +
      "<path class=\"hg-fill\" d=\"" + TOP + "\" fill=\"url(#" + gf + ")\"/>" +
      "<path class=\"hg-fill\" d=\"" + BOT + "\" fill=\"url(#" + gf + ")\"/>" +
      "<g clip-path=\"url(#" + t + ")\"><g class=\"hg-level\">" +
        "<path class=\"hg-sand\" d=\"M0 16.2Q23 21.2 46 16.2V34H0Z\"/>" +
        "<path class=\"hg-surface\" d=\"M5 16Q23 21.2 41 16\"/>" +
      "</g></g>" +
      "<g clip-path=\"url(#" + b + ")\"><path class=\"hg-pile\" d=\"M3.4 64C12.5 58.4 17.6 52.4 23.6 52.4C29.6 52.4 33.5 58.4 42.6 64Z\"/></g>" +
      "<path class=\"hg-stream-soft\" d=\"M23 36V51.6\"/><path class=\"hg-stream\" d=\"M23 36V51.6\"/>" +
      "<circle class=\"hg-grain g1\" cx=\"23\" cy=\"39\" r=\".78\"/>" +
      "<circle class=\"hg-grain g2\" cx=\"22.1\" cy=\"42.6\" r=\".56\"/>" +
      "<circle class=\"hg-grain g3\" cx=\"23.6\" cy=\"44.4\" r=\".44\"/>" +
      "<circle class=\"hg-grain g4\" cx=\"22.7\" cy=\"47.2\" r=\".5\"/>" +
      "<path class=\"hg-gloss\" d=\"M6.4 9.4C6.8 16 9.4 27 12.6 30.2\"/>" +
      "<path class=\"hg-gloss2\" d=\"M39.6 10C39.2 15.4 37.2 26 34.6 29.2\"/>" +
      "<path class=\"hg-glass\" d=\"" + WL + "\" stroke=\"url(#" + gs + ")\"/>" +
      "<path class=\"hg-glass\" d=\"" + WR + "\" stroke=\"url(#" + gs + ")\"/>" +
      "<ellipse class=\"hg-rim\" cx=\"23\" cy=\"4\" rx=\"21\" ry=\"2.4\"/>" +
      "<ellipse class=\"hg-rim\" cx=\"23\" cy=\"64\" rx=\"21\" ry=\"2.4\"/>" +
      "<g class=\"hg-face\">" +
        "<ellipse class=\"hg-blush\" cx=\"15.2\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/>" +
        "<ellipse class=\"hg-blush\" cx=\"30.8\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/>" +
        "<circle class=\"hg-eye\" cx=\"18\" cy=\"10.9\" r=\"1.72\"/>" +
        "<circle class=\"hg-eye\" cx=\"28\" cy=\"10.9\" r=\"1.72\"/>" +
        "<circle class=\"hg-eye-hi\" cx=\"17.4\" cy=\"10.3\" r=\".45\"/>" +
        "<circle class=\"hg-eye-hi\" cx=\"27.4\" cy=\"10.3\" r=\".45\"/>" +
        "<path class=\"hg-mouth\" d=\"M21 13.9Q23 15.6 25 13.9\"/>" +
      "</g>" +
    "</g>" +
  "</svg>";
}

function defs(id){
  return "<defs>" +
   "<clipPath id=\"" + id + "t\"><path d=\"" + TOP + "\"/></clipPath>" +
   "<clipPath id=\"" + id + "b\"><path d=\"" + BOT + "\"/></clipPath>" +
   "<linearGradient id=\"" + id + "s\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"s1\" offset=\"0\"/><stop class=\"s2\" offset=\"1\"/></linearGradient>" +
   "<linearGradient id=\"" + id + "g\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"g1\" offset=\"0\"/><stop class=\"g2\" offset=\"1\"/></linearGradient>" +
   "<linearGradient id=\"" + id + "f\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"f1\" offset=\"0\"/><stop class=\"f2\" offset=\"1\"/></linearGradient>" +
  "</defs>";
}

function faceMark(){
  return "<g class=\"face\">" +
    "<ellipse class=\"blush\" cx=\"15.2\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/><ellipse class=\"blush\" cx=\"30.8\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/>" +
    "<circle class=\"eye\" cx=\"18\" cy=\"10.9\" r=\"1.72\"/><circle class=\"eye\" cx=\"28\" cy=\"10.9\" r=\"1.72\"/>" +
    "<circle class=\"eye-hi\" cx=\"17.4\" cy=\"10.3\" r=\".45\"/><circle class=\"eye-hi\" cx=\"27.4\" cy=\"10.3\" r=\".45\"/>" +
    "<path class=\"mouth\" d=\"M21 13.9Q23 15.6 25 13.9\"/>" +
  "</g>";
}

function glassBody(id, opt){
  opt = opt || {};
  var top = opt.top || ("<g clip-path=\"url(#" + id + "t)\"><path class=\"sand\" d=\"M0 16.2Q23 21.2 46 16.2V34H0Z\"/>" +
    "<path class=\"surface\" d=\"M5 16Q23 21.2 41 16\"/></g>");
  var bot = opt.bot || ("<g clip-path=\"url(#" + id + "b)\"><path class=\"pile\" d=\"M3.4 64C12.5 58.4 17.6 52.4 23.6 52.4C29.6 52.4 33.5 58.4 42.6 64Z\"/></g>");
  return "<path d=\"" + TOP + "\" fill=\"url(#" + id + "f)\"/><path d=\"" + BOT + "\" fill=\"url(#" + id + "f)\"/>" + top + bot +
   (opt.stream === false ? "" : ("<path class=\"stream-soft\" d=\"M23 36V51.6\"/><path class=\"stream\" d=\"M23 36V51.6\"/>" +
    "<circle class=\"grain\" cx=\"23\" cy=\"39\" r=\".78\"/><circle class=\"grain g2\" cx=\"22.1\" cy=\"42.6\" r=\".56\"/>" +
    "<circle class=\"grain g3\" cx=\"23.6\" cy=\"45.4\" r=\".44\"/><circle class=\"grain g4\" cx=\"22.7\" cy=\"48.2\" r=\".5\"/>")) +
   "<path class=\"gloss\" d=\"M6.4 9.4C6.8 16 9.4 27 12.6 30.2\"/><path class=\"gloss2\" d=\"M39.6 10C39.2 15.4 37.2 26 34.6 29.2\"/>" +
   "<path class=\"glass\" d=\"" + WL + "\" stroke=\"url(#" + id + "g)\"/><path class=\"glass\" d=\"" + WR + "\" stroke=\"url(#" + id + "g)\"/>" +
   "<ellipse class=\"rim\" cx=\"23\" cy=\"4\" rx=\"21\" ry=\"2.4\"/><ellipse class=\"rim\" cx=\"23\" cy=\"64\" rx=\"21\" ry=\"2.4\"/>";
}

function buildHop(id){
  var d = defs(id);
  var splash = [[4.2,65.8,-7,-2.2,1],[2.2,66.6,-8.6,-.8,.8],[14,67.2,-3.4,1.2,.9],[23,67.6,0,2,.8],
    [32,67.2,3.4,1.2,.9],[43.8,66.6,8.6,-.8,.8],[41.8,65.8,7,-2.2,1]].map(function(s){
    return "<circle class=\"sp\" cx=\"" + s[0] + "\" cy=\"" + s[1] + "\" r=\"" + s[4] + "\" style=\"--dx:" + s[2] + "px;--dy:" + s[3] + "px\"/>";
  }).join("");
  var inner = "<ellipse class=\"shadow hopSh\" cx=\"23\" cy=\"67\" rx=\"15\" ry=\"1.6\"/>" +
    "<g class=\"hopBody\">" + glassBody(id) + faceMark() + "</g>" + splash;
  return "<svg class=\"art a1\" viewBox=\"-4 0 54 72\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + d + inner + "</svg>";
}

function buildJelly(id){
  var bell = "M10 26C10 11.4 18.6 3.2 30 3.2C41.4 3.2 50 11.4 50 26Q45.4 29 41.6 26Q38.2 29 33.8 26Q30.2 28.6 26.8 26Q22.4 29 18.2 26Q14.4 29 10 26Z";
  var inner =
  "<defs>" +
   "<linearGradient id=\"" + id + "bell\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#E6F8FD\" stop-opacity=\".86\"/><stop offset=\"1\" stop-color=\"#8FD3E9\" stop-opacity=\".5\"/></linearGradient>" +
   "<linearGradient id=\"" + id + "s\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"s1\" offset=\"0\"/><stop class=\"s2\" offset=\"1\"/></linearGradient>" +
   "<clipPath id=\"" + id + "c\"><path d=\"" + bell + "\"/></clipPath>" +
  "</defs>" +
  "<g class=\"drift\"><g class=\"bellPulse\">" +
    "<path class=\"bell\" fill=\"url(#" + id + "bell)\" d=\"" + bell + "\"/>" +
    "<g clip-path=\"url(#" + id + "c)\"><path class=\"bellSand\" d=\"M6 17.2Q30 22.4 54 17.2V31H6Z\"/><path class=\"surface\" d=\"M10 17.2Q30 22.4 50 17.2\"/></g>" +
    "<path class=\"bellHi\" d=\"M13.4 19.6C14 13.4 18.4 8.8 23.8 7.8\"/>" +
    "<g class=\"t\" style=\"transform-origin:21px 27px\"><path class=\"tent-soft\" d=\"M21 26.4C19 33.4 23.4 37.6 20.6 43.6C18.6 48.2 21.4 51.4 20 56.2\"/><path class=\"tent\" d=\"M21 26.4C19 33.4 23.4 37.6 20.6 43.6C18.6 48.2 21.4 51.4 20 56.2\"/></g>" +
    "<g class=\"t t2\" style=\"transform-origin:30px 27.4\"><path class=\"tent-soft\" d=\"M30 27.4C32.4 34.4 28 38.8 31 44.6C33.4 49 30.2 52.2 31.4 57.4\"/><path class=\"tent\" d=\"M30 27.4C32.4 34.4 28 38.8 31 44.6C33.4 49 30.2 52.2 31.4 57.4\"/></g>" +
    "<g class=\"t t3\" style=\"transform-origin:39px 26.6\"><path class=\"tent-soft\" d=\"M39 26.6C41.4 33 37.2 37.4 40.2 43C42.4 47.4 39.6 50.6 40.8 55\"/><path class=\"tent\" d=\"M39 26.6C41.4 33 37.2 37.4 40.2 43C42.4 47.4 39.6 50.6 40.8 55\"/></g>" +
    "<path class=\"stream-soft\" d=\"M30 24V31\"/><path class=\"stream\" d=\"M30 24V31\"/>" +
    "<circle class=\"eye\" cx=\"24.9\" cy=\"13\" r=\"1.8\"/><circle class=\"eye\" cx=\"35.1\" cy=\"13\" r=\"1.8\"/>" +
    "<circle class=\"eye-hi\" cx=\"24.3\" cy=\"12.4\" r=\".48\"/><circle class=\"eye-hi\" cx=\"34.5\" cy=\"12.4\" r=\".48\"/>" +
    "<ellipse class=\"blush\" cx=\"22.4\" cy=\"15.7\" rx=\"1.7\" ry=\".8\"/><ellipse class=\"blush\" cx=\"37.6\" cy=\"15.7\" rx=\"1.7\" ry=\".8\"/>" +
    "<path class=\"mouth\" d=\"M27.8 16.2Q30 18.2 32.2 16.2\"/>" +
    "<circle class=\"grain\" cx=\"20.6\" cy=\"39.6\" r=\".7\"/><circle class=\"grain g2\" cx=\"31\" cy=\"41\" r=\".6\"/><circle class=\"grain g3\" cx=\"40.2\" cy=\"38.8\" r=\".65\"/>" +
  "</g></g>";
  return "<svg class=\"art a2\" viewBox=\"-2 -1 64 62\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + inner + "</svg>";
}

function spiral(cx, cy, turns, rmax, rmin){
  var d = "";
  for(var i = 0; i <= 120; i++){
    var t = i / 120, a = -Math.PI / 2 + t * turns * 2 * Math.PI, r = rmax * (1 - t) + rmin * t;
    d += (i ? "L" : "M") + (cx + Math.cos(a) * r).toFixed(2) + " " + (cy + Math.sin(a) * r).toFixed(2);
  }
  return d;
}

function buildSnail(id){
  var inner =
  "<defs>" +
   "<linearGradient id=\"" + id + "shellG\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop class=\"s1\" offset=\"0\"/><stop class=\"s2\" offset=\"1\"/></linearGradient>" +
   "<linearGradient id=\"" + id + "s\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop class=\"s1\" offset=\"0\"/><stop class=\"s2\" offset=\"1\"/></linearGradient>" +
  "</defs>" +
  "<g class=\"trail\">" +
    "<circle class=\"trailDot\" cx=\"49\" cy=\"54.5\" r=\"1.2\"/>" +
    "<circle class=\"trailDot\" cx=\"55\" cy=\"55\" r=\"1\" style=\"animation-delay:-.6s\"/>" +
    "<circle class=\"trailDot\" cx=\"45.5\" cy=\"55.2\" r=\".9\" style=\"animation-delay:-1.2s\"/>" +
    "<circle class=\"trailDot\" cx=\"52\" cy=\"54.2\" r=\".8\" style=\"animation-delay:-1.8s\"/>" +
  "</g>" +
  "<g class=\"snailMove\">" +
    "<path class=\"body\" d=\"M8 50.5C7 44.6 9.4 38.4 14.6 33.8C17.6 31 21.4 29.6 24.6 31.4C28.8 33.8 32.6 37 35.6 41C37.6 43.6 38.6 46.6 38.6 49.6C35.4 52 30.6 53 26.4 52.4C20.4 51.8 13.4 51.8 8 50.5Z\"/>" +
    "<path class=\"body\" d=\"M11.6 33.8C9.4 30.4 10 25.4 13.6 22.8C17 20.4 21.6 22 23.2 25.8C24.8 29.6 23.2 33.4 19.6 34.6C16.8 35.6 13.4 35.4 11.6 33.8Z\"/>" +
    "<g class=\"shell\">" +
      "<circle cx=\"37.4\" cy=\"36.2\" r=\"14.2\" fill=\"url(#" + id + "shellG)\"/>" +
      "<path class=\"shellHi\" d=\"M29.4 27.6C24.6 31 23 37.6 26 42.6\"/>" +
      "<path class=\"spiral\" d=\"" + spiral(38, 36.6, 2.45, 12.6, 1.4) + "\"/>" +
      "<circle class=\"shellRim\" cx=\"37.4\" cy=\"36.2\" r=\"14.2\"/>" +
      "<path class=\"miniSoft\" d=\"M37.4 36.6V44.4\"/><path class=\"miniStream\" d=\"M37.4 36.6V44.4\"/>" +
      "<circle class=\"grain\" cx=\"37.4\" cy=\"39.2\" r=\".6\"/><circle class=\"grain g2\" cx=\"37.4\" cy=\"42\" r=\".5\"/>" +
    "</g>" +
    "<g class=\"stalk\" style=\"transform-origin:15px 24px\"><path d=\"M14.6 23.6C13.6 19.8 13 17.2 12.6 15.4\" fill=\"none\" stroke=\"var(--bodyLine)\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></g>" +
    "<g class=\"stalk r\" style=\"transform-origin:20px 24px\"><path d=\"M20 23.8C20.6 20 21.4 17.6 22 15.6\" fill=\"none\" stroke=\"var(--bodyLine)\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></g>" +
    "<circle cx=\"12.5\" cy=\"14.4\" r=\"2.5\" fill=\"var(--eyeHi)\" stroke=\"var(--rim)\" stroke-width=\".7\"/>" +
    "<circle cx=\"22.1\" cy=\"14.6\" r=\"2.5\" fill=\"var(--eyeHi)\" stroke=\"var(--rim)\" stroke-width=\".7\"/>" +
    "<circle cx=\"12.9\" cy=\"14.6\" r=\"1.05\" fill=\"var(--eye)\"/><circle cx=\"22.5\" cy=\"14.8\" r=\"1.05\" fill=\"var(--eye)\"/>" +
    "<circle class=\"eye\" cx=\"14.4\" cy=\"26.6\" r=\"1.35\"/><circle class=\"eye\" cx=\"19.6\" cy=\"26.8\" r=\"1.35\"/>" +
    "<path class=\"mouth\" d=\"M15.6 29.8Q17 31.4 18.4 29.8\" stroke-width=\".95\"/>" +
  "</g>";
  return "<svg class=\"art a3\" viewBox=\"0 2 62 58\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + inner + "</svg>";
}

function buildRun(id){
  var d = defs(id);
  var inner = "<ellipse class=\"shadow runSh\" cx=\"23\" cy=\"70\" rx=\"14\" ry=\"1.5\"/>" +
   "<g class=\"speeds\"><path class=\"speed\" d=\"M2 20H-4\"/><path class=\"speed s2\" d=\"M3 31.5H-2.5\"/><path class=\"speed s3\" d=\"M2.5 44H-3.5\"/></g>" +
   "<g class=\"runRig\">" + glassBody(id) + faceMark() +
     "<ellipse class=\"foot\" cx=\"14.2\" cy=\"67.8\" rx=\"3.5\" ry=\"1.8\"/>" +
     "<ellipse class=\"foot b\" cx=\"31.8\" cy=\"67.8\" rx=\"3.5\" ry=\"1.8\"/>" +
   "</g>" +
   "<circle class=\"dust\" cx=\"6.5\" cy=\"69.4\" r=\"1.1\"/><circle class=\"dust d2\" cx=\"10\" cy=\"70.4\" r=\".8\"/>";
  return "<svg class=\"art a4\" viewBox=\"-7 0 60 74\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + d + inner + "</svg>";
}

function buildTide(id){
  var d = defs(id);
  var top = "<g clip-path=\"url(#" + id + "t)\"><g class=\"tideTop\">" +
    "<path class=\"sand\" d=\"M0 8.6Q23 13.8 46 8.6V34H0Z\"/><path class=\"surface\" d=\"M4 8.8Q23 14 42 8.8\"/></g></g>";
  var bot = "<g clip-path=\"url(#" + id + "b)\"><g class=\"tideBot\">" +
    "<path class=\"pile\" d=\"M3.4 64C12.5 58.4 17.6 52.4 23.6 52.4C29.6 52.4 33.5 58.4 42.6 64Z\"/></g></g>";
  var up = [0,1,2,3,4].map(function(i){
    return "<circle class=\"rise r" + (i + 1) + "\" cx=\"" + (22.4 + (i % 3) * .5) + "\" cy=\"" + (50 - i * .4) + "\" r=\"" + (i % 2 ? .55 : .7) + "\"/>";
  }).join("");
  var down = [0,1,2,3,4].map(function(i){
    return "<circle class=\"rise r" + ((i + 2) % 5 + 1) + "\" cx=\"" + (23.2 + (i % 3) * .45) + "\" cy=\"" + (34.6 + i * .4) + "\" r=\"" + (i % 2 ? .55 : .7) + "\"/>";
  }).join("");
  var spark = "<g class=\"spark\"><path d=\"M8 12l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z\"/></g>" +
    "<g class=\"spark k2\"><path d=\"M38 20l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z\"/></g>" +
    "<g class=\"spark k3\"><path d=\"M11 41l.5 1.6 1.6.5-1.6.5-.5 1.6-.5-1.6-1.6-.5 1.6-.5z\"/></g>";
  var inner = "<ellipse class=\"shadow\" cx=\"23\" cy=\"67\" rx=\"15\" ry=\"1.6\"/>" +
    "<g>" + glassBody(id, { top:top, bot:bot, stream:false }) +
      "<ellipse class=\"glow\" cx=\"23\" cy=\"4\" rx=\"21\" ry=\"2.4\"/>" +
      "<ellipse class=\"glow\" cx=\"23\" cy=\"64\" rx=\"21\" ry=\"2.4\"/>" +
      "<path class=\"stream-soft\" d=\"M23 36V51.6\"/><path class=\"stream\" d=\"M23 36V51.6\"/>" +
      "<g class=\"up\">" + up + "</g><g class=\"down\">" + down + "</g>" +
      faceMark() + spark +
    "</g>";
  return "<svg class=\"art a5\" viewBox=\"-6 -3 58 75\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + d + inner + "</svg>";
}

function buildSneeze(id){
  var d = defs(id);
  var burst = [];
  for(var i = 0; i < 12; i++){
    var a = (i / 12) * Math.PI * 2 + 0.35, r = 18 + (i % 3) * 4;
    burst.push("<circle class=\"burst\" cx=\"23\" cy=\"40\" r=\"" + (i % 3 ? .7 : 1) + "\" fill=\"var(--sand2)\" " +
      "style=\"--dx:" + (Math.cos(a) * r).toFixed(1) + "px;--dy:" + (Math.sin(a) * r * 0.85).toFixed(1) + "px\"/>");
  }
  var puffs = [[6,22,-6,-4],[40,24,7,-5],[8,55,-5,3],[39,56,6,4]].map(function(p){
    return "<path class=\"puff\" d=\"M" + p[0] + " " + p[1] + "h3.2\" style=\"--px:" + p[2] + "px;--py:" + p[3] + "px\"/>";
  }).join("");
  var face = "<g class=\"face\">" +
    "<ellipse class=\"blush\" cx=\"15.2\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/><ellipse class=\"blush\" cx=\"30.8\" cy=\"13.2\" rx=\"1.9\" ry=\".9\"/>" +
    "<circle class=\"eye\" cx=\"18\" cy=\"10.9\" r=\"1.72\"/><circle class=\"eye\" cx=\"28\" cy=\"10.9\" r=\"1.72\"/>" +
    "<circle class=\"eye-hi\" cx=\"17.4\" cy=\"10.3\" r=\".45\"/><circle class=\"eye-hi\" cx=\"27.4\" cy=\"10.3\" r=\".45\"/>" +
    "<path class=\"eyeHappy\" d=\"M16.2 11.4Q18.2 9.4 20.2 11.4\"/><path class=\"eyeHappy\" d=\"M25.8 11.4Q27.8 9.4 29.8 11.4\"/>" +
    "<path class=\"mSmile mouth\" d=\"M21 13.9Q23 15.6 25 13.9\"/>" +
    "<ellipse class=\"mO\" cx=\"23\" cy=\"14.9\" rx=\"1\" ry=\"1.2\"/>" +
    "<ellipse class=\"mBig\" cx=\"23\" cy=\"15.2\" rx=\"2.1\" ry=\"1.8\"/>" +
    "<path class=\"mWavy\" d=\"M20.6 15Q22.2 13.9 23.6 15Q25 16.1 26.4 15\"/>" +
    "<path class=\"dizzy\" d=\"M16.3 9.5L19 12.2\"/><path class=\"dizzy\" d=\"M19 9.5L16.3 12.2\"/>" +
    "<path class=\"dizzy\" d=\"M27 9.5L29.7 12.2\"/><path class=\"dizzy\" d=\"M29.7 9.5L27 12.2\"/>" +
  "</g>";
  var inner = "<ellipse class=\"shadow sneezeSh\" cx=\"23\" cy=\"67\" rx=\"15\" ry=\"1.6\"/>" +
    "<g class=\"sneezeBody\">" + glassBody(id) + face + "</g>" +
    "<g class=\"burstWrap\">" + burst.join("") + "</g>" + puffs;
  return "<svg class=\"art a6\" viewBox=\"-8 0 62 73\" aria-hidden=\"true\" style=\"--sg:url(#" + id + "s)\">" + d + inner + "</svg>";
}

var BUILDERS = { hop:buildHop, jelly:buildJelly, snail:buildSnail, run:buildRun, tide:buildTide, sneeze:buildSneeze };

function ornamentSVG(key){
  if(key === "classic") return hourglassSVG();
  var build = BUILDERS[key];
  return build ? build(uid()) : hourglassSVG();
}

/* ==================== 侧栏槽位 ==================== */
var slot = null;
var renderedKey = "";

function navIsTight(){
  var nav = document.querySelector(".side-nav");
  if(!nav) return false;
  if(document.documentElement.getAttribute("data-layout") === "mobile") return true;
  slot.hidden = false;
  var band = slot.getBoundingClientRect().height;
  slot.hidden = true;
  if(!band){ slot.hidden = false; return false; }
  var padBottom = parseFloat(getComputedStyle(nav).paddingBottom) || 0;
  var last = nav.lastElementChild;
  if(!last){ slot.hidden = false; return false; }
  var need = last.getBoundingClientRect().bottom - nav.getBoundingClientRect().top + nav.scrollTop + padBottom;
  var tight = need > nav.clientHeight - band - 2;
  slot.hidden = false;
  return tight;
}

function renderSlot(force){
  slot = slot || $("sideOrnament");
  if(!slot) return;
  if(!orn.on){ slot.hidden = true; return; }
  if(force || renderedKey !== orn.pick){
    slot.innerHTML = ornamentSVG(orn.pick);
    renderedKey = orn.pick;
  }
  slot.hidden = navIsTight();
}

function scheduleSync(){
  if(scheduleSync.queued) return;
  scheduleSync.queued = true;
  requestAnimationFrame(function(){
    scheduleSync.queued = false;
    renderSlot(false);
  });
}

export function initSideOrnament(){
  slot = $("sideOrnament");
  if(!slot) return;
  if(slot.__wired) return;
  slot.__wired = true;
  renderSlot(true);
  window.addEventListener("resize", scheduleSync, { passive:true });
  var nav = document.querySelector(".side-nav");
  if(nav){
    nav.addEventListener("click", scheduleSync);
    nav.addEventListener("keydown", scheduleSync);
    if(window.ResizeObserver) new ResizeObserver(scheduleSync).observe(nav);
  }
  document.addEventListener("visibilitychange", function(){
    document.body.classList.toggle("tab-hidden", document.hidden);
  });
  window.addEventListener("ornament:change", scheduleSync);
  window.addEventListener("storage", function(e){
    if(e.key !== PREF_KEY) return;
    orn = readPref();
    renderSlot(true);
    syncSettings();
  });
}

/* ==================== 个人设置 · 外观 ==================== */
var TICK = "<svg viewBox=\"0 0 10 10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 5.2 4.2 7.4 8 3\"/></svg>";

function syncSettings(){
  var grid = $("meOrnGrid");
  var sw = $("meOrnOn");
  if(!grid || !sw) return;
  sw.checked = orn.on;
  grid.querySelectorAll("[data-orn]").forEach(function(b){
    var on = b.getAttribute("data-orn") === orn.pick;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
    b.disabled = !orn.on;
  });
  grid.setAttribute("aria-disabled", orn.on ? "false" : "true");
  var reason = $("meOrnReason");
  if(reason) reason.hidden = orn.on;
}

export function mountOrnamentSettings(){
  var grid = $("meOrnGrid");
  var sw = $("meOrnOn");
  if(!grid || !sw) return;
  if(!grid.__wired){
    grid.__wired = true;
    grid.innerHTML = ORN_OPTIONS.map(function(o){
      return "<button class=\"orn-opt\" type=\"button\" role=\"radio\" data-orn=\"" + o.key + "\" aria-checked=\"false\">" +
        "<span class=\"orn-pv\">" + ornamentSVG(o.key) + "</span>" +
        "<span class=\"orn-t\"><b>" + o.name + "</b><em>" + o.dur + "</em></span>" +
        "<span class=\"orn-tick\" aria-hidden=\"true\">" + TICK + "</span>" +
      "</button>";
    }).join("");
    grid.addEventListener("click", function(e){
      var b = e.target.closest("[data-orn]");
      if(!b || b.disabled) return;
      setOrnamentPref({ pick:b.getAttribute("data-orn") });
    });
    grid.addEventListener("keydown", function(e){
      if(["ArrowRight","ArrowDown","ArrowLeft","ArrowUp"].indexOf(e.key) < 0) return;
      var list = [].slice.call(grid.querySelectorAll("[data-orn]:not(:disabled)"));
      var i = list.indexOf(document.activeElement);
      if(i < 0) return;
      e.preventDefault();
      var next = (e.key === "ArrowRight" || e.key === "ArrowDown")
        ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next].focus();
      list[next].click();
    });
    sw.addEventListener("change", function(){ setOrnamentPref({ on:sw.checked }); });
    var reset = $("meOrnReset");
    if(reset) reset.addEventListener("click", function(){ setOrnamentPref({ on:true, pick:"classic" }); });
    window.addEventListener("ornament:change", syncSettings);
  }
  syncSettings();
}
