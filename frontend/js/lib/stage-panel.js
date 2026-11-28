/* lib/stage-panel · 阶段投入面板与下钻抽屉（可复用 DOM 生成）
   口径全部来自 lib/stage-hours；这里只负责三卡、条、表、行内构成与抽屉。
   页面只需传入 summarizeStages 结果与明细行，点击用 data-stage-* 统一委托。 */

import { esc, UI } from "../core/ui.js";
import { icon } from "../core/icons.js";
import { openTaskById } from "../core/task-actions.js";
import { fmtMinutesShort } from "./format.js";
import { STAGE_META, stageEpic, stageActualOf } from "./stage-hours.js";

function minutes(v){ return Math.max(0, Number(v) || 0); }
export function stageHoursText(v){
  var n = minutes(v);
  if(!n) return "0h";
  /* 与工作项详情/需求页共用一套时长格式（h+m），避免同一数值在不同页面显示成 1.5h / 1h30m 两种 */
  return fmtMinutesShort(n);
}
function pctOf(v, total){
  return total ? Math.round(minutes(v) * 100 / total) : 0;
}
/* 三段取整后可能差 1%：差额落在最后一段，保证条宽、图例与表格一致 */
function stagePcts(stage, denom, key){
  var parts = STAGE_META.map(function(m){ return { key:m.key, p:pctOf(stage[key || "act"][m.key], denom) }; });
  var sum = parts.reduce(function(a, p){ return a + p.p; }, 0);
  if(parts.length && denom) parts[parts.length - 1].p += 100 - sum;
  return parts;
}
function deltaText(act, est){
  if(!est) return "—";
  var d = Math.round((minutes(act) - minutes(est)) * 100 / minutes(est));
  return (d > 0 ? "+" : "") + d + "%";
}
function scopeAttrs(scope, ver){
  return ' data-stage-scope="' + esc(scope || "") + '"'
    + (ver ? ' data-stage-ver="' + esc(ver) + '"' : "");
}
export function stageTypeName(type){
  return { story:"需求", task:"任务", bug:"缺陷", epic:"史诗" }[type] || "其他";
}
/* 页面把工作项转成抽屉行：只带有计时的工作项，史诗不出现；阶段分钟互不重叠 */
export function stageDrillRows(tasks, opts){
  opts = opts || {};
  var rows = [];
  (tasks || []).forEach(function(t){
    if(stageEpic(t)) return;
    var a = stageActualOf(t);
    if(a.product + a.dev + a.test <= 0) return;
    rows.push({
      id:t.id,
      title:t.title || "",
      type:t.itemType || "",
      category:opts.catName ? opts.catName(t.categoryId) : "",
      owner:t.owner || "",
      versionName:opts.versionName ? opts.versionName(t) : "",
      minutes:a
    });
  });
  return rows;
}

/* ---------- 三张阶段卡 ---------- */
function cardsHTML(stage, mode, scope, ver){
  var isEst = mode === "estimate";
  var denom = isEst ? stage.estTotal : stage.actTotal;
  return '<div class="stage-grid">' + STAGE_META.map(function(m){
    var v = isEst ? stage.est[m.key] : stage.act[m.key];
    var other = isEst ? stage.act[m.key] : stage.est[m.key];
    var zero = !v;
    var meta = (zero && m.key === "product" && !isEst)
      ? "暂无需求类工作项，不做摊派"
      : (isEst ? "实际 " : "预估 ") + stageHoursText(other) + " · 占 " + pctOf(v, denom) + "%";
    return '<button class="stage-card" type="button" data-stage-drill="' + m.key + '"' + scopeAttrs(scope, ver)
      + ' title="下钻：' + esc(m.name) + '阶段的工作项">'
      + '<span class="stage-name"><i style="background:' + m.color + '"></i>' + esc(m.name) + '</span>'
      + '<span class="stage-v' + (zero ? " zero" : "") + '">' + (zero ? "—" : esc(stageHoursText(v))) + '</span>'
      + '<span class="stage-meta">' + esc(meta) + '</span>'
      + '<span class="stage-items">' + (stage.count[m.key] || 0) + ' 项有计时</span>'
      + '<span class="stage-cta">查看明细 →</span>'
      + '</button>';
  }).join("") + '</div>';
}
/* ---------- 8px 三段条与图例 ---------- */
function barHTML(stage, mode, scope, ver){
  var isEst = mode === "estimate";
  var denom = isEst ? stage.estTotal : stage.actTotal;
  if(!denom){
    return '<p class="stage-empty"><b>还没有已结束的计时</b>，产品 / 开发 / 测试拆分要等第一条计时产生。</p>';
  }
  var ps = stagePcts(stage, denom);
  var parts = STAGE_META.map(function(m, i){
    return { key:m.key, name:m.name, color:m.color, v:isEst ? stage.est[m.key] : stage.act[m.key], p:ps[i].p };
  });
  var aria = (isEst ? "预估" : "实际") + "工时中" + parts.map(function(p){ return p.name + " " + p.p + "%"; }).join("，");
  return '<div class="stage-bar" role="img" aria-label="' + esc(aria) + '">'
    + parts.map(function(p){
      return p.v > 0 ? '<i style="width:' + p.p + '%;background:' + p.color + '"></i>' : '';
    }).join("")
    + '</div><div class="stage-legend">'
    + parts.map(function(p){
      return '<button type="button" data-stage-drill="' + p.key + '"' + scopeAttrs(scope, ver) + ' title="下钻：' + esc(p.name) + '阶段的工作项">'
        + '<i style="background:' + p.color + '"></i>' + esc(p.name) + ' <b>' + (p.v ? esc(stageHoursText(p.v)) : "—") + '</b>'
        + '<span class="muted">' + (p.v ? p.p + "%" : "") + '</span></button>';
    }).join("") + '</div>';
}
/* ---------- 阶段表 ---------- */
function tableHTML(stage, scope, ver){
  var ps = stagePcts(stage, stage.actTotal);
  var rows = STAGE_META.map(function(m, i){
    var s = { act:stage.act[m.key], est:stage.est[m.key], items:stage.count[m.key] || 0 };
    var zero = !s.act;
    return '<tr tabindex="0" data-stage-drill="' + m.key + '"' + scopeAttrs(scope, ver)
      + ' title="下钻：' + esc(m.name) + '阶段的工作项">'
      + '<td><span class="st-name"><i style="background:' + m.color + '"></i>' + esc(m.name) + '</span>'
      + '<small class="st-note">' + esc(m.note) + '</small></td>'
      + '<td class="num">' + s.items + '</td>'
      + '<td class="num">' + (s.est ? esc(stageHoursText(s.est)) : "0h") + '</td>'
      + '<td class="num">' + (zero ? '<span class="muted">—</span>' : esc(stageHoursText(s.act))) + '</td>'
      + '<td class="num">' + (zero ? '<span class="muted">—</span>' : ps[i].p + "%") + '</td>'
      + '<td class="num">' + (zero ? '<span class="muted">—</span>' : deltaText(s.act, s.est)) + '</td>'
      + '<td class="num"><span class="st-go">明细 →</span></td></tr>';
  }).join("");
  return '<div class="tbl-wrap"><table class="phase-tbl stage-tbl"><thead><tr>'
    + '<th>阶段</th><th class="num">条目</th><th class="num">预估</th><th class="num">实际</th>'
    + '<th class="num">实际占比</th><th class="num">偏差</th><th class="num">明细</th>'
    + '</tr></thead><tbody>' + rows
    + '<tr class="roll-total"><td><b>合计</b><small class="st-note">三个阶段互不重叠</small></td>'
    + '<td class="num">' + stage.items + '</td>'
    + '<td class="num">' + (stage.estTotal ? esc(stageHoursText(stage.estTotal)) : "0h") + '</td>'
    + '<td class="num">' + esc(stageHoursText(stage.actTotal)) + '</td>'
    + '<td class="num">' + (stage.actTotal ? "100%" : "—") + '</td>'
    + '<td class="num">' + deltaText(stage.actTotal, stage.estTotal) + '</td><td></td></tr>'
    + '</tbody></table></div>';
}
var CALIBER = "测试窗口（提测 → 测试结束）内的计时先归「测试」；剩余按工作项类型拆：需求类归「产品 / 设计」，任务 / 缺陷归「开发」。"
  + "三段互不重叠，合计等于实际工时。产品 / 设计是近似口径：统计需求类工作项上的全部非测试计时，不做摊派。"
  + "测试窗口按自然日判断；预估按字段拆：需求预计耗时、任务 / 缺陷预计耗时、测试预估；史诗不计工时。";

/* opts: stage / mode / title / sub / scope / versionId / badge / table / toggle / note / zeroNote / denomLabel */
export function stagePanelHTML(opts){
  opts = opts || {};
  var stage = opts.stage || { items:0, timed:0, count:{product:0,dev:0,test:0}, est:{product:0,dev:0,test:0}, act:{product:0,dev:0,test:0}, estTotal:0, actTotal:0 };
  var mode = opts.mode === "estimate" ? "estimate" : "actual";
  var scope = opts.scope || "";
  var ver = opts.versionId || "";
  var zeroNote = opts.zeroNote !== false && mode === "actual" && stage.actTotal > 0 && !stage.act.product
    ? '<p class="stage-empty">暂无需求类工作项，产品 / 设计计 0，不做摊派。</p>' : '';
  var tools = (opts.badge ? '<span class="tag tag-ghost">' + esc(opts.badge) + '</span>' : '')
    + (opts.toggle === false ? "" : '<span class="seg mini" role="group" aria-label="统计口径">'
      + '<button type="button" data-stage-mode="actual" aria-pressed="' + (mode === "actual") + '">实际</button>'
      + '<button type="button" data-stage-mode="estimate" aria-pressed="' + (mode === "estimate") + '">预估</button></span>')
    + '<details class="manager-caliber"><summary>口径</summary><div>' + CALIBER + '</div></details>';
  return '<section class="manager-panel stage-panel" data-stage-panel>'
    + '<div class="manager-panel-head"><div class="stage-head-l"><b>' + esc(opts.title || "阶段投入") + '</b>'
    + '<span>' + esc(opts.sub || "") + '</span></div>'
    + '<div class="stage-tools">' + tools + '</div></div>'
    + zeroNote
    + cardsHTML(stage, mode, scope, ver)
    + barHTML(stage, mode, scope, ver)
    + (opts.note ? '<p class="stage-note">' + esc(opts.note) + '</p>' : '')
    + (opts.table === false ? "" : tableHTML(stage, scope, ver))
    + '<div class="stage-foot"><span>实际占比以' + esc(opts.denomLabel || "全部实际工时") + '为分母；条目不可相加，同一工作项可同时出现在多个阶段。</span>'
    + '<span>产品 / 设计为近似口径。</span></div>'
    + '</section>';
}

/* ---------- 版本行「阶段构成」 ---------- */
/* opts: versionId / scope / versionName */
export function stageRowHTML(stage, opts){
  opts = opts || {};
  var total = stage.actTotal;
  var ver = opts.versionId || "";
  var scope = opts.scope || "";
  var short = { product:"产品", dev:"开发", test:"测试" };
  if(!total){
    return '<div class="vstage" title="尚未开始计时">'
      + '<span class="vstage-bar empty"></span>'
      + '<span class="vstage-txt">尚未开始计时</span>'
      + '<span class="vstage-chips"><span class="vchip zero">尚未开始计时</span></span></div>';
  }
  var ps = stagePcts(stage, total);
  var segs = STAGE_META.map(function(m, i){
    var v = stage.act[m.key];
    return v > 0
      ? '<button type="button" class="vstage-seg" data-stage-drill="' + m.key + '"' + scopeAttrs(scope, ver)
        + ' style="width:' + ps[i].p + '%;background:' + m.color + '"'
        + ' aria-label="下钻：' + esc(short[m.key] + " " + stageHoursText(v)) + '" title="下钻：' + esc(short[m.key] + " " + stageHoursText(v)) + '"></button>'
      : "";
  }).join("");
  var text = STAGE_META.map(function(m){
    var v = stage.act[m.key];
    return short[m.key] + " " + (v ? esc(stageHoursText(v)) : "—");
  }).join(" · ");
  var chips = '<span class="vstage-chips">' + STAGE_META.map(function(m){
    var v = stage.act[m.key];
    return '<button type="button" class="vchip' + (v ? "" : " zero") + '" data-stage-drill="' + m.key + '"' + scopeAttrs(scope, ver) + '>'
      + '<i style="background:' + m.color + '"></i>' + short[m.key] + ' <b>' + (v ? esc(stageHoursText(v)) : "—") + '</b></button>';
  }).join("") + '</span>';
  var aria = STAGE_META.map(function(m){ return short[m.key] + " " + stageHoursText(stage.act[m.key]); }).join("，");
  return '<div class="vstage" title="' + esc(aria) + '">'
    + '<span class="vstage-bar" role="img" aria-label="' + esc(aria) + '">' + segs + '</span>'
    + '<span class="vstage-txt">' + text + '</span>' + chips + '</div>';
}

/* ---------- 下钻抽屉 ---------- */
/* opts: scopeLabel / stageKey / rows / denominatorLabel */
export function openStageDrill(opts){
  opts = opts || {};
  var rows = opts.rows || [];
  var state = { stage:opts.stageKey || "", q:"" };
  var layer = document.createElement("div");
  layer.className = "modal-layer side stage-drill";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "阶段投入明细");
  layer.innerHTML = '<div class="sheet">'
    + '<div class="sheet-head"><div class="drill-head-tx"><h2>阶段投入明细</h2><p class="drill-sub" data-drill-sub></p></div>'
    + '<button class="icon-btn sm" type="button" data-drill-close aria-label="关闭明细">' + icon("close", 16) + '</button></div>'
    + '<div class="drill-tools" data-drill-tools></div>'
    + '<div class="sheet-body drill-body" data-drill-body></div>'
    + '<div class="drill-foot" data-drill-foot></div>'
    + '</div>';
  document.body.appendChild(layer);

  function stageMeta(key){ return STAGE_META.filter(function(m){ return m.key === key; })[0] || null; }
  function sumAll(){ return rows.reduce(function(a, r){ return a + minutes(r.minutes.product) + minutes(r.minutes.dev) + minutes(r.minutes.test); }, 0); }
  function stageSum(key){ return rows.reduce(function(a, r){ return a + minutes(r.minutes[key]); }, 0); }
  function matched(){
    var q = state.q.trim().toLowerCase();
    return rows.filter(function(r){
      if(state.stage && !minutes(r.minutes[state.stage])) return false;
      if(!state.stage && !(minutes(r.minutes.product) + minutes(r.minutes.dev) + minutes(r.minutes.test))) return false;
      if(!q) return true;
      return [r.title, r.category, r.owner, r.versionName, stageTypeName(r.type)].join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }
  function stageCell(r){
    if(state.stage) return '<b>' + esc(stageHoursText(r.minutes[state.stage])) + '</b>';
    var parts = STAGE_META.filter(function(m){ return minutes(r.minutes[m.key]); }).map(function(m){
      return '<span class="drill-st"><i style="background:' + m.color + '"></i>' + esc(m.name) + ' <b>' + esc(stageHoursText(r.minutes[m.key])) + '</b></span>';
    });
    return '<span class="drill-multi">' + parts.join("") + '</span>';
  }
  function totalOf(r){ return minutes(r.minutes.product) + minutes(r.minutes.dev) + minutes(r.minutes.test); }
  function paints(){
    var list = matched();
    var scope = opts.scopeLabel || "全部工作项";
    var m = stageMeta(state.stage);
    var denom = m ? stageSum(m.key) : sumAll();
    $(layer, "[data-drill-sub]").textContent = m
      ? scope + " · " + m.name + " · " + stageHoursText(denom) + " / " + stageHoursText(sumAll()) + "（" + pctOf(denom, sumAll()) + "%）"
      : scope + " · 全部阶段 · " + stageHoursText(sumAll());
    var tools = '<span class="fchip"><span>范围</span><b>' + esc(scope) + '</b></span>';
    if(m){
      tools += '<span class="fchip" style="--chip:' + m.color + '"><i class="fdot" style="background:' + m.color + '"></i>' + esc(m.name) + ' '
        + '<button type="button" data-drill-clear-stage aria-label="移除阶段筛选">×</button></span>';
    }
    tools += '<button class="link-btn" type="button" data-drill-clear' + (m || state.q ? "" : " disabled") + '>清除筛选</button>'
      + '<input class="drill-search" type="search" data-drill-search placeholder="搜索工作项、分类、负责人" aria-label="搜索工作项、分类、负责人" value="' + esc(state.q) + '">';
    $(layer, "[data-drill-tools]").innerHTML = tools;
    var body;
    if(!list.length){
      body = '<div class="drill-empty"><span class="ico">' + icon("search", 18) + '</span><b>没有符合条件的明细</b>'
        + '<p>' + (state.q ? '没有匹配「' + esc(state.q) + '」的工作项，换个关键词或清除筛选。' : (m ? '该范围还没有「' + esc(m.name) + '」阶段的计时明细。' : '该范围还没有已结束的计时。')) + '</p>'
        + '<button class="btn sm" type="button" data-drill-clear>清除筛选</button></div>';
    }else{
      var table = '<div class="tbl-wrap drill-table-wrap"><table class="phase-tbl drill-tbl"><thead><tr>'
        + '<th>工作项</th><th>类型</th><th>分类</th><th>负责人</th><th class="num">阶段工时</th><th class="num">总实际</th>'
        + '</tr></thead><tbody>' + list.map(function(r){
          var typeLabel = stageTypeName(r.type), catLabel = r.category || "未分类", ownerLabel = r.owner || "未指派";
          return '<tr tabindex="0" data-drill-task="' + esc(r.id) + '" title="打开工作项">'
            + '<td><span class="drill-title"><b>' + esc(r.title) + '</b>'
            + (r.versionName ? '<small>' + esc(r.versionName) + '</small>' : '') + '</span></td>'
            + '<td class="drill-clip" title="' + esc(typeLabel) + '">' + esc(typeLabel) + '</td>'
            + '<td class="drill-clip" title="' + esc(catLabel) + '">' + esc(catLabel) + '</td>'
            + '<td class="drill-clip" title="' + esc(ownerLabel) + '">' + esc(ownerLabel) + '</td>'
            + '<td class="num">' + stageCell(r) + '</td>'
            + '<td class="num">' + esc(stageHoursText(totalOf(r))) + '</td></tr>';
        }).join("") + '</tbody></table></div>';
      var cards = '<div class="drill-cards">' + list.map(function(r){
        return '<button class="drill-card" type="button" data-drill-task="' + esc(r.id) + '">'
          + '<span class="dc-head"><b>' + esc(r.title) + '</b><span class="dc-h">' + esc(stageHoursText(totalOf(r))) + '</span></span>'
          + '<span class="dc-meta">' + [r.versionName, stageTypeName(r.type), r.category || "未分类", r.owner || "未指派"].filter(Boolean).map(esc).join(" · ") + '</span>'
          + '<span class="dc-foot"><span>' + (m ? esc(m.name) : "阶段工时") + '<b> ' + esc(stageHoursText(m ? r.minutes[m.key] : totalOf(r))) + '</b></span><span>总实际 <b>' + esc(stageHoursText(totalOf(r))) + '</b></span></span>'
          + '</button>';
      }).join("") + '</div>';
      body = table + cards;
    }
    $(layer, "[data-drill-body]").innerHTML = body;
    $(layer, "[data-drill-foot]").innerHTML = '<span>' + list.length + ' 个工作项 · 阶段工时 ' + esc(stageHoursText(m ? stageSum(m.key) : sumAll()))
      + ' · 不含史诗</span><span>按工作项归组 · 不含史诗</span>';
  }
  function $(root, sel){ return root.querySelector(sel); }

  layer.addEventListener("click", function(e){
    if(e.target.closest("[data-drill-close]")){ UI.closeModal(layer); return; }
    if(e.target.closest("[data-drill-clear-stage]")){ state.stage = ""; paints(); return; }
    if(e.target.closest("[data-drill-clear]")){ state.stage = ""; state.q = ""; paints(); return; }
    var row = e.target.closest("[data-drill-task]");
    if(row){
      UI.closeModal(layer);
      openTaskById(row.dataset.drillTask);
    }
  });
  layer.addEventListener("input", function(e){
    if(e.target.matches("[data-drill-search]")){ state.q = e.target.value || ""; paints(); }
  });
  layer.addEventListener("keydown", function(e){
    if((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-drill-task]")){
      e.preventDefault();
      UI.closeModal(layer);
      openTaskById(e.target.dataset.drillTask);
    }
  });
  paints();
  layer.__uiOnClose = function(){ layer.remove(); };
  UI.openModal(layer, "[data-drill-search]");
  return layer;
}
