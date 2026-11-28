/* core/tour · 首次进入欢迎卡 + 9 步发版闭环指引（原型 11-27 §15.4）
   欢迎卡只在首次打开时出现一次（localStorage sl-tour-v1）；?tour=1 强制欢迎卡、?tour=2 直接进分步 tour。
   每一步先驱动页面到对应位置，再按真实元素测量高亮；目标不可见时退化为居中卡片，不阻断讲解。 */

import { API } from "./api.js";
import { $ } from "./dom.js";
import { isMobile } from "./layout.js";
import { activeView, showView } from "./router.js";
import { rt } from "./state.js";
import { loadView } from "./view-loader.js";

var SEEN_KEY = "sl-tour-v1";
var lastFocus = null;
var seq = 0;
var opened = { id:"", tab:"" };
var versionTarget = null;

var TOUR = [
  {
    sel:['#sideNav .nav-sub-item[data-view="release"]'],
    prep: function(){ return showView("phase").then(ensureNavOpen); },
    title:"发布计划有独立入口",
    body:"发布计划不再藏在版本的页签里：左侧「版本 → 发布计划」，点进去是跨项目的计划列表，谁都能找到。"
  },
  {
    sel:['#releaseBody .pl-kpis'],
    prep: function(){ return showView("release"); },
    title:"计划列表 —— 跨项目统一排期",
    body:"一个计划可以同时覆盖多个项目的版本；列表按计划窗口排出就绪检查、执行人、状态。右上「新建发布计划」从这里直接开单。"
  },
  {
    sel:['#phaseScopeWrap'],
    prep: function(){ return showView("phase"); },
    title:"范围可切「全部项目 / 项目集 / 单项目」",
    body:"版本列表不用逐个项目切换：范围支持全部项目、项目集和单个项目。进向导选版本时，已发布 / 已关闭版本默认隐藏，越积越多也不干扰。"
  },
  {
    sel:['.vd-next-panel', '.vd-empty-guide'],
    prep: function(){ return openDetail("home"); },
    title:"下一步清单 —— 照做即可",
    body:"进了版本页先看这里：系统根据数据自动算出「下一步该做什么」。做完一项、清单就少一项，不用记流程。"
  },
  {
    sel:['.vd-tabs'],
    prep: function(){ return openDetail("scope"); },
    title:"工作项与需求",
    body:"一个版本 = 一批工作项 + 一批需求。点页签切换，每页右上都有对应的主操作（添加工作项 / 添加需求）。"
  },
  {
    sel:['.vd-rel-plans'],
    prep: function(){ return openDetail("releases"); },
    title:"发布计划（日程存计划）",
    body:"版本的「发布」页也能看到覆盖本版本的计划（含跨项目计划），点「全部发布计划」回到列表。"
  },
  {
    sel:['.vd-rel-records'],
    prep: function(){ return openDetail("releases"); },
    title:"发布记录（记录存事实）",
    body:"发布后在这里如实记一条：什么时间、什么环境、结果如何。填错会有偏差提示；记录成功还能自动收口计划、生成交付说明。"
  },
  {
    sel:['#deliveryBody .dl-head'],
    prep: openDelivery,
    title:"交付说明",
    body:"发布记录够了，交付说明就自动生成。对外表述逐条确认后即为可交付状态，右上角可导出。"
  },
  {
    sel:null,
    prep: function(){ return openDetail("releases"); },
    title:"轮到你了",
    body:"流程串起来了：版本 → 计划 → 记录 → 交付。现在试一遍：在版本详情点「记录实际发布」，把那条生产发布记下来，看页面会自动发生什么。"
  }
];

function ensureNavOpen(){
  document.body.classList.remove("side-rail");
  var item = document.querySelector('#sideNav .nav-sub-item[data-view="release"]');
  if(!item) return;
  var group = item.closest(".nav-group");
  if(group){
    group.classList.add("open");
    var exp = group.querySelector(".nav-exp");
    if(exp) exp.setAttribute("aria-expanded", "true");
  }
}

function waitFor(fn, timeout){
  var limit = timeout || 6000;
  var start = Date.now();
  return new Promise(function(resolve){
    (function tick(){
      var el = null;
      try{ el = fn(); }catch(e){ el = null; }
      if(el || Date.now() - start > limit){ resolve(el); return; }
      setTimeout(tick, 100);
    })();
  });
}

function firstVisible(selectors){
  for(var i = 0; i < selectors.length; i++){
    var el = document.querySelector(selectors[i]);
    if(el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) return el;
  }
  return null;
}

function ensureVersionTarget(){
  if(versionTarget && versionTarget.id) return Promise.resolve(versionTarget);
  var reqId = rt.phaseReqId || (($("phaseReq") || {}).value) || "";
  var p = reqId ? Promise.resolve(reqId) : waitFor(function(){ return $("phaseReq") && $("phaseReq").value; }, 5000).then(function(el){ return el && el.value; });
  return p.then(function(id){
    if(!id) throw new Error("没有可打开的项目");
    return API.get("/api/versions", { reqId:id });
  }).then(function(list){
    list = list || [];
    var open = list.filter(function(v){ return v.status === "active" || v.status === "planned"; });
    var pick = open.filter(function(v){ return Number(v.taskCount) > 0; })[0]
      || open[0]
      || list.filter(function(v){ return Number(v.taskCount) > 0; })[0]
      || list[0];
    if(pick && Number(pick.taskCount) > 0){
      versionTarget = { reqId:reqId || (pick.reqId || ""), id:pick.id, name:pick.name };
      return versionTarget;
    }
    /* 当前项目还没有含工作项的版本时，用未收口发布计划覆盖的版本做示例 */
    return API.get("/api/release-plans", { status:"all" }).then(function(plans){
      var row = (plans || []).filter(function(r){
        return r.versionId && r.reqId && r.status !== "completed" && r.status !== "canceled";
      })[0] || (plans || []).filter(function(r){ return r.versionId && r.reqId; })[0];
      if(row){
        versionTarget = { reqId:row.reqId, id:row.versionId, name:row.versionName };
        return versionTarget;
      }
      if(!pick) throw new Error("这个项目还没有版本");
      versionTarget = { reqId:reqId || (list[0].reqId || ""), id:pick.id, name:pick.name };
      return versionTarget;
    }).catch(function(){
      if(!pick) throw new Error("这个项目还没有版本");
      versionTarget = { reqId:reqId || (list[0].reqId || ""), id:pick.id, name:pick.name };
      return versionTarget;
    });
  });
}

function openDetail(tab){
  return ensureVersionTarget().then(function(t){
    if(activeView === "version" && opened.id === t.id && opened.tab === tab) return null;
    if(activeView === "version" && opened.id === t.id){
      var btn = document.querySelector('.vd-tab[data-vd-tab="' + tab + '"]');
      if(btn){ opened.tab = tab; btn.click(); return null; }
    }
    return loadView("version").then(function(m){
      opened = { id:t.id, tab:tab };
      m.openVersionDetail(t.reqId, t.id, tab);
    });
  });
}

function openDelivery(){
  return ensureVersionTarget().then(function(t){
    return loadView("delivery").then(function(m){
      m.openDeliveryNote(t.id, "");
    });
  });
}

function maskHTML(){
  return '<button id="tourReplay" class="tour-replay" type="button" title="重播新手引导" aria-label="重播新手引导">?</button>'
    + '<div id="welcomeMask" class="welcome-mask" hidden>'
    + '<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="wcTitle">'
    + '<div class="wc-head"><div id="wcTitle" class="wc-title">欢迎来到「版本」<span class="wc-time">3 分钟学会发布全流程</span></div>'
    + '<div class="wc-sub">版本 = 一次要交付的批次。完整闭环只有 4 步，照着做就行：</div></div>'
    + '<div class="wc-steps">'
    + '<div class="ws"><div class="n is-purple">1</div><div class="t">建版本</div><div class="d">定目标与时间盒；可以先建空壳，需求和工作项随时补。</div></div>'
    + '<div class="ws"><div class="n is-blue">2</div><div class="t">做发布计划</div><div class="d">日程存计划：什么时候、发哪些版本（<b>可跨项目</b>）、谁验收。</div></div>'
    + '<div class="ws"><div class="n is-green">3</div><div class="t">记录发布</div><div class="d">记录存事实：发布后如实记一条；和计划有偏差要写理由。</div></div>'
    + '<div class="ws"><div class="n is-orange">4</div><div class="t">生成交付说明</div><div class="d">记录够了自动生成草稿，逐条确认对外表述后即可导出。</div></div>'
    + '</div>'
    + '<div class="wc-tips">'
    + '<div>· 不知道下一步做什么？看版本页的<b>「下一步」清单</b>，做完一项少一项。</div>'
    + '<div>· 发布计划有<b>独立入口</b>（左侧 版本 → 发布计划），列表跨项目排期；一个计划能同时覆盖多个项目的版本。</div>'
    + '<div>· 版本列表的范围支持<b>全部项目 / 项目集 / 单项目</b>；向导里已发布、已关闭版本默认隐藏。</div>'
    + '</div>'
    + '<div class="wc-foot"><button class="btn" type="button" data-wc-skip>跳过，先自己逛逛</button>'
    + '<span class="sp"></span><span class="wc-note">可随时点右下角 ? 重看</span>'
    + '<button class="btn primary" type="button" data-wc-start>开始 3 分钟指引 →</button></div>'
    + '</div></div>'
    + '<div id="tourMask" class="tour-mask" hidden>'
    + '<div class="tour-box" id="tourBox"></div>'
    + '<div class="tour-card" id="tourCard" role="dialog" aria-modal="true" aria-labelledby="tourTitle">'
    + '<div class="tour-head"><span id="tourStep"></span><span id="tourDots" class="tour-dots"></span>'
    + '<button class="tour-skip" type="button" data-tour-skip>跳过 ✕</button></div>'
    + '<div class="tour-title" id="tourTitle"></div><div class="tour-body" id="tourBody"></div>'
    + '<div class="tour-nav"><button class="btn" type="button" id="tourPrev" data-tour-prev>← 上一步</button>'
    + '<button class="btn primary" type="button" id="tourNext" data-tour-next>下一步 →</button></div>'
    + '</div></div>';
}

function markSeen(){
  try{ localStorage.setItem(SEEN_KEY, "1"); }catch(e){ /* 受限环境忽略 */ }
}

function openWelcome(){
  var mask = $("welcomeMask");
  if(!mask) return;
  lastFocus = document.activeElement;
  mask.hidden = false;
  document.body.classList.add("tour-lock");
  var start = mask.querySelector("[data-wc-start]");
  if(start) start.focus();
}

function closeWelcome(mark){
  var mask = $("welcomeMask");
  if(mask) mask.hidden = true;
  document.body.classList.remove("tour-lock");
  if(mark) markSeen();
  restoreFocus();
}

function restoreFocus(){
  if(lastFocus && document.documentElement.contains(lastFocus)){
    try{ lastFocus.focus({ preventScroll:true }); }catch(e){ /* noop */ }
  }
}

function focusCard(){
  var card = $("tourCard");
  if(!card) return;
  var active = document.activeElement;
  if(active && card.contains(active)) return;
  var next = $("tourNext");
  if(next) next.focus({ preventScroll:true });
}

function startTour(){
  closeWelcome(true);
  var mask = $("tourMask");
  if(!mask) return;
  lastFocus = document.activeElement;
  mask.hidden = false;
  document.body.classList.add("tour-lock");
  tourGo(0);
  focusCard();
}

function endTour(){
  seq++;
  var mask = $("tourMask");
  if(mask) mask.hidden = true;
  document.body.classList.remove("tour-lock");
  markSeen();
  restoreFocus();
}

var placeToken = 0;
function centerCard(card){
  card.style.width = "";
  card.style.left = Math.max(12, (window.innerWidth - card.offsetWidth) / 2) + "px";
  card.style.top = Math.max(12, (window.innerHeight - card.offsetHeight) / 2) + "px";
}
function drawBox(el, card, token){
  var box = $("tourBox");
  if(!box) return;
  try{ el.scrollIntoView({ block:"center", inline:"nearest" }); }catch(e){ /* noop */ }
  setTimeout(function(){
    if(token !== undefined && token !== placeToken) return;
    if($("tourMask").hidden) return;
    var r = el.getBoundingClientRect();
    if(!r.width && !r.height) return;
    box.hidden = false;
    box.style.top = (r.top - 8) + "px";
    box.style.left = (r.left - 8) + "px";
    box.style.width = (r.width + 16) + "px";
    box.style.height = (r.height + 16) + "px";
    var cw = card.offsetWidth, ch = card.offsetHeight;
    var left, top;
    if(r.right + 16 + cw < window.innerWidth){
      left = r.right + 16;
      top = Math.min(Math.max(12, r.top), window.innerHeight - ch - 12);
    }else{
      left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
      var below = r.bottom + 16;
      top = below + ch + 12 < window.innerHeight ? below : Math.max(12, r.top - ch - 16);
    }
    card.style.left = left + "px";
    card.style.top = top + "px";
  }, 180);
}
/* 目标可能因数据回填被重绘：找不到或量到 0 时短轮询，别一次失手就把描边藏掉 */
function place(step){
  var card = $("tourCard");
  if(!card) return;
  var token = ++placeToken;
  var box = $("tourBox");
  var el = step.sel ? firstVisible(step.sel) : null;
  if(!el){
    if(box) box.hidden = true;
    centerCard(card);
  }else{
    drawBox(el, card, token);
  }
  if(!step.sel) return;
  var tries = 0;
  (function retry(){
    if(token !== placeToken || $("tourMask").hidden) return;
    var current = $("tourBox");
    var again = firstVisible(step.sel);
    /* 目标换了节点（数据回填重绘）或当前描边没画出来：按新节点重画，避免一直框着兜底大容器 */
    if(again && (again !== el || !current || current.hidden || !current.getBoundingClientRect().width)){
      el = again;
      drawBox(again, card, token);
    }
    if(++tries < 50) setTimeout(retry, 200);
  })();
}

function tourGo(i){
  if(i < 0) return;
  if(i >= TOUR.length){ endTour(); return; }
  var step = TOUR[i], mine = ++seq;
  /* 换步先收起上一步描边，并作废还没到点的重绘定时器 */
  var stale = $("tourBox");
  if(stale) stale.hidden = true;
  placeToken++;
  var stepEl = $("tourStep"), dots = $("tourDots"), title = $("tourTitle"), body = $("tourBody");
  var prev = $("tourPrev"), next = $("tourNext");
  if(stepEl) stepEl.textContent = "步骤 " + (i + 1) + " / " + TOUR.length;
  if(dots) dots.innerHTML = TOUR.map(function(_, k){ return '<i class="' + (k === i ? "on" : "") + '"></i>'; }).join("");
  if(title) title.textContent = step.title;
  if(body) body.textContent = step.body;
  if(prev) prev.style.visibility = i === 0 ? "hidden" : "visible";
  if(next) next.textContent = i === TOUR.length - 1 ? "完成，开始操作 ✓" : "下一步 →";
  currentStep = i;
  Promise.resolve().then(function(){ return step.prep ? step.prep() : null; }).catch(function(){ return null; }).then(function(){
    if(mine !== seq) return;
    if(!step.sel) return null;
    return waitFor(function(){
      return firstVisible(step.sel);
    }, 4000);
  }).then(function(el){
    if(mine !== seq) return;
    place(step);
    if(el){
      /* 内容可能晚一点到（表格/计划卡片），再量一次保证描边贴合 */
      setTimeout(function(){ if(mine === seq) place(step); }, 450);
    }
  });
}

var currentStep = 0;

function trap(e, root){
  if(e.key !== "Tab") return;
  var nodes = Array.prototype.filter.call(
    root.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    function(el){ return el.getBoundingClientRect().width > 0; }
  );
  if(!nodes.length) return;
  var first = nodes[0], last = nodes[nodes.length - 1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}

function onKey(e){
  var welcome = $("welcomeMask"), mask = $("tourMask");
  if(welcome && !welcome.hidden){
    if(e.key === "Escape"){ e.preventDefault(); closeWelcome(true); return; }
    trap(e, welcome.querySelector(".welcome"));
    return;
  }
  if(!mask || mask.hidden) return;
  if(e.key === "Escape"){ e.preventDefault(); endTour(); return; }
  if(e.key === "ArrowRight"){ e.preventDefault(); tourGo(currentStep + 1); return; }
  if(e.key === "ArrowLeft" && currentStep > 0){ e.preventDefault(); tourGo(currentStep - 1); return; }
  trap(e, $("tourCard"));
}

/* 引导讲的是「版本」发版闭环，只属于版本域：进入这些视图才允许自动弹出与重播 */
var VERSION_VIEWS = { phase:1, release:1, version:1, delivery:1, record:1, "plan-wizard":1 };
function inVersionScope(){ return !!VERSION_VIEWS[activeView]; }
function syncReplay(){
  var btn = $("tourReplay");
  if(btn) btn.style.display = inVersionScope() ? "" : "none";
}
function maybeAutoWelcome(){
  if(!inVersionScope()) return;
  var seen = null;
  try{ seen = localStorage.getItem(SEEN_KEY); }catch(e){ seen = null; }
  if(seen) return;
  markSeen();
  setTimeout(function(){ if(inVersionScope() && !isMobile()) openWelcome(); }, 500);
}

export function initTour(){
  if($("welcomeMask")) return;
  var host = document.createElement("div");
  host.innerHTML = maskHTML();
  while(host.firstChild) document.body.appendChild(host.firstChild);

  document.addEventListener("click", function(e){
    if(e.target.closest("#tourReplay")){ openWelcome(); return; }
    if(e.target.closest("[data-wc-skip]")){ closeWelcome(true); return; }
    if(e.target.closest("[data-wc-start]")){ startTour(); return; }
    if(e.target.closest("[data-tour-skip]")){ endTour(); return; }
    if(e.target.closest("[data-tour-next]")){ tourGo(currentStep + 1); return; }
    if(e.target.closest("[data-tour-prev]")){ tourGo(currentStep - 1); return; }
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("ds:view-change", function(){
    syncReplay();
    maybeAutoWelcome();
  });

  var search = String(window.location.search || "");
  if(/[?&]tour=1(&|$)/.test(search)){ syncReplay(); setTimeout(openWelcome, 600); return; }
  if(/[?&]tour=2(&|$)/.test(search)){ syncReplay(); setTimeout(startTour, 600); return; }
  if(/[?&]demo=/.test(search)){ syncReplay(); return; }
  syncReplay();
  maybeAutoWelcome();
}
