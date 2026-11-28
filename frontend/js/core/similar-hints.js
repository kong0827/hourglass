/* core/similar-hints.js · 新建需求 / 缺陷时的「可能已有类似条目」提示
 *
 * 边界（改之前先读）：
 *   1. 只读、只提示：不写库、不阻断提交，也不替用户判定「重复」；
 *   2. 规则匹配在后端完成（标题二元组 + 描述），前端不自己算相似度；
 *   3. 表单与抽屉由其他批次维护，这里只做运行时注入，不改静态模板；
 *   4. 仅新建时检查：编辑态不提示，避免把自己当成重复项。
 */
import { API } from "./api.js";
import { rt } from "./state.js";
import { esc, toast } from "./ui.js";
import { demandNoText, itemNoText } from "../lib/format.js";
import { taskLink } from "./task-actions.js";

var STYLE_ID = "sim-hint-style";
var DEBOUNCE_TITLE = 700;
var DEBOUNCE_DESC = 1400;
var MIN_CHARS = 3;

var state = {
  timer: null,
  seq: 0,
  collapsedKey: "",
  lastDoneKey: "",
  layerObserver: null,
  openState: { demand: false, defect: false },
  booted: false
};

/* ==================== 入口 ==================== */

function initSimilarHints() {
  if (state.booted) return;
  state.booted = true;
  ensureStyle();
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("ds:view-change", resetAll);
  observeLayers();
}

/* ==================== 注入 ==================== */

function demandOpen() {
  var layer = document.getElementById("dlgDemand");
  return !!(layer && layer.classList.contains("open"));
}

function taskOpen() {
  var layer = document.getElementById("taskDrawer");
  return !!(layer && layer.classList.contains("on"));
}

/* 只在新建时提示：编辑已有需求 / 工作项时，自己就是那条「相似条目」 */
function demandCreating() {
  var title = document.getElementById("demandFormTitle");
  return !!(title && title.textContent.indexOf("新建") === 0);
}

function taskCreating() {
  return !rt.editingId;
}

function currentKind(target) {
  if (target && target.id === "dTitle") return demandOpen() && demandCreating() ? "demand" : "";
  if (target && target.id === "iTitle") return taskOpen() && taskCreating() ? "defect" : "";
  return "";
}

function eligible(kind) {
  if (kind === "demand") return demandOpen() && demandCreating();
  if (kind === "defect") {
    var type = document.getElementById("iItemType");
    return taskOpen() && taskCreating() && !!type && type.value === "bug";
  }
  return false;
}

function anchorOf(kind) {
  return document.getElementById(kind === "demand" ? "fDemandTitle" : "fTitle");
}

function boxOf(kind, create) {
  var box = document.querySelector('[data-sim-hint="' + kind + '"]');
  if (box || !create) return box;
  var anchor = anchorOf(kind);
  if (!anchor || !anchor.parentNode) return null;
  box = document.createElement("div");
  box.className = "sim-hint";
  box.setAttribute("data-sim-hint", kind);
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.hidden = true;
  anchor.parentNode.insertBefore(box, anchor.nextSibling);
  return box;
}

function hide(kind) {
  var box = boxOf(kind, false);
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
}

function hideAll() {
  hide("demand");
  hide("defect");
}

/* ==================== 触发 ==================== */

function onInput(e) {
  var t = e.target;
  if (!t || !t.id) return;
  if (t.id === "dTitle" || t.id === "iTitle") {
    schedule(currentKind(t), DEBOUNCE_TITLE);
    return;
  }
  /* 描述只影响排序：标题已写过时，描述补完再刷新一次，不跟着每个字请求 */
  if (t.id === "dDesc") schedule(demandOpen() && demandCreating() ? "demand" : "", DEBOUNCE_DESC);
  if (t.id === "iDesc") schedule(taskOpen() && taskCreating() ? "defect" : "", DEBOUNCE_DESC);
}

function onChange(e) {
  var t = e.target;
  if (!t || !t.id) return;
  if (t.id === "iItemType" || t.id === "dReq" || t.id === "iReq") {
    /* 类型 / 项目变了，旧结果不再可信：先收起来，再按新条件查 */
    var kind = t.id === "iItemType"
      ? (taskOpen() && taskCreating() ? "defect" : "")
      : (t.id === "dReq" ? "demand" : "defect");
    hide(kind);
    state.lastDoneKey = "";
    schedule(kind, 200);
  }
}

function schedule(kind, delay) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (!kind || !eligible(kind)) {
    if (kind) hide(kind);
    return;
  }
  state.timer = setTimeout(function () {
    state.timer = null;
    run(kind);
  }, delay || DEBOUNCE_TITLE);
}

function readValue(id) {
  var el = document.getElementById(id);
  return el ? String(el.value == null ? "" : el.value).trim() : "";
}

function readDesc(id) {
  var el = document.getElementById(id);
  if (!el) return "";
  var text = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 2000);
}

function payloadOf(kind) {
  if (kind === "demand") {
    return {
      kind: "demand",
      projectId: readValue("dReq") || null,
      title: readValue("dTitle"),
      description: readDesc("dDesc") || null
    };
  }
  return {
    kind: "defect",
    projectId: readValue("iReq") || null,
    title: readValue("iTitle"),
    description: readDesc("iDesc") || null
  };
}

function run(kind) {
  if (!eligible(kind)) {
    hide(kind);
    return;
  }
  var payload = payloadOf(kind);
  if (payload.title.replace(/\s+/g, "").length < MIN_CHARS) {
    hide(kind);
    state.lastDoneKey = "";
    return;
  }
  var key = kind + "|" + payload.projectId + "|" + payload.title + "|" + (payload.description || "").slice(0, 120);
  if (key === state.lastDoneKey) return;
  if (key !== state.collapsedKey) state.collapsedKey = "";

  var seq = ++state.seq;
  API.post("/api/similar/check", payload).then(function (res) {
    if (seq !== state.seq || !eligible(kind)) return;
    state.lastDoneKey = key;
    var items = (res && res.items) || [];
    if (!items.length || key === state.collapsedKey) {
      hide(kind);
      return;
    }
    render(kind, items, key);
  }).catch(function () {
    /* 提示失败就当没有：不能因为查重失败打扰正在建单的人 */
    if (seq === state.seq) hide(kind);
  });
}

/* ==================== 渲染 ==================== */

function render(kind, items, key) {
  var box = boxOf(kind, true);
  if (!box) return;
  var noun = kind === "demand" ? "需求" : "缺陷";
  var rows = items.map(function (it) {
    var no = kind === "demand" ? demandNoText(it.itemNo) : itemNoText(it.itemNo);
    var meta = [it.projectName || "未归属项目", it.statusName || it.status || "状态未知",
      "相似 " + Math.round((it.score || 0) * 100) + "%"];
    return '<li class="sim-hint-row">'
      + '<div class="sim-hint-top">'
      + (no ? '<span class="sim-hint-no">' + esc(no) + '</span>' : "")
      + '<span class="sim-hint-title">' + esc(it.title || "") + '</span>'
      + '<button class="sim-hint-open" type="button" data-sim-open="' + esc(it.id || "") + '" data-sim-kind="' + kind + '">打开</button>'
      + '</div>'
      + '<div class="sim-hint-meta">' + esc(meta.join(" · ")) + '</div>'
      + (it.snippet ? '<div class="sim-hint-snip">' + esc(it.snippet) + '</div>' : "")
      + '</li>';
  }).join("");
  box.innerHTML =
    '<div class="sim-hint-head">'
      + '<b>可能已有类似的' + noun + '</b>'
      + '<span>按标题与描述的字面相似度，仅供参考</span>'
      + '<button class="sim-hint-collapse" type="button" data-sim-collapse="' + esc(key) + '">收起</button>'
      + '</div>'
      + '<ul class="sim-hint-list">' + rows + '</ul>'
      + '<p class="sim-hint-foot">只做提示，不会阻止提交；打开原条目核对后再决定是否继续。</p>';
  box.hidden = false;
}

/* ==================== 交互 ==================== */

function onClick(e) {
  var collapse = e.target.closest && e.target.closest("[data-sim-collapse]");
  if (collapse) {
    e.preventDefault();
    state.collapsedKey = collapse.getAttribute("data-sim-collapse") || "";
    hideAll();
    return;
  }
  var open = e.target.closest && e.target.closest("[data-sim-open]");
  if (!open) return;
  e.preventDefault();
  var id = open.getAttribute("data-sim-open");
  if (!id) return;
  if (open.getAttribute("data-sim-kind") === "defect") {
    /* 新标签打开，保住抽屉里正在写的草稿 */
    window.open(taskLink(id), "_blank", "noopener");
    return;
  }
  /* 需求没有跨页深链：叠一层详情，关掉就回到表单，草稿不丢 */
  import("../views/demands.js").then(function (m) {
    m.openDemandDetailById(id);
  }).catch(function () {
    toast("打不开这条需求，请到需求池查看", "warn");
  });
}

/* ==================== 生命周期 ==================== */

function syncOpenState() {
  var now = {
    demand: demandOpen() && demandCreating(),
    defect: taskOpen() && taskCreating()
  };
  var prev = state.openState;
  state.openState = now;
  return now.demand !== prev.demand || now.defect !== prev.defect;
}

function observeLayers() {
  if (!state.layerObserver && window.MutationObserver) {
    state.layerObserver = new MutationObserver(function () {
      /* 只认开合变化：抽屉切全屏等其他 class 变动不该清掉正在看的结果 */
      if (!syncOpenState()) return;
      hideAll();
      state.lastDoneKey = "";
      /* 新建页重新打开时，按已经填好的标题再查一次 */
      if (demandOpen() && demandCreating() && eligible("demand")) schedule("demand", 300);
      if (taskOpen() && taskCreating() && eligible("defect")) schedule("defect", 300);
    });
  }
  state.openState = { demand: demandOpen() && demandCreating(), defect: taskOpen() && taskCreating() };
  ["dlgDemand", "taskDrawer"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el || el.__simWatched) return;
    el.__simWatched = true;
    if (state.layerObserver) {
      state.layerObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
    }
  });
}

function resetAll() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.seq++;
  state.lastDoneKey = "";
  state.collapsedKey = "";
  hideAll();
}

/* ==================== 样式（注入避免改公共 CSS） ==================== */

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  var st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent =
    '.sim-hint{margin:8px 0 4px;padding:10px 12px;border:1px solid var(--border,#E4E7EC);'
    + 'border-radius:10px;background:var(--surface-2,#F2F4F7);}'
    + '.sim-hint[hidden]{display:none;}'
    + '.sim-hint-head{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--text-3,#667085);}'
    + '.sim-hint-head b{font-size:12px;font-weight:650;color:var(--warning-fg,#B54708);white-space:nowrap;}'
    + '.sim-hint-head span{flex:1;min-width:0;}'
    + '.sim-hint-collapse{border:0;background:none;padding:0 2px;font-size:12px;color:var(--text-2,#475467);cursor:pointer;}'
    + '.sim-hint-collapse:hover{color:var(--text,#101828);}'
    + '.sim-hint-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}'
    + '.sim-hint-row{padding:6px 8px;border:1px solid var(--border,#E4E7EC);border-radius:8px;background:var(--surface,#fff);}'
    + '.sim-hint-top{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;}'
    + '.sim-hint-no{flex:none;font-family:var(--mono,ui-monospace,Menlo,monospace);color:var(--text-3,#667085);}'
    + '.sim-hint-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#101828);}'
    + '.sim-hint-open{flex:none;border:1px solid var(--border,#E4E7EC);border-radius:6px;background:none;'
    + 'padding:1px 7px;font-size:11px;line-height:16px;color:var(--text-2,#475467);cursor:pointer;}'
    + '.sim-hint-open:hover{border-color:var(--border-strong,#D0D5DD);color:var(--text,#101828);}'
    + '.sim-hint-meta{margin-top:2px;font-size:11px;line-height:16px;color:var(--text-3,#667085);}'
    + '.sim-hint-snip{margin-top:2px;font-size:11px;line-height:16px;color:var(--text-2,#475467);'
    + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.sim-hint-foot{margin:6px 0 0;font-size:11px;line-height:16px;color:var(--text-3,#667085);}';
  document.head.appendChild(st);
}

export { initSimilarHints };
