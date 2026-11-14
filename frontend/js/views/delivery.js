/* views/delivery · 一页式交付说明工作台
   左侧纸张 + 右侧常驻控制区：后端一次取回事实，控制区只改「怎么投影」，不重新请求；
   人工层（交付对象 / 支持联系 / 验收补充 / 改写后的叙述 / 确认状态）防抖自动保存，带修订号 CAS。
   导出即锁定：任何格式的导出都先落一条不可变快照，再用冻结后的载荷产出文件，
   保证接收人看到的文字与编制人导出时完全一致。 */

import { API } from "../core/api.js";
import { icon } from "../core/icons.js";
import { activeView, showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { UI, copyToClipboard, esc, toast } from "../core/ui.js";
import { DD } from "../lib/delivery-doc.js";
import { printDeliveryPaper, registerDeliveryPrintSource, triggerDownload } from "../lib/download.js";
import { openTaskById } from "../core/task-actions.js";

var host = null;
var data = null;
var versionId = null;
var loadSeq = 0;
var editMode = false, editingField = null;
var risksExpanded = false;
var dirty = false, saving = false, saveQueued = false, saveTimer = null;
var saveState = "idle";
var pickerRows = null, pickerQuery = "";
var exportFmt = "pdf";
var busyAction = false;

function $(sel, root) { return (root || host || document).querySelector(sel); }
function opts() { return data ? DD.options(data) : DD.DEFAULTS; }
function view() { return { editMode: editMode, editingField: editingField, risksExpanded: risksExpanded, readonly: DD.locked(data) }; }
function base() { return "/api/versions/" + encodeURIComponent(versionId) + "/delivery-note"; }

/* ==================== 入口 ==================== */

function enterDeliveryView() {
  host = document.getElementById("deliveryBody");
  if (!host) return;
  wire();
  var want = rt.deliveryVersionId || versionId;
  if (want) { load(want); return; }
  renderPicker();
}
/* 从版本卡 / 发布记录进入：带上版本（可选带上发布记录）直接落到工作台 */
function openDeliveryNote(id, releaseId) {
  rt.deliveryVersionId = id;
  rt.deliveryReleaseId = releaseId || "";
  versionId = null;
  showView("delivery");
}

function renderPicker() {
  host.innerHTML = '<div class="dl-head"><div>'
    + '<div class="dl-title-row"><h1>一页式交付说明</h1></div>'
    + '<p class="dl-sub">选一个版本，把承诺范围、实际发布、回归结果、遗留缺陷与投入聚合成一份可对外提交的说明。'
    + "数字全部只读并可点回原始记录；文字由系统草拟，你逐段确认后即可导出与分享。</p></div></div>"
    + '<div id="dlPickerList">' + UI.skeletonRows(4) + "</div>";
  if (pickerRows) { paintPicker(); return; }
  API.get("/api/versions/cross-project").then(function (rows) {
    pickerRows = rows || [];
    if (activeView === "delivery" && !data) paintPicker();
  }).catch(function (ex) {
    var box = document.getElementById("dlPickerList");
    if (box) box.innerHTML = UI.errorState(ex.message || "版本清单加载失败");
  });
}
function paintPicker() {
  var box = document.getElementById("dlPickerList");
  if (!box) return;
  var q = pickerQuery.trim().toLowerCase();
  var rows = (pickerRows || []).filter(function (r) {
    return !q || (r.projectName + " " + r.versionName).toLowerCase().indexOf(q) !== -1;
  });
  if (!rows.length) {
    box.innerHTML = UI.emptyState({
      icon: "note", title: pickerQuery ? "没有匹配的版本" : "还没有版本",
      text: pickerQuery ? "换个关键词，或清空搜索。" : "先在「版本」里为项目建版本并绑定工作项，这里就能生成交付说明。"
    });
    return;
  }
  var groups = {};
  rows.forEach(function (r) { (groups[r.reqId] = groups[r.reqId] || { name: r.projectName, list: [] }).list.push(r); });
  var body = Object.keys(groups).map(function (reqId) {
    var g = groups[reqId];
    return '<div class="dl-modgroup"><div class="dl-modgroup-head"><span class="dl-mod">' + esc(g.name)
      + '</span><span class="cnt">' + g.list.length + " 个版本</span></div>"
      + '<div class="dl-rows">' + g.list.map(function (r) {
        var released = r.versionStatus === "released" || !!r.latestReleaseDate;
        var sub = [r.versionId, r.targetDate ? "目标 " + DD.dateText(r.targetDate) : "未设目标日",
          r.latestReleaseDate ? "最近生产发布 " + DD.dateText(r.latestReleaseDate) : "无生产发布记录"].join(" · ");
        return '<div class="dl-row body" style="grid-template-columns:96px minmax(0,1fr) 120px">'
          + "<span>" + (released ? '<span class="dl-badge ok">有发布记录</span>' : '<span class="dl-badge warn">未确认发布</span>') + "</span>"
          + '<span class="tt"><b>' + esc(r.versionName) + "</b><span>" + esc(sub) + "</span></span>"
          + '<span><button class="btn sm primary" type="button" data-dl-open="' + esc(r.versionId) + '">'
          + icon("note", 13) + "生成说明</button></span></div>";
      }).join("") + "</div></div>";
  }).join("");
  box.innerHTML = '<div class="dl-rfield" style="max-width:340px;margin:12px 0">'
    + '<input class="input" type="search" id="dlPickerQuery" placeholder="搜索项目或版本" value="' + esc(pickerQuery) + '" aria-label="搜索版本">'
    + "</div>" + body;
  var input = document.getElementById("dlPickerQuery");
  if (input) input.addEventListener("input", function () {
    pickerQuery = input.value;
    var pos = input.selectionStart;
    paintPicker();
    var next = document.getElementById("dlPickerQuery");
    if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) { /* search 类型部分浏览器不支持 */ } }
  });
}

function load(id, releaseId) {
  var current = ++loadSeq;
  versionId = id;
  rt.deliveryVersionId = id;
  data = null;
  editMode = false; editingField = null; dirty = false; saveState = "idle"; risksExpanded = false;
  host.innerHTML = UI.skeletonRows(6);
  var want = releaseId || rt.deliveryReleaseId || "";
  rt.deliveryReleaseId = "";
  return API.get(base(), want ? { releaseId: want } : null).then(function (resp) {
    if (current !== loadSeq || activeView !== "delivery") return;
    data = resp;
    renderAll();
  }).catch(function (ex) {
    if (current !== loadSeq) return;
    host.innerHTML = UI.errorState(ex.message || "交付说明加载失败");
    var btn = host.querySelector("[data-empty-action]");
    if (btn) btn.addEventListener("click", function () { load(id, want); });
  });
}

/* ==================== 渲染 ==================== */

function renderAll() {
  if (!data) return;
  var o = opts(), g = DD.gates(data), isLocked = DD.locked(data);
  host.innerHTML = '<div class="dl-head"><div>'
    + '<div class="dl-title-row"><h1>一页式交付说明</h1>'
    + '<span class="dl-chip pri">' + esc(DD.toneName(o.tone)) + "</span>"
    + '<span class="dl-chip">' + esc(data.projectName || "未归属项目") + " · " + esc(data.versionName || "") + "</span>"
    + (isLocked ? '<span class="dl-chip plum">' + icon("lock", 11) + "快照 " + esc(data.docNo || "") + "</span>" : "")
    + "</div>"
    + '<p class="dl-sub">数字全部来自系统记录、只读且可点回原始记录；文字由系统草拟，逐段确认后导出。'
    + "右侧控制区实时改变投影方式，不改变任何事实。</p>"
    + '<div class="dl-facts">'
    + "<span>" + icon("layers", 12) + "承诺 <b>" + (data.counts ? data.counts.planned || 0 : 0) + "</b> 项</span>"
    + "<span>" + icon("note", 12) + "编号 <b>" + esc(data.docNo || "未编号") + "</b></span>"
    + "<span>" + icon("clock", 12) + "生成 <b>" + esc(DD.timeText(data.generatedAt)) + "</b></span>"
    + "<span>" + icon("shield", 12) + "编制 <b>" + esc(data.ownerName || "未记录") + "</b></span>"
    + "</div></div>"
    + '<div class="dl-acts">'
    + '<button class="btn sm ghost" type="button" data-dl-act="pick">' + icon("layers", 13) + "切换版本</button>"
    + '<button class="btn sm ghost" type="button" data-dl-act="snapshots">' + icon("layers", 13) + "快照记录"
    + ((data.revisions || []).length ? " (" + data.revisions.length + ")" : "") + "</button>"
    + '<button class="btn sm" type="button" data-dl-act="save"' + (isLocked || !data.canEdit ? " disabled" : "") + ">"
    + icon("check", 13) + '保存草稿<span id="dlSaveState"></span></button>'
    + '<button class="btn sm" type="button" data-dl-act="share">' + icon("share", 13) + "分享链接</button>"
    + '<button class="btn sm primary" type="button" data-dl-act="export">' + icon("download", 13) + "导出说明</button>"
    + "</div></div>"
    + '<div id="dlBanner"></div>'
    + '<div class="dl-work"><div class="dl-main">'
    + '<div class="dl-secbar" id="dlSecbar">'
    + '<button class="dl-secstep" type="button" data-dl-navstep="-1" aria-label="向前翻区块导航">'
    + icon("left", 12) + "</button>"
    + '<div class="dl-secwrap">'
    + '<nav class="dl-secnav" id="dlSecnav" aria-label="文档区块导航"></nav>'
    + '<div class="dl-secrail" id="dlSecrail" aria-hidden="true"><i></i></div>'
    + "</div>"
    + '<button class="dl-secstep" type="button" data-dl-navstep="1" aria-label="向后翻区块导航">'
    + icon("right", 12) + "</button></div>"
    + '<div id="dlSheetHost"></div>'
    + '<p class="dl-page-foot">按 A4 纵向排版估算页数；导出 PDF 时以打印对话框的实际分页为准。</p>'
    + "</div>" + railHTML() + "</div>";
  renderDoc();
  paintSaveState();
}

function bannerHTML() {
  var g = DD.gates(data), isLocked = DD.locked(data);
  var kind, ic, title, desc, acts = "";
  if (isLocked) {
    kind = "lock"; ic = "lock"; title = "正在查看不可变快照 " + (data.docNo || "");
    desc = "内容已冻结，不随系统记录变化；控制区与文字编辑均已锁定。";
    acts = '<button class="btn sm" type="button" data-dl-act="back-draft">回到当前草稿</button>';
  } else if (g.customerBlocked) {
    kind = "bad"; ic = "alertCircle"; title = "未确认成功的生产发布，客户版不可导出";
    desc = "实际交付以成功的生产发布记录为准，完成数量不代表已交付。可切到管理版 / 内部版先看内部草稿。";
    acts = '<button class="btn sm" type="button" data-dl-act="tone" data-dl-tone="manager">切到管理版</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto" data-dl-view="phase">去记录发布</button>';
  } else if (!g.production) {
    kind = "warn"; ic = "alert"; title = "选中的记录不是成功的生产部署";
    desc = "测试环境发布、失败与回滚都不构成对外交付依据；请在控制区换一条成功的生产发布记录。";
  } else if (g.pending.length) {
    kind = "warn"; ic = "edit"; title = g.pending.length + " 处对外表述待确认";
    desc = "系统按事实草拟了这些段落，核对无误后点「确认这段」；也可以改写。全部确认后才能导出与分享。";
    acts = '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
  } else {
    kind = "ok"; ic = "checkCircle"; title = "事实与文字均已就绪";
    desc = "可导出不可变快照并生成只读分享链接；导出后系统记录再变化也不影响已发出的这一份。";
  }
  /* 「不是生产发布」与「文字待确认」会同时成立：前一条横幅不能把后一条的下一步吞掉，
     否则管理版草稿被待确认闸门拦住，页面上却找不到确认入口。 */
  if (!isLocked && !g.customerBlocked && g.pending.length && acts.indexOf("accept-all") < 0) {
    acts += '<button class="btn sm" type="button" data-dl-act="accept-all">全部确认</button>'
      + '<button class="btn sm ghost" type="button" data-dl-act="goto-pending">逐项查看</button>';
    desc += "另有 " + g.pending.length + " 处对外表述待确认，核对后才能导出。";
  }
  return '<div class="dl-banner ' + kind + '"><span class="bi">' + icon(ic, 15) + "</span>"
    + "<div><div class=\"bt\">" + esc(title) + "</div><div class=\"bp\">" + esc(desc) + "</div></div>"
    + (acts ? '<div class="ba">' + acts + "</div>" : "") + "</div>";
}

function secnavHTML() {
  return DD.sectionList(data).map(function (s, i) {
    return '<button type="button" data-dl-jump="' + s.k + '"><span class="n">' + (i < 9 ? "0" : "") + (i + 1)
      + "</span>" + esc(s.title) + "</button>";
  }).join("");
}

function renderDoc() {
  if (!data) return;
  var sheetHost = document.getElementById("dlSheetHost");
  var nav = document.getElementById("dlSecnav");
  var banner = document.getElementById("dlBanner");
  if (banner) banner.innerHTML = bannerHTML();
  if (nav) nav.innerHTML = secnavHTML();
  if (sheetHost) sheetHost.innerHTML = DD.sheetMarkup(data, view());
  updateMeter();
  /* 重排会把横向滚动位置清零，重新把当前节带回视野 */
  secnavCurrent = null;
  syncSecnav();
}

/* A4 纵向去掉 14mm/12mm 页边距后的内容盒，单位 CSS px（96dpi） */
var PAPER_W = 703, PAPER_H = 1017;

/* 区块设了 break-inside:avoid，整节放不下时会整节挪到下一页，
   所以页数不是总高除以页高那么简单，要按同样的规则走一遍页光标。 */
function countPages(sheet) {
  var y = 0, parts = sheet.children;
  for (var i = 0; i < parts.length; i++) {
    /* offsetHeight 是布局高度：预览纸带 scale 变换，getBoundingClientRect 会把缩放算进去，页数就虚高了 */
    var h = parts[i].offsetHeight;
    if (parts[i].classList.contains("dl-sec") && h <= PAPER_H && y % PAPER_H + h > PAPER_H) {
      y = Math.ceil(y / PAPER_H) * PAPER_H;
    }
    y += h;
  }
  return Math.max(1, Math.ceil(y / PAPER_H));
}

/* 屏幕上的纸随视口变宽，直接拿它估页数会少算三分之一：离屏按 A4 几何量一份 */
function measurePages() {
  var sheet = $("#dlSheetHost .dl-sheet");
  if (!sheet) return 1;
  var box = document.getElementById("dlMeasure");
  if (!box) {
    box = document.createElement("div");
    box.id = "dlMeasure";
    box.setAttribute("aria-hidden", "true");
    document.body.appendChild(box);
  }
  var clone = sheet.cloneNode(true);
  clone.classList.add("dl-a4");
  clone.removeAttribute("id");
  /* 离屏副本不能带着区块 id，否则 getElementById 会撞上它，导航跳转就定位错了 */
  clone.querySelectorAll("[id]").forEach(function (n) { n.removeAttribute("id"); });
  box.innerHTML = "";
  box.appendChild(clone);
  return countPages(clone);
}

function updateMeter() {
  var pages = measurePages();
  var g = DD.gates(data);
  var el = document.getElementById("dlMeterPages");
  if (el) {
    el.textContent = String(pages);
    el.parentNode.className = pages > 1 ? "m-warn" : "m-ok";
  }
  var p = document.getElementById("dlMeterPending");
  if (p) {
    p.textContent = String(g.pending.length);
    p.parentNode.className = g.pending.length ? "m-warn" : "m-ok";
  }
  var s = document.getElementById("dlMeterSecs");
  if (s) s.textContent = String(DD.sectionList(data).length);
}

/* 滚动时标出当前区块：纸张很长，导航要能告诉读者「现在在哪一节」 */
var secnavCurrent = null;
function syncSecnav() {
  var nav = document.getElementById("dlSecnav");
  if (!nav) return;
  var scroller = document.getElementById("view-delivery");
  var top = scroller ? scroller.getBoundingClientRect().top : 0;
  var secs = DD.sectionList(data), current = null;
  secs.forEach(function (s) {
    var el = document.getElementById("dl-sec-" + s.k);
    if (el && el.getBoundingClientRect().top - top <= 80) current = s.k;
  });
  /* 末节比视口短，滚到底时它的标题仍到不了顶：不补这一条，点最后一节永远高亮在倒数第二节 */
  if (scroller && secs.length && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
    current = secs[secs.length - 1].k;
  }
  var active = null;
  nav.querySelectorAll("[data-dl-jump]").forEach(function (b) {
    if (b.dataset.dlJump === current) { b.setAttribute("aria-current", "true"); active = b; }
    else b.removeAttribute("aria-current");
  });
  /* 当前节被横向裁掉时把它带进视野，否则读者滚到第 10 节却看不到高亮在哪 */
  if (active && current !== secnavCurrent) {
    var l = active.offsetLeft, r = l + active.offsetWidth;
    if (l < nav.scrollLeft + 4 || r > nav.scrollLeft + nav.clientWidth - 4) {
      nav.scrollLeft = Math.max(0, l - (nav.clientWidth - active.offsetWidth) / 2);
    }
  }
  secnavCurrent = current;
  syncSecnavOverflow();
}

/* 溢出线索按实际滚动位置刷新：到两端时对应箭头置灰、渐隐消失，滑块跟着走 */
function syncSecnavOverflow() {
  var nav = document.getElementById("dlSecnav"), bar = document.getElementById("dlSecbar");
  var rail = document.getElementById("dlSecrail");
  if (!nav || !bar) return;
  var over = nav.scrollWidth - nav.clientWidth;
  var left = nav.scrollLeft > 2, right = nav.scrollLeft < over - 2;
  bar.dataset.overflow = over > 2 ? "1" : "0";
  bar.dataset.moreLeft = over > 2 && left ? "1" : "0";
  bar.dataset.moreRight = over > 2 && right ? "1" : "0";
  bar.querySelectorAll("[data-dl-navstep]").forEach(function (b) {
    b.disabled = Number(b.dataset.dlNavstep) < 0 ? !left : !right;
  });
  if (rail) {
    var track = rail.clientWidth, thumb = secnavThumbW(nav, track);
    var span = Math.max(1, track - thumb);
    rail.firstChild.style.width = thumb + "px";
    rail.firstChild.style.transform = "translateX(" + (over > 0 ? Math.round(nav.scrollLeft / over * span) : 0) + "px)";
  }
}
function secnavThumbW(nav, track) {
  return Math.max(28, Math.round(track * Math.min(1, nav.clientWidth / Math.max(1, nav.scrollWidth))));
}

/* 自绘滚动条要能拖：按住滑块 1:1 跟随指针，点轨道则翻页到该处 */
function onSecrailDown(e) {
  var rail = e.target.closest ? e.target.closest("#dlSecrail") : null;
  if (!rail || e.button !== undefined && e.button !== 0) return;
  var nav = document.getElementById("dlSecnav");
  if (!nav) return;
  var over = nav.scrollWidth - nav.clientWidth;
  if (over <= 2) return;
  e.preventDefault();
  var track = rail.clientWidth, thumb = secnavThumbW(nav, track), span = Math.max(1, track - thumb);
  var box = rail.getBoundingClientRect();
  var onThumb = e.target === rail.firstChild;
  var startX = e.clientX, startLeft = nav.scrollLeft;
  var smooth = nav.style.scrollBehavior;
  nav.style.scrollBehavior = "auto";
  if (!onThumb) {
    var want = (e.clientX - box.left - rail.clientLeft - thumb / 2) / span * over;
    nav.scrollLeft = Math.max(0, Math.min(over, want));
    startLeft = nav.scrollLeft;
  }
  rail.classList.add("drag");
  try { rail.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器没有指针捕获，window 监听兜底 */ }
  var move = function (ev) {
    nav.scrollLeft = Math.max(0, Math.min(over, startLeft + (ev.clientX - startX) * (over / span)));
  };
  var up = function () {
    rail.classList.remove("drag");
    nav.style.scrollBehavior = smooth;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    syncSecnavOverflow();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  syncSecnavOverflow();
}

/* ==================== 控制区 ==================== */

function seg(act, items, value, label) {
  return '<div class="seg mini" role="group" aria-label="' + esc(label) + '">'
    + items.map(function (it) {
      var on = String(it[0]) === String(value);
      return '<button type="button" data-dl-act="' + act + '" data-dl-val="' + esc(it[0]) + '"'
        + ' aria-pressed="' + (on ? "true" : "false") + '">' + esc(it[1]) + "</button>";
    }).join("") + "</div>";
}
function switchRow(key, title, hint, checked, disabled) {
  return '<label class="dl-switch"><input type="checkbox" data-dl-opt="' + key + '"'
    + (checked ? " checked" : "") + (disabled ? " disabled" : "") + '><span class="track"></span>'
    + '<span class="sw-t">' + esc(title) + (hint ? '<span class="sw-h">' + esc(hint) + "</span>" : "") + "</span></label>";
}
function rfield(label, inner) {
  return '<div class="dl-rfield"><span class="rl">' + esc(label) + "</span>" + inner + "</div>";
}
function railHTML() {
  var o = opts(), isLocked = DD.locked(data), readOnly = isLocked || !data.canEdit;
  var dis = readOnly ? " disabled" : "";
  var releases = [["", "自动取最近一次成功生产发布"]].concat((data.releaseOptions || []).map(function (r) {
    return [r.id, (r.deliveryEvidence ? "✓ " : "· ") + r.label];
  }));
  var groups = '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("users", 12) + "读者与依据</div>"
    + rfield("语气版本", seg("tone", [["customer", "客户"], ["manager", "管理"], ["internal", "内部"]], o.tone, "语气版本"))
    + rfield("发布依据", '<select class="select" data-dl-release' + dis + ' aria-label="发布依据">'
      + releases.map(function (r) {
        return '<option value="' + esc(r[0]) + '"' + (String(r[0]) === String(o.releaseId || "") ? " selected" : "") + ">" + esc(r[1]) + "</option>";
      }).join("") + "</select>")
    + rfield("交付对象", '<input class="input" type="text" maxlength="120" data-dl-text="audience" value="'
      + esc(data.audience || "") + '" placeholder="如 某公司 · 清算业务部"' + dis + ">")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("board", 12) + "范围与明细</div>"
    + switchRow("includeUnreleased", "含未发布项", "关掉只列本次已发布", o.includeUnreleased, readOnly)
    + rfield("明细粒度", seg("gran", [["brief", "汇总"], ["module", "分组"], ["items", "逐条"]], o.granularity, "明细粒度"))
    + switchRow("showChanges", "变更说明", "基线对照与变更台账", o.showChanges, readOnly)
    + switchRow("showDemands", "需求兑现", "按需求看兑现率", o.showDemands, readOnly)
    + switchRow("showDefects", "缺陷与已知问题", "已修复与遗留清单", o.showDefects, readOnly)
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("stats", 12) + "投入与证据</div>"
    + switchRow("showEffort", "投入与负载", "客户版默认不含成员明细", o.showEffort, readOnly)
    + rfield("投入维度", '<select class="select" data-dl-opt-select="effortDim"' + (readOnly || !o.showEffort ? " disabled" : "")
      + ' aria-label="投入维度"><option value="module"' + (o.effortDim === "module" ? " selected" : "") + ">按模块</option>"
      + '<option value="member"' + (o.effortDim === "member" ? " selected" : "") + ">按成员</option></select>")
    + rfield("证据详细度", seg("evidence", [[0, "关键"], [1, "完整"], [2, "校验值"]], o.evidence, "证据详细度"))
    + switchRow("showRelease", "发布与运行信息", "环境、目标、制品与执行人", o.showRelease, readOnly)
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("shield", 12) + "验收与支持</div>"
    + switchRow("showAcceptance", "验收与结论", "依据、条件与阻塞项", o.showAcceptance, readOnly)
    + switchRow("showSupport", "支持与联系", "接收人找谁", o.showSupport, readOnly)
    + rfield("支持联系人", '<input class="input" type="text" maxlength="200" data-dl-text="supportContact" value="'
      + esc(data.supportContact || "") + '" placeholder="姓名 · 邮箱 / 电话"' + dis + ">")
    + rfield("验收补充", '<textarea class="dl-ta" maxlength="1000" data-dl-text="acceptanceNote" placeholder="双方约定的验收口径与差异说明"' + dis + ">"
      + esc(data.acceptanceNote || "") + "</textarea>")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("edit", 12) + "叙述与排版</div>"
    + rfield("叙述详略", '<input type="range" min="0" max="2" step="1" data-dl-verbosity value="' + o.verbosity + '"' + dis
      + ' aria-label="叙述详略"><div class="dl-range-lab"><span>精简</span><span>标准</span><span>详细</span></div>')
    + rfield("排版密度", seg("density", [["cozy", "宽松"], ["compact", "紧凑"]], o.density, "排版密度"))
    + switchRow("brand", "信头与编号", "沙漏信头 + 文档编号", o.brand, readOnly)
    + switchRow("watermark", "草稿水印", "未确认发布时强制显示", o.watermark, readOnly)
    + rfield("补充说明", '<textarea class="dl-ta" maxlength="4000" data-dl-narr="note" placeholder="要额外告知接收人的事项（会单独成节）"' + dis + ">"
      + esc(DD.narrative(data, "note") || "") + "</textarea>")
    + "</div>"
    + '<div class="dl-rgroup"><div class="dl-rg-lab">' + icon("table", 12) + "附录</div>"
    + switchRow("showCaliber", "统计口径", "每个数字的定义与分母", o.showCaliber, readOnly)
    + switchRow("showRevisions", "修订记录", "本版本已导出的快照", o.showRevisions, readOnly)
    + "</div>";
  var g = DD.gates(data);
  return '<aside class="dl-rail' + (readOnly ? " locked" : "") + '" aria-label="生成控制区">'
    + '<div class="dl-rail-head"><h3>' + icon("settings", 13) + "生成控制</h3>"
    + '<div class="dl-rh-sub">实时生效，不改变任何事实' + (readOnly ? " · 当前只读" : "") + "</div>"
    + '<div class="dl-meter"><div class="m-ok"><b id="dlMeterPages">1</b><span>A4 页数</span></div>'
    + '<div class="' + (g.pending.length ? "m-warn" : "m-ok") + '"><b id="dlMeterPending">' + g.pending.length + "</b><span>待确认</span></div>"
    + '<div><b id="dlMeterSecs">' + DD.sectionList(data).length + "</b><span>区块</span></div></div></div>"
    + (isLocked ? '<div class="dl-lockbar">' + icon("lock", 12) + " 快照已锁定，控制区不可改。"
      + '<button class="btn sm" type="button" data-dl-act="back-draft">回到当前草稿</button></div>'
      : !data.canEdit ? '<div class="dl-lockbar">' + icon("lock", 12) + " 你对该项目只有查看权限，可阅读但不能改写或导出。</div>" : "")
    + '<div class="dl-rail-body">' + groups + "</div>"
    + '<div class="dl-rail-foot">'
    + '<button class="btn sm ghost" type="button" data-dl-act="reset"' + dis + ">重置默认</button>"
    + '<button class="btn sm ghost" type="button" data-dl-act="lean"' + dis + ">压到一页</button>"
    + '<button class="btn sm" type="button" data-dl-act="save"' + dis + ">保存草稿</button>"
    + '<button class="btn sm primary" type="button" data-dl-act="export">导出说明</button>'
    + "</div>"
    + '<div class="dl-rail-note">口径：已发布只取发布快照中「已发布」的项；通过率 = 通过 /（已执行 − 跳过）；'
    + "投入为计时 + 补记，不用于计费。任何一段没有记录就标「未记录」，不推断。</div>"
    + "</aside>";
}
function renderRail() {
  var old = $(".dl-rail");
  if (!old) return;
  var wrap = document.createElement("div");
  wrap.innerHTML = railHTML();
  old.parentNode.replaceChild(wrap.firstChild, old);
  updateMeter();
}

/* ==================== 人工层保存 ==================== */

function paintSaveState() {
  var el = document.getElementById("dlSaveState");
  if (!el) return;
  el.textContent = saveState === "saving" ? " · 保存中" : dirty ? " · 未保存" : saveState === "saved" ? " · 已保存" : "";
}
function markDirty() {
  dirty = true;
  saveState = "dirty";
  paintSaveState();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { saveTimer = null; saveNow(true); }, 900);
}
function saveBody() {
  return {
    revision: data.revision == null ? 0 : data.revision,
    audience: data.audience || "",
    supportContact: data.supportContact || "",
    acceptanceNote: data.acceptanceNote || "",
    options: data.options,
    narratives: data.narratives || {},
    confirmed: data.confirmed || []
  };
}
function saveNow(silent) {
  if (!data || DD.locked(data) || !data.canEdit) return Promise.resolve(null);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (saving) { saveQueued = true; return Promise.resolve(null); }
  saving = true;
  saveState = "saving";
  paintSaveState();
  return API.put(base(), saveBody()).then(function (resp) {
    /* 保存期间又切了版本：这份响应属于旧版本，丢弃 */
    if (resp && resp.versionId === versionId) {
      resp.options = resp.options || data.options;
      data = resp;
      dirty = false;
      saveState = "saved";
      var banner = document.getElementById("dlBanner");
      if (banner) banner.innerHTML = bannerHTML();
      updateMeter();
    }
    if (!silent) toast("草稿已保存", "fs");
    return resp;
  }).catch(function (ex) {
    saveState = "error";
    dirty = true;
    var msg = String(ex && ex.message || "保存失败");
    toast(msg, "bad");
    if (/409|已被他人修改/.test(msg)) load(versionId);
    return null;
  }).then(function (r) {
    saving = false;
    paintSaveState();
    if (saveQueued) { saveQueued = false; return saveNow(true); }
    return r;
  });
}
/* 改写中的段落先落到 data，再重绘，避免控制区一动就丢掉正在输入的文字 */
function harvestEditing() {
  var el = document.activeElement;
  if (!el || !el.dataset || !el.dataset.dlField || el.getAttribute("contenteditable") !== "true") return;
  setNarrative(el.dataset.dlField, el.textContent);
}
function setNarrative(field, text) {
  var value = String(text == null ? "" : text).replace(/\u00a0/g, " ").trim();
  data.narratives = data.narratives || {};
  if (!value || (field !== "internal" && field !== "note" && value === DD.autoText(data, field))) {
    delete data.narratives[field];
  } else {
    data.narratives[field] = value.slice(0, 4000);
  }
}
function confirmField(field) {
  data.confirmed = data.confirmed || [];
  if (data.confirmed.indexOf(field) === -1) data.confirmed.push(field);
}
function unconfirmField(field) {
  data.confirmed = (data.confirmed || []).filter(function (k) { return k !== field; });
}

/* ==================== 选项变更 ==================== */

function applyOption(key, value) {
  if (!data || DD.locked(data) || !data.canEdit) return;
  data.options = data.options || {};
  data.options[key] = value;
  if (key === "tone") {
    data.options.showEffort = value !== "customer";
    if (value === "internal") data.options.evidence = 2;
    else if (data.options.evidence === 2) data.options.evidence = 1;
  }
  harvestEditing();
  markDirty();
  if (key === "tone" || key === "showEffort" || key === "showRevisions") { renderAll(); return; }
  renderDoc();
  syncRailControls();
}
/* 只同步依赖联动的控件，不整块重绘控制区（否则正在拖的滑块会断） */
function syncRailControls() {
  var o = opts();
  var dim = $('[data-dl-opt-select="effortDim"]');
  if (dim) dim.disabled = DD.locked(data) || !data.canEdit || !o.showEffort;
}

/* ==================== 事件 ==================== */

var wired = false;
function wire() {
  if (wired || !host) return;
  wired = true;
  /* 原生 Ctrl+P 与「导出 PDF」印同一份只读投影；离开本视图或还没选版本时不接管打印 */
  registerDeliveryPrintSource(function () {
    return data && activeView === "delivery" ? DD.sheetMarkup(data, { readonly: true, clean: true, a4: true }) : null;
  });
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  host.addEventListener("input", onInput);
  host.addEventListener("focusout", onFocusOut);
  host.addEventListener("pointerdown", onSecrailDown);
  var scroller = document.getElementById("view-delivery");
  if (scroller) scroller.addEventListener("scroll", function () {
    if (activeView === "delivery" && data) syncSecnav();
  }, { passive: true });
  window.addEventListener("resize", function () {
    if (activeView === "delivery" && data) { updateMeter(); syncSecnavOverflow(); }
  });
  /* host 上的 scroll 不冒泡，导航条要自己监听 */
  host.addEventListener("scroll", function (e) {
    if (e.target && e.target.id === "dlSecnav") syncSecnavOverflow();
  }, { passive: true, capture: true });
  window.addEventListener("ds:before-route", function () {
    if (dirty && data && !DD.locked(data)) saveNow(true);
  });
}

function onChange(e) {
  var t = e.target;
  if (t.dataset.dlOpt !== undefined) { applyOption(t.dataset.dlOpt, t.checked); return; }
  if (t.dataset.dlOptSelect) { applyOption(t.dataset.dlOptSelect, t.value); return; }
  if (t.dataset.dlRelease !== undefined) {
    if (DD.locked(data) || !data.canEdit) return;
    data.options.releaseId = t.value;
    dirty = true;
    /* 发布依据要重新聚合事实：保存后后端按持久化的 releaseId 返回同一条记录 */
    saveNow(true).then(function (resp) { if (resp) renderAll(); });
    return;
  }
}
function onInput(e) {
  var t = e.target;
  if (t.dataset.dlVerbosity !== undefined) { applyOption("verbosity", Number(t.value)); return; }
  if (t.dataset.dlText) {
    if (!data || DD.locked(data) || !data.canEdit) return;
    data[t.dataset.dlText] = t.value;
    markDirty();
    renderDoc();
    return;
  }
  if (t.dataset.dlNarr) {
    if (!data || DD.locked(data) || !data.canEdit) return;
    setNarrative(t.dataset.dlNarr, t.value);
    markDirty();
    renderDoc();
  }
}
function onFocusOut(e) {
  var t = e.target;
  if (!t.dataset || !t.dataset.dlField || t.getAttribute("contenteditable") !== "true") return;
  if (!data || DD.locked(data)) return;
  var field = t.dataset.dlField;
  setNarrative(field, t.textContent);
  if (field !== "internal" && field !== "note") confirmField(field);
  editingField = null;
  markDirty();
  renderDoc();
}

function onClick(e) {
  var open = e.target.closest("[data-dl-open]");
  if (open) { load(open.dataset.dlOpen); return; }
  var step = e.target.closest("[data-dl-navstep]");
  if (step) {
    var nav = document.getElementById("dlSecnav");
    if (nav && !step.disabled) nav.scrollLeft += Number(step.dataset.dlNavstep) * Math.max(120, nav.clientWidth - 60);
    return;
  }
  var jump = e.target.closest("[data-dl-jump]");
  if (jump) {
    var sec = document.getElementById("dl-sec-" + jump.dataset.dlJump);
    if (sec) sec.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  var btn = e.target.closest("[data-dl-act]");
  if (!btn || btn.disabled) return;
  var act = btn.dataset.dlAct;
  if (act === "tone") { applyOption("tone", btn.dataset.dlTone || btn.dataset.dlVal); return; }
  if (act === "gran") { applyOption("granularity", btn.dataset.dlGran || btn.dataset.dlVal); return; }
  if (act === "risks") { risksExpanded = !risksExpanded; renderDoc(); return; }
  if (act === "density") { applyOption("density", btn.dataset.dlVal); return; }
  if (act === "evidence") { applyOption("evidence", Number(btn.dataset.dlVal)); return; }
  if (act === "evidence-level") { applyOption("evidence", Number(btn.dataset.dlLv)); return; }
  if (act === "pick") { data = null; versionId = null; rt.deliveryVersionId = ""; renderPicker(); return; }
  if (act === "save") { saveNow(false); return; }
  if (act === "reset") { resetOptions(); return; }
  if (act === "lean") { leanOptions(); return; }
  if (act === "back-draft") { load(versionId); return; }
  if (act === "edit-mode") { editMode = !editMode; editingField = null; harvestEditing(); renderDoc(); return; }
  if (act === "edit-one") { startEditOne(btn.dataset.dlField); return; }
  if (act === "accept") { confirmField(btn.dataset.dlKey); markDirty(); renderDoc(); return; }
  if (act === "goto-pending") {
    var target = document.getElementById("dl-sec-" + DD.pendingSection(data));
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (act === "accept-all") {
    DD.pendingFields(data).forEach(confirmField);
    markDirty();
    renderDoc();
    toast("已确认全部对外表述，导出前请再通读一遍", "fs");
    return;
  }
  if (act === "restore") {
    var f = btn.dataset.dlField;
    delete (data.narratives || {})[f];
    unconfirmField(f);
    markDirty();
    renderDoc();
    return;
  }
  if (act === "source") { openSource(btn.dataset.dlSrc); return; }
  if (act === "sources") { openSourcesOverview(); return; }
  if (act === "export") { openExport(); return; }
  if (act === "snapshots") { openSnapshots(); return; }
  if (act === "share") { openShare(); return; }
  if (act === "goto") { gotoView(btn.dataset.dlView, btn.dataset.dlRef); return; }
  if (act === "evidence") { gotoView(btn.dataset.dlView, btn.dataset.dlRef); return; }
}
function startEditOne(field) {
  if (!data || DD.locked(data) || !data.canEdit) return;
  editingField = field;
  renderDoc();
  var el = $('[data-dl-field="' + field + '"]');
  if (!el) return;
  el.focus();
  try {
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (err) { /* 选区 API 不可用时只聚焦 */ }
}
function resetOptions() {
  if (!data || DD.locked(data) || !data.canEdit) return;
  var keepRelease = (data.options || {}).releaseId || "";
  data.options = Object.assign({}, DD.DEFAULTS, { releaseId: keepRelease });
  markDirty();
  renderAll();
  toast("生成控制已重置为默认", "fs");
}
function leanOptions() {
  if (!data || DD.locked(data) || !data.canEdit) return;
  Object.assign(data.options, DD.leanPatch());
  markDirty();
  renderAll();
  toast("已压到最简：精简叙述 + 紧凑排版 + 模块汇总", "fs");
}
function gotoView(name, refId) {
  if (!name) { toast("该证据没有可跳转的原始记录", "warn"); return; }
  if (dirty) saveNow(true);
  if (name === "board" && refId) { openTaskById(refId); return; }
  var pid = data && data.projectId;
  /* 目标页的项目定位与页签都在各自模块内部，按需拉模块再落路由，避免把低频视图拉进首屏 */
  import("../core/view-loader.js").then(function (m) {
    if (name === "phase") {
      return m.loadView("phase").then(function (mod) { mod.setPhaseProject(pid, "version"); showView("phase"); });
    }
    if (name === "demands") {
      return m.loadView("demands").then(function (mod) { mod.openDemandsForReq(pid); showView("demands"); });
    }
    if (name === "testcases" || name === "defects") {
      return m.loadView("testcases").then(function (mod) {
        mod.setTcProject(pid);
        mod.setTcMode(name === "defects" ? "defects" : "plans");
        showView("testcases");
      });
    }
    showView(name);
  }).catch(function (ex) { toast(ex.message || "打开原始记录失败", "bad"); });
}

/* ==================== 通用弹层 ==================== */

function modal(html, wide) {
  var layer = document.createElement("div");
  layer.className = "modal-layer dl-dlg";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.innerHTML = '<div class="sheet ' + (wide || "md") + '">' + html + "</div>";
  /* 关闭即销毁：否则每次开合都留一份含同名 id 的旧弹层在 document 里 */
  layer.__uiOnClose = function () { setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 0); };
  document.body.appendChild(layer);
  UI.openModal(layer);
  layer.addEventListener("click", function (e) {
    if (e.target.closest("[data-dl-close]")) UI.closeModal(layer);
  });
  return layer;
}
function modalHead(title, desc) {
  return '<div class="sheet-head"><div style="flex:1 1 auto;min-width:0"><h2>' + esc(title) + "</h2>"
    + (desc ? '<div class="desc">' + esc(desc) + "</div>" : "") + "</div>"
    + '<button class="icon-btn sm" type="button" data-dl-close aria-label="关闭">' + icon("close", 15) + "</button></div>";
}
function removeModal(layer) {
  UI.closeModal(layer);
  setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 240);
}

/* ==================== 数字来源 ==================== */

function openSource(key) {
  var s = DD.sourceInfo(data, key);
  var layer = modal(modalHead(s.title, "数字只读。下面是它的口径与原始记录。")
    + '<div class="sheet-body"><div class="dl-caliber">' + esc(s.caliber) + "</div>"
    + (s.rows.length ? s.rows.map(function (x) {
      return '<div class="dl-srcrec"><span class="si">' + esc(String(x.id).slice(0, 10)) + "</span>"
        + '<div class="sc"><b>' + esc(x.m) + "</b><span>" + esc(x.s) + "</span></div></div>";
    }).join("") : '<div class="dl-missing">' + icon("infoCircle", 15) + "<div>没有可列出的原始记录。</div></div>")
    + "</div>"
    + '<div class="sheet-foot"><span class="hint">口径写在数据旁边，不藏在帮助文档里</span>'
    + '<button class="btn" type="button" data-dl-close>关闭</button>'
    + (s.view ? '<button class="btn primary" type="button" data-dl-src-goto>' + icon("extlink", 13) + "打开原始记录</button>" : "")
    + "</div>");
  var go = layer.querySelector("[data-dl-src-goto]");
  if (go) go.addEventListener("click", function () {
    removeModal(layer);
    gotoView(s.view, s.refId);
  });
}
function openSourcesOverview() {
  var rows = DD.sourcesOverview(data);
  modal(modalHead("数据来源总览", (data.projectName || "") + " · " + (data.versionName || "") + " · 全部为只读聚合")
    + '<div class="sheet-body"><div class="dl-caliber">生成过程只读：一次取回版本、承诺、发布、需求、测试、缺陷与工时，不写任何业务表；'
    + '只有「导出说明」会落一条不可变快照。</div>'
    + rows.map(function (x) {
      return '<div class="dl-srcrec"><span class="si">' + icon("layers", 12) + "</span>"
        + '<div class="sc"><b>' + esc(x.name) + "</b><span>" + esc(x.from) + "<br>" + esc(x.table) + "</span></div></div>";
    }).join("")
    + '<div class="dl-missing">' + icon("infoCircle", 15)
    + "<div>缺失处理：任何一段没有记录就显示「未记录 / 未验证」，不推断、不补造，也不阻断其余区块生成。</div></div>"
    + "</div>"
    + '<div class="sheet-foot"><span class="hint"></span><button class="btn" type="button" data-dl-close>关闭</button></div>');
}

/* ==================== 导出 ==================== */

function openExport() {
  if (!data) return;
  var g = DD.gates(data);
  if (!data.canSnapshot && !DD.locked(data)) { toast("你对该项目只有查看权限，不能导出快照", "warn"); return; }
  if (!DD.locked(data) && !g.canExport) { toast(g.exportBlock, "warn"); return; }
  exportFmt = "pdf";
  var layer = modal(modalHead("导出交付说明", DD.locked(data) ? "当前已是不可变快照，导出不会再生成新快照。" : "导出即锁定：先冻结一份不可变快照，再产出文件。")
    + '<div class="sheet-body"><div class="dl-fmt-tabs" role="group" aria-label="导出格式">'
    + '<button type="button" data-dl-fmt="pdf" class="on">' + icon("print", 13) + " PDF（A4）</button>"
    + '<button type="button" data-dl-fmt="md">' + icon("table", 13) + " Markdown</button>"
    + '<button type="button" data-dl-fmt="html">' + icon("codeBlock", 13) + " 独立 HTML</button>"
    + "</div>"
    + '<div id="dlExportBody"></div></div>'
    + '<div class="sheet-foot"><span class="hint" id="dlExportHint"></span>'
    + '<button class="btn" type="button" data-dl-close>取消</button>'
    + '<button class="btn primary" type="button" id="dlExportGo">导出</button></div>', "wide");
  layer.__dlLayer = true;
  var refit = function () { if (exportFmt === "pdf") fitPaper(layer); };
  window.addEventListener("resize", refit);
  var destroy = layer.__uiOnClose;
  layer.__uiOnClose = function () { window.removeEventListener("resize", refit); destroy(); };
  layer.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-dl-fmt]");
    if (tab) {
      exportFmt = tab.dataset.dlFmt;
      layer.querySelectorAll("[data-dl-fmt]").forEach(function (b) { b.classList.toggle("on", b === tab); });
      paintExport(layer);
      return;
    }
    if (e.target.closest("#dlExportGo")) doExport(layer);
  });
  paintExport(layer);
}
function paintExport(layer) {
  var body = layer.querySelector("#dlExportBody");
  var hint = layer.querySelector("#dlExportHint");
  var go = layer.querySelector("#dlExportGo");
  if (exportFmt === "pdf") {
    body.innerHTML = '<div class="dl-paper-frame"><div class="dl-paper-holder"><div class="dl-paper" id="dlPaper">'
      + DD.sheetMarkup(data, { readonly: true, clean: true, a4: true }) + "</div></div></div>"
      + '<p class="hint">PDF 由浏览器打印生成：在打印对话框里选「另存为 PDF」，纸张 A4、边距默认。'
      + "预览按缩放显示，实际分页以打印结果为准。</p>";
    hint.textContent = "导出后快照锁定，控制区不可再改";
    go.innerHTML = icon("print", 13) + " 冻结并打开打印";
    fitPaper(layer);
  } else if (exportFmt === "md") {
    body.innerHTML = '<pre class="dl-md-pre">' + esc(DD.markdown(data)) + "</pre>"
      + '<p class="hint">纯文本，可直接贴进邮件、IM 或知识库；表格与清单保留结构。</p>';
    hint.textContent = "同时提供「复制」与「下载 .md」";
    go.innerHTML = icon("download", 13) + " 冻结并下载 .md";
  } else {
    body.innerHTML = '<div class="dl-caliber">单文件 HTML：样式内联，双击即可打开，不依赖沙漏服务，也不需要登录。'
      + "适合归档或作为附件发送。</div>"
      + '<div class="dl-paper-frame"><div class="dl-paper-holder"><div class="dl-paper" id="dlPaper">'
      + DD.sheetMarkup(data, { readonly: true, clean: true, a4: true }) + "</div></div></div>";
    hint.textContent = "含浅色主题令牌与打印样式";
    go.innerHTML = icon("download", 13) + " 冻结并下载 .html";
    fitPaper(layer);
  }
}
function fitPaper(layer) {
  requestAnimationFrame(function () {
    var frame = layer.querySelector(".dl-paper-frame");
    var paper = layer.querySelector("#dlPaper");
    var holder = layer.querySelector(".dl-paper-holder");
    if (!frame || !paper || !holder) return;
    /* 按预览框实际宽度缩放并居中：这份预览是导出前逐段校对用的，缩到原始纸宽会小到读不清，
       写死上限更会让宽屏上一半预览区是空白 */
    var scale = Math.min(1.5, Math.max(0.2, (frame.clientWidth - 34) / PAPER_W));
    paper.style.transform = "scale(" + scale + ")";
    holder.style.width = Math.ceil(PAPER_W * scale) + "px";
    holder.style.height = Math.ceil(paper.scrollHeight * scale) + "px";
    var hint = layer.querySelector("#dlExportHint");
    var sheet = paper.querySelector(".dl-sheet");
    /* 预览纸就是 A4 几何，直接数它，比屏幕上那张宽纸准 */
    var pages = sheet ? countPages(sheet) : 1;
    var meter = document.getElementById("dlMeterPages");
    if (meter) {
      meter.textContent = String(pages);
      meter.parentNode.className = pages > 1 ? "m-warn" : "m-ok";
    }
    if (hint) {
      hint.textContent = "约 " + pages + " 页 A4 · "
        + DD.toneName(opts().tone) + " · 预览缩放 " + Math.round(scale * 100) + "%";
    }
  });
}
/* 导出统一先冻结：拿到 locked 载荷后再产出文件，接收人与编制人看到同一份 */
function freezeForExport() {
  if (DD.locked(data)) return Promise.resolve(data);
  return saveNow(true).then(function () {
    return API.post(base() + "/snapshots", saveBody());
  }).then(function (resp) {
    data = resp;
    editMode = false; editingField = null; dirty = false; saveState = "saved";
    renderAll();
    toast("已冻结快照 " + (resp.docNo || "") + "，内容不再随系统变化", "fs");
    return resp;
  });
}
function doExport(layer) {
  if (busyAction) return;
  busyAction = true;
  var go = layer.querySelector("#dlExportGo");
  if (go) { go.disabled = true; go.textContent = "处理中…"; }
  var fmt = exportFmt;
  freezeForExport().then(function (snapshot) {
    var name = DD.exportBaseName(snapshot);
    if (fmt === "md") {
      var md = DD.markdown(snapshot);
      triggerDownload(name + ".md", md, "text/markdown;charset=utf-8");
      copyToClipboard(md, "已下载并复制 Markdown", "已下载 .md（复制失败可手动选择）");
      removeModal(layer);
      return;
    }
    if (fmt === "html") {
      return inlineCSS().then(function (css) {
        triggerDownload(name + ".html", DD.htmlDocument(snapshot, css), "text/html;charset=utf-8");
        toast("已下载独立 HTML", "fs");
        removeModal(layer);
      });
    }
    removeModal(layer);
    printDeliveryPaper(DD.sheetMarkup(snapshot, { readonly: true, clean: true, a4: true }));
    return null;
  }).catch(function (ex) {
    toast(ex && ex.message || "导出失败", "bad");
    if (go) { go.disabled = false; go.textContent = "重试导出"; }
  }).then(function () { busyAction = false; });
}
function inlineCSS() {
  return Promise.all(["css/tokens.css", "css/delivery.css"].map(function (path) {
    return fetch(path).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
  })).then(function (parts) { return parts.join("\n"); });
}

/* ==================== 快照记录 ==================== */

function openSnapshots() {
  var layer = modal(modalHead("快照记录", "每份快照都是不可变副本；系统记录再变化也不影响已发出的那一版。")
    + '<div class="sheet-body" id="dlSnapBody">' + UI.skeletonRows(3) + "</div>"
    + '<div class="sheet-foot"><span class="hint">分享链接挂在快照上，撤销分享不影响快照本身</span>'
    + '<button class="btn" type="button" data-dl-close>关闭</button></div>');
  API.get(base() + "/snapshots").then(function (rows) {
    var body = layer.querySelector("#dlSnapBody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = UI.emptyState({ icon: "layers", title: "还没有导出过快照", text: "点「导出说明」会落第一条不可变快照，并生成正式编号。" });
      return;
    }
    body.innerHTML = rows.map(function (x) {
      return '<div class="dl-snap"><span class="dl-sec-idx">' + esc(x.seq) + "</span>"
        + '<div class="sc"><b>' + esc(x.docNo) + "</b><span>"
        + esc(DD.timeText(x.createdAt) + " · " + (x.createdByName || "未记录") + " · " + DD.toneName(x.tone)
          + " · 校验值 " + String(x.contentHash || "").slice(0, 12)) + "</span></div>"
        + (x.shared ? '<span class="dl-badge pri">已分享</span>' : "")
        + '<button class="btn sm" type="button" data-dl-snap-view="' + esc(x.id) + '">查看</button>'
        + '<button class="btn sm ghost" type="button" data-dl-snap-share="' + esc(x.id) + '"'
        + ' data-dl-snap-no="' + esc(x.docNo || "") + '">' + icon("share", 12) + "分享</button>"
        + "</div>";
    }).join("");
  }).catch(function (ex) {
    var body = layer.querySelector("#dlSnapBody");
    if (body) body.innerHTML = UI.errorState(ex.message || "快照记录加载失败");
  });
  layer.addEventListener("click", function (e) {
    var v = e.target.closest("[data-dl-snap-view]");
    if (v) {
      removeModal(layer);
      API.get("/api/delivery-notes/" + encodeURIComponent(v.dataset.dlSnapView)).then(function (resp) {
        data = resp;
        editMode = false; editingField = null; dirty = false;
        renderAll();
      }).catch(function (ex) { toast(ex.message || "快照打开失败", "bad"); });
      return;
    }
    var s = e.target.closest("[data-dl-snap-share]");
    if (s) { removeModal(layer); openShare(s.dataset.dlSnapShare, s.dataset.dlSnapNo); }
  });
}

/* ==================== 分享 ==================== */

function shareURL(token) {
  var q = "token=" + encodeURIComponent(token) + "&kind=delivery";
  if (location.protocol === "file:") return "share.html?" + q;
  return location.origin + API.appBase + "/share.html?" + q;
}
function openShare(snapshotId, docNo) {
  if (!data) return;
  var g = DD.gates(data);
  var sid = snapshotId || data.snapshotId || "";
  if (!sid && !g.canShare) { toast(g.shareBlock || "当前不可分享", "warn"); return; }
  if (!sid && !data.canSnapshot) { toast("你对该项目只有查看权限，不能生成分享链接", "warn"); return; }
  var layer = modal(modalHead("只读分享链接", sid ? "链接指向已冻结的快照，内容不会随系统变化。" : "生成链接会先冻结一份不可变快照，再对外分享。")
    + '<div class="sheet-body" id="dlShareBody">' + UI.skeletonRows(2) + "</div>"
    + '<div class="sheet-foot"><span class="hint">接收人无需登录；内部复盘版永不分享</span>'
    + '<button class="btn" type="button" data-dl-close>关闭</button></div>', "sm");
  var state = { snapshotId: sid, docNo: docNo || (sid && sid === data.snapshotId ? data.docNo : ""),
    info: null, days: 30, allowDownload: true };
  function paint() {
    var body = layer.querySelector("#dlShareBody");
    if (!body) return;
    var info = state.info;
    var has = !!(info && info.token);
    body.innerHTML = '<div class="dl-kv"><span>语气版本</span><b>' + esc(DD.toneName(opts().tone)) + "</b></div>"
      + (has ? '<div class="dl-rfield"><span class="rl">只读链接</span><div class="dl-share-url">'
        + '<input class="input" type="text" readonly value="' + esc(shareURL(info.token)) + '" aria-label="只读链接">'
        + '<button class="btn sm" type="button" data-dl-share-copy>' + icon("copy", 13) + "复制</button></div></div>"
        + '<div class="dl-kvs"><div class="dl-kvbox"><span>编号</span><strong>' + esc(info.docNo || "") + "</strong></div>"
        + '<div class="dl-kvbox"><span>有效至</span><strong>' + esc(DD.timeText(info.expiresAt)) + "</strong></div>"
        + '<div class="dl-kvbox"><span>访问次数</span><strong>' + (info.viewCount || 0) + "</strong></div>"
        + '<div class="dl-kvbox"><span>允许下载</span><strong>' + (info.allowDownload ? "是" : "否") + "</strong></div></div>"
        + '<div class="dl-narr-bar">'
        + '<button class="btn sm" type="button" data-dl-share-open>' + icon("extlink", 13) + "预览接收人页</button>"
        + '<button class="btn sm danger" type="button" data-dl-share-revoke>' + icon("close", 13) + "停止分享</button></div>"
        : '<div class="dl-rfield"><span class="rl">有效期</span>'
        + '<select class="select" data-dl-share-days aria-label="有效期">'
        + [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (state.days === d ? " selected" : "") + ">" + d + " 天</option>"; }).join("")
        + "</select></div>"
        + switchRow("allowDownload", "允许接收人下载 PDF", "关掉只能在线查看", state.allowDownload, false)
        + '<div class="dl-caliber">'
        + (state.snapshotId ? "将分享快照 " + esc(state.docNo || String(state.snapshotId).slice(0, 10)) + "。"
          : "尚未冻结快照：点下方按钮会先保存草稿并冻结一份不可变快照，再生成链接。")
        + "</div>"
        + '<button class="btn primary block" type="button" data-dl-share-gen>' + icon("share", 13) + "生成只读链接</button>");
  }
  layer.addEventListener("change", function (e) {
    if (e.target.dataset.dlShareDays !== undefined) state.days = Number(e.target.value);
    if (e.target.dataset.dlOpt === "allowDownload") state.allowDownload = e.target.checked;
  });
  layer.addEventListener("click", function (e) {
    if (e.target.closest("[data-dl-share-copy]")) {
      copyToClipboard(shareURL(state.info.token), "链接已复制", "复制失败，请手动选择链接");
      return;
    }
    if (e.target.closest("[data-dl-share-open]")) {
      window.open(shareURL(state.info.token), "_blank", "noopener");
      return;
    }
    if (e.target.closest("[data-dl-share-revoke]")) {
      UI.showConfirm({
        title: "停止分享", okText: "停止分享",
        msg: "已发出的链接会立即失效，接收人再打开会看到失效提示。快照本身保留。"
      }).then(function (ok) {
        if (!ok) return;
        API.del("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share").then(function () {
          state.info = null;
          toast("已停止分享", "fs");
          paint();
          refreshRevisions();
        }).catch(function (ex) { toast(ex.message || "停止分享失败", "bad"); });
      });
      return;
    }
    if (e.target.closest("[data-dl-share-gen]")) {
      if (busyAction) return;
      busyAction = true;
      var btn = layer.querySelector("[data-dl-share-gen]");
      if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
      var ready = state.snapshotId ? Promise.resolve(null)
        : freezeForExport().then(function (resp) { state.snapshotId = resp.snapshotId; return resp; });
      ready.then(function () {
        return API.post("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share?allowDownload="
          + (state.allowDownload ? "true" : "false") + "&days=" + state.days, {});
      }).then(function (info) {
        state.info = info;
        toast("只读链接已生成", "fs");
        paint();
        refreshRevisions();
      }).catch(function (ex) {
        toast(ex.message || "生成链接失败", "bad");
        paint();
      }).then(function () { busyAction = false; });
    }
  });
  if (state.snapshotId) {
    API.get("/api/delivery-notes/" + encodeURIComponent(state.snapshotId) + "/share").then(function (info) {
      state.info = info && info.token ? info : null;
      paint();
    }).catch(function () { paint(); });
  } else { paint(); }
}
function refreshRevisions() {
  if (!versionId) return;
  API.get(base() + "/snapshots").then(function (rows) {
    if (data) data.revisions = rows || [];
  }).catch(function () { /* 修订记录只是附录，失败不打扰 */ });
}

export { enterDeliveryView, openDeliveryNote };