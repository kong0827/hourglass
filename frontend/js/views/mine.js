/* views/mine · 我的工作（多角色个人工作台）
   页签：待我处理 / 我发起的 / 我关注的（移动端负责人 / 管理员另有「团队」）
   口径见 docs/audit/my-work-redesign-2026-11-20/设计说明.md */

import { API } from "../core/api.js";
import { btnMineRefresh, mineBody, mineBrief, mineCatchup, mineChips, mineDisplayMenu, mineDisplayPop, mineFilterCount, mineFilterMenu, mineFilterPop, mineNote, mineSearch, mineTabs, mineToolbar } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { isMobile } from "../core/layout.js";
import { loadPrioritySpaces } from "../core/priorities.js";
import { canCreateNow, canEditReq, dueState, progressOf, rt, roleReadOnly, statusBucket } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { UI, esc, toast, toastAction } from "../core/ui.js";
import { PRIORITIES, addDays, colName, dayDiff, fmtShortMD, fmtTs, parseDate } from "../lib/format.js";
import { caliberMarkHTML, initCaliberHelp, registerHelp } from "../lib/caliber-help.js";
import { effectiveMemberRole } from "../lib/member-labels.js";
import { openTaskTable } from "./manager-shared.js";

registerHelp({
  "mine.doneRate": {
    title: "完成率",
    rows: [
      ["怎么算", "区间内完成的工作项数 ÷ 计划工作项数。", "ok"],
      ["计划怎么来", "完成时间落在区间内的，加上截止日期落在区间内的（同一个工作项只算一次）；所以计划里可能包含早已完成、但截止日在本期的项。", "info"],
      ["快照部分", "逾期、被阻塞与待处理是当前快照，不随「本周 / 本月 / 近 30 天」切换。", "mute"]
    ]
  },
  "mine.load": {
    title: "成员负载",
    rows: [
      ["怎么算", "该成员在所选区间内的实际计时 ÷（区间工作日 × 每日 8h 容量），不是按未完成工作项的预估任务量算。", "ok"],
      ["容量", "区间内周一至周五统一折算，不区分成员档期、请假或兼职比例。", "info"],
      ["计时归入", "按计时开始日期落在区间内统计。", "mute"],
      ["阈值", "超过 100% 为超出容量；90%–100% 为接近容量。", "warn"]
    ]
  }
});
initCaliberHelp();

var PAGE = 100;
var STORE_TAB = "ds.mineTab";
var STORE_FOLD = "ds.mineSecFold.v1";
var STORE_GROUP = "ds.mineGroup.v1";
var STORE_GFOLD = "ds.mineGfold.v1";
var HANDOFF_KEY = "ds.wsHandoff.v1";
var PRI_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var PRI_LABEL = { P0: "紧急", P1: "高", P2: "中", P3: "低" };
var TABS = [
  { key: "pending", label: "待我处理" },
  { key: "created", label: "我发起的" },
  { key: "watched", label: "我关注的" }
];
var DEMAND_META = {
  review: { label: "待评审", tone: "plum" },
  pass: { label: "已通过", tone: "green" },
  plan: { label: "已排期", tone: "blue" },
  done: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "gray" },
  rej: { label: "未通过", tone: "gray" },
  canceled: { label: "已取消", tone: "gray" }
};
var PLAN_META = {
  draft: { label: "草稿", tone: "gray" },
  running: { label: "执行中", tone: "orange" },
  done: { label: "已完成", tone: "green" }
};
var RELEASE_META = {
  draft: { label: "草稿", tone: "gray" },
  ready: { label: "就绪", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  canceled: { label: "已取消", tone: "gray" }
};
var PENDING_DEFS = {
  dev: {
    title: "我负责的开发", icon: "board", tint: "blue",
    desc: "负责人是你、尚未完成的工作项；在测试中会显示状态",
    head: ["工作项", "状态", "优先级", "截止", "进度"], grid: "mw-g-dev",
    empty: "目前没有待你开发的工作项", go: "board", unit: "项"
  },
  test: {
    title: "我带的测试", icon: "clock", tint: "plum",
    desc: "测试负责人是你、处于待测试或测试中；可领取队列不计入这里",
    head: ["工作项", "测试进度", "状态", "提测", "截止"], grid: "mw-g-test",
    empty: "目前没有待你测试的工作项", go: "board", unit: "项"
  },
  plan: {
    title: "待我执行的测试计划", icon: "checklist", tint: "green",
    desc: "执行人是你、尚未完成的测试计划；打开后圈选用例并批量记录结果",
    head: ["测试计划", "项目", "进度", "截止", "状态"], grid: "mw-g-plan",
    empty: "目前没有指派给你的测试计划", go: "testcases", unit: "个"
  },
  review: {
    title: "待我评审的需求", icon: "review", tint: "amber",
    desc: "指派给你的优先；未指派的按项目写权限进入公共队列；不含你本人提交的需求",
    head: ["需求", "提交人", "优先级", "期望上线", "提交"], grid: "mw-g-review",
    empty: "目前没有待你评审的需求", go: "demands", unit: "项"
  }
};
var CREATED_DEF = {
  title: "我发起的事项", icon: "demand", tint: "green",
  desc: "需求按最近更新排序，含评审、排期与完成；工作项按看板状态与截止日期跟踪",
  head: ["事项", "状态", "优先级", "期望 / 截止", "最近更新"], grid: "mw-g-demand",
  go: "demands", unit: "个"
};
var WATCH_DEF = {
  title: "我关注的事项", icon: "star", tint: "gray",
  desc: "工作项、缺陷、需求与发布计划只接收提醒，不代表你负责；可随时取消关注",
  head: ["事项", "状态", "所属项目", "版本", "更新时间"], grid: "mw-g-watch",
  go: "board", unit: "条"
};
/* 分组维度沿用工作项列表的统一词表；「待我处理」的分区本身已区分类型，故不提供「按类型」 */
var GROUP_ITEMS = [
  { key: "project", label: "按项目" },
  { key: "type", label: "按类型" },
  { key: "status", label: "按状态" },
  { key: "priority", label: "按优先级" }
];
var TYPE_LABEL = { task: "工作项", bug: "缺陷", demand: "需求", plan: "测试计划", release: "发布计划" };
var STATUS_RANK = {
  "阻塞": 0, "待处理": 1, "进行中": 2, "待测试": 3, "测试中": 4, "评审中": 5,
  "已排期": 6, "就绪": 7, "计划中": 8, "执行中": 9, "已完成": 10, "已关闭": 11, "已取消": 12, "已发布": 13, "草稿": 14
};

/* ---------------- 状态 ---------------- */

function safeGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 受限环境忽略 */ }
}
function loadFold() {
  try {
    var o = JSON.parse(safeGet(STORE_FOLD) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (e) { return {}; }
}
function isGroupKey(v) {
  return v === "project" || v === "type" || v === "status" || v === "priority";
}
function loadGroup() {
  var out = { pending: "none", created: "none", watched: "none" };
  try {
    var o = JSON.parse(safeGet(STORE_GROUP) || "{}");
    if (o && typeof o === "object") {
      TABS.forEach(function (t) {
        if (isGroupKey(o[t.key])) out[t.key] = o[t.key];
      });
    }
  } catch (e) { /* 受限环境回落不分组 */ }
  return out;
}
function saveGroup() {
  safeSet(STORE_GROUP, JSON.stringify(mw.group));
}
function loadGfold() {
  try {
    var o = JSON.parse(safeGet(STORE_GFOLD) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (e) { return {}; }
}
function saveGfold() {
  safeSet(STORE_GFOLD, JSON.stringify(mw.gfold));
}
function enc(v) { return encodeURIComponent(v == null ? "" : v); }
function page0() { return { items: [], offset: 0, hasMore: false, total: 0 }; }
function freshSrc() {
  return {
    pending: { tasks: page0(), review: page0(), plans: page0() },
    created: { demands: page0(), tasks: page0(), statusCounts: null },
    watched: { tasks: page0(), demands: page0(), plans: page0() }
  };
}
function initialTab() {
  var saved = safeGet(STORE_TAB);
  return ["pending", "created", "watched"].indexOf(saved) >= 0 ? saved : "pending";
}

var mw = {
  tab: initialTab(),
  tabTouched: !!safeGet(STORE_TAB),
  counts: null,
  countsErr: null,
  countsLoading: false,
  cseq: 0,
  claimable: 0,
  reviewAvailable: true,
  updatedAt: "",
  q: "",
  chip: { pending: "all", created: "all", watched: "all" },
  pri: "all",
  blocked: false,
  sort: { pending: "updated", created: "updated", watched: "updated" },
  group: loadGroup(),
  gfold: loadGfold(),
  expand: {},
  fold: loadFold(),
  src: freshSrc(),
  loading: { pending: false, created: false, watched: false },
  err: { pending: null, created: null, watched: null },
  partialErr: { pending: null, created: null, watched: null },
  seq: { pending: 0, created: 0, watched: 0 },
  picked: false,
  everLoaded: false,
  reqNames: {},
  reqNamesTried: false,
  team: { range: "week", cache: {}, data: null, err: null, loading: false, seq: 0 }
};

/* ---------------- 基础信息 ---------------- */

function myId() { return (rt.currentUser && rt.currentUser.id) || ""; }
function myName() { return (rt.currentUser && (rt.currentUser.displayName || rt.currentUser.username)) || ""; }
function myRole() { return (rt.currentWs && rt.currentWs.myRole) || ""; }
/* 团队页签：空间主 / 管理员（桌面与移动同一入口，数据同一接口） */
function canTeam() { return myRole() === "owner" || myRole() === "admin"; }
function myMember() {
  var id = myId(), list = rt.wsMembersCache || [];
  for (var i = 0; i < list.length; i++) if (list[i].userId === id) return list[i];
  return null;
}
function roleTitle() { return effectiveMemberRole(myMember()); }
function roleLabel() {
  if (roleTitle()) return roleTitle();
  var r = myRole();
  return r === "owner" ? "空间主" : r === "admin" ? "管理员" : r === "viewer" ? "查看者" : (r ? "成员" : "");
}
function identityText() {
  var bits = [];
  if (myName()) bits.push(myName());
  if (roleLabel()) bits.push(roleLabel());
  return bits.join(" · ");
}
function sectionOrder() {
  var title = roleTitle();
  if (myRole() === "owner" || myRole() === "admin" || /产品|需求|经理|负责人/.test(title)) return ["review", "plan", "test", "dev"];
  if (/测试/.test(title)) return ["plan", "test", "dev", "review"];
  return ["plan", "dev", "test", "review"];
}
function reviewAllowed() { return !mw.counts || mw.counts.reviewAvailable !== false; }
function num(v) { return Number(v) || 0; }
function tabCount(key) {
  if (key === "team") return null;
  if (!mw.counts) return null;
  var server, loaded;
  if (key === "pending") {
    var p = mw.counts.pending || {};
    server = num(p.tasks) + num(p.review) + num(p.plans);
    var all = pendingData();
    loaded = all.dev.length + all.test.length + all.review.length + all.plan.length;
  } else if (key === "created") {
    server = num(mw.counts.created) + num(mw.counts.createdTasks);
    loaded = createdData().length;
  } else {
    server = num(mw.counts.watched);
    loaded = watchedData().length;
  }
  /* 计数来自服务端；本页已载入的行数更大时以行数为准，避免页签数字与可见列表矛盾 */
  return Math.max(server, loaded);
}
function activeTabs() {
  var list = TABS.slice();
  if (canTeam()) list.push({ key: "team", label: "团队" });
  return list;
}
function activeTabKeys() {
  return activeTabs().map(function (t) { return t.key; });
}
function currentTab() {
  return activeTabKeys().indexOf(mw.tab) >= 0 ? mw.tab : "pending";
}

/* ---------------- 排队与时间 ---------------- */

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var d = new Date(String(v).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}
function tsOf(v) { var d = toDate(v); return d ? d.getTime() : 0; }
function isTodayTs(v) {
  var d = toDate(v);
  return !!(d && rt.TODAY && d.toDateString() === rt.TODAY.toDateString());
}
function mineDueKind(t) {
  var st = dueState(t);
  if (st.kind === "over") return "overdue";
  if (st.kind === "today") return "today";
  if (st.kind === "none") return "none";
  if (st.kind === "done" || st.kind === "canceled" || st.kind === "ended") return st.kind;
  var dow = (rt.TODAY.getDay() + 6) % 7;
  var weekEnd = addDays(rt.TODAY, 6 - dow);
  return parseDate(t.dueDate) <= weekEnd ? "week" : "later";
}
function dueN(t) {
  var st = dueState(t);
  return st && st.n ? st.n : 0;
}
function reqNameOf(id) {
  if (!id) return "";
  var list = rt.reqList || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name || "";
  return mw.reqNames[id] || "";
}
function taskRelation(t) {
  var id = myId(), name = myName();
  var isDev = (id && t.ownerUserId === id) || (!t.ownerUserId && name && t.owner === name);
  if (isDev) return "dev";
  var isTest = id && t.testOwnerUserId === id && (t.boardColumn === "test" || t.boardColumn === "testing");
  return isTest ? "test" : "dev";
}
function taskRow(t, role) {
  var vers = Array.isArray(t.versionNames) && t.versionNames.length ? t.versionNames[0] : "";
  return {
    kind: "task", type: "task", itemType: t.itemType || "task",
    id: t.id, wsId: t.workspaceId || "", wsName: t.workspaceName || "",
    title: t.title || "未命名工作项", project: t.reqName || reqNameOf(t.reqId), version: vers,
    pri: t.priority || "", blocked: !!t.blocked, col: t.boardColumn || "",
    dueKind: mineDueKind(t), dueN: dueN(t), dueDate: t.dueDate || "",
    updatedTs: tsOf(t.updatedAt), updatedRaw: t.updatedAt || "",
    requested: t.testRequestedAt || "", requestedRaw: t.testRequestedAt || "",
    progress: progressOf(t), testDone: num(t.subtaskDone), testTotal: num(t.subtaskTotal),
    submitter: t.owner || "", expect: "", createdTs: 0, createdRaw: "",
    viewRole: role || "dev", raw: t
  };
}
function demandRow(d) {
  var st = d.status || "";
  var meta = DEMAND_META[st] || { label: st || "—", tone: "gray" };
  var nowWs = rt.currentWs || {};
  return {
    kind: "demand", type: "demand", id: d.id, wsId: nowWs.id || "", wsName: nowWs.name || "",
    title: d.title || "未命名需求", project: reqNameOf(d.reqId), version: d.versionName || "",
    pri: d.priority || "", blocked: false, col: "", dueKind: "none", dueN: 0, dueDate: "",
    status: st, statusLabel: meta.label, tone: meta.tone,
    updatedTs: tsOf(d.updatedAt), updatedRaw: d.updatedAt || "",
    requested: "", requestedRaw: "",
    progress: 0, testDone: 0, testTotal: 0,
    submitter: d.createdByName || d.createdBy || "", reviewer: d.reviewerName || "", expect: d.expectDate || "",
    canClaim: st === "review" && !d.reviewerUserId && canEditReq(d.reqId) &&
      (!rt.currentUser || d.createdBy !== rt.currentUser.id),
    createdTs: tsOf(d.createdAt), createdRaw: d.createdAt || "",
    viewRole: "", raw: d
  };
}

/* 发布计划行：我的关注里的只读摘要，点开进版本页的发布工作台 */
function releasePlanRow(p) {
  var meta = RELEASE_META[p.status] || { label: p.status || "—", tone: "gray" };
  var planLabel = p.planNo ? ("PL-" + (p.planNo < 100 ? (p.planNo < 10 ? "00" : "0") : "") + p.planNo) : "发布计划";
  var nowWs = rt.currentWs || {};
  var planned = p.plannedAt ? String(p.plannedAt).slice(0, 10) : "";
  return {
    kind: "release", type: "release", id: p.id, versionId: p.versionId || "", reqId: p.reqId || "",
    wsId: nowWs.id || "", wsName: nowWs.name || "",
    title: planLabel + (p.versionNames ? " · " + p.versionNames : ""),
    project: p.projectNames || "", version: planned || (p.versionCount ? p.versionCount + " 个版本" : ""),
    pri: "", blocked: false, col: "",
    dueKind: p.plannedAt ? "none" : "none", dueN: 0, dueDate: p.plannedAt || "",
    updatedTs: tsOf(p.updatedAt), updatedRaw: p.updatedAt || "",
    requested: "", requestedRaw: "",
    progress: 0, testDone: 0, testTotal: 0,
    status: p.status || "", statusLabel: meta.label, tone: meta.tone,
    submitter: "", expect: "", createdTs: 0, createdRaw: "",
    plannedAt: p.plannedAt || "", versionCount: p.versionCount || 0,
    viewRole: "", raw: p
  };
}

function planDueInfo(end) {  if (!end) return { kind: "none", n: 0 };
  var d = parseDate(end);
  if (!d) return { kind: "none", n: 0 };
  var n = dayDiff(d, rt.TODAY);
  if (n < 0) return { kind: "overdue", n: -n };
  if (n === 0) return { kind: "today", n: 0 };
  var dow = (rt.TODAY.getDay() + 6) % 7;
  var weekEnd = addDays(rt.TODAY, 6 - dow);
  return d <= weekEnd ? { kind: "week", n: 0 } : { kind: "later", n: 0 };
}
/* 测试计划行：执行人的「待我执行」队列，字段与 /api/my-work/test-plans 对齐 */
function planRowModel(p) {
  var meta = PLAN_META[p.status] || { label: p.status || "—", tone: "gray" };
  var due = planDueInfo(p.plannedEnd);
  var nowWs = rt.currentWs || {};
  return {
    kind: "plan", type: "plan", id: p.id, reqId: p.reqId || "", wsId: nowWs.id || "", wsName: nowWs.name || "",
    title: p.name || "未命名计划", project: p.reqName || reqNameOf(p.reqId), version: p.versionName || "",
    pri: "", blocked: false, col: "",
    dueKind: due.kind, dueN: due.n, dueDate: p.plannedEnd || "",
    updatedTs: tsOf(p.createdAt), updatedRaw: p.createdAt || "",
    requested: "", requestedRaw: "",
    progress: p.caseCount ? Math.round(num(p.executedCount) * 100 / p.caseCount) : 0,
    testDone: num(p.executedCount), testTotal: num(p.caseCount),
    caseCount: num(p.caseCount), executedCount: num(p.executedCount),
    status: p.status || "", statusLabel: meta.label, tone: meta.tone,
    submitter: "", expect: "", createdTs: 0, createdRaw: "",
    viewRole: "", raw: p
  };
}

/* ---------------- 计数与列表请求 ---------------- */

function loadCounts(force) {
  if (mw.countsLoading && !force) return Promise.resolve();
  mw.countsLoading = true;
  var seq = ++mw.cseq;
  return API.get("/api/my-work/counts").then(function (d) {
    if (seq !== mw.cseq) return;
    mw.counts = d || null;
    if (d) {
      mw.claimable = num(d.claimable);
      mw.reviewAvailable = d.reviewAvailable !== false;
      mw.updatedAt = d.updatedAt || "";
    }
    mw.countsErr = null;
  }).catch(function (ex) {
    if (seq !== mw.cseq) return;
    mw.countsErr = ex;
  }).then(function () {
    if (seq !== mw.cseq) return;
    mw.countsLoading = false;
    autoPick();
    render();
  });
}
function autoPick() {
  if (mw.picked) return;
  mw.picked = true;
  if (mw.tabTouched || !mw.counts) return;
  if (currentTab() !== "pending") return;
  if (num(tabCount("pending")) > 0) return;
  if (num(tabCount("created")) > 0) {
    mw.tab = "created";
    loadTab("created", { silent: true });
    return;
  }
  if (num(tabCount("watched")) > 0) {
    mw.tab = "watched";
    loadTab("watched", { silent: true });
  }
}
function fetchTasks(view, scope, offset) {
  return API.getGlobal("/api/my-tasks", { view: view, scope: scope, offset: offset, limit: PAGE });
}
function fetchDemands(view, offset) {
  return API.get("/api/my-demands", { view: view, offset: offset, limit: PAGE });
}
/* 我发起的工作项：跨空间，含已完成与已取消（scope=all） */
function fetchCreatedTasks(offset) {
  return fetchTasks("created", "all", offset);
}
function fetchTestPlans(offset) {
  return API.get("/api/my-work/test-plans", { offset: offset, limit: PAGE });
}
function fetchReleasePlans(offset) {
  return API.get("/api/my-work/release-plans", { view: "watch", offset: offset, limit: PAGE });
}
function mergePage(prev, res, append) {
  var items = append ? (prev.items || []).concat((res && res.items) || []) : ((res && res.items) || []);
  return {
    items: items,
    offset: items.length,
    hasMore: !!(res && res.hasMore),
    total: res && typeof res.total === "number" ? res.total : items.length
  };
}
function applySource(tab, key, res, append) {
  var src = mw.src;
  if (tab === "pending") {
    if (key === "tasks") src.pending.tasks = mergePage(src.pending.tasks, res, append);
    else if (key === "plans") src.pending.plans = mergePage(src.pending.plans, res, append);
    else src.pending.review = mergePage(src.pending.review, res, append);
    return;
  }
  if (tab === "created") {
    if (key === "createdTasks") src.created.tasks = mergePage(src.created.tasks, res, append);
    else {
      src.created.demands = mergePage(src.created.demands, res, append);
      if (res && res.statusCounts) src.created.statusCounts = res.statusCounts;
    }
    return;
  }
  if (tab === "watched") {
    if (key === "tasks") src.watched.tasks = mergePage(src.watched.tasks, res, append);
    else if (key === "release") src.watched.plans = mergePage(src.watched.plans, res, append);
    else src.watched.demands = mergePage(src.watched.demands, res, append);
  }
}
function resetTabSource(tab) {
  if (tab === "pending") mw.src.pending = { tasks: page0(), review: page0(), plans: page0() };
  else if (tab === "created") mw.src.created = { demands: page0(), tasks: page0(), statusCounts: mw.src.created.statusCounts };
  else if (tab === "watched") mw.src.watched = { tasks: page0(), demands: page0(), plans: page0() };
}
function allDemandItems() {
  return (mw.src.pending.review.items || [])
    .concat(mw.src.created.demands.items || [])
    .concat(mw.src.watched.demands.items || []);
}
function ensureReqNames() {
  if (mw.reqNamesTried) return;
  var missing = false;
  allDemandItems().forEach(function (d) {
    if (d.reqId && !reqNameOf(d.reqId)) missing = true;
  });
  if (!missing) return;
  mw.reqNamesTried = true;
  API.getAllPages("/api/reqs").then(function (list) {
    (list || []).forEach(function (r) { if (r && r.id) mw.reqNames[r.id] = r.name || ""; });
    render();
  }).catch(function () { /* 项目名取不到时保留为空，不影响列表主体 */ });
}

function loadTab(tab, opts) {
  opts = opts || {};
  if (tab === "team" || !mineBody) return Promise.resolve();
  var append = !!opts.append;
  if (append && mw.loading[tab]) return Promise.resolve();
  if (!append) {
    mw.loading[tab] = true;
    mw.err[tab] = null;
    mw.partialErr[tab] = null;
    if (!opts.silent) resetTabSource(tab);
    render();
  }
  var seq = ++mw.seq[tab];
  /* 分块加载：各数据源独立成败，单个接口失败只降级该块，不再整页报错 */
  var jobs = [];
  if (tab === "pending") {
    var tOff = append ? mw.src.pending.tasks.offset : 0;
    var rOff = append ? mw.src.pending.review.offset : 0;
    var pOff = append ? mw.src.pending.plans.offset : 0;
    if (!append || mw.src.pending.tasks.hasMore) {
      jobs.push({ key: "tasks", run: function () { return fetchTasks("pending", "open", tOff); } });
    }
    if (!append || mw.src.pending.plans.hasMore) {
      jobs.push({ key: "plans", run: function () { return fetchTestPlans(pOff); } });
    }
    if (reviewAllowed() && (!append || mw.src.pending.review.hasMore)) {
      jobs.push({ key: "review", run: function () { return fetchDemands("review", rOff); } });
    }
  } else if (tab === "created") {
    var cdOff = append ? mw.src.created.demands.offset : 0;
    var ctOff = append ? mw.src.created.tasks.offset : 0;
    if (!append || mw.src.created.demands.hasMore) {
      jobs.push({ key: "created", run: function () { return fetchDemands("created", cdOff); } });
    }
    if (!append || mw.src.created.tasks.hasMore) {
      jobs.push({ key: "createdTasks", run: function () { return fetchCreatedTasks(ctOff); } });
    }
  } else if (tab === "watched") {
    var wtOff = append ? mw.src.watched.tasks.offset : 0;
    var wdOff = append ? mw.src.watched.demands.offset : 0;
    var wpOff = append ? mw.src.watched.plans.offset : 0;
    if (!append || mw.src.watched.tasks.hasMore) {
      jobs.push({ key: "tasks", run: function () { return fetchTasks("watch", "all", wtOff); } });
    }
    if (!append || mw.src.watched.demands.hasMore) {
      jobs.push({ key: "demands", run: function () { return fetchDemands("watch", wdOff); } });
    }
    if (!append || mw.src.watched.plans.hasMore) {
      jobs.push({ key: "release", run: function () { return fetchReleasePlans(wpOff); } });
    }
  }
  if (!jobs.length) {
    mw.loading[tab] = false;
    render();
    return Promise.resolve();
  }
  return runJobs(tab, jobs, append, seq).then(function (r) {
    if (seq !== mw.seq[tab] || !r.ok) return;
    if (r.spaces.length) return loadPrioritySpaces(r.spaces);
  }).then(function () {
    if (seq !== mw.seq[tab]) return;
    render();
  });
}

function runJobs(tab, jobs, append, seq) {
  var spaces = [];
  var tracked = jobs.map(function (j) {
    var p = j.run();
    if (j.key === "tasks" || j.key === "createdTasks") p = p.then(function (res) {
      if (res && res.spaces) spaces = spaces.concat(res.spaces);
      return res;
    });
    return p.then(function (res) { return { key: j.key, res: res }; }, function (err) { return { key: j.key, err: err }; });
  });
  return Promise.all(tracked).then(function (list) {
    if (seq !== mw.seq[tab]) return { ok: false, spaces: [] };
    var fails = list.filter(function (x) { return x.err; });
    list.forEach(function (x) { if (!x.err) applySource(tab, x.key, x.res, append); });
    mw.loading[tab] = false;
    if (append) {
      mw.err[tab] = null;
      if (fails.length) toast("加载更多失败：" + (fails[0].err.message || "网络异常"), "bad");
      render();
      return { ok: false, spaces: spaces };
    }
    mw.err[tab] = fails.length === list.length ? fails[0].err : null;
    mw.partialErr[tab] = fails.length && fails.length < list.length ? {
      keys: fails.map(function (f) { return f.key; }),
      msg: (fails[0].err && fails[0].err.message) || "网络异常",
      retrying: false,
      jobs: jobs.filter(function (j) {
        return fails.some(function (f) { return f.key === j.key; });
      })
    } : null;
    if (list.some(function (x) { return !x.err; })) {
      mw.everLoaded = true;
      ensureReqNames();
    }
    return { ok: true, spaces: spaces };
  }, function (ex) {
    if (seq !== mw.seq[tab]) return { ok: false, spaces: [] };
    mw.loading[tab] = false;
    mw.err[tab] = ex;
    render();
    return { ok: false, spaces: [] };
  });
}

function retryPartial(tab) {
  var info = mw.partialErr[tab];
  if (!info || info.retrying || !info.jobs || !info.jobs.length) return;
  var seq = mw.seq[tab];
  info.retrying = true;
  render();
  runJobs(tab, info.jobs, false, seq).then(function () {
    if (seq !== mw.seq[tab]) return;
    render();
  });
  return Promise.resolve();
}

function loadMine(opts) {
  opts = opts || {};
  if (!mineBody) return Promise.resolve();
  mw.tab = currentTab();
  if (mw.tab === "team") {
    loadCounts(false);
    return loadTeam(opts);
  }
  var jobs = [loadCounts(false), loadTab(mw.tab, { silent: !!opts.silent })];
  render();
  return Promise.all(jobs);
}

/* ---------------- 行过滤 / 排序 ---------------- */

function rowPass(r) {
  var tab = currentTab();
  if (mw.q) {
    var hay = [r.title, r.project, r.submitter, r.wsName, r.version].join(" ").toLowerCase();
    if (hay.indexOf(mw.q.toLowerCase()) === -1) return false;
  }
  if (tab !== "watched" && mw.pri !== "all" && r.pri !== mw.pri) return false;
  if (mw.blocked && !r.blocked) return false;
  var chip = mw.chip[tab] || "all";
  if (chip !== "all") {
    if (tab === "pending") {
      if (chip === "overdue" && r.dueKind !== "overdue") return false;
      if (chip === "today" && r.dueKind !== "today") return false;
      if (chip === "week" && r.dueKind !== "week") return false;
    } else if (tab === "watched") {
      if (chip === "task" && (r.kind !== "task" || r.itemType === "bug")) return false;
      if (chip === "bug" && (r.kind !== "task" || r.itemType !== "bug")) return false;
      if (chip === "demand" && r.kind !== "demand") return false;
      if (chip === "release" && r.kind !== "release") return false;
      if (chip === "today" && !isTodayTs(r.updatedRaw)) return false;
    } else if (tab === "created") {
      if (chip === "demand" && r.kind !== "demand") return false;
      if (chip === "task" && r.kind !== "task") return false;
    }
  }
  return true;
}
function sortRows(rows) {
  var tab = currentTab();
  var key = mw.sort[tab] || "updated";
  var arr = rows.slice();
  function byTitle(a, b) { return String(a.title).localeCompare(String(b.title), "zh-Hans-CN"); }
  if (key === "priority") {
    arr.sort(function (a, b) {
      var x = PRI_RANK[a.pri], y = PRI_RANK[b.pri];
      return (x === undefined ? 9 : x) - (y === undefined ? 9 : y) || byTitle(a, b);
    });
  } else if (key === "expect") {
    arr.sort(function (a, b) {
      /* 需求看期望上线，工作项看截止日期：合并列表按「最近的时间节点」排，未定的排最后 */
      var xv = a.expect || a.dueDate, yv = b.expect || b.dueDate;
      var x = xv ? parseDate(xv).getTime() : Infinity;
      var y = yv ? parseDate(yv).getTime() : Infinity;
      return x - y || byTitle(a, b);
    });
  } else if (key === "due" && tab === "pending") {
    arr.sort(function (a, b) {
      var x = a.dueDate ? parseDate(a.dueDate).getTime() : Infinity;
      var y = b.dueDate ? parseDate(b.dueDate).getTime() : Infinity;
      return x - y || byTitle(a, b);
    });
  } else {
    arr.sort(function (a, b) { return (b.updatedTs || 0) - (a.updatedTs || 0) || byTitle(a, b); });
  }
  return arr;
}
function hasFilter() {
  return !!(mw.q || mw.pri !== "all" || mw.blocked || (mw.chip[currentTab()] && mw.chip[currentTab()] !== "all"));
}

/* ---------------- 分组 ---------------- */

function groupDim(tab) {
  var v = mw.group[tab] || "none";
  if (tab === "pending" && v === "type") return "none";
  return v;
}
function groupItemsFor(tab) {
  return tab === "pending" ? GROUP_ITEMS.filter(function (g) { return g.key !== "type"; }) : GROUP_ITEMS;
}
function statusTextOf(r) {
  if (r.kind === "task") return taskStatus(r).label;
  return r.statusLabel || "—";
}
function groupMetaOf(r, dim) {
  if (dim === "project") return { key: r.project || "\u0000none", label: r.project || "未归属项目" };
  if (dim === "type") {
    var t = r.kind === "task" ? (r.itemType === "bug" ? "bug" : "task") : r.kind;
    return { key: t, label: TYPE_LABEL[t] || "其他" };
  }
  if (dim === "status") {
    var l = statusTextOf(r);
    return { key: l, label: l };
  }
  return r.pri
    ? { key: r.pri, label: r.pri + " " + (PRI_LABEL[r.pri] || "") }
    : { key: "\u0000none", label: "未设优先级" };
}
/* 组顺序：优先级按 P0–P3，状态按流转顺序，其余按组内最新更新时间；
   无论哪种维度，组内行都沿用当前排序（默认最近更新倒序） */
function groupRowsOf(rows, dim) {
  var map = {}, list = [];
  rows.forEach(function (r) {
    var m = groupMetaOf(r, dim);
    var g = map[m.key];
    if (!g) {
      g = map[m.key] = { key: m.key, label: m.label, items: [], newest: 0 };
      list.push(g);
    }
    g.items.push(r);
    g.newest = Math.max(g.newest, r.updatedTs || 0);
  });
  list.sort(function (a, b) {
    if (dim === "priority") {
      var x = PRI_RANK[a.key], y = PRI_RANK[b.key];
      return (x === undefined ? 9 : x) - (y === undefined ? 9 : y);
    }
    if (dim === "status") {
      var sx = STATUS_RANK[a.label], sy = STATUS_RANK[b.label];
      sx = sx === undefined ? 50 : sx;
      sy = sy === undefined ? 50 : sy;
      if (sx !== sy) return sx - sy;
    }
    return b.newest - a.newest;
  });
  return list;
}
function groupBodyHTML(rows, rowFn, dim, sectionKey) {
  if (dim === "none") return rows.map(rowFn).join("");
  return groupRowsOf(rows, dim).map(function (g) {
    /* 组名可能含任意字符（项目名），用 JSON 串保证折叠状态的键不歧义 */
    var gid = JSON.stringify([sectionKey, dim, g.key]);
    var folded = !!mw.gfold[gid];
    return '<div class="mw-ggroup' + (folded ? " is-folded" : "") + '">' +
      '<button class="mw-ghead" type="button" data-gfold="' + esc(gid) + '" aria-expanded="' + (folded ? "false" : "true") +
      '" title="' + (folded ? "展开本组" : "收起本组") + '">' +
      '<span class="mw-gchev">' + icon("chevronRight", 11) + '</span>' +
      '<span class="mw-gname">' + esc(g.label) + '</span>' +
      '<span class="mw-gn">' + g.items.length + '</span></button>' +
      '<div class="mw-gbody">' + g.items.map(rowFn).join("") + '</div></div>';
  }).join("");
}
function groupCountText(filtered, dim) {
  return dim === "none" ? "" : " · " + groupRowsOf(filtered, dim).length + " 组";
}

/* ---------------- 单元格 ---------------- */

function typeTag(r) {
  if (r.kind === "release") {
    return '<span class="vtag" style="background:var(--plum-soft);color:var(--plum-fg)">发布计划</span>';
  }
  if (r.kind === "demand") {
    return '<span class="vtag" style="background:var(--success-soft);color:var(--success-fg)">需求</span>';
  }
  if (r.itemType === "bug") {
    return '<span class="vtag" style="background:var(--danger-soft);color:var(--danger-fg)">缺陷</span>';
  }
  return '<span class="vtag" style="background:var(--primary-soft);color:var(--primary-fg)">工作项</span>';
}
function titleCell(r, view) {
  var bits = [];
  if (view === "watched") {
    bits.push(typeTag(r));
    if (r.kind === "release") {
      if (r.project) bits.push(esc(r.project));
      if (r.version) bits.push('<span class="vtag">' + esc(r.version) + '</span>');
    } else {
      if (r.wsName) bits.push(esc(r.wsName));
      if (r.version) bits.push('<span class="vtag">' + esc(r.version) + '</span>');
    }
  } else {
    if (view === "created") bits.push(typeTag(r));
    if (r.project) bits.push(esc(r.project));
    if (r.version) bits.push('<span class="vtag">' + esc(r.version) + '</span>');
    if (r.kind === "demand" && r.reviewer) bits.push('评审人 ' + esc(r.reviewer));
    if (view === "created" && r.kind === "task" && r.submitter) bits.push('负责人 ' + esc(r.submitter));
  }
  if (!bits.length) bits.push('<span class="mw-muted">未归属项目</span>');
  return '<div class="mw-tcell"><div class="mw-ttl" title="' + esc(r.title) + '">' + esc(r.title) + '</div>' +
    '<div class="mw-tm">' + bits.join('<span class="sep">·</span>') + '</div></div>';
}
function taskStatus(r) {
  var t = r.raw;
  if (t.boardColumn === "canceled") return { label: "已取消", tone: "gray" };
  if (t.boardColumn === "done") return { label: "已完成", tone: "green" };
  if (t.blocked) return { label: "阻塞", tone: "orange" };
  var name = colName(t.boardColumn) || "未知状态";
  if (t.boardColumn === "testing" || t.boardColumn === "test") return { label: name, tone: "plum" };
  var b = statusBucket(t);
  return { label: name, tone: b === "doing" ? "blue" : (b === "ended" ? "green" : "gray") };
}
function statusCell(r) {
  var s = r.kind === "task" ? taskStatus(r)
    : r.kind === "release" ? { label: r.statusLabel, tone: r.tone }
    : { label: r.statusLabel, tone: r.tone };
  return '<span class="mw-badge mw-st-' + s.tone + '">' + esc(s.label) + '</span>';
}
function priCell(r) {
  if (!r.pri) return '<span class="mw-muted">—</span>';
  return '<span class="mw-pri ' + r.pri.toLowerCase() + '" title="' + esc(PRI_LABEL[r.pri] || r.pri) + '"><i></i>' + esc(r.pri) + '</span>';
}
function dueCell(r) {
  if (r.kind === "demand") return '<span class="mw-muted">—</span>';
  if (r.dueKind === "none") return '<span class="mw-muted">未设</span>';
  if (r.dueKind === "overdue") return '<span class="mw-due over">' + icon("alert", 11) + '逾期 ' + r.dueN + ' 天</span>';
  if (r.dueKind === "today") return '<span class="mw-due today">今天</span>';
  if (r.dueKind === "done" || r.dueKind === "canceled" || r.dueKind === "ended") return '<span class="mw-muted">—</span>';
  return '<span class="mw-due">' + esc(fmtShortMD(parseDate(r.dueDate))) + '</span>';
}
function progCell(r) {
  if (r.kind !== "task") return '<span class="mw-muted">—</span>';
  if (r.viewRole === "test") {
    var txt = r.testTotal > 0 ? (r.testDone + "/" + r.testTotal) : (r.progress + "%");
    return '<span class="mw-prog">' + (r.testTotal > 0 ? icon("check", 11) : "") + esc(txt) + '</span>';
  }
  var p = Math.max(0, Math.min(100, r.progress));
  return '<span class="mw-prog"><span class="mw-bar' + (r.dueKind === "overdue" ? " warn" : "") + '">' +
    '<span style="width:' + p + '%"></span></span>' + p + '%</span>';
}
function requestedCell(r) {
  if (!r.requested) return '<span class="mw-muted">—</span>';
  return '<span title="' + esc(fmtTs(r.requested)) + '">' + esc(fmtTs(r.requested)) + '</span>';
}
function submitterCell(r) {
  return r.submitter ? esc(r.submitter) : '<span class="mw-muted">—</span>';
}
function expectCell(r) {
  if (!r.expect) return '<span class="mw-muted">未定</span>';
  return esc(fmtShortMD(parseDate(r.expect)));
}
/* 合并列表第 4 列：需求是期望上线，工作项是截止日期 */
function nodeCell(r) {
  return r.kind === "demand" ? expectCell(r) : dueCell(r);
}
function submitCell(r) {
  if (!r.createdTs) return '<span class="mw-muted">—</span>';
  var wait = Math.max(0, dayDiff(rt.TODAY, new Date(r.createdTs)));
  /* 列宽有限：只写日期 + 等待天数，完整提交时间放 title，避免换行把行高撑开 */
  return '<span class="mw-cell-wait' + (wait >= 3 ? " mw-warn-txt" : "") + '" title="提交于 ' + esc(fmtTs(r.createdRaw)) + '，已等待 ' + wait + ' 天">' +
    esc(fmtShortMD(new Date(r.createdTs))) + (wait >= 3 ? ' · ' + wait + ' 天' : '') + '</span>';
}
function updatedCell(r) {
  if (!r.updatedTs) return '<span class="mw-muted">—</span>';
  return '<span title="' + esc(fmtTs(r.updatedRaw)) + '">' + esc(fmtTs(r.updatedRaw)) + '</span>';
}

/* ---------------- 行 ---------------- */

function rowAttrs(r, view) {
  var what = r.kind === "task" ? (r.itemType === "bug" ? "缺陷" : "工作项")
    : (r.kind === "plan" ? "测试计划" : (r.kind === "release" ? "发布计划" : "需求"));
  return ' role="button" tabindex="0" data-open="' + r.kind + '" data-id="' + esc(r.id) + '" data-ws="' + esc(r.wsId) +
    '" data-req="' + esc(r.reqId || "") + '" data-version="' + esc(r.versionId || "") +
    '" data-title="' + esc(r.title) + '" aria-label="打开' + what + '：' + esc(r.title) + '"';
}
function devRow(r) {
  return '<div class="mw-row mw-g-dev"' + rowAttrs(r, "pending") + '>' + titleCell(r) + '<div>' + statusCell(r) +
    '</div><div>' + priCell(r) + '</div><div>' + dueCell(r) + '</div><div>' + progCell(r) + '</div></div>';
}
function testRow(r) {
  return '<div class="mw-row mw-g-test"' + rowAttrs(r, "pending") + '>' + titleCell(r) + '<div>' + progCell(r) +
    '</div><div>' + statusCell(r) + '</div><div>' + requestedCell(r) + '</div><div>' + dueCell(r) + '</div></div>';
}
function planProgCell(r) {
  var p = Math.max(0, Math.min(100, num(r.progress)));
  return '<span class="mw-prog"><span class="mw-bar' + (r.dueKind === "overdue" ? " warn" : "") + '">' +
    '<span style="width:' + p + '%"></span></span>' + p + '%</span>';
}
function planRow(r) {
  return '<div class="mw-row mw-g-plan"' + rowAttrs(r, "pending") + '>' + titleCell(r) +
    '<div>' + (r.project ? esc(r.project) : '<span class="mw-muted">—</span>') + '</div>' +
    '<div>' + planProgCell(r) + '</div><div>' + dueCell(r) + '</div><div>' + statusCell(r) + '</div></div>';
}
function reviewRow(r) {
  /* 未指派的需求给一个就地认领入口：认领只写入评审人，不会顺带通过 */
  var submit = submitCell(r);
  if (!r.reviewer && r.canClaim) {
    submit = '<div class="mw-cell-claim"><span>' + submit + '</span>' +
      '<button class="mw-link" type="button" data-claim-review="' + esc(r.id) + '" title="认领后由你评审，不会自动通过">认领评审</button></div>';
  }
  return '<div class="mw-row mw-g-review"' + rowAttrs(r, "pending") + '>' + titleCell(r) + '<div>' + submitterCell(r) +
    '</div><div>' + priCell(r) + '</div><div>' + expectCell(r) + '</div><div>' + submit + '</div></div>';
}
function createdRow(r) {
  return '<div class="mw-row mw-g-demand"' + rowAttrs(r, "created") + '>' + titleCell(r, "created") + '<div>' + statusCell(r) +
    '</div><div>' + priCell(r) + '</div><div>' + nodeCell(r) + '</div><div>' + updatedCell(r) + '</div></div>';
}
function watchedRow(r) {
  var upd = '<div class="mw-cell-upd"><span>' + updatedCell(r) + '</span>' +
    '<button class="mw-unwatch" type="button" data-unwatch="' + r.kind + '" data-id="' + esc(r.id) + '" data-ws="' +
    esc(r.wsId) + '" data-title="' + esc(r.title) + '">取消关注</button></div>';
  return '<div class="mw-row mw-g-watch"' + rowAttrs(r, "watched") + '>' + titleCell(r, "watched") + '<div>' + statusCell(r) +
    '</div><div class="mw-cell-proj">' + (r.project ? esc(r.project) : '<span class="mw-muted">—</span>') +
    '</div><div class="mw-cell-ver">' + (r.version ? esc(r.version) : '<span class="mw-muted">—</span>') +
    '</div>' + upd + '</div>';
}

/* ---------------- 分区 ---------------- */

function claimHTML() {
  return '<div class="mw-claimline">' + icon("inbox", 13) +
    '<span>另有 <b>' + mw.claimable + '</b> 个未指派测试可领取 · 不计入你的待处理</span>' +
    '<button class="mw-link" type="button" data-claim title="打开当前空间的可领取测试列表">去领取 ' + icon("chevronRight", 12) + '</button></div>';
}
/* 分区头：图标 + 标题是折叠开关；数量、口径与次要操作留在按钮外，收起时次要操作一并隐藏 */
function secHeadHTML(key, def, countText, act) {
  var folded = !!mw.fold[key];
  return '<div class="mw-shead">' +
    '<button class="mw-sfold" type="button" data-fold="' + key + '" aria-expanded="' + (folded ? "false" : "true") +
    '" aria-controls="mw-body-' + key + '" aria-label="' + (folded ? "展开" : "收起") + "「" + esc(def.title) + "」" +
    '" title="' + (folded ? "展开本分区" : "收起本分区") + '">' +
    '<span class="mw-sicon mw-tint-' + def.tint + '">' + icon(def.icon, 14) + '</span>' +
    '<span class="mw-stitle">' + esc(def.title) + '</span>' +
    '<span class="mw-chev">' + icon("chevronRight", 12) + '</span></button>' +
    '<span class="mw-scount">' + esc(countText) + '</span>' +
    '<span class="mw-sdesc">' + esc(def.desc) + '</span>' +
    '<span class="mw-sact">' + (act || "") + '</span></div>';
}
function secOpen(key, def, countText, act) {
  return '<section class="mw-sec' + (mw.fold[key] ? " is-folded" : "") + '">' + secHeadHTML(key, def, countText, act) +
    '<div class="mw-sbody" id="mw-body-' + key + '">';
}
function emptySection(key, def) {
  var html = secOpen(key, def, "0 " + (def.unit || "项")) +
    '<div class="mw-sempty">' + icon("inbox", 14) + '<span>' + esc(def.empty) + '</span>' +
    '<button class="mw-link" type="button" data-go="' + def.go + '">去看看 ' + icon("chevronRight", 12) + '</button></div>';
  if (key === "test" && mw.claimable > 0) html += claimHTML();
  return html + '</div></section>';
}
function sectionHTML(key, def, rows, rowFn, view) {
  var filtered = sortRows(rows.filter(rowPass));
  if (!rows.length) {
    if (hasFilter()) return "";
    return emptySection(key, def);
  }
  if (!filtered.length) return "";
  var dim = groupDim("pending");
  var expanded = !!mw.expand[key];
  /* 分组后由分组头承担收拢，分区本身不再截断为 4 行 */
  var shown = dim !== "none" ? filtered : (expanded ? filtered : filtered.slice(0, 4));
  var countText = filtered.length + " " + (def.unit || "项") + groupCountText(filtered, dim) +
    (filtered.length !== rows.length ? " / 共 " + rows.length : "");
  var act = "";
  if (dim === "none" && filtered.length > 4) {
    act = '<button class="mw-link" type="button" data-expand="' + key + '">' +
      (expanded ? "收起" : "查看全部 " + filtered.length) + ' ' + icon("chevronRight", 12) + '</button>';
  }
  var html = secOpen(key, def, countText, act) +
    '<div class="mw-thead ' + def.grid + '">' +
    def.head.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join("") + '</div>';
  html += groupBodyHTML(shown, rowFn, dim, key);
  if (key === "test" && mw.claimable > 0) html += claimHTML();
  return html + '</div></section>';
}

/* ---------------- 页签数据 ---------------- */

function pendingData() {
  var dev = [], test = [];
  (mw.src.pending.tasks.items || []).forEach(function (t) {
    var rel = taskRelation(t);
    (rel === "test" ? test : dev).push(taskRow(t, rel));
  });
  var review = (mw.src.pending.review.items || []).map(function (d) { return demandRow(d); });
  var plan = (mw.src.pending.plans.items || []).map(function (p) { return planRowModel(p); });
  return { dev: dev, test: test, review: review, plan: plan };
}
function createdData() {
  var demands = (mw.src.created.demands.items || []).map(function (d) { return demandRow(d); });
  var tasks = (mw.src.created.tasks.items || []).map(function (t) { return taskRow(t, "dev"); });
  return demands.concat(tasks);
}
function watchedData() {
  var tasks = (mw.src.watched.tasks.items || []).map(function (t) { return taskRow(t, "watch"); });
  var demands = (mw.src.watched.demands.items || []).map(function (d) { return demandRow(d); });
  var plans = (mw.src.watched.plans.items || []).map(function (p) { return releasePlanRow(p); });
  return tasks.concat(demands, plans);
}
function pendingHTML() {
  var data = pendingData();
  var order = sectionOrder().filter(function (k) {
    if (k === "review") return reviewAllowed();
    /* 没有被指派的计划就不出现这一块，避免给所有人多加一张空卡片 */
    if (k === "plan" && !data.plan.length && !num(mw.counts && mw.counts.pending && mw.counts.pending.plans)) return false;
    return true;
  });
  var html = "";
  order.forEach(function (key) {
    var def = PENDING_DEFS[key];
    var fn = key === "dev" ? devRow : key === "test" ? testRow : key === "plan" ? planRow : reviewRow;
    html += sectionHTML(key, def, data[key], fn, "pending");
  });
  return html;
}
function createdHTML() {
  var def = CREATED_DEF;
  var dim = groupDim("created");
  var filtered = sortRows(createdData().filter(rowPass));
  if (!filtered.length) return "";
  var expanded = !!mw.expand.created;
  var shown = dim !== "none" ? filtered : (expanded ? filtered : filtered.slice(0, 4));
  var act = "";
  if (dim === "none" && filtered.length > 4) {
    act = '<button class="mw-link" type="button" data-expand="created">' +
      (expanded ? "收起" : "查看全部 " + filtered.length) + ' ' + icon("chevronRight", 12) + '</button>';
  }
  return secOpen("created", def, filtered.length + " 个" + groupCountText(filtered, dim), act) +
    '<div class="mw-thead ' + def.grid + '">' +
    def.head.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join("") + '</div>' +
    groupBodyHTML(shown, createdRow, dim, "created") + '</div></section>';
}
function watchedHTML() {
  var def = WATCH_DEF;
  var dim = groupDim("watched");
  var filtered = sortRows(watchedData().filter(rowPass));
  if (!filtered.length) return "";
  var expanded = !!mw.expand.watched;
  var shown = dim !== "none" ? filtered : (expanded ? filtered : filtered.slice(0, 4));
  var act = "";
  if (dim === "none" && filtered.length > 4) {
    act = '<button class="mw-link" type="button" data-expand="watched">' +
      (expanded ? "收起" : "查看全部 " + filtered.length) + ' ' + icon("chevronRight", 12) + '</button>';
  }
  return secOpen("watched", def, filtered.length + " 条" + groupCountText(filtered, dim), act) +
    '<div class="mw-thead ' + def.grid + '">' +
    def.head.map(function (h) { return '<span>' + esc(h) + '</span>'; }).join("") + '</div>' +
    groupBodyHTML(shown, watchedRow, dim, "watched") + '</div></section>';
}
function moreLine(tab) {
  var loaded = 0, total = 0;
  if (tab === "pending") {
    loaded = mw.src.pending.tasks.items.length + mw.src.pending.review.items.length + mw.src.pending.plans.items.length;
    total = mw.src.pending.tasks.total + mw.src.pending.review.total + mw.src.pending.plans.total;
  } else if (tab === "created") {
    loaded = mw.src.created.demands.items.length + mw.src.created.tasks.items.length;
    total = mw.src.created.demands.total + mw.src.created.tasks.total;
  } else if (tab === "watched") {
    loaded = mw.src.watched.tasks.items.length + mw.src.watched.demands.items.length
      + mw.src.watched.plans.items.length;
    total = mw.src.watched.tasks.total + mw.src.watched.demands.total + mw.src.watched.plans.total;
  }
  if (!total || loaded >= total) return "";
  return '<div class="mw-claimline"><span>已载入 <b>' + loaded + '</b> / 共 <b>' + total + '</b></span>' +
    '<button class="mw-link" type="button" data-more="' + tab + '">' +
    (mw.loading[tab] ? "加载中…" : "继续加载 " + icon("chevronRight", 12)) + '</button></div>';
}

/* ---------------- 结论条 / 页签 / 工具条 ---------------- */

function metaHTML(extra) {
  var time = mw.updatedAt ? fmtTs(mw.updatedAt) : "";
  var bits = [];
  if (extra) bits.push(extra);
  if (time) bits.push('<span class="dot"></span>' + esc(time) + ' 更新');
  return bits.length ? '<span class="mw-brief-meta">' + bits.join(" · ") + '</span>' : "";
}
function briefHTML() {
  var tab = currentTab();
  if (tab === "pending") {
    var data = pendingData();
    var items = data.dev.concat(data.test, data.plan, data.review);
    var total = mw.counts ? tabCount("pending") : items.length;
    if (!total && !items.length) {
      return '<span class="mw-txt"><strong>今天没有需要你处理的事项</strong><span> · 可以去「我发起的」看看进展，或从关注列表挑一件推进。</span></span>' + metaHTML();
    }
    if (!items.length) {
      return '<span class="mw-bic">' + icon("infoCircle", 15) + '</span><span class="mw-txt"><strong>' + total +
        ' 项待处理</strong> · 正在汇总逾期、今天到期与阻塞。</span>' + metaHTML("按角色排序");
    }
    var overdue = 0, today = 0, blocked = 0;
    items.forEach(function (r) {
      if (r.dueKind === "overdue") overdue++;
      if (r.dueKind === "today") today++;
      if (r.blocked) blocked++;
    });
    var first = items.filter(function (r) { return r.dueKind === "overdue"; })[0] ||
      items.filter(function (r) { return r.blocked; })[0] || items[0];
    var parts = [];
    if (overdue) parts.push(overdue + " 项已逾期");
    if (today) parts.push(today + " 项今天到期");
    if (blocked) parts.push(blocked + " 项阻塞");
    var tone = (overdue || blocked) ? " warn" : "";
    return '<span class="mw-bic">' + icon(overdue || blocked ? "alert" : "infoCircle", 15) + '</span>' +
      '<span class="mw-txt"><strong>' + total + ' 项待处理</strong> · ' + esc(parts.join("，") || "都在本周内") +
      '；建议先处理「' + esc(first.title) + '」。</span>' + metaHTML("按角色排序").replace('class="mw-brief-meta"', 'class="mw-brief-meta' + tone + '"');
  }
  if (tab === "created") {
    var rows = createdData();
    var demandTotal = mw.counts ? num(mw.counts.created) : 0;
    var taskTotal = mw.counts ? num(mw.counts.createdTasks) : 0;
    var createdTotal = Math.max(demandTotal + taskTotal, rows.length);
    if (!createdTotal && !rows.length) {
      return '<span class="mw-txt"><strong>你还没有发起过事项</strong> · 提交需求或创建工作项后可在这里跟踪进展。</span>' + metaHTML();
    }
    var sc = mw.src.created.statusCounts || {};
    var parts = [];
    if (demandTotal) {
      var st = [];
      if (sc.review) st.push(sc.review + " 评审中");
      if (sc.pass) st.push(sc.pass + " 已通过");
      if (sc.plan) st.push(sc.plan + " 已排期");
      if (sc.done) st.push(sc.done + " 已完成");
      parts.push(demandTotal + " 个需求" + (st.length ? "（" + st.join("、") + "）" : ""));
    }
    if (taskTotal) parts.push(taskTotal + " 个工作项");
    var waiting = rows.filter(function (r) { return r.kind === "demand" && r.status === "review"; })[0];
    return '<span class="mw-bic">' + icon("demand", 15) + '</span><span class="mw-txt"><strong>' + createdTotal + ' 个事项</strong> · ' +
      esc(parts.join("、") || "提交后会在这里跟踪") + (waiting ? '；「' + esc(waiting.title) + '」正在等待评审。' : '。') + '</span>' + metaHTML();
  }
  var wrows = watchedData();
  var tasks = Math.max(mw.counts ? num(mw.counts.watchedTasks) : 0, (mw.src.watched.tasks.items || []).length);
  var demands = Math.max(mw.counts ? num(mw.counts.watchedDemands) : 0, (mw.src.watched.demands.items || []).length);
  var plans = Math.max(mw.counts ? num(mw.counts.watchedPlans) : 0, (mw.src.watched.plans.items || []).length);
  var watchedTotal = Math.max(mw.counts ? num(mw.counts.watched) : 0, wrows.length, tasks + demands + plans);
  if (!watchedTotal && !wrows.length) {
    return '<span class="mw-txt"><strong>你还没有关注任何事项</strong> · 在工作项、缺陷、需求或发布计划里点「关注」，变更会出现在这里。</span>' + metaHTML();
  }
  var today = 0;
  wrows.forEach(function (r) { if (isTodayTs(r.updatedRaw)) today++; });
  return '<span class="mw-bic">' + icon("star", 15) + '</span><span class="mw-txt"><strong>' + watchedTotal + ' 条关注</strong> · ' +
    tasks + ' 个工作项、' + demands + ' 个需求、' + plans + ' 个发布计划' +
    (today ? '；' + today + ' 条今天有变更' : '；今天暂无变更') + '。</span>' + metaHTML();
}
function briefTone() {
  if (currentTab() !== "pending") return "";
  var data = pendingData();
  var risk = data.dev.concat(data.test, data.plan, data.review).some(function (r) { return r.dueKind === "overdue" || r.blocked; });
  return risk ? " warn" : "";
}
function countLabel(tab) {
  if (tab === "team") return "";
  var n = tabCount(tab);
  if (n === null) return '<span class="mw-n muted">—</span>';
  return '<span class="mw-n' + (n ? "" : " muted") + '">' + n + '</span>';
}
function renderTabs() {
  if (!mineTabs) return;
  var tab = currentTab();
  mineTabs.innerHTML = activeTabs().map(function (t) {
    return '<button class="mw-tab" type="button" role="tab" data-tab="' + t.key + '" aria-selected="' + (t.key === tab) + '">' +
      esc(t.label) + countLabel(t.key) + '</button>';
  }).join("");
}
function chipsFor(tab) {
  if (tab === "pending") {
    var all = pendingData();
    var rows = all.dev.concat(all.test, all.plan, all.review).filter(rowPassBase);
    return [
      { key: "all", label: "全部", n: rows.length },
      { key: "overdue", label: "逾期", n: rows.filter(function (r) { return r.dueKind === "overdue"; }).length },
      { key: "today", label: "今天到期", n: rows.filter(function (r) { return r.dueKind === "today"; }).length },
      { key: "week", label: "本周", n: rows.filter(function (r) { return r.dueKind === "week"; }).length }
    ];
  }
  if (tab === "created") {
    if (!mw.counts) {
      var crows = createdData().filter(rowPassBase);
      return [
        { key: "all", label: "全部", n: crows.length },
        { key: "demand", label: "需求", n: crows.filter(function (r) { return r.kind === "demand"; }).length },
        { key: "task", label: "工作项", n: crows.filter(function (r) { return r.kind === "task"; }).length }
      ];
    }
    return [
      { key: "all", label: "全部", n: num(mw.counts.created) + num(mw.counts.createdTasks) },
      { key: "demand", label: "需求", n: num(mw.counts.created) },
      { key: "task", label: "工作项", n: num(mw.counts.createdTasks) }
    ];
  }
  var w = watchedData().filter(rowPassBase);
  return [
    { key: "all", label: "全部", n: w.length },
    { key: "task", label: "工作项", n: w.filter(function (r) { return r.kind === "task" && r.itemType !== "bug"; }).length },
    { key: "bug", label: "缺陷", n: w.filter(function (r) { return r.kind === "task" && r.itemType === "bug"; }).length },
    { key: "demand", label: "需求", n: w.filter(function (r) { return r.kind === "demand"; }).length },
    { key: "release", label: "发布计划", n: w.filter(function (r) { return r.kind === "release"; }).length }
  ];
}
/* chips 计数忽略 chip 自身，但响应搜索、优先级与阻塞 */
function rowPassBase(r) {
  if (mw.q) {
    var hay = [r.title, r.project, r.submitter, r.wsName, r.version].join(" ").toLowerCase();
    if (hay.indexOf(mw.q.toLowerCase()) === -1) return false;
  }
  if (currentTab() !== "watched" && mw.pri !== "all" && r.pri !== mw.pri) return false;
  if (mw.blocked && !r.blocked) return false;
  return true;
}
function filterCount() {
  var n = 0;
  if (currentTab() !== "watched" && mw.pri !== "all") n++;
  if (mw.blocked) n++;
  return n;
}
function sortOptions(tab) {
  if (tab === "created") {
    return [
      { key: "updated", label: "最近更新" },
      { key: "priority", label: "优先级" },
      { key: "expect", label: "期望 / 截止" }
    ];
  }
  if (tab === "watched") {
    return [
      { key: "updated", label: "最近更新" },
      { key: "priority", label: "优先级" }
    ];
  }
  return [
    { key: "updated", label: "最近更新" },
    { key: "due", label: "截止时间" },
    { key: "priority", label: "优先级" }
  ];
}
function renderToolbar() {
  if (!mineToolbar) return;
  var tab = currentTab();
  var visible = tab !== "team" && pageState() === "data";
  mineToolbar.hidden = !visible;
  if (!visible) return;
  if (mineSearch && document.activeElement !== mineSearch && mineSearch.value !== mw.q) mineSearch.value = mw.q;
  var chips = chipsFor(tab);
  var active = "all";
  chips.forEach(function (c) { if (c.key === mw.chip[tab]) active = c.key; });
  mineChips.innerHTML = chips.map(function (c) {
    return '<button class="mw-chip" type="button" data-chip="' + c.key + '" aria-pressed="' + (active === c.key) + '">' +
      esc(c.label) + ' <b>' + c.n + '</b></button>';
  }).join("");
  var fc = filterCount();
  if (mineFilterCount) {
    mineFilterCount.hidden = fc === 0;
    mineFilterCount.textContent = String(fc);
  }
  if (mineFilterMenu) {
    if (tab === "watched") {
      mineFilterMenu.innerHTML = '<h4>筛选</h4><div class="mw-popnote">关注列表按最近变更排序，不提供优先级筛选。</div>';
    } else {
      var pri = ['<h4>优先级</h4>'];
      pri.push('<label class="mw-check"><input type="radio" name="mw-pri" value="all"' + (mw.pri === "all" ? " checked" : "") + '>全部优先级</label>');
      PRIORITIES.forEach(function (code) {
        pri.push('<label class="mw-check"><input type="radio" name="mw-pri" value="' + code + '"' + (mw.pri === code ? " checked" : "") + '>' +
          esc(code + " " + (PRI_LABEL[code] || "")) + '</label>');
      });
      pri.push('<hr><label class="mw-check"><input type="checkbox" id="mwBlocked"' + (mw.blocked ? " checked" : "") + '>只看阻塞项</label>');
      pri.push('<div class="mw-popnote">筛选只改变当前分区显示；页签计数来自服务端，不随筛选变化。</div>');
      mineFilterMenu.innerHTML = pri.join("");
    }
  }
  if (mineDisplayMenu) {
    var current = mw.sort[tab] || "updated";
    var gcur = groupDim(tab);
    var gitems = [{ key: "none", label: "不分组" }].concat(groupItemsFor(tab));
    mineDisplayMenu.innerHTML = '<h4>分组</h4>' + gitems.map(function (g) {
      return '<label class="mw-check"><input type="radio" name="mw-group" value="' + g.key + '"' + (gcur === g.key ? " checked" : "") + '>' + esc(g.label) + '</label>';
    }).join("") +
      '<hr><h4>排序</h4>' + sortOptions(tab).map(function (o) {
        return '<label class="mw-check"><input type="radio" name="mw-sort" value="' + o.key + '"' + (current === o.key ? " checked" : "") + '>' + o.label + '</label>';
      }).join("") +
      '<div class="mw-popnote">分组按页签记住，排序切换页签后保留；分组头可点击折叠，页签计数不随分组变化。</div>';
  }
}
/* ---------------- 周五补记入口 ---------------- */

var cuEntry = null;

function loadCatchupEntry() {
  if (!mineCatchup) return Promise.resolve();
  return API.get("/api/catchup/entry").then(function (d) {
    cuEntry = d || null;
    renderCatchup();
  }).catch(function () {
    /* 老库未执行 120_catchup.sql 时静默隐藏，不影响「我的工作」本身 */
    cuEntry = null;
    renderCatchup();
  });
}

function catchupCardText(d) {
  var status = d.status || "none";
  var pending = Number(d.pending || 0);
  var total = Number(d.total || 0);
  var done = Number(d.done || 0);
  var hours = parseFloat(d.timeTotal) || 0;
  var timeBit = hours ? " · " + String(d.timeTotal || "").replace(/\.0h$/, "h") + " 工时" : "";
  if (status === "submitted") {
    return {
      title: "周五补记已提交",
      chip: "已提交",
      tone: "green",
      desc: "本周 <b>" + total + "</b> 条工作项" + timeBit + "已于 " + esc(fmtTs(d.submittedAt)) + " 写入；周回顾已生成。",
      primary: "查看补记"
    };
  }
  if (status === "skipped") {
    return {
      title: "本周补记已跳过",
      chip: "已跳过",
      tone: "gray",
      desc: pending ? "还有 <b>" + pending + "</b> 条工作项未确认；想补的时候随时进来。" : "本周的痕迹都已处理；想补的时候随时进来。",
      primary: "仍要补记"
    };
  }
  if (status === "draft") {
    return {
      title: "周五补记",
      chip: "草稿进行中",
      tone: "amber",
      desc: pending
        ? "已确认 <b>" + done + "</b> 条，还有 <b>" + pending + "</b> 条待确认" + timeBit + "。"
        : "工作项都已确认，可以检查工时与风险后提交" + timeBit + "。",
      primary: "继续补记"
    };
  }
  return {
    title: "周五补记",
    chip: "本周",
    tone: "blue",
    desc: "本周有 <b>" + total + "</b> 条工作项痕迹" + timeBit + "，系统已整理成草稿，预计 10 分钟。",
    primary: "开始补记",
    canSkip: true
  };
}

function renderCatchup() {
  if (!mineCatchup) return;
  if (!cuEntry || !cuEntry.visible || currentTab() === "team") {
    mineCatchup.hidden = true;
    mineCatchup.innerHTML = "";
    return;
  }
  var t = catchupCardText(cuEntry);
  mineCatchup.hidden = false;
  mineCatchup.innerHTML = '<div class="mw-catchup-card">' +
    '<span class="mw-catchup-ic">' + icon("clock", 17) + '</span>' +
    '<div class="mw-catchup-main">' +
      '<div class="mw-catchup-t">' + esc(t.title) + '<span class="cu-chip ' + t.tone + '">' + esc(t.chip) + '</span></div>' +
      '<div class="mw-catchup-d">' + t.desc + '</div>' +
    '</div>' +
    '<div class="mw-catchup-acts">' +
      (t.canSkip ? '<button type="button" class="mw-catchup-skip" data-cu-entry="skip">今天不补</button>' : '') +
      '<button type="button" class="btn sm primary" data-cu-entry="open">' + esc(t.primary) + '</button>' +
    '</div>' +
    '</div>';
}

function openCatchup() {
  window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: "catchup" } }));
}

function skipCatchup(btn) {
  if (!cuEntry || !cuEntry.weekStart || !btn) return;
  btn.disabled = true;
  API.post("/api/catchup/skip?week=" + encodeURIComponent(cuEntry.weekStart)).then(function () {
    toast("这周先不补；需要时可以从卡片再进来");
    return loadCatchupEntry();
  }).catch(function (err) {
    toast(err && err.message ? err.message : "跳过失败，请稍后重试", "bad");
  }).then(function () {
    btn.disabled = false;
  });
}

function renderBrief() {
  if (!mineBrief) return;
  if (currentTab() === "team") return; // 团队页签由 renderTeamView 写结论条
  var st = pageState();
  if (st === "loading") {
    mineBrief.hidden = true;
    return;
  }
  mineBrief.hidden = false;
  mineBrief.className = "mw-brief" + briefTone();
  mineBrief.innerHTML = briefHTML();
}

/* ---------------- 整页状态 ---------------- */

function resetTabData(tab) {
  mw.err[tab] = null;
  mw.loading[tab] = true;
}
function tabHasData(tab) {
  if (tab === "pending") return !!(mw.src.pending.tasks.items.length || mw.src.pending.review.items.length || mw.src.pending.plans.items.length);
  if (tab === "created") return !!(mw.src.created.demands.items.length || mw.src.created.tasks.items.length);
  if (tab === "watched") return !!(mw.src.watched.tasks.items.length || mw.src.watched.demands.items.length || mw.src.watched.plans.items.length);
  return false;
}
function tabRawEmpty(tab) {
  if (tabHasData(tab)) return false;
  if (mw.counts) return num(tabCount(tab)) === 0;
  if (tab === "pending") return !mw.src.pending.tasks.total && !mw.src.pending.review.total && !mw.src.pending.plans.total && !tabHasData(tab);
  if (tab === "created") return !mw.src.created.demands.total && !mw.src.created.tasks.total && !tabHasData(tab);
  if (tab === "watched") return !mw.src.watched.tasks.total && !mw.src.watched.demands.total && !mw.src.watched.plans.total && !tabHasData(tab);
  return true;
}
function pageState() {
  var tab = currentTab();
  if (tab === "team") return teamState();
  var loading = !!mw.loading[tab], err = mw.err[tab];
  if (!mw.counts && mw.countsLoading && !tabHasData(tab)) return "loading";
  if (loading && !tabHasData(tab)) return "loading";
  if (err && !tabHasData(tab)) return "error";
  if (!mw.counts && mw.countsErr && !tabHasData(tab) && !loading) return "error";
  if (tabRawEmpty(tab) && !loading) return "empty";
  return "data";
}
function skeletonHTML() {
  var card = '<div class="mw-skcard"><div class="mw-sk" style="width:140px;height:14px"></div>' +
    '<div class="mw-sk l"></div><div class="mw-sk l" style="width:86%"></div><div class="mw-sk l" style="width:72%"></div></div>';
  return '<div class="mw-sk mw-skbrief"></div>' + card + card;
}
function errorHTML(ex) {
  var msg = (ex && ex.message) ? ex.message : "网络异常，请稍后重试";
  return '<div class="mw-bigstate err"><span class="mw-bigico">' + icon("alertCircle", 20) + '</span>' +
    '<h3>「我的工作」加载失败</h3><p>' + esc(msg) + ' · 请检查网络后重试。</p>' +
    '<div class="mw-bigact"><button class="btn primary" type="button" data-retry>重试</button>' +
    '<button class="btn" type="button" data-go="board">查看工作项</button></div></div>';
}
function filterEmptyHTML() {
  return '<div class="mw-bigstate"><span class="mw-bigico">' + icon("search", 20) + '</span>' +
    '<h3>当前筛选下没有事项</h3><p>筛选与搜索只作用于已载入的这部分；清除后可看到全部内容。</p>' +
    '<div class="mw-bigact"><button class="btn primary" type="button" data-clear-filter>清除筛选</button></div></div>';
}
function emptyHTML() {
  var tab = currentTab();
  var canNew = canCreateNow();
  var conf = {
    pending: {
      t: "本周还没有待处理事项",
      d: canNew
        ? "没有被指派给你的工作项，也没有待你测试或评审的事项。加入项目或被指派后，这里会自动汇总。"
        : (roleReadOnly()
          ? "查看者只读：这里只汇总指派给你的事项；当前空间还没有与你相关的工作项或待评审需求。"
          : "你还没有被分配可写项目。空间主或管理员分配项目后，指派给你的工作项会汇总到这里。"),
      a: canNew
        ? [["新建工作项", "primary", "task"], ["去需求池看看", "", "demands"]]
        : [["去项目页看看", "primary", "projects"], ["去需求池看看", "", "demands"]]
    },
    created: {
      t: "你还没有发起过事项",
      d: canNew
        ? "提交需求或创建工作项后，评审、排期与完成进展都会在这里更新，不需要再去列表里逐个查找。"
        : "需求和工作项都需要落在可写项目里；获得项目写权限后，才能在这里跟踪进展。",
      a: canNew
        ? [["新建工作项", "primary", "task"], ["提一个需求", "", "demand"], ["去需求池看看", "", "demands"]]
        : [["去需求池看看", "primary", "demands"], ["去项目页看看", "", "projects"]]
    },
    watched: {
      t: "你还没有关注任何事项",
      d: "在工作项、缺陷、需求或发布计划里点「关注」，变更会收到提醒，并汇总到这里；关注不代表负责。",
      a: [["去工作项列表", "primary", "board"], ["去需求池", "", "demands"], ["去发布计划", "", "phase"]]
    }
  }[tab];
  return '<div class="mw-bigstate"><span class="mw-bigico">' + icon("inbox", 20) + '</span>' +
    '<h3>' + esc(conf.t) + '</h3><p>' + esc(conf.d) + '</p><div class="mw-bigact">' +
    conf.a.map(function (a) {
      var action = a[2] === "task" || a[2] === "demand"
        ? ' data-empty-new="' + a[2] + '"'
        : ' data-go="' + a[2] + '"';
      return '<button class="btn ' + a[1] + '" type="button"' + action + '>' + esc(a[0]) + '</button>';
    }).join("") + '</div></div>';
}
function noteText() {
  var tab = currentTab();
  var bits = [];
  if (tab === "pending") bits.push("页签计数来自服务端；逾期、今天到期与阻塞按已载入明细统计，继续加载会更新结论。「待我执行」只列执行人是你、尚未完成的测试计划。工作项与测试计划可跨空间，评审需求限定当前空间。");
  else if (tab === "created") bits.push("页签计数来自服务端；需求按当前空间统计，工作项跨空间（含已完成与已取消）。类型 chips 与页签计数同源，搜索与优先级筛选只作用于已载入内容。");
  else bits.push("关注只接收提醒，不代表负责；列表只读，取消关注不会删除对象。工作项可跨空间，需求与发布计划限定当前空间。");
  bits.push("每类先载入 " + PAGE + " 条，继续加载会追加；搜索、筛选与分组只作用于已载入内容。");
  bits.push("分组按页签记住、排序切换页签后保留；分组头可点击折叠，页签计数不随分组变化。");
  if (tab === "created" && mw.counts && num(mw.counts.matchedByNameOnly) > 0) {
    bits.push("另有 " + num(mw.counts.matchedByNameOnly) + " 个需求按显示名匹配到你的历史提交。");
  }
  if (!reviewAllowed()) bits.push("当前空间没有可写项目，未显示待评审分区。");
  return icon("infoCircle", 12) + '<span>' + esc(bits.join(" ")) + '</span>';
}
function partialHTML(tab) {
  var info = mw.partialErr[tab];
  if (!info) return "";
  var LABELS = { tasks: "工作项", review: "待我评审", plans: "测试计划", release: "关注的发布计划", created: "我发起的需求", createdTasks: "我发起的工作项", demands: "关注的需求" };
  var names = info.keys.map(function (k) { return LABELS[k] || k; }).join("、");
  return '<div class="mw-partial"><span class="mw-partial-ico">' + icon("alertCircle", 14) + '</span>' +
    '<span>' + esc(names) + '加载失败：' + esc(info.msg || "网络异常") + '；其余内容已正常显示。</span>' +
    '<button class="mw-link" type="button" data-retry-partial>' + (info.retrying ? "重试中…" : "重试") + '</button></div>';
}
function partialEmptyHTML() {
  return '<div class="mw-bigstate"><span class="mw-bigico">' + icon("alertCircle", 20) + '</span>' +
    '<h3>这部分内容暂不可用</h3><p>其余数据源已加载；可重试失败的接口，或稍后再看。</p></div>';
}
function renderBody() {
  if (!mineBody) return;
  var tab = currentTab();
  if (tab === "team") return; // renderTeamView
  var st = pageState();
  if (st === "loading") { mineBody.innerHTML = skeletonHTML(); return; }
  if (st === "error") { mineBody.innerHTML = errorHTML(mw.err[tab] || mw.countsErr); return; }
  if (st === "empty") { mineBody.innerHTML = emptyHTML(); return; }
  var partial = partialHTML(tab);
  var html = tab === "pending" ? pendingHTML() : tab === "created" ? createdHTML() : watchedHTML();
  if (!html) { mineBody.innerHTML = partial ? partial + partialEmptyHTML() : filterEmptyHTML(); return; }
  mineBody.innerHTML = partial + html + moreLine(tab);
}
function renderNote() {
  if (!mineNote) return;
  mineNote.hidden = currentTab() === "team" || pageState() !== "data";
  if (!mineNote.hidden) mineNote.innerHTML = noteText();
}
function syncPageHead() {
  var head = document.getElementById("pageHead");
  var sub = document.getElementById("pageSub");
  var st = currentTab() === "team" ? teamState() : pageState();
  if (head) head.classList.toggle("mw-empty", st === "empty" || st === "error");
  if (!sub) return;
  var tail;
  if (st === "error") tail = "数据加载失败";
  else if (st === "empty") {
    tail = currentTab() === "created" ? "还没有发起过事项" : currentTab() === "watched" ? "还没有关注任何事项" : currentTab() === "team" ? "本周团队交付概览" : "本周没有待处理事项";
  } else if (currentTab() === "team") {
    tail = "团队交付概览";
  } else if (currentTab() === "pending") {
    var n = tabCount("pending");
    var rows = pendingData();
    var over = rows.dev.concat(rows.test, rows.review).filter(function (r) { return r.dueKind === "overdue"; }).length;
    var today = rows.dev.concat(rows.test, rows.review).filter(function (r) { return r.dueKind === "today"; }).length;
    var b = [];
    b.push(n ? n + " 项待处理" : "今天没有待处理");
    if (over) b.push(over + " 项逾期");
    if (today) b.push(today + " 项今天到期");
    tail = b.join(" · ");
  } else if (currentTab() === "created") {
    tail = num(tabCount("created")) + " 个我发起的事项";
  } else {
    tail = num(tabCount("watched")) + " 条关注";
  }
  var who = identityText();
  sub.textContent = who ? who + " · " + tail : tail;
}

function render() {
  if (!mineBody) return;
  mw.tab = currentTab();
  renderTabs();
  renderCatchup();
  if (mw.tab === "team") {
    renderTeamView();
  } else {
    renderBrief();
    renderToolbar();
    renderBody();
    renderNote();
  }
  /* 页头副标题全站共用：只有当前就在「我的工作」时才写，
     否则异步计数返回后会把别的页面（如逾期与阻塞）的副标题覆盖成个人待处理摘要 */
  if (document.body.dataset.view === "mine") syncPageHead();
}

/* ---------------- 团队页签（仅移动端负责人 / 管理员） ---------------- */

var TEAM_RANGE_KEYS = ["week", "month", "days30"];
var TEAM_RANGE_LABELS = { week: "本周", month: "本月", days30: "近 30 天" };
function teamRangeKey() {
  var k = null;
  try { k = localStorage.getItem("ds.teamRange"); } catch (e) { /* 受限环境回落本周 */ }
  return TEAM_RANGE_KEYS.indexOf(k) >= 0 ? k : "week";
}
function teamRange() {
  var key = teamRangeKey(), t = rt.TODAY, from, to;
  if (key === "month") {
    from = new Date(t.getFullYear(), t.getMonth(), 1);
    to = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  } else if (key === "days30") {
    to = t;
    from = addDays(t, -29);
  } else {
    var dow = (t.getDay() + 6) % 7;
    from = addDays(t, -dow);
    to = addDays(from, 6);
  }
  return { key: key, label: TEAM_RANGE_LABELS[key], from: isoDay(from), to: isoDay(to) };
}
function isoDay(d) {
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function teamRangeBar(range) {
  return '<div class="rangebar" role="group" aria-label="团队统计范围"><div class="seg">' +
    TEAM_RANGE_KEYS.map(function (k) {
      return '<button type="button" class="tr-btn" data-team-range="' + k + '" aria-pressed="' + (k === range.key) + '">' + TEAM_RANGE_LABELS[k] + '</button>';
    }).join("") + '</div><span class="range-dates">' + esc(range.from) + ' ~ ' + esc(range.to) + '</span></div>';
}
function teamState() {
  if (!canTeam()) return "unsupported";
  if (mw.team.err && !mw.team.data) return "error";
  if (mw.team.loading && !mw.team.data) return "loading";
  if (!mw.team.data) return "loading";
  return teamIsEmpty(mw.team.data) ? "empty" : "data";
}
function teamIsEmpty(d) {
  var h = (d.overview && d.overview.health) || {};
  var p = (d.overview && d.overview.pending) || {};
  var risks = ((d.overview && d.overview.risks) || []).length || ((d.risks && (d.risks.overdue || []).concat(d.risks.blocked || [])) || []).length;
  var members = (d.workload && d.workload.members) || [];
  return !num(h.planCount) && !num(h.doneCount) && !num(h.overdue) && !num(h.blocked) &&
    !num(p.review) && !num(p.accept) && !num(p.merge) && !risks && !members.length;
}
function hm(minutes) {
  var h = (Number(minutes) || 0) / 60;
  return (Math.round(h * 10) / 10) + "h";
}
function teamSectionError(err, title) {
  if (err && err.code === 4030) {
    return '<div class="mw-bigstate err" style="margin-top:10px;padding:24px 16px"><span class="mw-bigico">' + icon("ban", 20) + '</span>' +
      '<h3>' + esc(title || "当前角色无权查看") + '</h3><p>该区块仅对空间管理员开放，请联系空间主调整成员角色。</p></div>';
  }
  return '<div class="mw-bigstate err" style="margin-top:10px;padding:24px 16px"><span class="mw-bigico">' + icon("alertCircle", 20) + '</span>' +
    '<h3>' + esc(title || "加载失败") + '</h3><p>' + esc(err && err.message ? err.message : "网络异常，请稍后重试") + '</p>' +
    '<div class="mw-bigact"><button class="btn" type="button" data-team-refresh>重试</button></div></div>';
}
function renderTeamView() {
  if (!mineBody || !mineBrief) return;
  if (!canTeam()) { mw.tab = "pending"; render(); return; }
  if (!mw.team.data && !mw.team.loading) loadTeam({ silent: true });
  var range = teamRange();
  var st = teamState();
  if (st === "data") {
    var h = (mw.team.data.overview && mw.team.data.overview.health) || {};
    var rate = Math.round((Number(h.doneRate) || 0) * 100);
    mineBrief.hidden = false;
    mineBrief.className = "mw-brief";
    mineBrief.innerHTML = '<span class="mw-bic">' + icon("users", 15) + '</span><span class="mw-txt"><strong>' +
      esc(range.label) + '团队</strong> · 完成率 ' + rate + '% · 计划 ' + num(h.planCount) + ' 项。</span>' +
      metaHTML(esc(range.from) + " ~ " + esc(range.to));
  } else if (st === "empty" || st === "error") {
    mineBrief.hidden = false;
    mineBrief.className = "mw-brief";
    mineBrief.innerHTML = '<span class="mw-bic">' + icon(st === "error" ? "alert" : "users", 15) + '</span><span class="mw-txt"><strong>' +
      (st === "error" ? "团队数据加载失败" : "本周还没有团队数据") + '</strong> · ' +
      (st === "error" ? "重试后可恢复；团队统计不影响个人页签。" : "成员开始记录后会自动汇总。") + '</span>' + metaHTML();
  } else {
    mineBrief.hidden = true;
  }
  mineToolbar.hidden = true;
  mineNote.hidden = true;
  if (st === "loading") { mineBody.innerHTML = skeletonHTML(); return; }
  if (st === "error") {
    var ex = mw.team.err;
    mineBody.innerHTML = (ex && ex.code === 4030)
      ? '<div class="mw-bigstate err"><span class="mw-bigico">' + icon("ban", 20) + '</span><h3>当前角色无权查看团队数据</h3>' +
        '<p>团队页签仅对空间主、管理员开放。</p></div>'
      : errorHTML(ex);
    return;
  }
  if (st === "empty") {
    mineBody.innerHTML = '<div class="mw-bigstate"><span class="mw-bigico">' + icon("users", 20) + '</span>' +
      '<h3>本周还没有团队数据</h3><p>团队统计会在成员开始记录工作项后生成。当前范围没有计划项，或个人视图尚未同步。</p>' +
      '<div class="mw-bigact"><button class="btn primary" type="button" data-go="board">查看工作项列表</button>' +
      '<button class="btn" type="button" data-team-refresh>刷新团队数据</button></div></div>';
    return;
  }
  mineBody.innerHTML = teamBody(mw.team.data, range);
}
function teamBody(d, range) {
  var overview = d.overview || {};
  var workload = d.workload || {};
  var risks = d.risks || {};
  var h = overview.health || {};
  var pending = overview.pending || {};
  var riskList = (overview.risks || []).slice();
  if (!riskList.length && !risks.__err) riskList = (risks.overdue || []).concat(risks.blocked || []).slice(0, 5);
  var rate = Math.round((Number(h.doneRate) || 0) * 100);
  var delta = Math.round((Number(h.deltaWeek) || 0) * 100);
  var html = '<div class="team-panel">' + teamRangeBar(range) +
    '<section class="team-hero"><div class="th-main" style="--done-rate:' + rate + '%"><b>' + rate + '%</b>' +
    '<span class="caliber-label">' + esc(range.label) + '完成率' + caliberMarkHTML("mine.doneRate", false, "查看「完成率」口径") + '</span>' +
    '<em class="' + (delta >= 0 ? "up" : "down") + '" title="与前一等长周期比较">' + (delta >= 0 ? "↑ +" + delta : "↓ " + Math.abs(delta)) + '%</em></div>' +
    '<div class="th-grid">' +
    '<div><b>' + num(h.doneCount) + '/' + num(h.planCount) + '</b><span>完成 / 计划</span></div>' +
    '<button type="button" class="danger" data-team-risk="over" title="查看逾期工作项"><b>' + num(h.overdue) + '</b><span>已逾期</span></button>' +
    '<button type="button" class="warn" data-team-risk="blocked" title="查看被阻塞工作项"><b>' + num(h.blocked) + '</b><span>被阻塞</span></button>' +
    '</div><div class="th-note">完成率与工时按「' + esc(range.label) + '」统计；逾期、阻塞与待处理是当前快照，不随区间变化。</div></section>' +
    '<section class="team-card"><div class="tc-head"><h3>待处理</h3><span class="foot-note">截止此刻</span></div>' +
    '<div class="team-pending">' +
    '<button type="button" data-team-go="demands"><b>' + num(pending.review) + '</b><span>待评审</span></button>' +
    '<button type="button" data-team-go="branches" data-team-status="testing"><b>' + num(pending.accept) + '</b><span>待验收</span></button>' +
    '<button type="button" data-team-go="branches" data-team-status="merging"><b>' + num(pending.merge) + '</b><span>待合并</span></button>' +
    '</div></section>';
  html += '<section class="team-card"><div class="tc-head"><h3>风险工作项</h3><span class="foot-note">' + riskList.length + ' 项 · 截止此刻</span></div>' +
    (riskList.length ? '<div class="team-risks">' + riskList.map(function (r) {
      var lv = r.level === "high" ? "high" : "mid";
      return '<div class="team-risk ' + lv + '" data-team-task="' + esc(r.taskId) + '" role="button" tabindex="0">' +
        '<i class="tr-dot"></i><div class="tr-main"><b>' + esc(r.title || "未命名工作项") + '</b>' +
        '<span>' + esc(r.ownerName || "未指派") + ' · ' + esc(r.reason || "") + '</span></div>' +
        (r.dayCount ? '<span class="tr-days">' + r.dayCount + ' 天</span>' : '') + '</div>';
    }).join("") + '</div>' : UI.emptyState({ icon: "checkCircle", title: "此刻没有风险工作项", compact: true })) + '</section>';
  if (workload.__err) {
    html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3></div>' + teamSectionError(workload.__err, "成员负载不可见") + '</section>';
  } else {
    var members = workload.members || [];
    var capDays = Number(workload.rangeWorkdays) || 0;
    html += '<section class="team-card"><div class="tc-head"><h3>成员负载</h3>' + caliberMarkHTML("mine.load", false, "查看「成员负载」口径") +
      '<span class="foot-note">' + esc(range.label) + '计时 / ' + capDays + ' 个工作日容量</span></div>' +
      (members.length ? '<div class="team-load">' + members.map(function (m) {
        var pct = Math.round((Number(m.percent) || 0) * 100);
        var cls = pct > 100 ? "over" : (pct >= 90 ? "near" : "");
        return '<button type="button" class="tl-row" data-team-member="' + esc(m.name || "") + '" title="查看该成员未完成工作项">' +
          '<div class="tl-top"><b>' + esc(m.name || "—") + '</b><span>' + hm(m.actualMinutes) + ' / ' + hm(m.plannedMinutes) + '</span></div>' +
          '<div class="tl-bar"><i class="' + cls + '" style="width:' + Math.min(pct, 100) + '%"></i></div>' +
          '<span class="tl-pct ' + cls + '">' + pct + '%</span></button>';
      }).join("") + '</div>' : UI.emptyState({ icon: "inbox", title: "该区间还没有成员计时", compact: true })) + '</section>';
  }
  html += '</div><div class="mw-note">' + icon("infoCircle", 12) +
    '<span>团队页签对空间主 / 管理员开放；统计范围独立一行，数据按所选区间统计。</span></div>';
  return html;
}
function loadTeam(opts) {
  opts = opts || {};
  if (!canTeam()) return Promise.resolve();
  var range = teamRange();
  if (mw.team.cache[range.key] && !opts.force) {
    mw.team.data = mw.team.cache[range.key];
    mw.team.err = null;
    mw.team.range = range.key;
    renderTeamView();
    return Promise.resolve();
  }
  mw.team.loading = true;
  mw.team.data = null;
  mw.team.err = null;
  mw.team.range = range.key;
  var seq = ++mw.team.seq;
  renderTeamView();
  var params = { from: range.from, to: range.to };
  return Promise.all([
    API.get("/api/mobile/team-overview", params),
    API.get("/api/mobile/workload", params).catch(function (err) { return { __err: err }; }),
    API.get("/api/mobile/risks").catch(function (err) { return { __err: err }; })
  ]).then(function (res) {
    if (seq !== mw.team.seq) return;
    mw.team.loading = false;
    var data = { overview: res[0] || {}, workload: res[1] || {}, risks: res[2] || {} };
    mw.team.cache[range.key] = data;
    mw.team.data = data;
    mw.team.err = null;
    renderTeamView();
  }).catch(function (ex) {
    if (seq !== mw.team.seq) return;
    mw.team.loading = false;
    mw.team.data = null;
    mw.team.err = ex;
    renderTeamView();
  });
}

/* ---------------- 打开 / 取消关注 / 领取 ---------------- */

function wsNameById(id) {
  for (var i = 0; i < rt.allWorkspaces.length; i++) if (rt.allWorkspaces[i].id === id) return rt.allWorkspaces[i].name;
  return "该空间";
}
function openRow(kind, id, ws, reqId, title, versionId) {
  if (!id) return;
  if (kind === "release") {
    if (!versionId) { toast("该计划缺少版本关联，请到发布日程查看", "warn"); return; }
    import("./release.js").then(function (m) {
      m.openReleasePage({ id: versionId, reqId: reqId, tab: "plan", planId: id });
    }).catch(function () { toast("发布计划打开失败", "bad"); });
    return;
  }
  if (kind === "plan") {
    /* 计划在测试视图里按项目打开：先切项目与页签，再落路由 */
    import("../core/view-loader.js").then(function (m) {
      return m.loadView("testcases").then(function (mod) {
        mod.openPlanInProject(reqId, id);
        goView("testcases");
      });
    }).catch(function () { toast("测试计划打开失败", "bad"); });
    return;
  }
  if (kind === "demand") {
    import("./demands.js").then(function (m) { m.openDemandDetailById(id); }).catch(function () {
      toast("需求详情打开失败", "bad");
    });
    return;
  }
  if (ws && rt.currentWs && ws !== rt.currentWs.id) {
    askSwitchWorkspace(ws, wsNameById(ws), { taskTitle: title || "", openTaskId: id });
    return;
  }
  openTaskById(id);
}
function removeWatched(kind, id) {
  var src = mw.src.watched;
  if (kind === "task") src.tasks.items = src.tasks.items.filter(function (t) { return t.id !== id; });
  else if (kind === "release") src.plans.items = src.plans.items.filter(function (p) { return p.id !== id; });
  else src.demands.items = src.demands.items.filter(function (d) { return d.id !== id; });
  mw.expand.watched = false;
}
function unwatch(kind, id, ws, title, btn) {
  if (btn) btn.disabled = true;
  var req = kind === "task"
    ? API.delWs(ws, "/api/tasks/" + enc(id) + "/watch")
    : kind === "release"
      ? API.del("/api/release-plans/" + enc(id) + "/watch")
      : API.del("/api/demands/" + enc(id) + "/watch");
  req.then(function () {
    removeWatched(kind, id);
    loadCounts(true);
    render();
    toastAction("已取消关注「" + title + "」", "撤销", function () {
      var redo = kind === "task"
        ? API.postWs(ws, "/api/tasks/" + enc(id) + "/watch")
        : kind === "release"
          ? API.post("/api/release-plans/" + enc(id) + "/watch", {})
          : API.post("/api/demands/" + enc(id) + "/watch", {});
      redo.then(function () {
        loadTab("watched", { silent: true });
        loadCounts(true);
        toast("已恢复关注", "fs");
      }).catch(function (ex) {
        toast(ex.message || "恢复关注失败", "bad");
      });
    }, "fs", 8000);
  }).catch(function (ex) {
    if (btn) btn.disabled = false;
    toast(ex.message || "取消关注失败", "bad");
  });
}
function claimReview(id, btn) {
  if (roleReadOnly()) { toast("当前空间或项目为只读，无法认领评审", "warn"); return; }
  if (btn) btn.disabled = true;
  API.post("/api/demands/" + enc(id) + "/claim-review", {}).then(function () {
    toast("已认领，需求进入你的评审队列", "fs");
    loadMine({ silent: true });
  }).catch(function (ex) {
    if (btn) btn.disabled = false;
    toast(ex.message || "认领失败", "bad");
  });
}
function openClaimable() {
  var params = { testOwners: "__none", columns: "test", open: 1, offset: 0, limit: PAGE };
  API.get("/api/tasks/list", params).then(function (page) {
    var rows = (page && page.items) || [];
    if (!rows.length) { toast("当前空间没有可领取的待测试工作项", "warn"); return; }
    openTaskTable("可领取的待测试工作项", rows, "当前空间 · 未指派测试负责人 · 点击工作项行打开详情", {
      total: page.total,
      hasMore: page.hasMore,
      fetch: function (offset) {
        return API.get("/api/tasks/list", Object.assign({}, params, { offset: offset }));
      }
    });
  }).catch(function (ex) {
    toast(ex && ex.message ? ex.message : "可领取列表加载失败", "bad");
  });
}

/* ---------------- 跳转 / 新建 ---------------- */

function goView(name) {
  var nav = document.querySelector('#sideNav [data-view="' + name + '"]');
  if (nav) { nav.click(); return; }
  window.location.hash = "#/" + name;
}
function newDemand() {
  window.location.hash = "#/demands?new=1";
  window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: "demands" } }));
}

/* ---------------- 跨空间切换（保留页签） ---------------- */

function askSwitchWorkspace(wsId, wsName, opts) {
  opts = opts || {};
  var target = wsName || wsNameById(wsId);
  var opening = opts.taskTitle || opts.linkTitle;
  var msg = opening
    ? ('即将切换到「' + esc(target) + '」并打开「' + esc(opening) + '」。<br><br>' +
      '当前空间的项目、分类等条件会清空；「我的工作」的当前页签会保留。抽屉里未保存的编辑不会保留。')
    : ('切换到「' + esc(target) + '」会重新加载页面。<br><br>' +
      '当前空间的项目、分类等条件会清空；「我的工作」的当前页签会保留。抽屉里未保存的编辑不会保留。');
  return UI.showConfirm({
    title: opts.title || "切换空间",
    msg: msg,
    okText: opts.okText || (opts.openTaskId || opts.openLink ? "切换并打开" : "切换"),
    cancelText: "取消",
    danger: false
  }).then(function (ok) {
    if (!ok) return false;
    saveWorkspaceHandoff(wsId);
    return API.post("/api/workspaces/" + enc(wsId) + "/select", {}).then(function () {
      if (opts.openTaskId) {
        try { sessionStorage.setItem("ds.openTask", opts.openTaskId); } catch (e) { /* noop */ }
      }
      if (opts.openLink && opts.openLink.kind && opts.openLink.id) {
        try { sessionStorage.setItem("ds.openNoticeLink", JSON.stringify(opts.openLink)); } catch (e) { /* noop */ }
      }
      window.location.reload();
      return true;
    }).catch(function (ex) {
      clearWorkspaceHandoff();
      toast(ex.message || "切换空间失败", "bad");
      return false;
    });
  });
}
function saveWorkspaceHandoff(targetId) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ wsId: targetId, mine: { tab: currentTab() } }));
  } catch (e) { /* 受限环境：保持原来的「重载后回默认」 */ }
}
function clearWorkspaceHandoff() {
  try { sessionStorage.removeItem(HANDOFF_KEY); } catch (e) { /* 受限环境忽略 */ }
}
function restoreWorkspaceHandoff() {
  var raw = null;
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch (e) { return false; }
  if (!raw || !rt.currentWs) return false;
  var snap = null;
  try { snap = JSON.parse(raw); } catch (e) { return false; }
  if (!snap || snap.wsId !== rt.currentWs.id) return false;
  var m = snap.mine || {};
  if (["pending", "created", "watched"].indexOf(m.tab) >= 0) {
    mw.tab = m.tab;
    mw.tabTouched = true;
    safeSet(STORE_TAB, m.tab);
  }
  return true;
}

/* ---------------- 交互 ---------------- */

function switchTab(tab) {
  if (activeTabKeys().indexOf(tab) < 0 || tab === mw.tab) return;
  mw.tab = tab;
  mw.tabTouched = true;
  safeSet(STORE_TAB, tab);
  mw.q = "";
  mw.pri = "all";
  mw.blocked = false;
  mw.expand = {};
  mw.chip[tab] = "all";
  if (mineSearch) mineSearch.value = "";
  closeMinePops();
  if (tab === "team") {
    render();
    loadTeam({ silent: true });
    loadCounts(false);
    return;
  }
  render();
  loadTab(tab, { silent: tabHasData(tab) });
}
function setChip(key) {
  var tab = currentTab();
  mw.chip[tab] = key || "all";
  mw.expand = {};
  closeMinePops();
  render();
}
function clearFilters() {
  mw.q = "";
  mw.pri = "all";
  mw.blocked = false;
  mw.chip[currentTab()] = "all";
  if (mineSearch) mineSearch.value = "";
  render();
}
function closeMinePops() {
  if (mineFilterPop) mineFilterPop.open = false;
  if (mineDisplayPop) mineDisplayPop.open = false;
}
var searchTimer = 0;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    mw.q = mineSearch ? mineSearch.value.trim() : "";
    render();
  }, 160);
}
function initEvents() {
  if (mineTabs) {
    mineTabs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]");
      if (b) switchTab(b.dataset.tab);
    });
    mineTabs.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var keys = activeTabKeys();
      var i = keys.indexOf(currentTab());
      if (i < 0) return;
      var next = keys[(i + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length];
      e.preventDefault();
      switchTab(next);
      var btn = mineTabs.querySelector('[data-tab="' + next + '"]');
      if (btn) btn.focus();
    });
  }
  if (mineSearch) {
    mineSearch.addEventListener("input", onSearch);
    mineSearch.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        mineSearch.value = "";
        mw.q = "";
        render();
      }
    });
  }
  if (mineChips) {
    mineChips.addEventListener("click", function (e) {
      var b = e.target.closest("[data-chip]");
      if (b) setChip(b.dataset.chip);
    });
  }
  if (mineFilterMenu) {
    mineFilterMenu.addEventListener("change", function (e) {
      var pri = e.target.closest('input[name="mw-pri"]');
      if (pri) { mw.pri = pri.value; render(); return; }
      var blocked = e.target.closest("#mwBlocked");
      if (blocked) { mw.blocked = !!blocked.checked; render(); }
    });
  }
  if (mineDisplayMenu) {
    mineDisplayMenu.addEventListener("change", function (e) {
      var grp = e.target.closest('input[name="mw-group"]');
      if (grp) {
        mw.group[currentTab()] = grp.value;
        mw.expand = {};
        saveGroup();
        render();
        return;
      }
      var el = e.target.closest('input[name="mw-sort"]');
      if (!el) return;
      mw.sort[currentTab()] = el.value;
      render();
    });
  }
  if (mineFilterPop) {
    mineFilterPop.addEventListener("toggle", function () {
      if (mineFilterPop.open && mineDisplayPop) mineDisplayPop.open = false;
    });
  }
  if (mineDisplayPop) {
    mineDisplayPop.addEventListener("toggle", function () {
      if (mineDisplayPop.open && mineFilterPop) mineFilterPop.open = false;
    });
  }
  if (btnMineRefresh) {
    btnMineRefresh.addEventListener("click", function () {
      btnMineRefresh.disabled = true;
      loadMine({ silent: false }).then(function () {
        btnMineRefresh.disabled = false;
        if (currentTab() === "team") return;
        if (!mw.err[currentTab()]) toast("已刷新", "fs");
      });
    });
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".mw-pop")) closeMinePops();
  });
  if (mineCatchup) {
    mineCatchup.addEventListener("click", function (e) {
      var el = e.target.closest("[data-cu-entry]");
      if (!el) return;
      if (el.dataset.cuEntry === "open") openCatchup();
      else if (el.dataset.cuEntry === "skip") skipCatchup(el);
    });
  }
  if (!mineBody) return;
  mineBody.addEventListener("click", function (e) {
    var claimReviewBtn = e.target.closest("[data-claim-review]");
    if (claimReviewBtn) {
      e.stopPropagation();
      claimReview(claimReviewBtn.dataset.claimReview, claimReviewBtn);
      return;
    }
    var unw = e.target.closest("[data-unwatch]");
    if (unw) {
      e.stopPropagation();
      unwatch(unw.dataset.unwatch, unw.dataset.id, unw.dataset.ws, unw.dataset.title || "", unw);
      return;
    }
    var opener = e.target.closest("[data-open]");
    if (opener) { openRow(opener.dataset.open, opener.dataset.id, opener.dataset.ws, opener.dataset.req || "", opener.dataset.title || "", opener.dataset.version || ""); return; }
    var gfold = e.target.closest("[data-gfold]");
    if (gfold) {
      var gid = gfold.dataset.gfold;
      var keepG = gfold.matches(":focus-visible");
      mw.gfold[gid] = !mw.gfold[gid];
      saveGfold();
      render();
      var againG = null;
      Array.prototype.forEach.call(mineBody.querySelectorAll("[data-gfold]"), function (el) {
        if (el.dataset.gfold === gid) againG = el;
      });
      if (againG && keepG) againG.focus({ preventScroll: true });
      return;
    }
    var fold = e.target.closest("[data-fold]");
    if (fold) {
      var fk = fold.dataset.fold;
      var keepFocus = fold.matches(":focus-visible");
      mw.fold[fk] = !mw.fold[fk];
      safeSet(STORE_FOLD, JSON.stringify(mw.fold));
      render();
      var again = mineBody.querySelector('[data-fold="' + fk + '"]');
      if (again && keepFocus) again.focus({ preventScroll: true });
      return;
    }
    var exp = e.target.closest("[data-expand]");
    if (exp) {
      var key = exp.dataset.expand;
      mw.expand[key] = !mw.expand[key];
      render();
      return;
    }
    var more = e.target.closest("[data-more]");
    if (more) { loadTab(more.dataset.more, { append: true }); return; }
    var claim = e.target.closest("[data-claim]");
    if (claim) { openClaimable(); return; }
    var retryPartialBtn = e.target.closest("[data-retry-partial]");
    if (retryPartialBtn) { retryPartial(currentTab()); return; }
    var retry = e.target.closest("[data-retry]");
    if (retry) {
      if (currentTab() === "team") loadTeam({ force: true });
      else loadMine({ silent: false });
      return;
    }
    var clear = e.target.closest("[data-clear-filter]");
    if (clear) { clearFilters(); return; }
    var go = e.target.closest("[data-go]");
    if (go) { goView(go.dataset.go); return; }
    var neo = e.target.closest("[data-empty-new]");
    if (neo) {
      if (!canCreateNow()) { toast("当前没有可写项目，无法新建；请联系空间主或管理员分配", "warn"); return; }
      if (neo.dataset.emptyNew === "task") openTaskDrawer("backlog");
      else newDemand();
      return;
    }
    var range = e.target.closest("[data-team-range]");
    if (range) {
      var rk = range.dataset.teamRange;
      if (rk === teamRangeKey()) return;
      try { localStorage.setItem("ds.teamRange", rk); } catch (ex) { /* 受限环境仅本次生效 */ }
      mw.team.cache = mw.team.cache || {};
      loadTeam({ silent: true });
      return;
    }
    var risk = e.target.closest("[data-team-risk]");
    if (risk) {
      var blocked = risk.dataset.teamRisk === "blocked";
      openTeamTaskTable(blocked ? "被阻塞工作项" : "逾期工作项",
        blocked ? { blocked: true } : { due: "over" }, "工作项加载失败");
      return;
    }
    var member = e.target.closest("[data-team-member]");
    if (member) {
      if (member.dataset.teamMember) openTeamTaskTable(member.dataset.teamMember + " · 未完成工作项", { owners: member.dataset.teamMember, open: 1 }, "工作项加载失败");
      return;
    }
    var teamGo = e.target.closest("[data-team-go]");
    if (teamGo) {
      var status = teamGo.dataset.teamStatus || "";
      if (status) {
        var from = status === "testing" ? "accept" : "merge";
        try { window.location.hash = "#/branches?status=" + status + "&from=" + from; } catch (ex) { /* noop */ }
      }
      goView(teamGo.dataset.teamGo);
      return;
    }
    var teamTask = e.target.closest("[data-team-task]");
    if (teamTask) { openTaskById(teamTask.dataset.teamTask); return; }
    var teamRefresh = e.target.closest("[data-team-refresh]");
    if (teamRefresh) { loadTeam({ force: true }); return; }
  });
  mineBody.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var claimKey = e.target.closest("[data-claim-review]");
    if (claimKey) { e.preventDefault(); claimKey.click(); return; }
    var el = e.target.closest("[data-open],[data-team-task]");
    if (!el) return;
    e.preventDefault();
    el.click();
  });
}
function teamTaskPage(params, offset) {
  return API.get("/api/tasks/list", Object.assign({}, params, { offset: offset || 0, limit: PAGE }))
    .then(function (page) {
      (page && page.items || []).forEach(function (t) {
        if (!t.reqName && t.reqId) t.reqName = reqNameOf(t.reqId);
      });
      return page;
    });
}
function openTeamTaskTable(title, params, errMsg) {
  teamTaskPage(params, 0).then(function (page) {
    openTaskTable(title, (page && page.items) || [], "团队视图 · 点击工作项行打开详情", {
      total: (page && page.total) || 0,
      hasMore: !!(page && page.hasMore),
      pub: true,
      fetch: function (offset, pub) {
        return teamTaskPage(Object.assign({}, params,
          { pubState: (pub === "published" || pub === "unpublished") ? pub : "" }), offset);
      }
    });
  }).catch(function (err) {
    toast(err && err.message ? err.message : errMsg, "bad");
  });
}

/* ---------------- 入口 / 事件 ---------------- */

function syncSearchPlaceholder() {
  if (!mineSearch) return;
  /* 390 下搜索框与筛选/显示/刷新同一行，完整提示会被截断，移动端用短文案 */
  mineSearch.placeholder = isMobile() ? "搜索事项" : "搜索标题、项目或提交人";
}

function enterMineView() {
  syncSearchPlaceholder();
  var saved = safeGet(STORE_TAB);
  if (saved && ["pending", "created", "watched", "team"].indexOf(saved) >= 0 && saved !== mw.tab) {
    mw.tab = saved;
    mw.tabTouched = true;
  }
  if (mw.tab === "team" && !canTeam()) mw.tab = "pending";
  render();
  if (mw.tab === "team") loadTeam({ silent: true });
  loadCatchupEntry();
  loadMine({ silent: mw.everLoaded });
}

function refreshMineIfOpen() {
  if (document.body.dataset.view !== "mine") return;
  loadCatchupEntry();
  if (currentTab() === "team") { loadTeam({ silent: true, force: true }); loadCounts(true); return; }
  loadCounts(true);
  loadTab(currentTab(), { silent: true });
}

window.addEventListener("ds:layout", function () {
  if (!rt.currentWs || document.body.dataset.view !== "mine") return;
  syncSearchPlaceholder();
  if (!canTeam()) mw.team.data = null;
  if (mw.tab === "team" && !canTeam()) mw.tab = "pending";
  render();
});
window.addEventListener("ds:refresh-mine", refreshMineIfOpen);
window.addEventListener("ds:task-saved", refreshMineIfOpen);
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState !== "visible" || document.body.dataset.view !== "mine") return;
  if (currentTab() === "team") return;
  loadCounts(true);
});

initEvents();
render();

export { askSwitchWorkspace, clearWorkspaceHandoff, enterMineView, loadMine, restoreWorkspaceHandoff, saveWorkspaceHandoff, wsNameById };
