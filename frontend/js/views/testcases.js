/* views/testcases · 测试用例：用例库、执行结果标记、失败一键转缺陷 */

import { API, csrfCookie } from "../core/api.js";
import { AIProgress, aiApplyFailText, aiErrorText, aiUsageText } from "../core/ai-progress.js";
import { previewable } from "../core/att-preview.js";
import { createAttachKit, bindFileDrop, uploadAttachment, openAttachment, attachmentChipHTML, validateFiles, reportRejected } from "../core/attach-kit.js";
import { $ } from "../core/dom.js";
import { attachEnvDict, recordEnv } from "../core/env-dict.js";
import { icon } from "../core/icons.js";
import { openTaskById, taskLink } from "../core/task-actions.js";
import { openTaskDrawer } from "../core/task-drawer.js";
import { canEditReq, canManageProject, catNameById, rt, state } from "../core/state.js";
import { loadViews, reloadFilteredViews, savedViewsFor } from "../core/filters-ui.js";
import { UI, esc, toast } from "../core/ui.js";
import { showView } from "../core/router.js";
import { PRIORITIES, assocLinkHTML, avatarHTML, fmtTs, priName, priTagHTML, severityBadgeHTML, colName, typeName, itemNoText, taskPublicationHTML } from "../lib/format.js";
import { loadProjectMembers } from "../lib/member-labels.js";
import { memberToOption, optionSubText } from "../lib/people-picker.js";
import { loadReqs } from "./board.js";
import { openDemandDetailById } from "./demands.js";
import { downloadCsv } from "./manager-shared.js";
import { triggerDownload } from "../lib/download.js";

var cases = [];
var stats = { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, untested: 0 };
var caseTotal = 0;        /* 当前筛选下的总数（服务端） */
var caseHasMore = false;
var caseSel = {};          /* 批量维护：勾选的用例 id → true，加载/筛选变化后清空 */
var caseBatchSaving = false;
var caseModules = [];     /* 模块名候选（自由文本口径，CSV 与旧数据仍可能出现） */
var caseOwners = [];
var caseFacetCounts = { module:{}, owner:{}, priority:{} };
var caseModuleNodes = [];  /* 项目目录树：服务端 DFS 扁平列表，带层级与计数 */
var caseModuleIdCounts = {};
var casePageSize = 100;    /* 每页条数：50 / 100 / 200 */
var caseSort = "created";
var caseSortDir = "desc";
var caseSearchWide = false; /* false 只搜标题/编号/模块，true 才搜前置、数据与步骤 */
var caseGroupBy = "";       /* ""=不分组；module / priority / status / owner / demand / set */
var caseGroupSegs = [];     /* 分组段头（当前筛选范围内的计数与结果分布） */
var caseGroupRows = {};     /* 段内已加载的行：key -> [case] */
var caseGroupMore = {};     /* 段内分页：key -> {total,hasMore,loading,error} */
var caseGroupShown = {};    /* 段内已显示行数：key -> n（首屏 6 行，其余点「段内加载更多」） */
var caseGroupCollapsed = {};
var caseGroupSeq = 0;
var caseSelAll = false;     /* 全选筛选结果：含未加载的行，按条件生效 */
var caseSelScope = null;    /* 全选本组：{dim,key,label}，范围再收窄一个维度 */
var caseExclude = {};       /* 全选后取消勾选的行 */
/* 左栏默认展开；手机上先收起，避免分组树把首屏用例挤出视口。目录已移到顶部筛选 */
var caseSide = (function(){
  try{ return window.matchMedia("(max-width:700px)").matches ? "" : "set"; }
  catch(e){ return "set"; }
})();
var caseSetQuery = "";      /* 分组搜索词 */
var caseSetNoneTotal = 0;   /* 未加入任何可见分组的用例数（项目全量口径） */
var caseSets = [];
var caseSetSeq = 0;
var caseSetOpen = {};       /* 分组折叠态：分组 id -> false 表示折叠，缺省即展开 */
var caseSetSub = true;      /* 选中父分组时是否显示子分组用例（服务端按子树去重） */
var caseDirOpen = {};       /* 目录折叠态：节点 id -> false 表示折叠，缺省即展开 */
var caseDirQuery = "";
var caseDrag = null;        /* 正在拖动的用例：{anchor,selection,count,target,action} */
var caseOrderDrag = null;   /* 手动排序中拖动的用例行：{id,target,action} */
var caseFormModules = [];   /* 用例弹窗所属项目的目录树（全部项目下与浏览项目不同） */
var caseFormModuleReq = null;
var caseFormModulePrev = "";  /* 目录下拉的上一个值：点「＋ 新建目录…」取消后回退 */
var caseSearchTimer = null;
var caseReqId = null;
/* 用例与测试计划的浏览范围：false=只看 caseReqId，true=全部项目（按项目分组） */
var caseScopeAll = false;
var CASE_ALL_KEY = "__all__";
var caseGroups = [];      /* 全部项目下按项目分组：{reqId,name,items,total,hasMore,error} */
var caseFormReqId = null; /* 当前用例弹窗的所属项目：编辑取用例自身，新增取选定目标 */
var statusFilter = "all";
var tcMode = "cases";
var coverageRows = [];
/* 覆盖矩阵展开态：需求 → 工作项 → 用例；数据按需加载后缓存 */
var covExpanded = {};
var covTaskCache = {};
var covCaseIndex = null;
var covLoadSeq = 0;
/* 从需求详情读数带跳入时，指定要自动展开并滚动到的需求行 */
var covPendingExpand = null;
var reportData = null;
var reportSeq = 0;
var runsCaseId = null;
var runsCaseTitle = "";
var runsSeq = 0;
var runsList = [];
var moduleFilter = "all";   /* 目录节点 ID / __none（未归类）/ all */
var caseModuleSub = false;  /* 目录筛选是否含子节点用例 */
var priFilter = "all";
var ownerFilter = "all";
var demandFilter = "all";   /* 主需求 ID / __none / all */
var setFilter = "all";      /* 用例集 ID / __none（未加入任何可见分组）/ all */
var bugOnly = false;
var searchText = "";
var editingCase = null;
/* 用例编辑：验证工作项多选。caseTaskSel = taskId → 候选行，候选限定主需求 */
var caseTaskSel = {};
var caseTaskOptions = [];
var caseTaskSeq = 0;
var caseTaskLoading = false;
var caseTaskError = null;
var caseTaskQuery = "";
var runningCaseId = null;
var defectCaseId = null;
var runStatus = "passed";
var runKit = null;          /* 执行弹框的待传证据收集器 */
var runRoundNo = 0;         /* 本轮是第几次执行（历史总数 + 1） */
var defectEvidence = [];    /* 最近一轮失败证据：转缺陷弹框展示与携带 */
var defectEvSeq = 0;
var loadSeq = 0;
/* 项目需求池条目缓存：候选浮层先给一页，输入关键词后走服务端搜索 */
var DEMAND_OPTIONS_PAGE_SIZE = 100;
var DEMAND_SEARCH_PAGE_SIZE = 50;
var DEMAND_SEARCH_DEBOUNCE = 250;
var demandOptions = { reqId: null, list: [], total: 0, loading: null, error: null };
/* seq 标记浮层实例，reqSeq 标记搜索请求：旧请求返回时不能覆盖新浮层 */
var demandPicker = { el: null, seq: 0, reqSeq: 0, query: "", list: [], total: 0, loading: false, error: null, timer: null };
var caseSaving = false;
/* 用例抽屉：阅读态正在看的用例、当前页签、执行流水（用于页签计数与执行历史/缺陷） */
var caseDetailId = null;
var caseDetailTab = "overview";
var caseDetailRuns = null;
var caseDetailSeq = 0;
/* 抽屉两态：阅读态点字段就地改，编辑态按同一结构批量改；完整表单只留给新建 */
var caseDetailEditing = false;
var caseDetailDraft = null;
var caseInlineEdit = null;   /* 阅读态正在就地编辑：{kind:"pre"|"testData", text} 或 {kind:"step", i, k, text} */
var caseInlineNewStep = null; /* 阅读态刚插入、还没保存的步骤行下标；取消时回滚 */
var caseDetailSaving = false;
var caseDetailModules = { reqId: null, list: [], loading: null };
/* 分组归属：list 是当前用例可见的全部分组，d.inCase 标记已加入；与 caseSets（左侧面板）分开缓存 */
var caseDetailSets = { reqId: null, caseId: null, list: [], loading: null, error: "", seq: 0 };
var caseRunning = false;
var caseDefecting = false;
var caseMoreLoading = false;
var caseFormBaseline = null;
var runFormBaseline = null;
var defectFormBaseline = null;
/* AI 生成用例：来源选择 → 进度层 → 草稿勾选 */
var aiCaseSource = "doc";
var aiCaseSourceReqId = null;
var aiCaseDrafts = [];
var aiCaseDemandId = "";
var aiCaseApplyReqId = null;
var aiCaseGenerating = false;
var aiCaseApplying = false;
var aiCaseDocs = { reqId: null, list: [], error: null };

/* ---------- 缺陷 tab：任务即缺陷，按项目拉全量后在前端派生状态 ---------- */
var DEFECT_PAGE = 100;
var defects = [];
var defectLinks = {};
var defectVersions = [];
var defectSeq = 0;
var defectShown = DEFECT_PAGE;
var defSeverity = "all";
var defPriority = "all";
var defStatus = "open";
var defOwner = "all";
var defVersion = "all";
var defPub = "all";
var defCat = "all";
var defTag = "all";
var defSearch = "";
/* 有发布事实即算已发布：正式记录的当前生效/部分/回滚/覆盖未知，或人工补录 */
function taskPublished(t){
  return !!(t.publishedAt || t.everPublished === true || t.manualPublished === true
    || (t.publicationState && t.publicationState !== "unpublished")
    || (Array.isArray(t.publicationTargets) && t.publicationTargets.length));
}
var defSearchTimer = null;
var defReqId = "";              /* "" = 全部项目；否则只看一个项目 */
var DEFECT_ALL_KEY = "__all__";
var defectOpenCount = 0;
var defectBadgeReqId = null;
var DEFECT_STATUSES = {
  todo: { label: "待修复", cls: "todo" },
  fixing: { label: "修复中", cls: "fixing" },
  verify: { label: "待回归", cls: "verify" },
  closed: { label: "已关闭", cls: "closed" }
};
var SEVERITY_RANK = { blocker: 0, critical: 1, major: 2, minor: 3 };

var STATUS_LABEL = { passed: "通过", failed: "失败", blocked: "阻塞", skipped: "跳过" };
/* 项目内稳定编号：创建后不变，缺陷单/评审都用它引用；与列表序号无关 */
function caseNoText(c){
  var n = Number(c && c.caseNo) || 0;
  if(n <= 0) return "";
  var s = String(n);
  while(s.length < 3) s = "0" + s;
  return "TC-" + s;
}
function statusBadgeHTML(s){
  if(!s) return '<span class="mini-tag mute">未执行</span>';
  var cls = { passed: "ok", failed: "over", blocked: "warn", skipped: "mute" }[s];
  return '<span class="mini-tag ' + cls + '">' + STATUS_LABEL[s] + '</span>';
}
function caseById(id){
  for(var i = 0; i < cases.length; i++) if(cases[i].id === id) return cases[i];
  return null;
}
function isWritable(){ return !!caseReqId && canEditReq(caseReqId); }
function caseWritable(c){ return canEditReq(c && c.reqId ? c.reqId : caseReqId); }
/* 弹窗里的项目可能不是当前浏览项目（全部项目下从某一行编辑），写权限按弹窗项目算 */
function caseFormWritable(){ return !!caseFormReqId && canEditReq(caseFormReqId); }
/* 全部项目只汇总可见且未归档的项目；归档项目仍可在单项目范围下单独查看 */
function caseScopeVisibleProjects(){
  return (rt.reqList || []).filter(function(r){ return !r.archivedAt; });
}
function caseCreateTargets(){
  var scope = caseScopeVisibleProjects();
  if(caseScopeAll) return scope.filter(function(r){ return canEditReq(r.id); }).map(function(r){ return r.id; });
  return caseReqId && canEditReq(caseReqId) ? [caseReqId] : [];
}
/* 有没有可看的用例目标：全部项目看可见项目，单项目看项目列表本身 */
function caseHasTargets(){
  return !!(caseScopeAll ? caseScopeVisibleProjects().length : rt.reqList.length);
}
/* 没有目标可筛时，筛选条针对的是不存在的数据：整块收起，只留空态与建项目指引 */
function syncCaseBars(){
  var hasTargets = caseHasTargets();
  var bar = $("tcFilterBar");
  if(bar) bar.hidden = tcMode === "defects" || !hasTargets;
  var card = $("tcFilterCard");
  /* 统计与筛选合并成一张卡：非用例视图整卡让位，避免留一条空框 */
  if(card) card.hidden = !hasTargets || tcMode !== "cases";
  var btn = $("tcFilterBtn");
  if(btn) btn.style.display = tcMode === "cases" && hasTargets ? "" : "none";
}

/* ---------- 缺陷项目范围：浏览可跨项目，写操作必须落到单个项目 ---------- */
function defectScopeProjects(){
  return (rt.reqList || []).filter(function(r){ return !r.archivedAt || r.id === defReqId; });
}
function defectScopeReqIds(){
  if(defReqId) return [defReqId];
  return (rt.reqList || []).filter(function(r){ return !r.archivedAt; }).map(function(r){ return r.id; });
}
function defectScopeKey(){ return defReqId || DEFECT_ALL_KEY; }
function defectScopeName(){
  return defReqId ? reqNameOf(defReqId) : "全部项目";
}
function defectProjectName(id){ return id ? reqNameOf(id) : "无项目"; }
function defectCreateTargets(){
  var scope = (rt.reqList || []).filter(function(r){ return !r.archivedAt; });
  if(defReqId){
    return scope.some(function(r){ return r.id === defReqId; }) && canEditReq(defReqId)
      ? [defReqId] : [];
  }
  return scope.filter(function(r){ return canEditReq(r.id); }).map(function(r){ return r.id; });
}
function syncDefectProjectSel(){
  var sel = $("tcDefReq");
  if(!sel) return;
  var list = defectScopeProjects();
  if(defReqId && !list.some(function(r){ return r.id === defReqId; })) defReqId = "";
  sel.innerHTML = '<option value="">全部项目</option>' + list.map(function(r){
    return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
  }).join("");
  sel.value = defReqId;
}
function syncDefectNewBtn(){
  var btn = $("btnDefectNew");
  if(btn) btn.hidden = tcMode !== "defects" || !defectCreateTargets().length;
}

/* ---------- 加载 ---------- */

function syncReqSel(){
  var sel = $("tcReq");
  if(!sel) return;
  /* 覆盖矩阵与测试报告必须落到单个项目，不提供「全部项目」 */
  var includeAll = tcMode === "cases" || tcMode === "plans";
  var list = rt.reqList.filter(function(r){ return !r.archivedAt || r.id === caseReqId; });
  /* 一个项目都没有时没有可选范围：留一个禁用占位，避免控件整块空白 */
  var empty = !list.length;
  sel.innerHTML = (empty ? '<option value="">无项目</option>' : "")
    + (includeAll && !empty ? '<option value="' + CASE_ALL_KEY + '">全部项目</option>' : "")
    + list.map(function(r){
      return '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.archivedAt ? "（已归档）" : "") + '</option>';
    }).join("");
  sel.disabled = empty;
  if(!caseReqId && list.length) caseReqId = list[0].id;
  sel.value = (includeAll && caseScopeAll) ? CASE_ALL_KEY : (caseReqId || "");
  /* 值对不上任何选项时（如「全部项目」已被收起）落到第一项，不留空白控件 */
  if(sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
}
/* 当前筛选条件（不含分页）：列表、分组段头、批量动作、按筛选加入计划与导出共用同一份口径。
   空值口径与服务端 CaseQuery 对齐：未执行=__untested、未归类/未设置=__none、缺陷开关=bugOnly。 */
function caseFilterQuery(reqId){
  var single = !caseScopeAll;
  return {
    reqId: reqId || caseReqId,
    status: statusFilter === "all" ? null : (statusFilter === "untested" ? "__untested" : statusFilter),
    moduleId: single && moduleFilter !== "all" ? moduleFilter : null,
    moduleSub: single && caseModuleSub ? true : null,
    pri: priFilter === "all" ? null : priFilter,
    owner: ownerFilter === "all" ? null : ownerFilter,
    demandId: single && demandFilter !== "all" ? demandFilter : null,
    setId: single && setFilter !== "all" ? setFilter : null,
    setSub: single && setFilter !== "all" && caseSetSub ? true : null,
    bugOnly: bugOnly ? true : null,
    q: searchText || null,
    searchWide: caseSearchWide ? true : null,
    sort: caseSort,
    sortDir: caseSortDir
  };
}
function caseQueryParams(offset, reqId, limit){
  var q = caseFilterQuery(reqId);
  q.offset = offset;
  q.limit = limit || casePageSize;
  return q;
}
/* 批量动作的作用范围：要么明确 ID（勾选已加载的行），要么按筛选条件生效（含未加载的行）。
   「全选本组」在筛选之上再叠一个维度条件，口径与段头计数完全一致。 */
function caseSelectionFilter(){
  var q = caseFilterQuery();
  if(caseSelScope) applySegmentCondition(q, caseSelScope.dim, caseSelScope.key);
  return q;
}
function caseSelection(){
  if(caseSelAll){
    return { allFiltered: true, filter: caseSelectionFilter(), excludeIds: Object.keys(caseExclude) };
  }
  return { ids: caseSelIds() };
}
function caseSelTotal(){
  if(!caseSelScope) return caseTotal;
  for(var i = 0; i < caseGroupSegs.length; i++){
    if(caseGroupSegs[i].key === caseSelScope.key) return caseGroupSegs[i].total;
  }
  return 0;
}
function caseSelCount(){
  return caseSelAll ? Math.max(0, caseSelTotal() - Object.keys(caseExclude).length) : caseSelIds().length;
}
function caseHasSel(){ return caseSelAll ? caseSelCount() > 0 : caseSelIds().length > 0; }
/* 某一行当前是否被选中。分组视图里传段键：用例集是多归属，同一条用例可能出现在多段，
   只有「全选本组」所在的那一段才算选中，不能靠用例自身字段反推。 */
function caseRowSelected(c, segKey){
  if(!caseSelAll) return !!caseSel[c.id];
  if(caseExclude[c.id]) return false;
  if(caseSelScope) return segKey === caseSelScope.key;
  return true;
}
/* ---------- 分组显示：段头计数 + 段内分页 ----------
   分组只是列表的呈现方式，不新增数据；段内行各自按「筛选 + 段条件」取，
   多归属的用例集因此也能按段正确分页。 */
var GROUP_PAGE = 20;   /* 段内一次取多少行 */
var GROUP_SHOW = 6;    /* 段内首屏显示多少行，其余点「段内加载更多」展开 */
var CASE_SORTS = [
  ["created", "创建时间"], ["updated", "更新时间"], ["executed", "最近执行"],
  ["no", "用例编号"], ["pri", "优先级"], ["module", "模块"], ["status", "执行结果"],
  ["manual", "手动排序"]
];
var CASE_GROUP_DIMS = [
  ["", "不分组"], ["module", "模块"], ["priority", "优先级"], ["status", "执行结果"],
  ["owner", "执行人"], ["demand", "主需求"], ["set", "自定义分组"]
];
function caseGroupQuery(){
  var q = caseFilterQuery();
  q.groupBy = caseGroupBy;
  return q;
}
/* 段条件叠在筛选之上，口径与段头计数完全一致；__none / __untested 由服务端识别 */
function applySegmentCondition(q, dim, key){
  if(dim === "module"){ q.moduleId = key; q.moduleSub = null; }
  else if(dim === "priority") q.pri = key;
  else if(dim === "status") q.status = key;
  else if(dim === "owner") q.owner = key;
  else if(dim === "demand") q.demandId = key;
  else if(dim === "set") q.setId = key;
  return q;
}
function segmentByKey(key){
  for(var i = 0; i < caseGroupSegs.length; i++) if(caseGroupSegs[i].key === key) return caseGroupSegs[i];
  return null;
}
function resetGroupRows(){
  caseGroupRows = {};
  caseGroupMore = {};
  caseGroupShown = {};
  caseGroupCollapsed = {};
  caseGroupSeq++;
}
/* cases 仍是「已加载行」的并集：编辑 / 执行 / 记录弹框都靠 caseById 取行 */
function rebuildGroupCases(){
  var seen = {}, out = [];
  caseGroupSegs.forEach(function(s){
    (caseGroupRows[s.key] || []).forEach(function(c){
      if(seen[c.id]) return;
      seen[c.id] = 1;
      out.push(c);
    });
  });
  cases = out;
}
function loadSegmentRows(key, append){
  var seg = segmentByKey(key);
  if(!seg || !seg.total) return Promise.resolve(false);
  var more = caseGroupMore[key] || (caseGroupMore[key] = { total: seg.total, hasMore: true, loading: false, error: "" });
  if(more.loading || (append && !more.hasMore)) return Promise.resolve(false);
  var rows = caseGroupRows[key] || (caseGroupRows[key] = []);
  var seq = loadSeq, gseq = caseGroupSeq;
  more.loading = true;
  more.error = "";
  var q = applySegmentCondition(caseFilterQuery(), caseGroupBy, key);
  q.offset = append ? rows.length : 0;
  q.limit = GROUP_PAGE;
  return API.get("/api/test-cases", q).then(function(page){
    more.loading = false;
    if(seq !== loadSeq || gseq !== caseGroupSeq) return false;
    page = page || {};
    var known = {};
    rows.forEach(function(c){ known[c.id] = 1; });
    (page.items || []).forEach(function(c){ if(!known[c.id]){ known[c.id] = 1; rows.push(c); } });
    if(page.total != null){ more.total = page.total; seg.total = page.total; }
    more.hasMore = !!page.hasMore;
    caseGroupShown[key] = rows.length;
    rebuildGroupCases();
    render();
    return true;
  }).catch(function(ex){
    more.loading = false;
    if(seq !== loadSeq || gseq !== caseGroupSeq) return false;
    more.error = ex.message || "网络异常";
    render();
    return false;
  });
}
/* 展开且非空的段逐批取行：一次 4 个请求，避免几十个目录节点同时打满连接 */
function loadExpandedSegments(){
  var keys = [];
  caseGroupSegs.forEach(function(s){
    if(s.total > 0 && !caseGroupCollapsed[s.key] && !(caseGroupRows[s.key] || []).length) keys.push(s.key);
  });
  var i = 0;
  function next(){
    if(i >= keys.length) return Promise.resolve(true);
    var batch = keys.slice(i, i + 4);
    i += 4;
    return Promise.all(batch.map(function(k){ return loadSegmentRows(k, false); })).then(next);
  }
  return next();
}
/* 段内加载更多：先展开已取到的行，取完了再请求下一页 */
function moreSegmentRows(key){
  var rows = caseGroupRows[key] || [];
  var shown = caseGroupShown[key] || 0;
  if(shown < rows.length){
    caseGroupShown[key] = rows.length;
    render();
    return Promise.resolve(true);
  }
  return loadSegmentRows(key, true);
}
function toggleSegment(key){
  if(caseGroupCollapsed[key]) delete caseGroupCollapsed[key];
  else caseGroupCollapsed[key] = true;
  render();
  if(!caseGroupCollapsed[key]) loadSegmentRows(key, false);
}
/* 空段也渲染段体（写明「该分组下没有用例」），折叠同样有效，所以按「有没有未折叠的段」判断 */
function anySegmentExpanded(){
  return caseGroupSegs.some(function(s){ return !caseGroupCollapsed[s.key]; });
}
function collapseAllSegments(on){
  caseGroupCollapsed = {};
  if(on) caseGroupSegs.forEach(function(s){ caseGroupCollapsed[s.key] = true; });
  render();
  if(!on) loadExpandedSegments();
}
function selectSegment(key){
  var seg = segmentByKey(key);
  if(!seg || !seg.total){ toast("该分组下没有用例", "warn"); return; }
  if(caseSelAll && caseSelScope && caseSelScope.key === key){ clearCaseSel(); return; }
  caseSel = {};
  caseExclude = {};
  caseSelAll = true;
  caseSelScope = { dim: caseGroupBy, key: key, label: seg.label };
  syncBulkBar();
  render();
}
function loadCases(){
  var seq = ++loadSeq;
  resetCaseSel();
  if(caseScopeAll) return loadCasesAll(seq);
  if(!caseReqId || !rt.reqList.length){
    cases = [];
    caseGroups = [];
    caseTotal = 0;
    caseHasMore = false;
    syncFilterOptions();
    $("tcList").innerHTML = UI.emptyState({
      icon: "folder", title: "还没有项目",
      text: "先在「项目」里创建项目，测试用例按项目收纳。"
    });
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = "";
    syncCaseBars();
    return Promise.resolve(false);
  }
  var reqId = caseReqId;
  var grouped = !!caseGroupBy;
  $("tcList").innerHTML = UI.skeletonRows(3);
  /* 分组视图：列表请求只取 1 行，用来拿总数与 facets（含目录树），段内行逐段单独取，
     这样多归属的用例集也能按段正确分页，不依赖「全局前缀按段切分」的隐含假设。 */
  var reqs = [
    API.get("/api/test-cases", caseQueryParams(0, null, grouped ? 1 : casePageSize)),
    API.get("/api/test-cases/stats", { reqId: reqId })
  ];
  if(grouped) reqs.push(API.get("/api/test-cases/groups", caseGroupQuery()));
  return Promise.all(reqs).then(function(rs){
    if(seq !== loadSeq || caseReqId !== reqId || caseScopeAll) return;
    var page = rs[0] || {};
    caseTotal = page.total || 0;
    caseModules = page.modules || [];
    caseOwners = page.owners || [];
    caseModuleNodes = page.moduleNodes || [];
    caseModuleIdCounts = page.moduleIdCounts || {};
    caseFacetCounts = {
      module: page.moduleCounts || {}, owner: page.ownerCounts || {},
      priority: page.priorityCounts || {}
    };
    stats = rs[1] || { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, untested: 0 };
    if(grouped){
      cases = [];
      caseHasMore = false;
      caseGroupSegs = rs[2] || [];
      resetGroupRows();
      render();
      loadExpandedSegments(seq);
    }else{
      cases = (page.items || []).slice();
      caseHasMore = !!page.hasMore;
      caseGroupSegs = [];
      resetGroupRows();
      render();
    }
    return true;
  }).catch(function(ex){
    if(seq !== loadSeq) return false;
    $("tcList").innerHTML = UI.emptyState({
      icon: "alert", title: "加载失败", text: ex.message || "网络异常，请稍后重试"
    });
    return false;
  });
}
/* 全部项目：按项目分组各自加载、各自分页；不合并排序，避免跨项目分页失真。
   模块只在项目内有意，因此全部项目下不传模块条件，筛选入口也一并隐藏。 */
function loadCasesAll(seq){
  var projects = caseScopeVisibleProjects();
  if(!rt.reqList.length || !projects.length){
    cases = [];
    caseGroups = [];
    caseTotal = 0;
    caseHasMore = false;
    caseModules = [];
    caseOwners = [];
    caseModuleNodes = [];
    caseModuleIdCounts = {};
    caseFacetCounts = { module:{}, owner:{}, priority:{} };
    syncFilterOptions();
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = "全部项目";
    $("tcList").innerHTML = UI.emptyState({
      icon: "folder", title: "没有可用项目",
      text: rt.reqList.length ? "项目都已归档，暂无用例可看。" : "先在「项目」里创建项目，测试用例按项目收纳。"
    });
    syncCaseBars();
    return Promise.resolve(false);
  }
  $("tcList").innerHTML = UI.skeletonRows(3);
  return Promise.all(projects.map(function(p){
    return API.get("/api/test-cases", caseQueryParams(0, p.id)).then(function(page){
      return { reqId: p.id, name: p.name, page: page || {} };
    }).catch(function(){
      return { reqId: p.id, name: p.name, page: null };
    });
  })).then(function(rs){
    if(seq !== loadSeq || !caseScopeAll) return false;
    caseGroups = rs.map(function(g){
      var page = g.page || {};
      return {
        reqId: g.reqId, name: g.name,
        items: (page.items || []).slice(),
        total: page.total || 0,
        hasMore: !!page.hasMore,
        loading: false,
        error: !g.page
      };
    });
    cases = [];
    caseGroups.forEach(function(g){ cases = cases.concat(g.items); });
    caseTotal = caseGroups.reduce(function(a, g){ return a + g.total; }, 0);
    caseHasMore = caseGroups.some(function(g){ return g.hasMore; });
    caseGroupSegs = [];
    resetGroupRows();
    mergeCaseFacets(rs.map(function(g){ return g.page; }).filter(Boolean));
    render();
    return true;
  }).catch(function(ex){
    if(seq !== loadSeq) return false;
    $("tcList").innerHTML = UI.emptyState({
      icon: "alert", title: "加载失败", text: ex.message || "网络异常，请稍后重试"
    });
    return false;
  });
}
function mergeFacetCounts(target, source){
  Object.keys(source || {}).forEach(function(k){
    target[k] = (target[k] || 0) + (Number(source[k]) || 0);
  });
}
function mergeCaseFacets(pages){
  var mods = {}, owners = {};
  var counts = { module:{}, owner:{}, priority:{} };
  pages.forEach(function(p){
    (p.modules || []).forEach(function(m){ mods[m] = 1; });
    (p.owners || []).forEach(function(o){ owners[o] = 1; });
    mergeFacetCounts(counts.module, p.moduleCounts);
    mergeFacetCounts(counts.owner, p.ownerCounts);
    mergeFacetCounts(counts.priority, p.priorityCounts);
  });
  caseModules = Object.keys(mods);
  caseOwners = Object.keys(owners).sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  caseFacetCounts = counts;
  /* 目录是项目内的单归属结构，跨项目合并会把同名节点误读为同一范围 */
  caseModuleNodes = [];
  caseModuleIdCounts = {};
}
/* 滚动加载下一页：沿用当前筛选条件，按已加载条数作为 offset；
   全部项目下按项目分组各自翻页 */
function loadMoreCases(reqId){
  if(caseScopeAll){
    var group = null;
    for(var i = 0; i < caseGroups.length; i++) if(caseGroups[i].reqId === reqId) group = caseGroups[i];
    if(!group || !group.hasMore || group.loading) return Promise.resolve(false);
    var seqAll = loadSeq;
    group.loading = true;
    render();
    return API.get("/api/test-cases", caseQueryParams(group.items.length, group.reqId)).then(function(page){
      group.loading = false;
      if(seqAll !== loadSeq || !caseScopeAll) return false;
      var known = {};
      group.items.forEach(function(c){ known[c.id] = 1; });
      (page.items || []).forEach(function(c){ if(!known[c.id]){ known[c.id] = 1; group.items.push(c); } });
      group.total = page.total || group.total;
      group.hasMore = !!page.hasMore;
      cases = [];
      caseGroups.forEach(function(g){ cases = cases.concat(g.items); });
      caseTotal = caseGroups.reduce(function(a, g){ return a + g.total; }, 0);
      caseHasMore = caseGroups.some(function(g){ return g.hasMore; });
      render();
      return true;
    }).catch(function(ex){
      group.loading = false;
      toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
      render();
      return false;
    });
  }
  if(!caseHasMore || caseMoreLoading) return Promise.resolve(false);
  caseMoreLoading = true;
  var seq = loadSeq;
  var reqId = caseReqId;
  var btn = $("tcList").querySelector("[data-tc-more]");
  function restoreBtn(){
    var cur = $("tcList") ? $("tcList").querySelector("[data-tc-more]") : null;
    var target = cur || (btn && btn.isConnected ? btn : null);
    if(!target) return;
    target.disabled = false;
    target.textContent = "加载更多（已加载 " + cases.length + " / 共 " + caseTotal + " 条）";
  }
  if(btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  return API.get("/api/test-cases", caseQueryParams(cases.length)).then(function(page){
    caseMoreLoading = false;
    if(seq !== loadSeq || caseReqId !== reqId || caseScopeAll) return false;
    var known = {};
    cases.forEach(function(c){ known[c.id] = 1; });
    (page.items || []).forEach(function(c){ if(!known[c.id]) cases.push(c); });
    caseTotal = page.total || caseTotal;
    caseHasMore = !!page.hasMore;
    render();
    return true;
  }).catch(function(ex){
    caseMoreLoading = false;
    if(seq === loadSeq) restoreBtn();
    toast("加载更多失败：" + (ex.message || "网络异常"), "bad");
    return false;
  });
}
/* ---------- 缺陷 tab ---------- */

/* 关闭口径：完成列且回归通过才算关闭。
   回归状态由后端随列流转维护：进入待测试/测试中=待回归，进入已完成=回归通过，退回待处理/进行中=回归失败；
   历史数据没有回归状态时按停在哪一列兜底。 */
function defectStatus(t){
  var reg = t.regressionStatus || "";
  var col = t.boardColumn || "";
  if(col === "done" && reg === "passed") return "closed";
  if(reg === "pending") return "verify";
  if(reg === "failed") return "todo";
  if(col === "done" || col === "test" || col === "testing") return "verify";
  if(col === "doing") return "fixing";
  return "todo";
}
function defectIsOpen(t){ return defectStatus(t) !== "closed"; }
function defectLinkedCases(t){ return defectLinks[t.id] || []; }
function defectVersionName(id){
  if(!id) return "";
  for(var i = 0; i < defectVersions.length; i++){
    if(defectVersions[i].id === id) return defectVersions[i].name || id;
  }
  return id;
}
function defectStatusHTML(st){
  var meta = DEFECT_STATUSES[st] || DEFECT_STATUSES.todo;
  return '<span class="tc-def-st is-' + meta.cls + '">' + meta.label + '</span>';
}
function defectOwnerList(){
  var seen = {}, list = [];
  defects.forEach(function(t){
    var name = t.owner || "";
    if(name && !seen[name]){ seen[name] = 1; list.push(name); }
  });
  list.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  return list;
}
function defectCatName(id){
  if(!id) return "未指定模块";
  return catNameById(id) || "已删除模块";
}
function defectMatches(t, skip){
  var st = defectStatus(t);
  if(skip !== "status"){
    if(defStatus === "open"){ if(st === "closed") return false; }
    else if(defStatus !== "all" && st !== defStatus) return false;
  }
  if(skip !== "severity" && defSeverity !== "all" && t.severity !== defSeverity) return false;
  if(skip !== "priority"){
    if(defPriority === "__none"){ if(t.priority) return false; }
    else if(defPriority !== "all" && t.priority !== defPriority) return false;
  }
  if(skip !== "owner"){
    if(defOwner === "__none"){ if(t.owner) return false; }
    else if(defOwner !== "all" && t.owner !== defOwner) return false;
  }
  if(skip !== "version"){
    if(defVersion === "__none"){ if(t.foundVersionId) return false; }
    else if(defVersion !== "all" && t.foundVersionId !== defVersion) return false;
  }
  if(skip !== "pub"){
    var isPub = taskPublished(t);
    if(defPub === "published" && !isPub) return false;
    if(defPub === "unpublished" && isPub) return false;
  }
  if(skip !== "cat"){
    if(defCat === "__none"){ if(t.categoryId) return false; }
    else if(defCat !== "all" && t.categoryId !== defCat) return false;
  }
  if(skip !== "tag"){
    if(defTag === "__none"){ if((t.tags || []).length) return false; }
    else if(defTag !== "all" && (t.tags || []).indexOf(defTag) === -1) return false;
  }
  var q = defSearch.trim().toLowerCase();
  if(skip !== "q" && q){
    var hay = [t.id, t.title, t.owner, t.environment, defectCatName(t.categoryId)]
      .concat(t.tags || [])
      .concat(defectLinkedCases(t).map(function(l){ return l.caseId + " " + l.caseTitle; }))
      .join(" ").toLowerCase();
    if(hay.indexOf(q) === -1) return false;
  }
  return true;
}
function defectFacet(skip){
  return defects.filter(function(t){ return defectMatches(t, skip); });
}
function facetOpt(value, label, count, current){
  if(!count && value !== current && value !== "all") return "";
  return '<option value="' + esc(value) + '">' + esc(label) + "（" + count + "）</option>";
}
function syncDefectFilters(){
  syncDefectProjectSel();
  var ownerCounts = {}, ownerList = [];
  defectFacet("owner").forEach(function(t){
    var name = t.owner || "__none";
    if(ownerCounts[name] === undefined){ ownerCounts[name] = 0; if(name !== "__none") ownerList.push(name); }
    ownerCounts[name]++;
  });
  ownerList.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  /* 已选值即使在当前组合下为 0 也要保留：补进候选并显示（0），避免应用视图后条件被静默清掉 */
  if(defOwner !== "all" && defOwner !== "__none" && ownerList.indexOf(defOwner) === -1
    && defects.some(function(t){ return t.owner === defOwner; })){
    ownerList.push(defOwner);
    ownerCounts[defOwner] = 0;
    ownerList.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  }
  var validOwner = defOwner === "all" || defOwner === "__none"
    || defects.some(function(t){ return t.owner === defOwner; });
  if(!validOwner) defOwner = "all";
  var ownerSel = $("tcDefOwner");
  if(ownerSel){
    ownerSel.innerHTML = facetOpt("all", "负责人：全部", defectFacet("owner").length, defOwner)
      + ownerList.map(function(o){ return facetOpt(o, o, ownerCounts[o] || 0, defOwner); }).join("")
      + facetOpt("__none", "未指派", ownerCounts.__none || 0, defOwner);
    ownerSel.value = defOwner;
  }
  var verCounts = {};
  defectFacet("version").forEach(function(t){
    var key = t.foundVersionId || "__none";
    verCounts[key] = (verCounts[key] || 0) + 1;
  });
  var validVer = defVersion === "all" || defVersion === "__none"
    || defectVersions.some(function(v){ return v.id === defVersion; });
  if(!validVer) defVersion = "all";
  var verSel = $("tcDefVersion");
  if(verSel){
    verSel.innerHTML = facetOpt("all", "发现版本：全部", defectFacet("version").length, defVersion)
      + defectVersions.map(function(v){
        var label = (!defReqId && v.projectName ? v.projectName + " · " : "") + (v.name || v.id);
        return facetOpt(v.id, label, verCounts[v.id] || 0, defVersion);
      }).join("")
      + facetOpt("__none", "未填写", verCounts.__none || 0, defVersion);
    verSel.value = defVersion;
  }
  var pubCounts = { published: 0, unpublished: 0 };
  defectFacet("pub").forEach(function(t){ pubCounts[taskPublished(t) ? "published" : "unpublished"]++; });
  var pubSel = $("tcDefPub");
  if(pubSel){
    pubSel.innerHTML = facetOpt("all", "发布：全部", defectFacet("pub").length, defPub)
      + facetOpt("published", "已发布", pubCounts.published, defPub)
      + facetOpt("unpublished", "未发布", pubCounts.unpublished, defPub);
    pubSel.value = defPub;
  }
  var priCounts = {};
  defectFacet("priority").forEach(function(t){
    var key = t.priority || "__none";
    priCounts[key] = (priCounts[key] || 0) + 1;
  });
  if(defPriority !== "all" && defPriority !== "__none" && PRIORITIES.indexOf(defPriority) === -1) defPriority = "all";
  var priSel = $("tcDefPriority");
  if(priSel){
    priSel.innerHTML = facetOpt("all", "优先级：全部", defectFacet("priority").length, defPriority)
      + PRIORITIES.map(function(p){ return facetOpt(p, p + " · " + priName(p), priCounts[p] || 0, defPriority); }).join("")
      + facetOpt("__none", "未设置", priCounts.__none || 0, defPriority);
    priSel.value = defPriority;
  }
  var sevCounts = {};
  defectFacet("severity").forEach(function(t){
    var key = t.severity || "__none";
    sevCounts[key] = (sevCounts[key] || 0) + 1;
  });
  var sevSel = $("tcDefSeverity");
  if(sevSel){
    var sevAll = defectFacet("severity").length;
    var sevOpts = [["all", "严重度：全部", sevAll], ["blocker", "阻断", sevCounts.blocker || 0],
      ["critical", "严重", sevCounts.critical || 0], ["major", "一般", sevCounts.major || 0],
      ["minor", "轻微", sevCounts.minor || 0], ["__none", "未设置", sevCounts.__none || 0]];
    sevSel.innerHTML = sevOpts.map(function(o){ return facetOpt(o[0], o[1], o[2], defSeverity); }).join("");
    sevSel.value = defSeverity;
  }
  var stCounts = { open: 0, all: 0, todo: 0, fixing: 0, verify: 0, closed: 0 };
  defectFacet("status").forEach(function(t){
    var st = defectStatus(t);
    stCounts.all++;
    if(st !== "closed") stCounts.open++;
    stCounts[st] = (stCounts[st] || 0) + 1;
  });
  var stSel = $("tcDefStatus");
  if(stSel){
    var stOpts = [["open", "状态：未关闭"], ["all", "全部状态"], ["todo", "待修复"], ["fixing", "修复中"], ["verify", "待回归"], ["closed", "已关闭"]];
    stSel.innerHTML = stOpts.map(function(o){
      return facetOpt(o[0], o[1], stCounts[o[0]] || 0, defStatus);
    }).join("");
    stSel.value = defStatus;
  }
  var catCounts = {};
  defectFacet("cat").forEach(function(t){
    var key = t.categoryId || "__none";
    catCounts[key] = (catCounts[key] || 0) + 1;
  });
  var catSel = $("tcDefCat");
  if(catSel){
    var catKeys = Object.keys(catCounts).filter(function(k){ return k !== "__none"; });
    if(defCat !== "all" && defCat !== "__none" && catKeys.indexOf(defCat) === -1
      && defects.some(function(t){ return t.categoryId === defCat; })){
      catKeys.push(defCat);
      catCounts[defCat] = 0;
    }
    catKeys.sort(function(a, b){ return defectCatName(a).localeCompare(defectCatName(b), "zh-Hans-CN"); });
    catSel.innerHTML = facetOpt("all", "模块：全部", defectFacet("cat").length, defCat)
      + catKeys.map(function(k){ return facetOpt(k, defectCatName(k), catCounts[k] || 0, defCat); }).join("")
      + facetOpt("__none", "未指定模块", catCounts.__none || 0, defCat);
    catSel.value = ["all", "__none"].indexOf(defCat) !== -1 || catKeys.indexOf(defCat) !== -1 ? defCat : "all";
    if(catSel.value !== defCat) defCat = "all";
  }
  var tagCounts = {}, tagList = [];
  defectFacet("tag").forEach(function(t){
    var tags = t.tags || [];
    if(!tags.length){ tagCounts.__none = (tagCounts.__none || 0) + 1; return; }
    tags.forEach(function(tag){
      if(tagCounts[tag] === undefined){ tagCounts[tag] = 0; tagList.push(tag); }
      tagCounts[tag]++;
    });
  });
  tagList.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  if(defTag !== "all" && defTag !== "__none" && tagList.indexOf(defTag) === -1
    && defects.some(function(t){ return (t.tags || []).indexOf(defTag) !== -1; })){
    tagList.push(defTag);
    tagCounts[defTag] = 0;
    tagList.sort(function(a, b){ return a.localeCompare(b, "zh-Hans-CN"); });
  }
  var tagSel = $("tcDefTag");
  if(tagSel){
    tagSel.innerHTML = facetOpt("all", "标签：全部", defectFacet("tag").length, defTag)
      + tagList.map(function(tag){ return facetOpt(tag, tag, tagCounts[tag] || 0, defTag); }).join("")
      + facetOpt("__none", "无标签", tagCounts.__none || 0, defTag);
    tagSel.value = ["all", "__none"].indexOf(defTag) !== -1 || tagList.indexOf(defTag) !== -1 ? defTag : "all";
    if(tagSel.value !== defTag) defTag = "all";
  }
  /* 搜索范围跟随项目口径：缺陷默认汇总全部项目 */
  var defSearchEl = $("tcDefSearch");
  if(defSearchEl){
    defSearchEl.placeholder = defReqId ? "搜索本项目缺陷…" : "搜索全部项目缺陷…";
    defSearchEl.title = defReqId
      ? "在所选项目内搜索缺陷 / 编号 / 用例 / 模块 / 标签"
      : "在全部项目中搜索缺陷 / 编号 / 用例 / 模块 / 标签";
    defSearchEl.setAttribute("aria-label", defReqId ? "在所选项目内搜索缺陷" : "在全部项目中搜索缺陷");
  }
  /* 「未关闭」是缺陷页默认口径，算中性；其余偏离默认才高亮 */
  UI.markFiltered($("tcDefReq"), !defReqId);
  UI.markFiltered($("tcDefSeverity"), defSeverity === "all");
  UI.markFiltered($("tcDefPriority"), defPriority === "all");
  UI.markFiltered($("tcDefStatus"), defStatus === "open");
  UI.markFiltered($("tcDefOwner"), defOwner === "all");
  UI.markFiltered($("tcDefVersion"), defVersion === "all");
  UI.markFiltered($("tcDefPub"), defPub === "all");
  UI.markFiltered($("tcDefCat"), defCat === "all");
  UI.markFiltered($("tcDefTag"), defTag === "all");
}
function filteredDefects(){
  var list = defects.filter(function(t){ return defectMatches(t, null); });
  return list.sort(function(a, b){
    var ra = SEVERITY_RANK[a.severity];
    var rb = SEVERITY_RANK[b.severity];
    ra = ra === undefined ? 9 : ra;
    rb = rb === undefined ? 9 : rb;
    if(ra !== rb) return ra - rb;
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}
function defectStatsHTML(){
  var open = defects.filter(defectIsOpen);
  var verify = open.filter(function(t){ return defectStatus(t) === "verify"; });
  var weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  var weekStartTs = weekStart.getTime();
  var week = defects.filter(function(t){
    var ts = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    return ts >= weekStartTs;
  });
  var fixDays = defects.filter(function(t){
    return defectStatus(t) === "closed" && t.createdAt && t.completedAt;
  }).map(function(t){
    return (new Date(t.completedAt).getTime() - new Date(t.createdAt).getTime()) / 86400000;
  }).filter(function(d){ return isFinite(d) && d >= 0; });
  var avgFix = fixDays.length
    ? (fixDays.reduce(function(a, b){ return a + b; }, 0) / fixDays.length).toFixed(1) + " 天"
    : "—";
  var counts = { blocker: 0, critical: 0, major: 0, minor: 0 };
  open.forEach(function(t){ if(counts[t.severity] !== undefined) counts[t.severity]++; });
  var sev = [
    ["blocker", "阻断"], ["critical", "严重"], ["major", "一般"], ["minor", "轻微"]
  ].map(function(p){
    return '<span><i class="sev-dot ' + p[0] + '"></i>' + p[1] + ' <b>' + counts[p[0]] + '</b></span>';
  }).join("");
  return '<span class="tc-stat over">未关闭 <b>' + open.length + '</b></span>'
    + '<span class="tc-stat warn">待回归 <b>' + verify.length + '</b></span>'
    + '<span class="tc-stat mute">本周新增 <b>' + week.length + '</b></span>'
    + '<span class="tc-stat mute">平均修复 <b>' + avgFix + '</b></span>'
    + '<span class="tc-def-sev">' + sev + '</span>';
}
function defectRowHTML(t, no){
  var st = defectStatus(t);
  var cases = defectLinkedCases(t);
  var first = cases[0];
  var caseHTML = first
    ? '<span class="tc-def-case-wrap">'
      + '<button class="tc-def-case" type="button" data-tc-def-case="' + esc(first.caseId) + '" data-tc-def-case-req="' + esc(first.reqId || "") + '" title="'
      + esc("打开来源用例：" + cases.map(function(l){ return (caseNoText(l) ? caseNoText(l) + " " : "") + l.caseTitle; }).join("；")) + '">'
      + esc((caseNoText(first) ? caseNoText(first) + " " : "") + cut(first.caseTitle, 16)) + '</button>'
      + (cases.length > 1 ? '<span class="tc-def-case-more" title="另有 ' + (cases.length - 1) + ' 条来源用例，打开缺陷查看全部">+' + (cases.length - 1) + '</span>' : "")
      + '</span>'
    : '<span class="tc-def-none">—</span>';
  var ownerHTML = t.owner
    ? '<span class="tc-def-owner">' + avatarHTML(t.owner) + '<span>' + esc(t.owner) + '</span></span>'
    : '<span class="tc-def-none">未指派</span>';
  var verHTML = t.foundVersionId
    ? '<span class="tc-def-ver">' + esc(cut(defectVersionName(t.foundVersionId), 14)) + '</span>'
    : '<span class="tc-def-none">未填</span>';
  var sevHTML = t.severity ? severityBadgeHTML(t.severity) : '<span class="mini-tag mute">未定</span>';
  var priHTML = t.priority
    ? '<span class="tc-def-pri" title="优先级：' + esc(priName(t.priority)) + '">' + priTagHTML(t.priority) + '</span>'
    : '<span class="tc-def-none">—</span>';
  var projHTML = defReqId ? ""
    : '<span class="tc-def-proj" title="' + esc(defectProjectName(t.reqId)) + '">'
      + esc(cut(defectProjectName(t.reqId), 18)) + '</span>';
  return '<div class="tc-def-row" role="button" tabindex="0" data-tc-defect="' + esc(t.id) + '" aria-label="打开缺陷：' + esc(t.title) + '">'
    + '<div class="tc-def-no" aria-hidden="true" title="当前列表序号，随筛选和排序变化">' + (no || "") + '</div>'
    + '<div>' + sevHTML + '</div>'
    + '<div>' + priHTML + '</div>'
    + '<div class="tc-def-main">'
    +   '<div class="tc-def-title">' + esc(t.title || "（无标题）") + '</div>'
    +   '<div class="tc-def-sub">' + projHTML + '<span class="tc-def-id">' + esc(t.id) + '</span>'
    +     '<span>' + esc(cases.length ? "测试发现" : "手工创建") + '</span>' + taskPublicationHTML(t) + '</div>'
    + '</div>'
    + '<div>' + defectStatusHTML(st) + '</div>'
    + '<div>' + ownerHTML + '</div>'
    + '<div>' + verHTML + '</div>'
    + '<div>' + caseHTML + '</div>'
    + '<div class="tc-def-upd">' + esc(t.updatedAt ? fmtTs(t.updatedAt) : "—") + '</div>'
    + '</div>';
}
function paintDefectBadge(){
  var show = (rt.reqList || []).length > 0
    && defectBadgeReqId === defectScopeKey() && defectOpenCount > 0;
  var badge = $("tcDefectCount");
  if(badge){
    badge.textContent = defectOpenCount;
    badge.hidden = !show;
  }
  var sub = document.querySelector('#subNav [data-sub-tab="defects"]');
  if(!sub) return;
  var b = sub.querySelector(".tc-tabcount");
  if(!b){
    b = document.createElement("span");
    b.className = "tc-tabcount";
    sub.appendChild(b);
  }
  b.textContent = defectOpenCount;
  b.hidden = !show;
}
function renderDefects(){
  syncDefectFilters();
  syncDefectNewBtn();
  defectOpenCount = defects.filter(defectIsOpen).length;
  defectBadgeReqId = defectScopeKey();
  paintDefectBadge();
  var statsEl = $("tcDefStats"), rowsEl = $("tcDefRows"), footEl = $("tcDefFoot");
  if(!statsEl || !rowsEl || !footEl) return;
  $("tcMeta").textContent = rt.reqList.length
    ? (defectScopeName() + " · 未关闭缺陷收敛在这里，点击行打开工作项")
    : "";
  if(!rt.reqList.length || !defectScopeProjects().length){
    var hasProjects = !!rt.reqList.length;
    statsEl.innerHTML = "";
    rowsEl.innerHTML = UI.emptyState({
      icon: "folder",
      title: hasProjects ? (defReqId ? "当前项目不可用" : "没有可用项目") : "还没有项目",
      text: hasProjects
        ? (defReqId ? "项目可能已被归档或删除，请切换到「全部项目」或其他项目。"
          : "项目都已归档，暂无缺陷可看。")
        : "先在「项目」里创建项目，缺陷按项目收纳。"
    });
    footEl.textContent = "";
    return;
  }
  statsEl.innerHTML = defects.length ? defectStatsHTML() : "";
  var list = filteredDefects();
  if(!list.length){
    var anyFilter = defStatus !== "open" || defSeverity !== "all" || defPriority !== "all"
      || defOwner !== "all" || defVersion !== "all" || defPub !== "all" || defCat !== "all" || defTag !== "all" || !!defSearch;
    rowsEl.innerHTML = UI.emptyState({
      icon: anyFilter ? "filterOff" : "check",
      title: defSearch ? "没有匹配的缺陷" : (anyFilter ? "没有符合条件的缺陷"
        : (defReqId ? "当前项目还没有缺陷" : "这些项目还没有缺陷")),
      text: defSearch ? "换个关键词，或点「恢复默认」再试。" : (anyFilter ? "换个筛选条件，或点「恢复默认」再试。" : "执行失败转缺陷，或用右上角「新建缺陷」录入。")
    });
    footEl.textContent = "共 0 条";
    return;
  }
  var shown = list.slice(0, defectShown);
  var html = shown.map(function(t, i){ return defectRowHTML(t, i + 1); }).join("");
  if(list.length > shown.length){
    html += '<button class="btn tc-load-more" type="button" data-tc-def-more>加载更多（已加载 '
      + shown.length + ' / 共 ' + list.length + ' 条）</button>';
  }
  rowsEl.innerHTML = html;
  var meta = "共 " + list.length + " 条";
  if(defStatus === "open") meta += " · 默认不含已关闭";
  else if(defStatus === "all") meta += " · 含已关闭";
  else meta += " · " + (DEFECT_STATUSES[defStatus] ? DEFECT_STATUSES[defStatus].label : "");
  if(defPriority !== "all") meta += " · 优先级 " + (defPriority === "__none" ? "未设置" : priName(defPriority));
  if(defCat !== "all") meta += " · 模块 " + (defCat === "__none" ? "未指定模块" : defectCatName(defCat));
  if(defTag !== "all") meta += " · 标签 " + (defTag === "__none" ? "无标签" : defTag);
  footEl.textContent = meta;
}
function defectVersionsFor(scopeIds){
  if(defReqId){
    return API.get("/api/versions", { reqId: defReqId }).then(function(rows){
      return (rows || []).map(function(v){
        return { id: v.id, name: v.name || v.id, reqId: defReqId, projectName: defectProjectName(defReqId) };
      });
    }).catch(function(){ return []; });
  }
  return API.get("/api/versions/cross-project").then(function(rows){
    return (rows || []).filter(function(r){ return scopeIds.indexOf(r.reqId) !== -1; })
      .map(function(r){
        return {
          id: r.versionId, name: r.versionName || r.versionId,
          reqId: r.reqId, projectName: r.projectName || defectProjectName(r.reqId)
        };
      });
  }).catch(function(){ return []; });
}
function defectLinksFor(reqIds){
  if(!reqIds.length) return Promise.resolve([]);
  return Promise.all(reqIds.map(function(reqId){
    return API.get("/api/test-cases/linked-bugs", { reqId: reqId }).catch(function(){ return []; });
  })).then(function(pages){
    var all = [];
    pages.forEach(function(page){ all = all.concat(page || []); });
    return all;
  });
}
function applyDefectLinks(links){
  defectLinks = {};
  (links || []).forEach(function(l){
    if(!l || !l.bugTaskId) return;
    (defectLinks[l.bugTaskId] || (defectLinks[l.bugTaskId] = [])).push(l);
  });
}
/**
 * opts.badgeOnly：只在非缺陷页刷新 Tab 角标，不拉关联用例和版本，避免首屏多打两轮请求。
 */
function loadDefects(opts){
  var badgeOnly = !!(opts && opts.badgeOnly);
  var seq = ++defectSeq;
  defectShown = DEFECT_PAGE;
  syncDefectProjectSel();
  var scopeIds = defectScopeReqIds();
  if(!rt.reqList.length || !defectScopeProjects().length){
    defects = [];
    defectLinks = {};
    defectVersions = [];
    defectOpenCount = 0;
    defectBadgeReqId = defectScopeKey();
    if(badgeOnly){
      paintDefectBadge();
      return Promise.resolve(false);
    }
    renderDefects();
    return Promise.resolve(false);
  }
  var key = defectScopeKey();
  if(!badgeOnly){
    $("tcDefRows").innerHTML = UI.skeletonRows(4);
    $("tcDefStats").innerHTML = "";
    $("tcDefFoot").textContent = "";
  }
  var tasksP = API.getAllPages("/api/tasks/list", { types: ["bug"], reqs: scopeIds, sort: "updated" });
  if(badgeOnly){
    return tasksP.then(function(rows){
      if(seq !== defectSeq || defectScopeKey() !== key) return false;
      defects = (rows || []).filter(function(t){ return t && (!t.itemType || t.itemType === "bug"); });
      defectOpenCount = defects.filter(defectIsOpen).length;
      defectBadgeReqId = key;
      paintDefectBadge();
      return true;
    }).catch(function(){ return false; });
  }
  return Promise.all([tasksP, defectVersionsFor(scopeIds)]).then(function(rs){
    if(seq !== defectSeq || defectScopeKey() !== key) return false;
    defects = (rs[0] || []).filter(function(t){ return t && (!t.itemType || t.itemType === "bug"); });
    defectVersions = rs[1] || [];
    /* 只给真的有缺陷的项目拉关联用例；全部项目下避免为无缺陷项目多发请求 */
    var linkIds = scopeIds;
    if(!defReqId){
      var seen = {};
      linkIds = [];
      defects.forEach(function(t){
        if(t.reqId && !seen[t.reqId]){ seen[t.reqId] = 1; linkIds.push(t.reqId); }
      });
    }
    return defectLinksFor(linkIds).then(function(links){
      if(seq !== defectSeq || defectScopeKey() !== key) return false;
      applyDefectLinks(links);
      renderDefects();
      return true;
    });
  }).catch(function(ex){
    if(seq !== defectSeq) return false;
    defects = [];
    defectLinks = {};
    defectVersions = [];
    defectOpenCount = 0;
    defectBadgeReqId = key;
    paintDefectBadge();
    $("tcDefStats").innerHTML = "";
    $("tcDefRows").innerHTML = UI.emptyState({
      icon: "alert", title: "加载失败", text: ex.message || "网络异常，请稍后重试"
    });
    $("tcDefFoot").textContent = "";
    return false;
  });
}
function resetDefectFilters(){
  var scopeChanged = !!defReqId;
  defReqId = "";
  defStatus = "open";
  defSeverity = "all";
  defPriority = "all";
  defOwner = "all";
  defVersion = "all";
  defPub = "all";
  defCat = "all";
  defTag = "all";
  defSearch = "";
  defectShown = DEFECT_PAGE;
  var q = $("tcDefSearch");
  if(q) q.value = "";
  if(scopeChanged) loadDefects(); else renderDefects();
  toast("已恢复默认：全部项目 · 未关闭，其他筛选条件已清空", "fs");
}

/* ---------- 缺陷保存视图（scope=defect：项目 / 状态 / 严重度 / 优先级 / 负责人 / 发现版本 / 搜索） ---------- */

var defViewsMenuEl = $("tcDefViewsMenu");
function defectViewParams(){
  return {
    scope: "defect", reqId: defReqId || "", severity: defSeverity, priority: defPriority,
    status: defStatus, owner: defOwner, version: defVersion, pub: defPub,
    cat: defCat, tag: defTag, q: defSearch || ""
  };
}
function defectViewMeaningful(p){
  return !!(p.reqId || p.severity !== "all" || p.priority !== "all" || p.status !== "open"
    || p.owner !== "all" || p.version !== "all" || p.pub !== "all" || p.cat !== "all" || p.tag !== "all" || p.q);
}
function applyDefectView(v){
  var p;
  try{ p = JSON.parse(v.params || "{}"); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "defect"){
    toast("视图参数不合法，无法应用（可删除后重新保存）", "bad");
    return;
  }
  defReqId = p.reqId && rt.reqList.some(function(r){ return r.id === p.reqId; }) ? p.reqId : "";
  defSeverity = typeof p.severity === "string" && p.severity ? p.severity : "all";
  defPriority = typeof p.priority === "string" && p.priority ? p.priority : "all";
  defStatus = typeof p.status === "string" && p.status ? p.status : "open";
  defOwner = typeof p.owner === "string" && p.owner ? p.owner : "all";
  defVersion = typeof p.version === "string" && p.version ? p.version : "all";
  defPub = p.pub === "published" || p.pub === "unpublished" ? p.pub : "all";
  defCat = typeof p.cat === "string" && p.cat ? p.cat : "all";
  defTag = typeof p.tag === "string" && p.tag ? p.tag : "all";
  defSearch = typeof p.q === "string" ? p.q.toLowerCase() : "";
  var q = $("tcDefSearch");
  if(q) q.value = defSearch;
  defectShown = DEFECT_PAGE;
  syncDefectFilters();
  syncTcDomain();
  loadDefects();
  toast("已应用视图「" + v.name + "」", "fs");
}
function saveDefectView(){
  var p = defectViewParams();
  if(!defectViewMeaningful(p)){ toast("先选择项目或设置筛选条件，再保存视图", "warn"); return; }
  UI.showPrompt({
    title: "保存缺陷视图",
    desc: "保存当前项目范围、状态与筛选条件；同名保存将覆盖原视图",
    label: "视图名称（≤20 字）", maxLength: 20, okText: "保存"
  }).then(function(name){
    if(!name) return;
    var overwrite = savedViewsFor("defect").some(function(v){ return v.name === name; });
    API.post("/api/views", { name: name, params: JSON.stringify(p) }).then(function(){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(renderDefectViewsMenu);
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteDefectView(id){
  UI.showConfirm({ title: "删除视图", msg: "确定删除该缺陷视图？不影响缺陷数据。", okText: "删除视图" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      loadViews().then(renderDefectViewsMenu);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function renderDefectViewsMenu(){
  if(!defViewsMenuEl) return;
  var views = savedViewsFor("defect");
  var html = '<div class="menu-title">缺陷视图</div>';
  if(!views.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的缺陷视图；选定项目或筛选条件后保存。</p></div>';
  }else{
    html += views.map(function(v){
      return '<div class="menu-row">' +
        '<button class="menu-item" type="button" data-tc-def-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
        '<button class="icon-btn sm" type="button" data-tc-def-view-del="' + esc(v.id) + '" aria-label="删除视图" title="删除视图">' + icon("close", 12) + '</button>' +
      '</div>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-tc-def-view-save>保存当前为视图</button></div>';
  defViewsMenuEl.innerHTML = html;
}
function openDefectDrawer(id){
  if(!id) return;
  openTaskById(id);
}

function enterTestCasesView(){
  syncModeUI();
  var run = function(){
    syncReqSel();
    /* 缺陷徽标要在任何模式的首屏都能看到，非缺陷页也并行拉一次；进入缺陷页时下面会再拉最新 */
    if(tcMode !== "defects") loadDefects({ badgeOnly: true });
    if(tcMode === "coverage") loadCoverage();
    else if(tcMode === "report") loadTestReport();
    else if(tcMode === "plans") loadPlans();
    else if(tcMode === "defects") loadDefects();
    else loadCases();
  };
  if(rt.reqsLoaded){ run(); return; }
  $("tcList").innerHTML = UI.skeletonRows(3);
  loadReqs().then(function(){
    if(rt.reqsLoaded){ run(); return; }
    /* 首屏并发：别的调用先占了 seq，本次回调被跳过，reqList 还没填充，再等一轮 */
    loadReqs().then(run);
  });
}

/* ---------- 覆盖矩阵 ---------- */
function loadCoverage(){
  render();
  if(!caseReqId) return;
  var reqId = caseReqId;
  var seq = ++covLoadSeq;
  covExpanded = {};
  covTaskCache = {};
  covCaseIndex = null;
  $("tcCoverage").innerHTML = UI.skeletonRows(4);
  Promise.all([
    API.get("/api/test-cases/coverage", { reqId: reqId }),
    loadAllCases({ reqId: reqId })
  ]).then(function(rs){
    if(seq !== covLoadSeq || tcMode !== "coverage" || caseReqId !== reqId) return;
    coverageRows = rs[0] || [];
    covCaseIndex = buildCoverageCaseIndex((rs[1] && rs[1].items) || []);
    /* 需求详情跳入：自动展开目标需求的工作项覆盖并滚动到该行 */
    var pend = covPendingExpand;
    covPendingExpand = null;
    var pendHit = pend && coverageRows.some(function(r){ return r.demandId === pend; });
    if(pendHit){
      covExpanded[pend] = true;
      loadCoverageTasks(pend);   /* 内部会 renderCoverage 并在取回工作项后再渲染 */
    } else {
      renderCoverage();
    }
    if(pendHit){
      var rowEl = $("tcCoverage").querySelector('[data-cov-demand="' + pend + '"]');
      if(rowEl){ try{ rowEl.scrollIntoView({ block:"center", behavior:"smooth" }); }catch(e){ rowEl.scrollIntoView(); } }
    }
  }).catch(function(ex){
    if(seq !== covLoadSeq || caseReqId !== reqId) return;
    $("tcCoverage").innerHTML = UI.errorState(ex.message || "网络异常");
  });
}
/* 用例索引：按需求与工作项归组，同时区分“需求级覆盖”（未关联工作项） */
function buildCoverageCaseIndex(items){
  var idx = { byId: {}, byDemand: {}, byTask: {} };
  items.forEach(function(c){
    idx.byId[c.id] = c;
    var dk = c.demandId || "__none__";
    var bucket = idx.byDemand[dk];
    if(!bucket){ bucket = { all: [], direct: [] }; idx.byDemand[dk] = bucket; }
    bucket.all.push(c);
    var tasks = c.tasks || [];
    if(!tasks.length) bucket.direct.push(c);
    tasks.forEach(function(t){
      if(!idx.byTask[t.taskId]) idx.byTask[t.taskId] = [];
      idx.byTask[t.taskId].push(c);
    });
  });
  return idx;
}
function covDemandTasks(demandId){
  return covCaseIndex && covCaseIndex.byTask ? covCaseIndex.byTask : {};
}
function covDirectCases(demandId){
  var b = covCaseIndex && covCaseIndex.byDemand[demandId || "__none__"];
  return b ? b.direct : [];
}
function covWorkItemCount(demandId){
  var all = (covCaseIndex && covCaseIndex.byDemand[demandId || "__none__"] || {}).all || [];
  var seen = {};
  all.forEach(function(c){ (c.tasks || []).forEach(function(t){ seen[t.taskId] = true; }); });
  return Object.keys(seen).length;
}
/* 0 值走中性：绿色代表有通过、红色代表有失败，0 两者都不代表 */
function covCountHTML(value, cls){
  var n = Number(value) || 0;
  return '<span class="' + cls + (n ? "" : " is-zero") + '">' + n + '</span>';
}
function covCaseChip(c){
  return '<button class="cov-case-chip" type="button" data-cov-case="' + esc(c.id) + '" title="'
    + esc(c.title) + '">'
    + '<span class="cov-case-no">' + esc(caseNoText(c) || "TC") + '</span>'
    + '<span class="cov-case-title">' + esc(c.title) + '</span>'
    + statusBadgeHTML(c.latestStatus)
    + '</button>';
}
function covTaskChildrenHTML(r){
  var demandId = r.demandId;
  var cached = covTaskCache[demandId];
  if(cached === null){
    return '<div class="cov-children"><p class="cov-child-empty">正在加载工作项覆盖…</p></div>';
  }
  if(cached === "error"){
    return '<div class="cov-children"><p class="cov-child-empty">工作项覆盖加载失败，'
      + '<button class="btn sm ghost" type="button" data-cov-retry="' + esc(demandId) + '">重试</button></p></div>';
  }
  var tasks = cached || [];
  var direct = covDirectCases(demandId);
  var html = '<div class="cov-children">';
  if(!tasks.length && !direct.length){
    html += '<p class="cov-child-empty">该需求下还没有工作项，也没有需求级用例。</p></div>';
    return html;
  }
  tasks.forEach(function(t){
    var cases = (covCaseIndex && covCaseIndex.byTask[t.taskId]) || [];
    var covered = (t.caseTotal || 0) > 0;
    html += '<div class="cov-wi-block">'
      + '<div class="cov-wi-head">'
      +   '<span class="cov-wi-name"><span class="cov-wi-no">' + esc(itemNoText(t) || "WI") + '</span>'
      +     '<span class="cov-wi-title">' + assocLinkHTML("task", t.taskId, t.taskTitle || "未命名工作项") + '</span>'
      +     taskPublicationHTML(t) + '</span>'
      +   '<span class="cov-wi-count">' + (covered
            ? (t.caseTotal || 0) + ' 条用例 · ' + (t.passed || 0) + ' 通过 · ' + (t.failed || 0) + ' 失败'
              + ((t.untested || 0) ? ' · ' + t.untested + ' 未执行' : "")
            : '未覆盖') + '</span>'
      +   '<span class="mini-tag ' + (covered ? "ok" : "over") + '">' + (covered ? "工作项级覆盖" : "未覆盖") + '</span>'
      + '</div>'
      + (cases.length ? '<div class="cov-wi-cases">' + cases.map(covCaseChip).join("") + '</div>' : "")
      + '</div>';
  });
  html += '<div class="cov-wi-block cov-direct-block">'
    + '<div class="cov-wi-head">'
    +   '<span class="cov-wi-name"><span class="cov-wi-no direct">需求级</span>'
    +     '<span class="cov-wi-title">未关联工作项的用例</span></span>'
    +   '<span class="cov-wi-count">' + (direct.length ? direct.length + ' 条用例' : '无') + '</span>'
    +   '<span class="mini-tag ' + (direct.length ? "mute" : "over") + '">'
    +     (direct.length ? "仅需求级覆盖" : (tasks.length ? "需求级已细化到工作项" : "需求级未覆盖")) + '</span>'
    + '</div>'
    + (direct.length ? '<div class="cov-wi-cases">' + direct.map(covCaseChip).join("") + '</div>' : "")
    + '</div></div>';
  return html;
}
function renderCoverage(){
  var box = $("tcCoverage");
  if(!box) return;
  var covered = 0, total = 0;
  coverageRows.forEach(function(r){
    if(r.demandId){ total++; if((r.caseTotal || 0) > 0) covered++; }
  });
  var head = '<div class="cov-summary">已覆盖需求 <b>' + covered + '</b> / ' + total +
    (total ? '（' + Math.round(covered * 100 / total) + '%）' : '') +
    '<span class="cov-note">覆盖率按「该需求至少有一条用例」计算；展开需求可看两种粒度：需求级＝用例只关联需求，工作项级＝用例已细化到具体工作项；0 表示未发生，不代表通过或失败</span></div>';
  if(!coverageRows.length){
    box.innerHTML = head + UI.emptyState({ icon:"checklist", title:"还没有可对照的需求或用例", text:"先录入需求池需求与测试用例，覆盖矩阵会自动汇总。" });
    return;
  }
  var rows = coverageRows.map(function(r){
    var rowTotal = r.caseTotal || 0;
    /* 跳过表示本次不适用，从通过率分母里剔除 */
    var base = Math.max(0, rowTotal - (r.skipped || 0));
    var pct = base ? Math.round((r.passed || 0) * 100 / base) : 0;
    var covTxt = !r.demandId ? "—" : (rowTotal ? "已覆盖" : "未覆盖");
    var covCls = !r.demandId ? "mute" : (rowTotal ? "ok" : "over");
    var linked = !!r.demandId;
    var expanded = linked && !!covExpanded[r.demandId];
    var wiCount = linked ? covWorkItemCount(r.demandId) : 0;
    var name = '<span class="cov-name"><b>' + esc(r.demandTitle || "未命名需求") + '</b>'
      + '<small>' + esc(demandStatusLabel(r.demandStatus))
      + (wiCount ? ' · 已关联 ' + wiCount + ' 项工作项' : '')
      + '</small></span>';
    var toggle = linked
      ? '<button class="cov-toggle" type="button" data-cov-toggle="' + esc(r.demandId) + '"'
        + ' aria-expanded="' + (expanded ? "true" : "false") + '"'
        + ' aria-label="' + (expanded ? "收起" : "展开") + '工作项覆盖">'
        + icon(expanded ? "chevronUp" : "chevronRight", 12) + '</button>'
      : '<span class="cov-toggle space"></span>';
    var row = '<div class="cov-row' + (linked ? " cov-link" : " cov-unlinked") + '"' +
      (linked ? ' role="button" tabindex="0" data-cov-demand="' + esc(r.demandId) + '" title="'
        + (rowTotal ? "查看需求详情" : "该需求还没有用例，点击查看需求详情") + '"' : '') + '>' +
      '<span class="cov-name-cell">' + toggle + name + '</span>' +
      '<span>' + rowTotal + '</span>' +
      covCountHTML(r.passed, "cov-pass") +
      covCountHTML(r.failed, "cov-fail") +
      covCountHTML(r.blocked, "cov-block") +
      covCountHTML(r.skipped, "cov-skip") +
      '<span>' + (r.untested || 0) + '</span>' +
      covCountHTML(r.bugCount, "cov-bug") +
      '<span><i class="cov-bar"><i style="width:' + pct + '%"></i></i>' + pct + '%</span>' +
      '<span class="mini-tag ' + covCls + '">' + covTxt + '</span>' +
    '</div>';
    if(expanded) row += covTaskChildrenHTML(r);
    return row;
  }).join("");
  box.innerHTML = head + '<div class="cov-table">' +
    '<div class="cov-head"><span>需求</span><span>用例</span><span>通过</span><span>失败</span><span>阻塞</span><span title="本次不执行 / 不适用">跳过</span><span>未执行</span><span title="关联缺陷中未删除、未完成的数量">未关闭缺陷</span><span>通过率</span><span>覆盖</span></div>' +
    rows + '</div>';
}

/* ---------- 测试报告 ---------- */

function reqNameOf(id){
  var hit = (rt.reqList || []).filter(function(r){ return r.id === id; })[0];
  return hit ? hit.name : (id || "");
}
function loadAllCases(params){
  var items = [], total = 0;
  function next(){
    var query = Object.assign({}, params, { offset: items.length, limit: 100 });
    return API.get("/api/test-cases", query).then(function(page){
      var rows = (page && page.items) || [];
      total = (page && page.total) || 0;
      items = items.concat(rows);
      return rows.length && items.length < total ? next() : { items: items, total: total };
    });
  }
  return next();
}
function loadTestReport(){
  render();
  var box = $("tcReport");
  if(!caseReqId){
    box.innerHTML = UI.emptyState({ icon:"folder", title:"还没有项目", text:"先在「项目」里创建项目，再生成测试报告。" });
    return;
  }
  var seq = ++reportSeq;
  var reqId = caseReqId;
  box.innerHTML = UI.skeletonRows(4);
  Promise.all([
    API.get("/api/test-cases/stats", { reqId: reqId }),
    loadAllCases({ reqId: reqId, status: "failed" }),
    loadAllCases({ reqId: reqId, status: "blocked" }),
    API.get("/api/test-cases/coverage", { reqId: reqId }),
    API.get("/api/test-cases/run-stats", { reqId: reqId }).catch(function(){ return null; })
  ]).then(function(rs){
    if(seq !== reportSeq || caseReqId !== reqId) return;
    reportData = {
      stats: rs[0] || {},
      failed: (rs[1] && rs[1].items) || [],
      failedTotal: (rs[1] && rs[1].total) || 0,
      blocked: (rs[2] && rs[2].items) || [],
      blockedTotal: (rs[2] && rs[2].total) || 0,
      coverage: rs[3] || [],
      runStats: rs[4] || null,
      generatedAt: new Date()
    };
    renderTestReport();
  }).catch(function(ex){
    if(seq !== reportSeq) return;
    box.innerHTML = UI.errorState(ex.message || "测试报告加载失败");
  });
}
function coverageSummary(rows){
  var total = 0, covered = 0;
  (rows || []).forEach(function(r){
    if(!r.demandId) return;
    total++;
    if((r.caseTotal || 0) > 0) covered++;
  });
  return { total: total, covered: covered, pct: total ? Math.round(covered * 100 / total) : 0 };
}
function caseMetaLine(c){
  var parts = [];
  if(c.module) parts.push(esc(c.module));
  if(c.priority) parts.push(esc(priName(c.priority)));
  if(c.latestBy) parts.push(esc(c.latestBy + (c.latestAt ? " · " + fmtTs(c.latestAt) : "")));
  if(c.demandTitle) parts.push("需求：" + assocLinkHTML("demand", c.demandId, c.demandTitle));
  return parts.join(" · ");
}
function reportCaseRow(c, kind){
  var bug = c.latestBugTaskId
    ? '<button class="btn sm ghost" type="button" data-report-bug="' + esc(c.id) + '" title="打开关联缺陷">缺陷 · ' + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 16)) + '</button>'
    : "";
  var ev = c.latestEvidenceCount
    ? '<button class="btn sm ghost" type="button" data-report-runs="' + esc(c.id) + '" title="查看执行历史与证据">证据 ' + c.latestEvidenceCount + '</button>'
    : '<button class="btn sm ghost" type="button" data-report-runs="' + esc(c.id) + '" title="查看执行历史">记录</button>';
  return '<div class="rep-row ' + kind + '">'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="rep-main"><button class="rep-title" type="button" data-report-case="' + esc(c.id) + '" title="打开用例"><b>'
    + (caseNoText(c) ? '<span class="rep-no">' + esc(caseNoText(c)) + '</span> ' : '')
    + esc(c.title) + '</b></button><small>' + caseMetaLine(c) + '</small>'
    + (c.latestNote ? '<span class="rep-note">' + esc(c.latestNote) + '</span>' : '')
    + '</div>'
    + '<div class="rep-acts">' + bug + ev + '</div>'
    + '</div>';
}
function reportCaseById(id){
  var pools = [reportData && reportData.failed, reportData && reportData.blocked];
  for(var i = 0; i < pools.length; i++){
    var list = pools[i] || [];
    for(var j = 0; j < list.length; j++) if(list[j].id === id) return list[j];
  }
  return null;
}
/* 报告里的用例可能不在当前列表页，按标题回查一次，再按 100 条一页兜底查找 */
function openReportCase(id){
  if(caseById(id)){ openCaseDetail(id); return; }
  if(!caseReqId){ toast("先选择项目再打开用例", "warn"); return; }
  var reqId = caseReqId, meta = reportCaseById(id);
  function openFound(c){
    if(!c) return false;
    if(!caseById(c.id)) cases.push(c);
    openCaseDetail(c.id);
    return true;
  }
  API.get("/api/test-cases", { reqId: reqId, q: (meta && meta.title) || null, limit: 50, offset: 0 }).then(function(page){
    if(caseReqId !== reqId) return;
    var found = ((page && page.items) || []).filter(function(c){ return c.id === id; })[0];
    if(openFound(found)) return;
    return loadAllCases({ reqId: reqId }).then(function(all){
      if(caseReqId !== reqId) return;
      var hit = ((all && all.items) || []).filter(function(c){ return c.id === id; })[0];
      if(!openFound(hit)) toast("用例不存在或无权查看", "warn");
    });
  }).catch(function(ex){ toast(ex.message || "用例加载失败", "warn"); });
}
function runStatsBucketRow(b, dim){
  var rate = Math.round(b.passRate || 0);
  var dist = '<span class="rs-d" title="通过 / 失败 / 阻塞 / 跳过">'
    + '<span><i class="rs-dot ok"></i>' + (b.passed || 0) + '</span>'
    + '<span><i class="rs-dot over"></i>' + (b.failed || 0) + '</span>'
    + '<span><i class="rs-dot warn"></i>' + (b.blocked || 0) + '</span>'
    + '<span><i class="rs-dot mute"></i>' + (b.skipped || 0) + '</span>'
    + '</span>';
  var key = b.key == null ? "" : String(b.key);
  var label = b.label || "";
  return '<div class="rs-row is-drill" role="button" tabindex="0"'
    + ' data-rs-drill="' + esc(dim) + '" data-rs-key="' + esc(key) + '"'
    + ' data-rs-label="' + esc(label) + '" data-rs-total="' + (b.total || 0) + '"'
    + ' title="点击查看「' + esc(label) + '」的 ' + (b.total || 0) + ' 条执行明细">'
    + '<span class="rs-label">' + esc(label || "—") + '</span>'
    + '<span class="rs-total">' + (b.total || 0) + ' 次</span>'
    + '<span class="rs-bar" title="通过率 ' + rate + '%（跳过不计入分母）"><i style="width:' + rate + '%"></i></span>'
    + '<span class="rs-rate">' + rate + '%</span>'
    + dist
    + '</div>';
}
function runStatsCol(title, buckets, dim){
  return '<div class="rs-col"><h4>' + title + '</h4>'
    + (buckets && buckets.length
      ? '<div class="rs-rows">' + buckets.map(function(b){ return runStatsBucketRow(b, dim); }).join("") + '</div>'
      : '<p class="rep-empty">暂无执行记录</p>')
    + '</div>';
}
/* 执行流水聚合：按执行人 / 环境 / 轮次的通过率，补充「最近一轮」概览之外的过程视角；点桶下钻看流水明细 */
function runStatsSection(rs){
  if(!rs || !rs.totalRuns) return "";
  return '<section class="rep-section rep-runstats">'
    + '<div class="rep-section-head"><b>执行统计</b><span>共 ' + rs.totalRuns + ' 次执行 · 按全部执行流水聚合</span></div>'
    + '<div class="rs-grid">'
    + runStatsCol("按执行人", rs.byExecutor, "executor")
    + runStatsCol("按环境", rs.byEnvironment, "environment")
    + runStatsCol("按轮次", rs.byRound, "round")
    + '</div>'
    + '<div class="rs-drill" id="rsDrill" hidden></div>'
    + '<p class="foot-note">通过率 = 通过 / (通过+失败+阻塞)，跳过不计入分母；分布依次为 <i class="rs-dot ok"></i>通过 <i class="rs-dot over"></i>失败 <i class="rs-dot warn"></i>阻塞 <i class="rs-dot mute"></i>跳过。轮次按用例内执行序号分桶；点击任一统计桶可下钻查看执行流水明细。</p>'
    + '</section>';
}
/* ---------- 执行统计下钻：桶内执行流水明细（口径同聚合，全部流水非最近一轮） ---------- */
var runDrillSeq = 0;
var runDrillRows = [];
var runDrillMeta = null;
function drillRoundText(n){
  var k = Number(n) || 0;
  return k <= 1 ? "首次" : "第 " + k + " 轮";
}
function closeRunDrill(){
  runDrillSeq++;
  runDrillRows = [];
  runDrillMeta = null;
  var panel = $("rsDrill");
  if(panel){ panel.hidden = true; panel.innerHTML = ""; }
  var active = document.querySelector(".rs-row.is-active");
  if(active) active.classList.remove("is-active");
}
function openRunDrill(dim, key, label, total, rowEl){
  var panel = $("rsDrill");
  if(!panel || !caseReqId) return;
  if(rowEl && rowEl.classList.contains("is-active")){ closeRunDrill(); return; }
  var prev = document.querySelector(".rs-row.is-active");
  if(prev) prev.classList.remove("is-active");
  if(rowEl) rowEl.classList.add("is-active");
  var dimName = { executor:"按执行人", environment:"按环境", round:"按轮次" }[dim] || dim;
  runDrillMeta = { dim: dim, key: key, label: label, total: total || 0 };
  runDrillRows = [];
  panel.hidden = false;
  panel.innerHTML = '<div class="rs-drill-head"><b>' + esc(dimName) + ' · ' + esc(label || "—") + '</b>'
    + '<span class="rs-drill-count">' + (total || 0) + ' 次执行</span>'
    + '<span class="rs-drill-acts">'
    + '<button class="btn sm ghost" type="button" data-rs-drill-export disabled title="导出当前统计桶的执行流水明细 CSV">导出明细 CSV</button>'
    + '<button class="btn sm ghost" type="button" data-rs-drill-close>返回统计</button>'
    + '</span></div>'
    + '<div class="rs-drill-body">' + UI.skeletonRows(3) + '</div>';
  panel.scrollIntoView({ block:"nearest", behavior:"smooth" });
  var seq = ++runDrillSeq;
  var reqId = caseReqId;
  API.get("/api/test-cases/run-stats/drill", { reqId: reqId, dim: dim, key: key }).then(function(rows){
    if(seq !== runDrillSeq || caseReqId !== reqId) return;
    renderRunDrill(rows || [], total || 0);
  }).catch(function(ex){
    if(seq !== runDrillSeq) return;
    var body = panel.querySelector(".rs-drill-body");
    if(body) body.innerHTML = UI.errorState(ex.message || "执行明细加载失败");
  });
}
function renderRunDrill(rows, total){
  var panel = $("rsDrill");
  if(!panel) return;
  var body = panel.querySelector(".rs-drill-body");
  if(!body) return;
  runDrillRows = rows || [];
  var exportBtn = panel.querySelector("[data-rs-drill-export]");
  if(exportBtn) exportBtn.disabled = !runDrillRows.length;
  if(!rows.length){
    body.innerHTML = '<p class="rep-empty">该统计桶下没有执行流水。</p>';
    return;
  }
  var head = '<tr><th>用例</th><th>结果</th><th>执行人</th><th>环境</th><th>轮次</th><th>执行时间</th><th>备注</th><th>缺陷</th></tr>';
  var trs = rows.map(function(r){
    var no = caseNoText(r);
    var caseBtn = '<button class="rs-drill-case" type="button" data-rs-drill-case="' + esc(r.caseId) + '"'
      + ' data-rs-drill-title="' + esc(r.caseTitle || "") + '" title="查看执行历史与证据">'
      + (no ? '<span class="rs-drill-no">' + esc(no) + '</span>' : '')
      + '<span class="rs-drill-ct">' + esc(r.caseTitle || "（无标题）") + '</span></button>';
    var bug = r.bugTaskId
      ? '<button class="btn sm ghost" type="button" data-rs-drill-bug="' + esc(r.bugTaskId) + '" title="打开关联缺陷">'
        + esc(cut(r.bugTaskTitle || r.bugTaskId, 14)) + '</button>'
      : '<span class="rs-drill-mute">—</span>';
    return '<tr>'
      + '<td class="rs-drill-td-case">' + caseBtn + '</td>'
      + '<td>' + statusBadgeHTML(r.status) + '</td>'
      + '<td>' + (r.executedBy ? esc(r.executedBy) : '<span class="rs-drill-mute">未记录</span>') + '</td>'
      + '<td>' + (r.environment ? '<span class="run-env" title="' + esc(r.environment) + '">' + esc(r.environment) + '</span>' : '<span class="rs-drill-mute">未记录</span>') + '</td>'
      + '<td>' + esc(drillRoundText(r.round)) + '</td>'
      + '<td class="rs-drill-time">' + esc(fmtTs(r.createdAt) || "—") + '</td>'
      + '<td class="rs-drill-note">' + (r.note ? '<span title="' + esc(r.note) + '">' + esc(r.note) + '</span>' : '<span class="rs-drill-mute">—</span>') + '</td>'
      + '<td>' + bug + '</td>'
      + '</tr>';
  }).join("");
  var more = total > rows.length
    ? '<p class="foot-note rs-drill-more">共 ' + total + ' 次执行，按时间倒序展示前 ' + rows.length + ' 条。</p>'
    : "";
  body.innerHTML = '<table class="rs-drill-table"><thead>' + head + '</thead><tbody>' + trs + '</tbody></table>' + more;
}
/* 下钻明细导出：与面板同口径（当前桶全部流水），缺陷列带可点回链 URL */
function exportRunDrillCsv(){
  if(!runDrillMeta || !runDrillRows.length){ toast("暂无可导出的执行明细", "warn"); return; }
  var m = runDrillMeta;
  var dimName = { executor:"按执行人", environment:"按环境", round:"按轮次" }[m.dim] || m.dim;
  var rows = [
    ["执行明细", dimName + " · " + (m.label || "—")],
    ["项目", reqNameOf(caseReqId)],
    ["统计桶执行次数", m.total],
    ["导出条数", runDrillRows.length],
    ["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })],
    [],
    ["用例编号", "用例", "结果", "执行人", "环境", "轮次", "执行时间", "备注", "缺陷编号", "缺陷标题", "缺陷链接"]
  ];
  runDrillRows.forEach(function(r){
    rows.push([
      caseNoText(r) || "",
      r.caseTitle || "",
      STATUS_LABEL[r.status] || r.status || "",
      r.executedBy || "",
      r.environment || "",
      drillRoundText(r.round),
      fmtTs(r.createdAt) || "",
      r.note || "",
      r.bugTaskId || "",
      r.bugTaskTitle || "",
      r.bugTaskId ? taskLink(r.bugTaskId) : ""
    ]);
  });
  var safe = function(s){ return String(s || "").replace(/[\\/:*?"<>|]/g, "-"); };
  downloadCsv("执行明细-" + safe(reqNameOf(caseReqId)) + "-" + safe(dimName) + "-" + safe(m.label) + ".csv", rows);
  toast("已导出执行明细 CSV", "fs");
}
function renderTestReport(){
  var box = $("tcReport");
  if(!box || !reportData) return;
  runDrillSeq++;
  var s = reportData.stats || {};
  var total = s.total || 0;
  /* 通过与通过率都不把跳过算作未通过：分母剔除跳过的用例 */
  var rateBase = Math.max(0, total - (s.skipped || 0));
  var passRate = rateBase ? Math.round((s.passed || 0) * 100 / rateBase) : 0;
  var cov = coverageSummary(reportData.coverage);
  var failed = reportData.failed || [];
  var blocked = reportData.blocked || [];
  var name = reqNameOf(caseReqId);
  var stamp = reportData.generatedAt.toLocaleString("zh-CN", { hour12: false });
  var head = '<div class="rep-head">'
    + '<div><h3>测试报告 · ' + esc(name) + '</h3><p class="foot-note">生成时间 ' + esc(stamp) + ' · 口径：每个用例取最近一轮执行结果</p></div>'
    + '<div class="rep-actions">'
    +   '<button class="btn sm" type="button" data-tc-report-csv>导出 CSV</button>'
    +   '<button class="btn sm" type="button" data-tc-report-doc>导出 Word</button>'
    +   '<button class="btn sm" type="button" data-tc-report-print title="打开打印对话框，在目标里选择「另存为 PDF」">导出 PDF</button>'
    + '</div>'
    + '</div>';
  var tiles = '<div class="rep-tiles">'
    + '<span class="tc-stat"><b>' + total + '</b>用例总数</span>'
    + '<span class="tc-stat' + ((s.passed || 0) > 0 ? " ok" : " mute") + '"><b>' + (s.passed || 0) + '</b>通过 · ' + passRate + '%</span>'
    + '<span class="tc-stat' + ((s.failed || 0) > 0 ? " over" : " mute") + '"><b>' + (s.failed || 0) + '</b>失败</span>'
    + '<span class="tc-stat' + ((s.blocked || 0) > 0 ? " warn" : " mute") + '"><b>' + (s.blocked || 0) + '</b>阻塞</span>'
    + '<span class="tc-stat' + ((s.skipped || 0) > 0 ? "" : " mute") + '" title="本次不执行 / 不适用，不计入通过率"><b>' + (s.skipped || 0) + '</b>跳过</span>'
    + '<span class="tc-stat mute"><b>' + (s.untested || 0) + '</b>未执行</span>'
    + '<span class="tc-stat"><b>' + cov.pct + '%</b>需求覆盖（' + cov.covered + '/' + cov.total + '）</span>'
    + '</div>';
  var failBlock = '<section class="rep-section"><div class="rep-section-head"><b>失败用例</b><span>'
    + (reportData.failedTotal || 0) + ' 条</span></div>'
    + (failed.length
      ? failed.map(function(c){ return reportCaseRow(c, "fail"); }).join("")
      : '<p class="rep-empty">没有失败用例，最近一轮全部通过或未执行。</p>')
    + ((reportData.failedTotal || 0) > failed.length
      ? '<p class="foot-note">部分失败用例加载失败，当前展示 ' + failed.length + ' 条。</p>' : '')
    + '</section>';
  var blockBlock = blocked.length
    ? '<section class="rep-section"><div class="rep-section-head"><b>阻塞用例</b><span>'
      + (reportData.blockedTotal || 0) + ' 条</span></div>'
      + blocked.map(function(c){ return reportCaseRow(c, "block"); }).join("")
      + '</section>'
    : "";
  var covBlock = '';
  if(cov.total){
    covBlock = '<section class="rep-section"><div class="rep-section-head"><b>需求覆盖</b><span>'
      + cov.covered + ' / ' + cov.total + '（' + cov.pct + '%）</span></div>'
      + '<div class="rep-cov">' + reportData.coverage.filter(function(r){ return r.demandId; }).map(function(r){
        var ok = (r.caseTotal || 0) > 0;
        return '<div class="rep-cov-row rep-cov-link" role="button" tabindex="0" data-cov-demand="' + esc(r.demandId) + '" title="查看需求详情"><span>' + esc(r.demandTitle || "未命名需求") + '</span>'
          + '<span>' + (r.caseTotal || 0) + ' 用例 · ' + (r.passed || 0) + ' 通过 · ' + (r.failed || 0) + ' 失败'
          + (r.skipped ? ' · ' + r.skipped + ' 跳过' : '') + '</span>'
          + '<span class="mini-tag ' + (ok ? "ok" : "over") + '">' + (ok ? "已覆盖" : "未覆盖") + '</span></div>';
      }).join("") + '</div>'
      + '<p class="foot-note">0 表示未发生，不代表通过或失败。</p></section>';
  }
  box.innerHTML = head + tiles + runStatsSection(reportData.runStats) + failBlock + blockBlock + covBlock
    + '<p class="foot-note">证据附件在执行历史中随执行记录保存；CSV / Word 直接下载，PDF 走浏览器打印（目标选「另存为 PDF」），均基于当前项目与最近一轮结果。</p>';
}
/* 执行统计三维桶：CSV / Word 导出共用，口径同报告内聚合（全部执行流水，跳过不计入通过率分母） */
function reportStatsDims(){
  var rs = reportData && reportData.runStats;
  if(!rs || !rs.totalRuns) return null;
  var dims = [["按执行人", rs.byExecutor || []], ["按环境", rs.byEnvironment || []], ["按轮次", rs.byRound || []]]
    .filter(function(p){ return p[1].length; });
  return dims.length ? { totalRuns: rs.totalRuns, dims: dims } : null;
}
function reportPlainRows(){
  if(!reportData) return [];
  var s = reportData.stats || {};
  var total = s.total || 0;
  var rateBase = Math.max(0, total - (s.skipped || 0));
  var cov = coverageSummary(reportData.coverage);
  var rows = [
    ["测试报告", reqNameOf(caseReqId)],
    ["生成时间", reportData.generatedAt.toLocaleString("zh-CN", { hour12: false })],
    ["用例总数", total],
    ["通过", s.passed || 0],
    ["失败", s.failed || 0],
    ["阻塞", s.blocked || 0],
    ["跳过", s.skipped || 0],
    ["未执行", s.untested || 0],
    ["通过率", (rateBase ? Math.round((s.passed || 0) * 100 / rateBase) : 0) + "%"],
    ["需求覆盖", cov.covered + "/" + cov.total + "（" + cov.pct + "%）"]
  ];
  var sd = reportStatsDims();
  if(sd){
    rows.push([], ["执行统计", "共 " + sd.totalRuns + " 次执行 · 按全部执行流水聚合（跳过不计入通过率分母）"]);
    sd.dims.forEach(function(pair){
      rows.push([], [pair[0], "次数", "通过", "失败", "阻塞", "跳过", "通过率"]);
      pair[1].forEach(function(b){
        rows.push([b.label || "—", b.total || 0, b.passed || 0, b.failed || 0, b.blocked || 0, b.skipped || 0, Math.round(b.passRate || 0) + "%"]);
      });
    });
  }
  rows.push([], ["失败用例", "编号", "模块", "优先级", "最近执行", "备注", "证据数", "缺陷"]);
  (reportData.failed || []).forEach(function(c){
    rows.push([c.title, caseNoText(c), c.module || "", c.priority || "", (c.latestBy || "") + (c.latestAt ? " " + fmtTs(c.latestAt) : ""),
      c.latestNote || "", c.latestEvidenceCount || 0, c.latestBugTaskTitle || c.latestBugTaskId || ""]);
  });
  return rows;
}
function exportTestReport(){
  if(!reportData){ toast("报告还没有加载完成", "warn"); return; }
  downloadCsv("测试报告-" + reqNameOf(caseReqId) + ".csv", reportPlainRows());
  toast("已导出测试报告 CSV", "fs");
}
/* Word 导出：Word 兼容 HTML 用表格排版（flex 在 Word 里不生效），.doc 可直接打开并另存为 .docx */
function exportTestReportDoc(){
  if(!reportData){ toast("报告还没有加载完成", "warn"); return; }
  var s = reportData.stats || {};
  var total = s.total || 0;
  var cov = coverageSummary(reportData.coverage);
  var name = reqNameOf(caseReqId);
  var stamp = reportData.generatedAt.toLocaleString("zh-CN", { hour12: false });
  var rateBase = Math.max(0, total - (s.skipped || 0));
  var passRate = rateBase ? Math.round((s.passed || 0) * 100 / rateBase) : 0;
  function cell(tag, v){ return '<' + tag + '>' + esc(v == null ? "" : String(v)) + '</' + tag + '>'; }
  function td(v){ return cell("td", v); }
  function th(v){ return cell("th", v); }
  var html = '<!doctype html><html lang="zh-CN" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head>'
    + '<meta charset="utf-8"><title>测试报告 · ' + esc(name) + '</title><style>'
    + '@page{size:A4;margin:1.8cm 1.6cm;}'
    + 'body{font:10.5pt/1.5 "Microsoft YaHei","PingFang SC",sans-serif;color:#101828;}'
    + 'h3{font-size:16pt;margin:0 0 3pt;}p{margin:0 0 6pt;}'
    + 'table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:9.5pt;}'
    + 'th,td{border:1px solid #D0D5DD;padding:4pt 5pt;vertical-align:top;text-align:left;}'
    + 'th{background:#F2F4F7;font-weight:600;}'
    + '.meta{color:#667085;font-size:9pt;}'
    + '</style></head><body>'
    + '<h3>测试报告 · ' + esc(name) + '</h3>'
    + '<p class="meta">生成时间 ' + esc(stamp) + ' · 口径：每个用例取最近一轮执行结果</p>'
    + '<table>'
    + '<tr>' + th("用例总数") + td(total) + th("通过") + td(s.passed || 0) + th("失败") + td(s.failed || 0) + '</tr>'
    + '<tr>' + th("阻塞") + td(s.blocked || 0) + th("跳过") + td(s.skipped || 0) + th("未执行") + td(s.untested || 0) + '</tr>'
    + '<tr>' + th("通过率") + td(passRate + "%") + th("需求覆盖") + td(cov.covered + "/" + cov.total + "（" + cov.pct + "%）") + th("报告范围") + td("当前项目") + '</tr>'
    + '</table>';
  var sd = reportStatsDims();
  if(sd){
    html += '<p><b>执行统计 · 共 ' + sd.totalRuns + ' 次执行</b></p>'
      + '<p class="meta">按全部执行流水聚合；通过率 = 通过 /（通过+失败+阻塞），跳过不计入分母；轮次按用例内执行序号分桶。</p>';
    sd.dims.forEach(function(pair){
      html += '<p><b>' + esc(pair[0]) + '</b></p><table>'
        + '<tr>' + th("分组") + th("次数") + th("通过") + th("失败") + th("阻塞") + th("跳过") + th("通过率") + '</tr>'
        + pair[1].map(function(b){
          return '<tr>' + td(b.label || "—") + td(b.total || 0) + td(b.passed || 0) + td(b.failed || 0)
            + td(b.blocked || 0) + td(b.skipped || 0) + td(Math.round(b.passRate || 0) + "%") + '</tr>';
        }).join("")
        + '</table>';
    });
  }
  var caseHead = '<tr>' + th("结果") + th("编号") + th("用例") + th("模块") + th("优先级") + th("最近执行") + th("备注") + th("证据") + th("缺陷") + '</tr>';
  function caseRows(list){
    return list.map(function(c){
      return '<tr>'
        + td(c.latestStatus ? (STATUS_LABEL[c.latestStatus] || c.latestStatus) : "未执行")
        + td(caseNoText(c))
        + td(c.title || "（无标题）")
        + td(c.module || "")
        + td(c.priority ? priName(c.priority) : "")
        + td((c.latestBy || "") + (c.latestAt ? " " + fmtTs(c.latestAt) : ""))
        + td(c.latestNote || "")
        + td(c.latestEvidenceCount || 0)
        + td(c.latestBugTaskTitle || c.latestBugTaskId || "")
        + '</tr>';
    }).join("");
  }
  var failed = reportData.failed || [];
  var blocked = reportData.blocked || [];
  if(failed.length){
    html += '<p><b>失败用例 · ' + (reportData.failedTotal || 0) + ' 条</b></p><table>' + caseHead + caseRows(failed) + '</table>';
    if((reportData.failedTotal || 0) > failed.length){
      html += '<p class="meta">部分失败用例加载失败，当前导出 ' + failed.length + ' 条。</p>';
    }
  }else{
    html += '<p><b>失败用例</b></p><p>没有失败用例，最近一轮全部通过或未执行。</p>';
  }
  if(blocked.length){
    html += '<p><b>阻塞用例 · ' + (reportData.blockedTotal || 0) + ' 条</b></p><table>' + caseHead + caseRows(blocked) + '</table>';
    if((reportData.blockedTotal || 0) > blocked.length){
      html += '<p class="meta">部分阻塞用例加载失败，当前导出 ' + blocked.length + ' 条。</p>';
    }
  }
  var covRows = (reportData.coverage || []).filter(function(r){ return r.demandId; });
  if(covRows.length){
    html += '<p><b>需求覆盖 · ' + cov.covered + ' / ' + cov.total + '（' + cov.pct + '%）</b></p><table>'
      + '<tr>' + th("需求") + th("用例数") + th("通过") + th("失败") + th("跳过") + th("覆盖") + '</tr>'
      + covRows.map(function(r){
        return '<tr>' + td(r.demandTitle || "未命名需求") + td(r.caseTotal || 0) + td(r.passed || 0) + td(r.failed || 0) + td(r.skipped || 0)
          + td((r.caseTotal || 0) > 0 ? "已覆盖" : "未覆盖") + '</tr>';
      }).join("")
      + '</table>';
  }
  html += '<p class="meta">报告基于当前项目与最近一轮执行结果；证据附件保存在各用例的执行历史中。</p></body></html>';
  triggerDownload("测试报告-" + name + ".doc", "\ufeff" + html, "application/msword;charset=utf-8");
  toast("已导出测试报告 Word", "fs");
}
function printTestReport(){
  if(!reportData){ toast("报告还没有加载完成", "warn"); return; }
  var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试报告 · '
    + esc(reqNameOf(caseReqId)) + '</title><style>'
    + 'body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#101828;padding:28px;}'
    + 'h3{margin:0 0 4px;font-size:20px;}.rep-actions,.foot-note,.rep-acts,.rs-drill{display:none!important;}'
    + '.rep-tiles{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;}.tc-stat{border:1px solid #E4E7EC;border-radius:6px;padding:6px 10px;font-size:12px;color:#475467;}'
    + '.tc-stat b{font-size:16px;margin-right:6px;color:#101828;}.tc-stat.ok b{color:#12B76A;}.tc-stat.over b{color:#D92D20;}.tc-stat.warn b{color:#F79009;}'
    + '.rep-section{margin-top:18px;border:1px solid #E4E7EC;border-radius:8px;padding:12px 14px;break-inside:avoid;}'
    + '.rep-section-head{display:flex;justify-content:space-between;border-bottom:1px solid #E4E7EC;padding-bottom:8px;margin-bottom:8px;}'
    + '.rep-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #F2F4F7;}.rep-row:last-child{border-bottom:0;}'
    + '.rep-main{flex:1;min-width:0;}.rep-main b{display:block;font-size:13px;}.rep-main small{display:block;color:#667085;font-size:11.5px;}'
    + '.rep-note{display:block;margin-top:3px;color:#475467;font-size:12px;}.rep-acts{font-size:11px;color:#667085;white-space:nowrap;}'
    + '.mini-tag{border:1px solid #E4E7EC;border-radius:999px;padding:1px 7px;font-size:11px;}.mini-tag.ok{color:#027A48;border-color:#A6F4C5;}.mini-tag.over{color:#B42318;border-color:#FECDCA;}.mini-tag.warn{color:#B54708;border-color:#FEDF89;}'
    + '.rep-empty{color:#667085;font-size:12.5px;}.rep-cov-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F2F4F7;font-size:12.5px;}'
    + '.rep-cov-row span:first-child{flex:1;min-width:0;}.rep-cov-row span:nth-child(2){color:#667085;white-space:nowrap;}'
    + '.rep-runstats .rs-grid{display:block;margin-top:8px;}.rs-col{margin-bottom:10px;break-inside:avoid;}.rs-col h4{margin:0 0 5px;font-size:13px;color:#101828;}'
    + '.rs-rows{display:block;}.rs-row{display:block;padding:5px 0;border-bottom:1px solid #F2F4F7;font-size:12px;}'
    + '.rs-label{font-weight:600;color:#101828;margin-right:8px;}.rs-total{color:#667085;margin-right:8px;}'
    + '.rs-bar{display:inline-block;width:90px;height:6px;border-radius:3px;background:#EAECF0;overflow:hidden;vertical-align:middle;margin-right:6px;}.rs-bar i{display:block;height:100%;background:#12B76A;}'
    + '.rs-rate{color:#027A48;font-weight:600;margin-right:8px;}.rs-d{display:inline-flex;gap:8px;color:#475467;font-size:11px;}.rs-d span{display:inline-flex;align-items:center;}'
    + '.rs-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:3px;}.rs-dot.ok{background:#12B76A;}.rs-dot.over{background:#D92D20;}.rs-dot.warn{background:#F79009;}.rs-dot.mute{background:#98A2B3;}'
    + '</style></head><body><h3>测试报告 · ' + esc(reqNameOf(caseReqId)) + '</h3>'
    + '<p style="color:#667085;font-size:12px;margin:0 0 4px">生成时间 ' + esc(reportData.generatedAt.toLocaleString("zh-CN", { hour12: false })) + ' · 口径：最近一轮执行结果</p>'
    + ($("tcReport").querySelector(".rep-tiles") ? $("tcReport").querySelector(".rep-tiles").outerHTML : "")
    + Array.prototype.map.call($("tcReport").querySelectorAll(".rep-section"), function(el){ return el.outerHTML; }).join("")
    + '</body></html>';
  var frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  var doc = frame.contentDocument || frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(function(){
    try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ /* 打印被拦截时保持静默 */ }
    setTimeout(function(){ frame.remove(); }, 1500);
  }, 120);
}

/* ---------- 执行历史与证据 ---------- */

function attUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/download" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function attThumbUrl(id){
  return API.url("/api/attachments/" + encodeURIComponent(id) + "/thumb" +
    (window.CURRENT_WORKSPACE ? ("?workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE)) : ""));
}
function fmtSize(n){
  if(!n && n !== 0) return "";
  if(n < 1024) return n + " B";
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function evidenceHTML(a, writable){
  var isImg = a.contentType && a.contentType.indexOf("image/") === 0;
  var canOpen = previewable(a.filename) || /\.(xlsx|xls)$/i.test(a.filename || "");
  var openKey = canOpen ? ' data-run-att-open="' + esc(a.id) + '"' : "";
  var anchorTitle = esc(a.filename) + (canOpen ? " · 在线预览" : " · 下载");
  var acts = '<span class="run-ev-acts">'
    + '<button class="icon-btn sm" type="button" data-run-att-download="' + esc(a.id) + '" title="下载证据" aria-label="下载证据">' + icon("download", 13) + '</button>'
    + (writable
      ? '<button class="icon-btn sm danger" type="button" data-run-att-del="' + esc(a.id) + '" title="删除证据" aria-label="删除证据">' + icon("trash", 13) + '</button>'
      : "")
    + '</span>';
  return '<span class="run-ev' + (isImg ? " is-img" : "") + '">'
    + (isImg
      ? '<a href="' + attUrl(a.id) + '" target="_blank" rel="noopener" title="' + anchorTitle + '"' + openKey + '><img src="' + attThumbUrl(a.id) + '" alt="" loading="lazy" /></a>'
      : '<a class="run-ev-file" href="' + attUrl(a.id) + '" target="_blank" rel="noopener" title="' + anchorTitle + '"' + openKey + '>' + icon("clip", 13) + '<span>' + esc(cut(a.filename, 12)) + '</span></a>')
    + acts + '</span>';
}
/* 证据附件按 id 找回对象：预览/表格弹层都需要文件名与大小 */
function findRunAtt(attId){
  for(var i = 0; i < runsList.length; i++){
    var files = (runsList[i] && runsList[i].attachments) || [];
    for(var j = 0; j < files.length; j++){
      if(files[j].id === attId) return files[j];
    }
  }
  return null;
}
/* ---------- 实体变更记录（audit_log → 时间线） ---------- */

var caseTimelineSeq = 0;

function timelineRowsHTML(rows, emptyText){
  if(!rows || !rows.length) return '<p class="tl-empty">' + esc(emptyText) + '</p>';
  return rows.map(function(r){
    var fail = r.result === "fail" ? '<span class="entity-log-fail">失败</span>' : "";
    var actor = r.actorName ? '<b>' + esc(r.actorName) + '</b> · ' : "";
    var txt = r.detail || r.actionLabel || r.action || "";
    return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(r.createdAt) || "—") + '</span>'
      + '<span class="tl-detail">' + fail + actor + esc(txt) + '</span></div>';
  }).join("");
}

function resetCaseTimeline(){
  caseTimelineSeq++;
  var box = $("caseTimeline");
  if(!box) return;
  box.hidden = true;
  box.open = false;
  box.ontoggle = null;
  var list = $("caseTimelineList");
  if(list){ list.innerHTML = ""; list.removeAttribute("data-loaded"); }
  $("caseTimelineCount").textContent = "";
}

/* 展开时才拉取：只为正在查看的那条用例发请求 */
function bindCaseTimeline(id){
  var box = $("caseTimeline");
  if(!box) return;
  resetCaseTimeline();
  box.hidden = false;
  var seq = caseTimelineSeq;
  box.ontoggle = function(){
    if(!box.open || $("caseTimelineList").getAttribute("data-loaded") === "1") return;
    loadCaseTimeline(id, seq);
  };
}

function loadCaseTimeline(id, seq){
  var list = $("caseTimelineList");
  var cnt = $("caseTimelineCount");
  list.innerHTML = '<p class="tl-empty">加载中…</p>';
  API.get("/api/test-cases/" + encodeURIComponent(id) + "/timeline").then(function(rows){
    if(seq !== caseTimelineSeq) return;
    list.setAttribute("data-loaded", "1");
    var items = rows || [];
    cnt.textContent = items.length ? String(items.length) : "";
    list.innerHTML = timelineRowsHTML(items, "暂无变更记录；新建与编辑都会记录在这里。");
  }).catch(function(ex){
    if(seq !== caseTimelineSeq) return;
    list.innerHTML = '<p class="tl-empty">变更记录加载失败：' + esc(ex.message || "网络异常") + '</p>';
  });
}


function openRunsDialog(id, title){
  var c = caseById(id);
  runsCaseId = id;
  runsCaseTitle = title || (c ? c.title : "");
  runsList = [];
  $("runsTitle").textContent = "执行历史 · " + cut(runsCaseTitle, 18);
  var no = caseNoText(c);
  $("runsSub").textContent = (no ? no + " · " : "") + "最近在前；失败证据随执行记录保存。";
  $("runsList").innerHTML = UI.skeletonRows(3);
  $("runsReadonlyHint").hidden = caseWritable(c);
  var seq = ++runsSeq;
  UI.openModal($("dlgCaseRuns"));
  API.getAllPages("/api/test-cases/" + encodeURIComponent(id) + "/runs").then(function(list){
    if(seq !== runsSeq) return;
    runsList = list || [];
    renderRuns();
  }).catch(function(ex){
    if(seq === runsSeq) $("runsList").innerHTML = UI.errorState(ex.message || "执行历史加载失败");
  });
}
function renderRuns(){
  var box = $("runsList");
  if(!box) return;
  if(!runsList.length){
    box.innerHTML = '<p class="rep-empty">还没有执行记录；点用例上的「执行」记录第一次结果。</p>';
    return;
  }
  var writable = caseWritable(caseById(runsCaseId));
  box.innerHTML = runsList.map(function(r){
    var atts = r.attachments || [];
    var ev = atts.length
      ? '<div class="run-evs">' + atts.map(function(a){ return evidenceHTML(a, writable); }).join("") + '</div>'
      : "";
    var upload = writable
      ? '<label class="btn sm add run-ev-add" title="上传失败证据：可多选，也可直接拖文件到本行">' + icon("plus", 12) + ' 证据'
        + '<input type="file" hidden multiple data-run-file="' + esc(r.id) + '" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx" /></label>'
      : "";
    var bug = r.bugTaskId
      ? '<button class="btn sm ghost" type="button" data-run-bug="' + esc(r.bugTaskId) + '">缺陷工作项</button>'
      : "";
    var env = r.environment
      ? '<span class="run-env" title="执行环境：' + esc(r.environment) + '">' + esc(cut(r.environment, 26)) + '</span>'
      : "";
    return '<div class="run-item' + (writable ? " can-drop" : "") + '" data-run-id="' + esc(r.id) + '">'
      + '<div class="run-top">' + statusBadgeHTML(r.status)
      +   '<span class="run-by">' + esc(r.executedBy || "—") + '</span>'
      +   '<span class="run-at">' + esc(fmtTs(r.createdAt) || "—") + '</span>'
      +   env
      +   '<span class="run-acts">' + bug + upload + '</span>'
      + '</div>'
      + (r.note ? '<p class="run-note">' + esc(r.note) + '</p>' : '')
      + ev
      + '</div>';
  }).join("");
  /* 每行都是一个拖拽补传区：截图直接拖到对应轮次，不用先点按钮 */
  if(writable){
    box.querySelectorAll(".run-item[data-run-id]").forEach(function(item){
      bindFileDrop(item, function(files){
        if(runsCaseId) uploadRunEvidence(runsCaseId, item.dataset.runId, files);
      });
    });
  }
}
function uploadRunEvidence(caseId, runId, files){
  var res = validateFiles(files, 0);
  reportRejected(res.rejected);
  if(!res.ok.length) return;
  var path = "/api/test-cases/" + encodeURIComponent(caseId) + "/runs/" + encodeURIComponent(runId) + "/attachments";
  var done = 0, failed = 0;
  var chain = Promise.resolve();
  res.ok.forEach(function(f){
    chain = chain.then(function(){
      return uploadAttachment(path, f).then(function(){ done++; }, function(){ failed++; });
    });
  });
  chain.then(function(){
    toast(failed ? "证据上传：成功 " + done + " 个，失败 " + failed + " 个" : "已上传 " + done + " 个证据", failed ? "warn" : "fs");
    openRunsDialog(caseId, runsCaseTitle);
    loadCases();
  });
}

/* ---------- 渲染 ---------- */

function render(){
  syncModeUI();
  if(tcMode === "defects"){
    renderDefects();
    return;
  }
  renderStats();
  if(tcMode === "plans"){
    $("tcCasesWrap").hidden = true;
    $("tcCoverage").hidden = true;
    $("tcReport").hidden = true;
    $("tcPlans").hidden = false;
    $("tcStats").innerHTML = "";
    $("tcMeta").textContent = caseScopeAll
      ? "全部项目 · 按项目分组"
      : (caseReqId ? "圈选 → 批量执行 → 完成留痕" : "");
    return;
  }
  if(tcMode === "coverage"){
    $("tcCasesWrap").hidden = true;
    $("tcCoverage").hidden = false;
    $("tcReport").hidden = true;
    $("tcPlans").hidden = true;
    $("tcMeta").textContent = caseReqId ? "需求 × 用例 × 缺陷" : "";
    return;
  }
  if(tcMode === "report"){
    $("tcCasesWrap").hidden = true;
    $("tcCoverage").hidden = true;
    $("tcReport").hidden = false;
    $("tcPlans").hidden = true;
    $("tcMeta").textContent = caseReqId ? "最近一轮执行结果汇总" : "";
    return;
  }
  $("tcCasesWrap").hidden = false;
  $("tcCoverage").hidden = true;
  $("tcReport").hidden = true;
  $("tcPlans").hidden = true;
  $("tcDefects").hidden = true;
  $("tcStats").hidden = caseScopeAll;
  syncQueryBar();
  syncCaseBars();
  syncSidePanel();
  renderSetDetail();
  syncBulkBar();
  syncFilterOptions();
  var anyFilter = caseFilterCount() > 0;
  if(caseScopeAll){
    var projects = caseScopeVisibleProjects();
    var metaAll = "全部项目 · " + projects.length + " 个项目";
    if(anyFilter) metaAll += " · 筛选出 " + caseTotal + " 条";
    else metaAll += " · 共 " + caseTotal + " 条";
    if(cases.length < caseTotal) metaAll += " · 已加载 " + cases.length + " 条";
    $("tcMeta").textContent = metaAll;
    if(!caseGroups.length){
      $("tcList").innerHTML = UI.emptyState({
        icon: "folder", title: "没有可用项目",
        text: "项目都已归档，暂无用例可看。"
      });
      return;
    }
    /* 空项目不占版面：全部项目下只列有内容或加载失败的项目，避免一屏都是空标题 */
    var visibleGroups = caseGroups.filter(function(g){ return g.items.length || g.error; });
    if(!visibleGroups.length){
      $("tcList").innerHTML = UI.emptyState({
        icon: anyFilter ? "filterOff" : "checklist",
        title: searchText ? "没有匹配的用例" : (anyFilter ? "没有符合条件的用例" : "全部项目下还没有测试用例"),
        text: searchText ? "换个关键词，或点「清空筛选」再试。" : (anyFilter ? "换个筛选条件，或点「清空筛选」再试。"
          : (caseCreateTargets().length
            ? "点右上角「新建用例」，选择目标项目后录入第一条。"
            : "当前没有可写的项目；获得写权限后即可新建用例。"))
      });
      return;
    }
    $("tcList").innerHTML = visibleGroups.map(caseGroupHTML).join("");
    return;
  }
  /* 计数只留一处：工具条「显示 X / 共 Y」；chips 条不再重复总数 */
  var metaText = "";
  var statTotal = stats ? (Number(stats.total) || 0) : 0;
  if(statTotal) metaText = anyFilter ? ("显示 " + caseTotal + " / 共 " + statTotal) : ("共 " + statTotal + " 条用例");
  if(cases.length < caseTotal) metaText += (metaText ? " · " : "") + "已加载 " + cases.length + " 条";
  if(caseGroupBy) metaText += (metaText ? " · " : "") + "按" + groupDimLabel() + "分组";
  /* 点左栏分组是静默筛选：在这行写明筛的是哪个分组，别人看截图也知道范围从哪来 */
  if(!caseScopeAll && setFilter !== "all" && caseGroupBy !== "set"){
    var fs = setFilter === "__none" ? null : setById(setFilter);
    metaText += (metaText ? " · " : "") + (setFilter === "__none"
      ? "未加入任何分组"
      : "只看分组「" + (fs ? cut(fs.name, 16) : "已删除的分组") + "」");
  }
  $("tcMeta").textContent = metaText;
  if(caseGroupBy){ renderGrouped(anyFilter); return; }
  var rows = cases;
  if(!rows.length){
    $("tcList").innerHTML = UI.emptyState({
      icon: anyFilter ? "filterOff" : "checklist",
      title: searchText ? "没有匹配的用例" : (anyFilter ? "没有符合条件的用例" : "还没有测试用例"),
      text: searchText ? "换个关键词，或点「清空筛选」再试。" : (anyFilter ? "换个筛选条件，或点「清空筛选」再试。" : "点右上角「新建用例」录入第一条，或用「导入」从 Excel / CSV 批量导入（导入菜单里可下载模板）。")
    });
    return;
  }
  var html = rows.map(function(c){ return caseRowHTML(c); }).join("");
  if(caseHasMore){
    html += '<button class="btn tc-load-more" type="button" data-tc-more>加载更多（已加载 '
      + cases.length + ' / 共 ' + caseTotal + ' 条）</button>';
  }
  $("tcList").innerHTML = html;
}
function groupDimLabel(){
  for(var i = 0; i < CASE_GROUP_DIMS.length; i++){
    if(CASE_GROUP_DIMS[i][0] === caseGroupBy) return CASE_GROUP_DIMS[i][1];
  }
  return "分组";
}
/* 拖拽语义随维度变化：目录是单归属（移动），用例集是多归属（加入），不能混用同一手势而不提示 */
function segmentDragHint(){
  if(caseGroupBy === "module") return "拖入段头 = 移动归属（单归属，原目录移出）";
  if(caseGroupBy === "set") return "拖入段头 = 加入分组（多归属，原分组保留）";
  if(caseGroupBy === "priority") return "拖入段头 = 改优先级";
  return "";
}
function syncDropBanner(){
  var el = $("tcDropBanner");
  if(!el) return;
  if(tcMode !== "cases" || caseScopeAll){ el.hidden = true; el.innerHTML = ""; return; }
  if(caseDrag){
    el.hidden = false;
    el.className = "tc-drop-banner live";
    el.innerHTML = icon("move", 13) + '<span>正在拖动 <b>' + caseDrag.count + '</b> 条用例'
      + (caseDrag.target
        ? '　放到「<b>' + esc(caseDrag.target) + '</b>」= ' + esc(caseDrag.action)
        : '　放到左侧目录节点或分组段头上完成归类') + '</span>';
    return;
  }
  if(caseOrderDrag){
    el.hidden = false;
    el.className = "tc-drop-banner live";
    el.innerHTML = icon("move", 13) + '<span>正在调整用例顺序'
      + (caseOrderDrag.target
        ? '　' + esc(caseOrderDrag.action) + '「<b>' + esc(caseOrderDrag.target) + '</b>」'
        : '　拖到目标行上：上/下半边决定插到它前面还是后面') + '</span>';
    return;
  }
  if(caseSetDrag){
    el.hidden = false;
    el.className = "tc-drop-banner live";
    el.innerHTML = icon("layers", 13) + '<span>正在拖动分组「<b>' + esc(caseSetDrag.name) + '</b>」'
      + (caseSetDrag.target
        ? '　' + esc(caseSetDrag.action) + '「<b>' + esc(caseSetDrag.target) + '</b>」'
        : '　放到别的分组上：中间＝成为子分组（继承可见范围），上/下边缘＝同级排序') + '</span>';
    return;
  }
  if(caseDirDrag){
    el.hidden = false;
    el.className = "tc-drop-banner live";
    el.innerHTML = icon("folder", 13) + '<span>正在拖动目录「<b>' + esc(caseDirDrag.name) + '</b>」'
      + (caseDirDrag.target
        ? '　' + esc(caseDirDrag.action) + '「<b>' + esc(caseDirDrag.target) + '</b>」'
        : '　放到别的目录上：中间＝成为子目录，上/下边缘＝同级排序') + '</span>';
    return;
  }
  var hint = caseGroupBy ? segmentDragHint() : "";
  if(!hint){ el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.className = "tc-drop-banner";
  el.innerHTML = icon("alert", 13) + '<span>当前分组维度：<b>' + esc(groupDimLabel()) + '</b>　' + esc(hint) + '</span>';
}
/* 分组段：段头带计数与结果分布，可折叠、可段内翻页、可整组全选；零用例的段保留，便于发现覆盖缺口 */
function renderGrouped(anyFilter){
  syncDropBanner();
  if(!caseGroupSegs.length){
    $("tcList").innerHTML = UI.emptyState({
      icon: anyFilter ? "filterOff" : "checklist",
      title: anyFilter ? "没有符合条件的用例" : "还没有可分组的内容",
      text: caseGroupBy === "set"
        ? "先在左侧「分组」里建一个分组并把用例加进去，再按分组查看。"
        : (anyFilter ? "换个筛选条件，或点「清空筛选」再试。" : "点右上角「新建用例」录入第一条。")
    });
    return;
  }
  $("tcList").innerHTML = caseGroupSegs.map(caseSegmentHTML).join("");
}
function segmentBarHTML(s){
  var t = s.total || 1;
  function seg(n, color){
    return n ? '<i style="width:' + (n / t * 100).toFixed(1) + '%;background:' + color + '"></i>' : "";
  }
  return '<span class="tc-seg-bar" aria-hidden="true">'
    + seg(s.passed, "var(--success)") + seg(s.failed, "var(--danger)")
    + seg(s.blocked, "var(--warning)") + seg(s.skipped, "var(--text-3)")
    + seg(s.untested, "var(--border-strong)") + '</span>'
    + '<span class="tc-seg-legend">' + s.passed + ' 通过 / ' + s.failed + ' 失败 / ' + s.untested + ' 未执行</span>';
}
function caseSegmentHTML(s){
  var open = !caseGroupCollapsed[s.key];
  var rows = caseGroupRows[s.key] || [];
  var more = caseGroupMore[s.key] || {};
  var shown = Math.min(caseGroupShown[s.key] || 0, rows.length);
  var hint = segmentDragHint();
  var selOn = caseSelAll && caseSelScope && caseSelScope.key === s.key;
  var count = rows.length && rows.length < s.total ? (shown + " / " + s.total) : String(s.total);
  var head = '<div class="tc-seg-head" data-tc-seg="' + esc(s.key) + '">'
    + '<button class="tc-seg-toggle" type="button" data-tc-seg-toggle="' + esc(s.key) + '"'
    + ' aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + (open ? "折叠分组" : "展开分组") + '">'
    + icon("chevronRight", 13) + '</button>'
    + '<span class="tc-seg-name" title="' + esc(s.label) + '">' + esc(s.label)
    + '<span class="tc-seg-count">' + count + ' 条</span></span>'
    + (s.total ? segmentBarHTML(s) : "")
    + '<span class="tc-seg-grow"></span>'
    + (hint && s.total ? '<span class="tc-seg-hint">' + icon("move", 11) + esc(hint) + '</span>' : "")
    + (s.total
      ? '<button class="btn sm ghost' + (selOn ? " soft" : "") + '" type="button" data-tc-seg-sel="' + esc(s.key) + '"'
        + ' title="选中本组全部 ' + s.total + ' 条（含未加载的行）">' + (selOn ? "取消全选本组" : "全选本组") + '</button>'
      : "")
    + '</div>';
  var body = "";
  if(open){
    var inner;
    if(more.error){
      inner = '<p class="tc-group-empty">本组加载失败：' + esc(more.error)
        + ' <button class="btn sm ghost" type="button" data-tc-seg-retry="' + esc(s.key) + '">重试</button></p>';
    }else if(!s.total){
      inner = '<p class="tc-group-empty">该分组下没有筛选范围内的用例</p>';
    }else if(!rows.length){
      inner = more.loading ? UI.skeletonRows(2) : '<p class="tc-group-empty">展开后加载本组用例</p>';
    }else{
      inner = rows.slice(0, shown).map(function(c){ return caseRowHTML(c, s.key); }).join("");
      if(shown < rows.length || more.hasMore){
        inner += '<button class="btn tc-load-more" type="button" data-tc-seg-more="' + esc(s.key) + '"'
          + (more.loading ? " disabled" : "") + '>'
          + (more.loading ? "加载中…" : "段内加载更多（已显示 " + shown + " / 共 " + s.total + " 条）") + '</button>';
      }
    }
    body = '<div class="tc-seg-body">' + inner + '</div>';
  }
  return '<section class="tc-seg' + (s.total ? "" : " is-empty") + '" data-tc-seg-drop="' + esc(s.key) + '">'
    + head + body + '</section>';
}
/* 全部项目：每个项目一段，段内沿用单项目的卡片与操作；分页、加载失败都按项目各自呈现 */
function caseGroupHTML(g){
  var anyFilter = statusFilter !== "all" || priFilter !== "all"
    || ownerFilter !== "all" || bugOnly || !!searchText;
  var count = g.items.length < g.total ? (g.items.length + " / " + g.total) : String(g.total);
  var head = '<div class="tc-group-head">'
    + '<span class="tc-group-name">' + esc(g.name) + '</span>'
    + '<span class="tc-group-count">' + count + ' 条用例</span>'
    + '<span class="tc-group-bar" aria-hidden="true"></span>'
    + (g.error ? '<span class="mini-tag over">加载失败</span>' : "")
    + '</div>';
  var body;
  if(g.error){
    body = '<p class="tc-group-empty">该项目用例加载失败；可切到单个项目重试。</p>';
  }else if(!g.items.length){
    body = '<p class="tc-group-empty">' + (anyFilter ? "没有符合条件的用例" : "还没有测试用例") + '</p>';
  }else{
    body = g.items.map(function(c){ return caseRowHTML(c); }).join("");
  }
  var more = "";
  if(g.hasMore){
    more = '<button class="btn tc-load-more" type="button" data-tc-more="' + esc(g.reqId) + '"'
      + (g.loading ? " disabled" : "") + '>'
      + (g.loading ? "加载中…" : "加载更多（已加载 " + g.items.length + " / 共 " + g.total + " 条）")
      + '</button>';
  }
  return '<section class="tc-group" data-tc-group="' + esc(g.reqId) + '">' + head
    + '<div class="tc-group-rows">' + body + '</div>' + more + '</section>';
}
function fillFilterSelect(id, allLabel, values, noneLabel, state, labelFn, counts){
  var sel = $(id);
  var hasCounts = !!counts && Object.keys(counts).length > 0;
  var n = function(key){ return (counts && counts[key] != null) ? "（" + counts[key] + "）" : ""; };
  /* 与工作项 / 缺陷一致：零结果选项隐藏，当前已选中的保留，避免筛选项误导为空 */
  if(hasCounts){
    values = values.filter(function(v){ return (counts[v] || 0) > 0 || v === state(); });
  }
  /* 「全部」不放候选数：数字与统计条「全部 N」重复，收起态的长度更要让给搜索框 */
  var html = '<option value="all">' + allLabel + '</option>';
  values.forEach(function(v){
    html += '<option value="' + esc(v) + '">' + esc(labelFn ? labelFn(v) : v) + n(v) + '</option>';
  });
  if(noneLabel && (!hasCounts || (counts.__none || 0) > 0 || state() === "__none")){
    html += '<option value="__none">' + noneLabel + n("__none") + '</option>';
  }
  sel.innerHTML = html;
  var valid = state() === "all" || (state() === "__none" && noneLabel)
    || values.indexOf(state()) !== -1;
  if(!valid) state("all");
  sel.value = state();
}
function caseFilterCount(){
  var n = 0;
  if(statusFilter !== "all") n++;
  if(!caseScopeAll && moduleFilter !== "all") n++;
  if(priFilter !== "all") n++;
  if(ownerFilter !== "all") n++;
  if(!caseScopeAll && demandFilter !== "all") n++;
  if(!caseScopeAll && setFilter !== "all") n++;
  if(bugOnly) n++;
  if(searchText) n++;
  return n;
}
/* 目录节点下拉：编辑 / 批量弹框共用。withKeep=true 时首项是「保持原值」，另给「移出目录」 */
function fillModuleSelect(sel, nodes, selected, withKeep){
  if(!sel) return;
  var html = withKeep
    ? '<option value="">保持原值</option><option value="__clear">移出目录（未归类）</option>'
    : '<option value="">未归类（不选目录）</option>';
  (nodes || []).forEach(function(n){
    var pad = "";
    for(var i = 1; i < Math.min(n.level, 7); i++) pad += "　";
    /* data-level / data-path 供自绘下拉还原层级与按全路径搜索；文本里的缩进留给原生下拉 */
    html += '<option value="' + esc(n.id) + '"'
      + ' data-level="' + esc(n.level || 1) + '"'
      + ' data-path="' + esc(modulePathOf(n.id, nodes)) + '">'
      + esc(pad + n.name) + '</option>';
  });
  sel.innerHTML = html;
  sel.value = selected || "";
  if(sel.value !== (selected || "")) sel.value = "";
}
/* 模块是项目内结构，筛选只在左树里表达；这里只做校验：目录被删或切换项目后回落到全部 */
function normalizeModuleFilter(){
  var nodes = caseModuleNodes || [];
  var valid = moduleFilter === "all" || moduleFilter === "__none"
    || nodes.some(function(n){ return n.id === moduleFilter; });
  if(!valid) moduleFilter = "all";
  return moduleFilter;
}
/* 查询条：排序 / 分组 / 每页 / 全选筛选结果。分组与目录面板都是项目内结构，全部项目下收起 */
function syncQueryBar(){
  var bar = $("tcQueryBar");
  if(!bar) return;
  bar.hidden = tcMode !== "cases" || !caseHasTargets();
  if(bar.hidden) return;
  var sortSel = $("tcSort");
  if(sortSel){
    if(sortSel.options.length !== CASE_SORTS.length){
      sortSel.innerHTML = CASE_SORTS.map(function(s){
        return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>';
      }).join("");
    }
    sortSel.value = caseSort;
    sortSel.title = caseSort === "manual"
      ? "手动排序：直接拖动用例行改顺序；只在单项目、不分组、无其它筛选且已加载完时可用"
      : "";
    UI.markFiltered(sortSel, caseSort === "created" && caseSortDir === "desc");
  }
  var dirBtn = $("tcSortDir");
  if(dirBtn){
    var asc = caseSortDir === "asc";
    dirBtn.textContent = asc ? "↑" : "↓";
    dirBtn.setAttribute("aria-label", "当前" + (asc ? "升序" : "降序") + "，点击切换");
    dirBtn.title = "当前" + (asc ? "升序" : "降序") + "，点击切换";
  }
  var grp = $("tcGroupBy");
  if(grp){
    /* 全部项目本身就是按项目分段；单个项目才提供其它维度 */
    var dims = caseScopeAll ? [["project", "按项目"]] : CASE_GROUP_DIMS;
    var sig = dims.map(function(d){ return d[0]; }).join("|");
    if(grp.dataset.dims !== sig){
      grp.innerHTML = dims.map(function(d){
        return '<option value="' + d[0] + '">' + esc(d[1]) + '</option>';
      }).join("");
      grp.dataset.dims = sig;
    }
    grp.value = caseScopeAll ? "project" : caseGroupBy;
    grp.disabled = caseScopeAll;
    grp.title = caseScopeAll
      ? "全部项目按项目分段；切到单个项目后可按执行结果、优先级、目录、自定义分组等分段"
      : "按维度分段显示：段头带计数与结果分布，可折叠、可段内翻页、可整组全选";
    UI.markFiltered(grp, caseScopeAll ? true : !caseGroupBy);
  }
  var ps = $("tcPageSize");
  if(ps){
    ps.value = String(casePageSize);
    ps.disabled = !!caseGroupBy;
    ps.title = caseGroupBy
      ? "分组显示下按段分页（每段一次取 " + GROUP_PAGE + " 条），每页条数不适用"
      : "一次加载多少条；仍用「加载更多」继续，不改成页码";
  }
  var pb = $("tcPanelBtn");
  if(pb){
    pb.hidden = caseScopeAll;
    pb.setAttribute("aria-expanded", caseSide ? "true" : "false");
    pb.classList.toggle("soft", !!caseSide);
    var lb = $("tcPanelBtnLabel");
    if(lb) lb.textContent = "分组";
    pb.title = caseSide
      ? "收起左侧分组"
      : "展开左侧分组：把用例拖到分组＝加入分组（可多归属），删分组不删用例";
  }
  syncDirBtn();
  var gt = $("tcGrpToggleAll");
  if(gt){
    var segOpen = anySegmentExpanded();
    gt.hidden = !caseGroupBy;
    gt.textContent = segOpen ? "全部折叠" : "全部展开";
    gt.title = segOpen ? "折叠所有已展开的段" : "展开所有有内容的段";
  }
  var sa = $("tcSelFiltered");
  if(sa){
    var on = caseSelAll && !caseSelScope;
    sa.hidden = caseScopeAll;
    sa.disabled = !caseTotal;
    sa.classList.toggle("soft", on);
    sa.textContent = (on ? "取消全选（" : "全选筛选结果（") + caseTotal + " 条）";
    sa.title = on ? "取消按筛选全选" : "选中当前筛选命中的全部用例（含未加载的行），一次最多 2000 条";
  }
}
function syncFilterOptions(){
  /* 候选值来自服务端 facets，不受当前筛选与已加载条数影响 */
  var owners = caseOwners;
  /* 模块只在项目内有意：全部项目下不提供模块筛选，避免跨项目同名模块被误读为同一范围 */
  normalizeModuleFilter();
  fillFilterSelect("tcOwner", "执行人：全部", owners, "未指定执行人", function(v){
    if(v === undefined) return ownerFilter;
    ownerFilter = v;
  }, null, caseFacetCounts.owner);
  fillFilterSelect("tcPri", "优先级：全部", PRIORITIES, "未设置", function(v){
    if(v === undefined) return priFilter;
    priFilter = v;
  }, function(p){
    return p + " · " + priName(p);
  }, caseFacetCounts.priority);
  /* 搜索范围内置到搜索框：不再单独占一个开关按钮 */
  var caseSearchEl = $("tcSearch");
  if(caseSearchEl){
    var scopeText = caseScopeAll ? "全部项目" : "本项目";
    var fields = caseSearchWide
      ? "标题 / 编号 / 模块 / 前置 / 测试数据 / 步骤 / 最近备注 / 需求与缺陷标题"
      : "标题 / 编号 / 模块";
    caseSearchEl.placeholder = "搜索" + scopeText + "用例…";
    caseSearchEl.title = "在" + scopeText + "内搜索：" + fields + "（编号如 TC-001）";
    caseSearchEl.setAttribute("aria-label", "在" + scopeText + "内按" + fields + "搜索测试用例");
  }
  var scopeSel = $("tcSearchScope");
  if(scopeSel){
    scopeSel.value = caseSearchWide ? "all" : "title";
    scopeSel.title = caseSearchWide
      ? "当前搜索范围：标题、编号、模块 + 前置、测试数据与步骤（大字段，较慢）"
      : "当前只搜标题、编号与模块；切到「含步骤与前置」才搜大字段";
  }
  $("tcBug").classList.toggle("soft", bugOnly);
  $("tcBug").setAttribute("aria-pressed", bugOnly ? "true" : "false");
  ["tcPri", "tcOwner"].forEach(function(id){
    var el = $(id);
    if(el) UI.markFiltered(el, el.value === "all");
  });
  var clearBtn = $("tcClearFilter");
  if(clearBtn) clearBtn.hidden = tcMode !== "cases" || !caseFilterCount();
  /* 手机上筛选面板默认收起：按钮上带条件数，收起时也知道有几项在生效 */
  var filterCount = $("tcFilterCount");
  if(filterCount){
    var n = caseFilterCount();
    filterCount.hidden = !n;
    filterCount.textContent = n;
  }
  syncDirBtn();
  /* 目录树随列表一起刷新：弹层开着时计数与节点要跟着筛选 / 增删改更新 */
  if(UI.popOpen($("tcDirMenu"))) renderDirPanel();
}
function renderStats(){
  var s = stats || {};
  var total = Number(s.total) || 0;
  /* chips 直接就是执行结果筛选；计数始终是项目全量口径 */
  var chips = [
    ["all", "全部", "", total],
    ["passed", "通过", "ok", s.passed],
    ["failed", "失败", "over", s.failed],
    ["blocked", "阻塞", "warn", s.blocked],
    ["skipped", "跳过", "mute", s.skipped],
    ["untested", "未执行", "mute", s.untested]
  ];
  var info = "计数始终是项目全量口径，不随当前筛选变化；点计数即按该结果筛选";
  $("tcStats").innerHTML = chips.map(function(it){
    /* 0 值统一中性且不可点：没有命中的结果不该给一个点了没反应的按钮 */
    var n = Number(it[3]) || 0;
    var cls = n === 0 ? "mute" : it[2];
    var on = statusFilter === it[0];
    var off = n === 0 && !on;
    return '<button type="button" class="tc-stat ' + cls + (on ? " on" : "") + '" data-tc-status="' + it[0] + '"'
      + ' aria-pressed="' + (on ? "true" : "false") + '"'
      + (off ? " disabled" : "")
      + ' title="' + it[1] + ' · ' + n + ' 条' + (off ? "（本项暂无）" : "，点击按此结果筛选") + '">'
      + (it[2] ? '<i class="tc-dot ' + it[2] + '"></i>' : "") + it[1] + ' <b>' + n + '</b></button>';
  }).join("")
    + '<span class="tc-stat-info" role="img" aria-label="' + info + '" title="' + info + '">' + icon("infoCircle", 13) + '</span>';
}

/* ---------- 用例保存视图（scope=testcase：项目 / 执行结果 / 筛选 / 展示方式） ---------- */

var tcViewsMenuEl = $("tcViewsMenu");
attachEnvDict($("runEnvironment"));
attachEnvDict($("defectEnvironment"));
function tcViewParams(){
  return {
    scope: "testcase", reqId: caseReqId || "", all: caseScopeAll ? 1 : 0,
    status: statusFilter, moduleId: moduleFilter, moduleSub: caseModuleSub ? 1 : 0,
    pri: priFilter, owner: ownerFilter, demandId: demandFilter, setId: setFilter,
    setSub: caseSetSub ? 1 : 0,
    bug: !!bugOnly, q: searchText || "", wide: caseSearchWide ? 1 : 0,
    sort: caseSort, sortDir: caseSortDir, groupBy: caseGroupBy, pageSize: casePageSize,
    mode: tcMode
  };
}
function tcViewMeaningful(p){
  return !!(p.reqId || p.all || p.status !== "all" || p.moduleId !== "all" || p.pri !== "all"
    || p.owner !== "all" || p.demandId !== "all" || p.setId !== "all" || p.bug || p.q
    || p.groupBy || p.sort !== "created" || p.sortDir !== "desc" || p.pageSize !== 100
    || p.mode === "coverage" || p.mode === "report" || p.mode === "plans");
}
/* 旧视图存的是模块自由文本：按节点名解析回目录节点，解析不到就明示忽略，不静默当成「全部」 */
function resolveModuleName(reqId, name){
  var hit = null;
  caseModuleNodes.forEach(function(n){ if(n.name === name) hit = n.id; });
  if(hit || (reqId === caseReqId && caseModuleNodes.length)) return Promise.resolve(hit);
  return API.get("/api/test-modules", { reqId: reqId }).then(function(nodes){
    var id = null;
    (nodes || []).forEach(function(n){ if(n.name === name) id = n.id; });
    return id;
  }).catch(function(){ return null; });
}
function applyTcView(v){
  var p;
  try{ p = JSON.parse(v.params || "{}"); }
  catch(e){ toast("视图参数损坏，无法应用", "bad"); return; }
  if(!p || p.scope !== "testcase" || (p.mode && p.mode !== "cases" && p.mode !== "coverage"
    && p.mode !== "report" && p.mode !== "plans")){
    toast("视图参数不合法，无法应用（可删除后重新保存）", "bad");
    return;
  }
  if(p.reqId && rt.reqList.some(function(r){ return r.id === p.reqId; })){
    if(p.reqId !== caseReqId){
      caseSetsReq = null;
      caseSets = [];
      caseSetsError = "";
      caseDirQuery = "";
      caseDirOpen = {};
    }
    caseReqId = p.reqId;
  }
  statusFilter = typeof p.status === "string" && p.status ? p.status : "all";
  moduleFilter = typeof p.moduleId === "string" && p.moduleId ? p.moduleId : "all";
  caseModuleSub = !!(p.moduleSub === 1 || p.moduleSub === true);
  priFilter = typeof p.pri === "string" && p.pri ? p.pri : "all";
  ownerFilter = typeof p.owner === "string" && p.owner ? p.owner : "all";
  demandFilter = typeof p.demandId === "string" && p.demandId ? p.demandId : "all";
  setFilter = typeof p.setId === "string" && p.setId ? p.setId : "all";
  caseSetSub = !(p.setSub === 0 || p.setSub === false);
  bugOnly = !!p.bug;
  searchText = typeof p.q === "string" ? p.q.toLowerCase() : "";
  caseSearchWide = !!(p.wide === 1 || p.wide === true);
  caseSort = CASE_SORTS.some(function(s){ return s[0] === p.sort; }) ? p.sort : "created";
  caseSortDir = p.sortDir === "asc" ? "asc" : "desc";
  casePageSize = [50, 100, 200].indexOf(Number(p.pageSize)) >= 0 ? Number(p.pageSize) : 100;
  caseGroupBy = CASE_GROUP_DIMS.some(function(d){ return d[0] === p.groupBy; }) ? (p.groupBy || "") : "";
  tcMode = p.mode === "coverage" ? "coverage"
    : (p.mode === "report" ? "report" : (p.mode === "plans" ? "plans" : "cases"));
  /* 视图里保存的是「全部项目」时，只有用例与计划能恢复；覆盖矩阵与报告始终是单项目 */
  caseScopeAll = !!((p.all === 1 || p.all === true) && (tcMode === "cases" || tcMode === "plans"));
  if(caseScopeAll){ moduleFilter = "all"; demandFilter = "all"; setFilter = "all"; caseGroupBy = ""; }
  if(UI.popOpen($("tcDirMenu"))) UI.closeAllPops();
  if(caseSide === "set" && !caseScopeAll) loadCaseSets();
  if($("tcSearch")) $("tcSearch").value = searchText;
  syncReqSel();
  syncModeUI();
  function go(){
    if(tcMode === "coverage") loadCoverage();
    else if(tcMode === "report") loadTestReport();
    else if(tcMode === "plans") loadPlans();
    else loadCases();
    toast("已应用视图「" + v.name + "」", "fs");
  }
  var legacy = typeof p.module === "string" && p.module && p.module !== "all" ? p.module : "";
  if(legacy && !p.moduleId && tcMode === "cases" && !caseScopeAll && caseReqId){
    if(legacy === "__none"){ moduleFilter = "__none"; go(); return; }
    moduleFilter = "all";
    resolveModuleName(caseReqId, legacy).then(function(id){
      if(id) moduleFilter = id;
      else toast("视图里的模块「" + legacy + "」已不是目录节点，该条件已忽略", "warn");
      go();
    });
    return;
  }
  go();
}
function saveTcView(){
  var p = tcViewParams();
  if(!tcViewMeaningful(p)){ toast("先选择项目或设置筛选条件，再保存视图", "warn"); return; }
  UI.showPrompt({
    title: "保存用例视图",
    desc: "保存当前项目、执行结果与筛选条件；同名保存将覆盖原视图",
    label: "视图名称（≤20 字）", maxLength: 20, okText: "保存"
  }).then(function(name){
    if(!name) return;
    var overwrite = savedViewsFor("testcase").some(function(v){ return v.name === name; });
    API.post("/api/views", { name: name, params: JSON.stringify(p) }).then(function(){
      toast((overwrite ? "已覆盖视图「" : "已保存视图「") + name + "」", "fs");
      loadViews().then(renderTcViewsMenu);
    }).catch(function(ex){ toast(ex.message || "保存失败", "bad"); });
  });
}
function deleteTcView(id){
  UI.showConfirm({ title: "删除视图", msg: "确定删除该用例视图？不影响用例数据。", okText: "删除视图" }).then(function(ok){
    if(!ok) return;
    API.del("/api/views/" + encodeURIComponent(id)).then(function(){
      toast("视图已删除", "fs");
      loadViews().then(renderTcViewsMenu);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function renderTcViewsMenu(){
  if(!tcViewsMenuEl) return;
  var views = savedViewsFor("testcase");
  var html = '<div class="menu-title">用例视图</div>';
  if(!views.length){
    html += '<div class="menu-field"><p class="foot-note" style="margin:0">还没有保存的用例视图；选定项目或筛选条件后保存。</p></div>';
  }else{
    html += views.map(function(v){
      return '<div class="menu-row">' +
        '<button class="menu-item" type="button" data-tc-view="' + esc(v.id) + '" title="应用视图：' + esc(v.name) + '">' + esc(v.name) + '</button>' +
        '<button class="icon-btn sm" type="button" data-tc-view-del="' + esc(v.id) + '" aria-label="删除视图" title="删除视图">' + icon("close", 12) + '</button>' +
      '</div>';
    }).join("");
  }
  html += '<div class="menu-foot"><button class="btn sm" type="button" data-tc-view-save>保存当前为视图</button></div>';
  tcViewsMenuEl.innerHTML = html;
}
/* 测试五模式已并到全局子导航：模式切换后同步高亮，避免还要维护页内分段 */
function syncTcSubnav(){
  if(document.body.dataset.view !== "testcases") return;
  var el = document.getElementById("subNav");
  if(!el) return;
  el.querySelectorAll("[data-sub-tab]").forEach(function(b){
    var on = b.dataset.subTab === tcMode;
    b.classList.toggle("on", on);
    if(on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  paintDefectBadge();
}
/* 手机端项目域导航：面包屑显示当前项目，子页负责跨域跳转 */
function tcDomainScopeId(){
  if(tcMode === "defects") return defReqId || "";
  return caseScopeAll ? "" : (caseReqId || "");
}
function syncTcDomain(){
  var cur = $("tcCrumbProj");
  if(!cur) return;
  var name = tcMode === "defects" ? defectScopeName()
    : (caseScopeAll || !caseReqId ? "全部项目" : reqNameOf(caseReqId));
  cur.textContent = name;
  cur.title = name;
}
function setTcMode(mode){
  if(mode !== "cases" && mode !== "defects" && mode !== "plans" && mode !== "coverage" && mode !== "report") return;
  if(mode === tcMode){ syncModeUI(); return; }
  tcMode = mode;
  if(UI.popOpen($("tcDirMenu"))) UI.closeAllPops();
  syncReqSel();
  syncModeUI();
  if(tcMode === "coverage") loadCoverage();
  else if(tcMode === "report") loadTestReport();
  else if(tcMode === "plans") loadPlans();
  else if(tcMode === "defects") loadDefects();
  else { render(); loadCases(); }
}
function currentTcMode(){ return tcMode; }
function syncModeUI(){
  var cov = tcMode === "coverage";
  var rep = tcMode === "report";
  var plan = tcMode === "plans";
  var def = tcMode === "defects";
  var view = $("view-testcases");
  if(view){
    view.classList.toggle("cov-mode", cov);
    view.classList.toggle("rep-mode", rep);
    view.classList.toggle("plans-mode", plan);
    view.classList.toggle("def-mode", def);
  }
  document.querySelectorAll("#tcModeSeg [data-tc-mode]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.tcMode === tcMode ? "true" : "false");
  });
  syncTcSubnav();
  syncTcDomain();
  syncQueryBar();
  var bn = $("btnCaseNew");
  if(bn) bn.style.display = !cov && !rep && !plan && !def && caseCreateTargets().length ? "" : "none";
  var bulkBar = $("tcBulkBar");
  if(bulkBar && tcMode !== "cases") bulkBar.hidden = true;
  /* 手机把筛选收进可展开面板：非用例模式、或没有项目可筛时，入口一并收起 */
  var defBar = $("tcDefectBar");
  syncCaseBars();
  if(defBar) defBar.hidden = !def;
  /* 缺陷页用自己的项目范围；隐藏公共项目下拉，避免同页两个项目控件 */
  var reqSel = $("tcReq");
  if(reqSel) reqSel.style.display = def ? "none" : "";
  syncPlanBar();
  var caseBar = $("tcFilterBar"), caseBarBtn = $("tcFilterBtn");
  if(tcMode !== "cases" && caseBar && caseBar.classList.contains("is-open")){
    caseBar.classList.remove("is-open");
    if(caseBarBtn) caseBarBtn.setAttribute("aria-expanded", "false");
  }
  var csvOut = $("btnCaseCsvOut"), csvIn = $("btnCaseCsvIn"), planNew = $("btnPlanNew");
  var importWrap = $("tcImportWrap");
  var aiBtn = $("btnCaseAi"), defNew = $("btnDefectNew");
  /* 导出、导入、AI 生成都只针对一个具体项目，全部项目下先收起，避免把范围写成模糊的全量 */
  var singleScope = !caseScopeAll;
  if(csvOut) csvOut.style.display = tcMode === "cases" && singleScope && caseReqId ? "" : "none";
  if(csvIn) csvIn.style.display = tcMode === "cases" && singleScope && isWritable() ? "" : "none";
  if(importWrap) importWrap.style.display = tcMode === "cases" && singleScope && isWritable() ? "" : "none";
  if(aiBtn) aiBtn.style.display = tcMode === "cases" && singleScope && isWritable() ? "" : "none";
  /* 该按钮初始带 hidden 属性，而全局 [hidden]{display:none!important} 优先级高于行内 display，
     必须切 hidden 本身，改 style.display 永远显示不出来。
     计划 tab 下始终可见：没选项目时点按给提示，而不是让入口整个消失。 */
  if(planNew) planNew.hidden = !plan;
  if(defNew) defNew.hidden = !def || !defectCreateTargets().length;
  var statsEl = $("tcStats"), defPane = $("tcDefects");
  /* 全部项目下没有单一项目的执行结果，统计条让位给分组标题；
     计划模式的统计在计划里，列表与详情共用同一个空容器，必须整块隐藏而不是只清空，
     否则空元素会带着上下外边距夹在两段 flex gap 之间 */
  if(statsEl) statsEl.hidden = plan || def || (tcMode === "cases" && caseScopeAll);
  if(defPane) defPane.hidden = !def;
  if(def){
    ["tcCasesWrap", "tcCoverage", "tcReport", "tcPlans"].forEach(function(id){
      var el = $(id);
      if(el) el.hidden = true;
    });
  }
  document.querySelectorAll("#tcStats [data-tc-status]").forEach(function(b){
    var on = b.dataset.tcStatus === statusFilter;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.classList.toggle("on", on);
  });
}
/* ---------- 批量维护：勾选、全选与批量设置 ---------- */

function caseSelIds(){ return Object.keys(caseSel); }
function caseWritableLoaded(){ return cases.filter(caseWritable); }
/* 列表重新加载前直接收起批量条，避免骨架屏上方残留上一次的勾选数 */
function resetCaseSel(){
  caseSel = {};
  caseSelAll = false;
  caseSelScope = null;
  caseExclude = {};
  var bar = $("tcBulkBar");
  if(bar) bar.hidden = true;
}
function clearCaseSel(){
  resetCaseSel();
  syncBulkBar();
}
/* 勾选语义分两种：明确 ID（只覆盖已加载的行）与按筛选生效（含未加载的行）。
   后者取消勾选记一条排除，重新勾选即撤销排除。 */
function toggleCaseSel(id, on, segKey){
  if(!id) return;
  if(caseSelAll){
    if(caseSelScope && segKey && segKey !== caseSelScope.key){ syncBulkBar(); return; }
    if(on) delete caseExclude[id];
    else{
      if(Object.keys(caseExclude).length >= 500){
        toast("取消勾选的行最多 500 条，请改用明确勾选", "warn");
        syncBulkBar();
        return;
      }
      caseExclude[id] = true;
    }
    syncBulkBar();
    return;
  }
  if(on){
    if(caseSelIds().length >= 200){
      toast("单次最多勾选 200 条；要覆盖未加载的行请用「全选筛选结果」", "warn");
      syncBulkBar();
      return;
    }
    caseSel[id] = true;
  }else{
    delete caseSel[id];
  }
  syncBulkBar();
}
/* 全选筛选结果：范围是当前筛选（或某一组），服务端按条件生效，不受分页限制 */
function selectAllFiltered(){
  if(caseScopeAll){ toast("「全选筛选结果」需要先切到单个项目", "warn"); return; }
  if(!caseReqId){ toast("先选择项目", "warn"); return; }
  if(!caseTotal){ toast("当前筛选没有命中用例", "warn"); return; }
  if(caseSelAll && !caseSelScope){ clearCaseSel(); render(); return; }
  if(caseTotal > 2000){
    toast("当前筛选命中 " + caseTotal + " 条，超过单次 2000 条上限；请先缩小筛选范围", "warn");
    return;
  }
  caseSel = {};
  caseExclude = {};
  caseSelAll = true;
  caseSelScope = null;
  syncBulkBar();
  render();
}
/* 列表头同时承担两级全选与批量动作：默认显示排序 / 分组 / 每页，
   有勾选时批量动作原地替换这些工具，不额外占一行 */
function syncBulkBar(){
  var bar = $("tcBulkBar"), head = $("tcQueryBar");
  if(!bar || !head) return;
  var show = tcMode === "cases" && caseHasTargets() && !$("tcCasesWrap").hidden;
  head.hidden = !show;
  if(!show) return;
  var writable = caseWritableLoaded();
  var n = caseSelCount();
  var loadedSel = writable.filter(function(c){ return caseRowSelected(c, null); }).length;
  var allOn = writable.length > 0 && loadedSel === writable.length;
  var allBox = $("tcBulkAll");
  allBox.checked = allOn;
  allBox.indeterminate = !allOn && loadedSel > 0;
  allBox.disabled = !writable.length || !!(caseSelAll && caseSelScope);
  allBox.title = allBox.disabled
    ? (writable.length
      ? "已全选「" + caseSelScope.label + "」组；要改选其他行请先取消全选本组"
      : "当前筛选下没有可编辑的用例")
    : "勾选当前已加载的可编辑行（最多 200 条）";
  $("tcBulkAllLabel").textContent = caseSelAll ? "全选已加载（按条件生效）" : "全选已加载";
  $("tcBulkCount").innerHTML = n
    ? ('已选 <b>' + n + '</b> 条')
    : ("共 " + writable.length + " 条可编辑");
  var loaded = writable.length;
  var hintEl = $("tcBulkHint");
  hintEl.textContent = !loaded
    ? "当前筛选下没有可编辑的用例"
    : caseSelAll
      ? (caseSelScope
        ? "范围：「" + caseSelScope.label + "」组内全部 " + caseSelTotal() + " 条（含未加载的行）"
        : "当前页已加载 " + loaded + " 条，其余 " + Math.max(0, n - loaded) + " 条按筛选条件匹配（未加载也生效）")
      : "仅覆盖已加载的行";
  hintEl.title = caseSelAll
    ? hintEl.textContent
    : "勾选只作用于当前已加载的 " + loaded + " 条；要覆盖未加载的行，请用「全选筛选结果」";
  /* 结果都在已加载的行里时，「全选筛选结果」与「全选已加载」等价，弱化掉免得两条路选同一批 */
  var selBtn = $("tcSelFiltered");
  if(selBtn) selBtn.hidden = !caseSelAll && caseTotal <= writable.length;
  /* 选中后把排序 / 分组等工具让位给批量动作：同一行内交换，不新增行高 */
  var tools = $("tcListHeadTools");
  if(tools) tools.hidden = n > 0;
  bar.hidden = n === 0;
  if(n === 0) return;
  ["btnTcBatchEdit", "btnTcBatchPri", "btnTcBatchSet", "btnTcBatchPlan", "btnTcBatchExport", "btnTcBatchDel"].forEach(function(id){
    var b = $(id);
    if(b) b.disabled = !n;
  });
  /* 移出分组只在「按某个分组筛选」或「全选本组（分组维度）」时有明确对象 */
  var unset = $("btnTcBatchUnset");
  if(unset){
    var scopeSet = caseSelScope && caseSelScope.dim === "set" ? caseSelScope.key
      : (setFilter !== "all" && setFilter !== "__none" ? setFilter : "");
    if(scopeSet && setDynamic(setById(scopeSet))) scopeSet = "";
    unset.hidden = !scopeSet;
    unset.dataset.setId = scopeSet;
  }
  $("btnTcBatchClear").hidden = !n;
  Array.prototype.forEach.call($("tcList").querySelectorAll("[data-tc-pick]"), function(box){
    var on = caseRowSelected({ id: box.dataset.tcPick }, box.dataset.tcPickSeg || null);
    box.checked = on;
    var row = box.closest(".tc-row");
    if(row) row.classList.toggle("is-selected", on);
  });
}
/* 批量改模块 / 改优先级共用一个弹框：只改填写的项，其余保持原值 */
function openBatchDialog(focus){
  if(!caseHasSel()){ toast("请先勾选用例", "warn"); return; }
  var n = caseSelCount();
  $("caseBatchSub").textContent = caseSelAll
    ? "已选 " + n + " 条（按筛选条件生效，含未加载的行）；只修改选择的项，「保持原值」不变。"
    : "已选 " + n + " 条用例；只修改选择的项，「保持原值」不变。";
  fillModuleSelect($("bModule"), caseModuleNodes, "", true);
  $("bPri").value = "";
  $("btnBatchSave").disabled = false;
  UI.openModal($("dlgCaseBatch"), "select");
  setTimeout(function(){ $(focus === "pri" ? "bPri" : "bModule").focus(); }, 30);
}
function saveBatchEdit(){
  if(caseBatchSaving) return;
  if(!caseHasSel()){ toast("请先勾选用例", "warn"); return; }
  var moduleId = $("bModule").value;
  var pri = $("bPri").value;
  var body = caseSelection();
  if(moduleId === "__clear") body.moduleAction = "clear";
  else if(moduleId){ body.moduleAction = "set"; body.moduleId = moduleId; }
  else body.moduleAction = "keep";
  if(pri === "__clear") body.priorityAction = "clear";
  else if(pri){ body.priorityAction = "set"; body.priority = pri; }
  else body.priorityAction = "keep";
  if(body.moduleAction === "keep" && body.priorityAction === "keep"){
    toast("选择目录节点或优先级后再应用", "warn");
    return;
  }
  caseBatchSaving = true;
  $("btnBatchSave").disabled = true;
  API.put("/api/test-cases/batch", body).then(function(r){
    var msg = "已更新 " + ((r && r.updated) || 0) + " 条用例";
    if(r && r.skipped) msg += "，跳过 " + r.skipped + " 条（已不存在或无权修改）";
    toast(msg, "fs");
    caseBatchSaving = false;
    $("btnBatchSave").disabled = false;
    UI.closeModal($("dlgCaseBatch"));
    clearCaseSel();
    loadCases();
  }).catch(function(ex){
    caseBatchSaving = false;
    $("btnBatchSave").disabled = false;
    toast(ex.message || "批量更新失败", "bad");
  });
}
function batchDeleteCases(){
  if(!caseHasSel()){ toast("请先勾选用例", "warn"); return; }
  var n = caseSelCount();
  var scope = caseSelAll
    ? (caseSelScope ? "「" + caseSelScope.label + "」组内按条件匹配的 " : "当前筛选命中的全部 ")
    : "勾选的 ";
  UI.showConfirm({
    title: "批量删除用例",
    msg: "将删除" + scope + "<b>" + n + "</b> 条用例，执行流水、失败证据与计划圈选一并清理，且不可恢复。",
    okText: "删除 " + n + " 条"
  }).then(function(ok){
    if(!ok) return;
    return API.post("/api/test-cases/batch-delete", caseSelection()).then(function(r){
      var msg = "已删除 " + ((r && r.deleted) || 0) + " 条用例";
      if(r && r.skipped) msg += "，跳过 " + r.skipped + " 条（已不存在或无权删除）";
      toast(msg, "fs");
      clearCaseSel();
      loadCases();
    });
  }).catch(function(ex){ toast(ex.message || "批量删除失败", "bad"); });
}

function moduleNodeById(id, nodes){
  var list = nodes || caseModuleNodes;
  for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i];
  return null;
}
/* 目录全路径（父 / 子）：列表与弹窗都按路径显示，避免同名子节点看不出归属 */
function modulePathOf(id, nodes){
  var list = nodes || caseModuleNodes;
  var byId = {};
  list.forEach(function(n){ byId[n.id] = n; });
  var parts = [], cur = byId[id], guard = 0;
  while(cur && guard++ <= list.length){
    parts.unshift(cur.name);
    cur = cur.parentId ? byId[cur.parentId] : null;
  }
  return parts.join(" / ");
}
function caseModuleLabel(c){
  if(c.moduleId){
    var p = modulePathOf(c.moduleId);
    if(p) return p;
  }
  return c.module || "";
}
function caseRowHTML(c, segKey){
  /* 元信息按「归属」与「执行」拆两行：第一行看出这条用例属于谁，第二行看出它怎么跑、跑到哪 */
  var stepCount = (c.steps || []).length;
  var modLabel = caseModuleLabel(c);
  var line1 = [], line2 = [];
  if(modLabel) line1.push('<span class="tc-kv"><span class="tc-mod" title="' + esc(modLabel) + '">' + esc(modLabel) + '</span></span>');
  if(c.demandTitle) line1.push('<span class="tc-kv"><em>需求</em>' + assocLinkHTML("demand", c.demandId, cut(c.demandTitle, 26)) + '</span>');
  if(c.tasks && c.tasks.length){
    var first = c.tasks[0];
    var firstLabel = (itemNoText(first.itemNo) ? itemNoText(first.itemNo) + " " : "") + cut(first.taskTitle || first.taskId, 22);
    var firstLink = assocLinkHTML("task", first.taskId, firstLabel);
    line1.push('<span class="tc-kv"><em>工作项</em>' + (c.tasks.length > 1 ? firstLink + " 等 " + c.tasks.length + " 个" : firstLink) + '</span>');
  }
  line2.push('<span class="tc-kv nw"><em>步骤</em>' + (stepCount || "无") + '</span>');
  if(c.precondition){
    line2.push('<span class="tc-kv"><em>前置</em><span class="tc-ell" title="' + esc(c.precondition) + '">' + esc(cut(c.precondition, 40)) + '</span></span>');
  }
  if(c.testData){
    line2.push('<span class="tc-kv"><em>数据</em><span class="tc-ell" title="' + esc(c.testData) + '">' + esc(cut(c.testData, 18)) + '</span></span>');
  }
  if(c.latestStatus){
    line2.push('<span class="tc-kv nw"><em>执行</em>' + esc((c.latestBy || "—") + " " + (c.latestAt ? fmtTs(c.latestAt) : "")) + '</span>');
  }
  if(c.latestEvidenceCount) line2.push('<span class="tc-kv nw"><em>证据</em>' + esc(c.latestEvidenceCount) + '</span>');
  var blocked = c.latestStatus === "blocked" && c.latestNote
    ? '<span class="tc-blocked" title="' + esc(c.latestNote) + '">' + icon("alert", 12) + '<span class="tc-ell">' + esc(cut(c.latestNote, 30)) + '</span></span>'
    : "";
  if(c.latestBugResolved && c.latestStatus === "failed"){
    line2.push('<span class="tc-retest-flag nw">缺陷已修复 · 待复测</span>');
  }
  var w = caseWritable(c);
  var acts = "";
  acts += '<button class="btn sm ghost" type="button" data-tc-runs="' + esc(c.id) + '" title="查看执行历史与失败证据">'
    + icon("clock", 13) + ' 记录</button>';
  if(w){
    /* 已有执行结果时语义是回归再测，按钮文案随之变化，避免误以为还没执行过 */
    acts += '<button class="btn sm" type="button" data-tc-run="' + esc(c.id) + '" title="'
      + (c.latestStatus ? "再执行一轮并记录结果（历史结果保留在执行记录里）" : "执行用例并记录结果") + '">'
      + icon("play", 13) + ' ' + (c.latestStatus ? "重新执行" : "执行") + '</button>';
  }
  if(c.latestBugTaskId){
    /* 关联缺陷已修复关闭、最新执行仍失败：提示「待复测」，点击回到缺陷确认后重测 */
    var retest = c.latestBugResolved && c.latestStatus === "failed";
    acts += '<button class="btn sm ghost' + (retest ? " tc-retest" : "") + '" type="button" data-tc-bug="' + esc(c.id) + '" title="'
      + (retest ? "关联缺陷已修复关闭，点击打开缺陷并复测确认" : "打开关联缺陷") + '">'
      + (retest ? icon("refresh", 13) + ' 待复测 · ' : '缺陷 · ') + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 10)) + '</button>';
  }else if(w && c.latestStatus === "failed"){
    acts += '<button class="btn sm ghost danger" type="button" data-tc-defect="' + esc(c.id) + '">转缺陷</button>';
  }
  if(w){
    /* 编辑 / 删除收进常显的 ⋯ 菜单：不再依赖 hover，触屏也能发现 */
    acts += '<span class="tc-menu-wrap">'
      + '<button class="icon-btn sm" type="button" data-tc-menu="' + esc(c.id) + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作" title="更多操作">'
      + icon("more", 15) + '</button>'
      + '<div class="tc-menu" role="menu" data-tc-menu-panel="' + esc(c.id) + '" hidden>'
      + '<button type="button" role="menuitem" data-tc-edit="' + esc(c.id) + '">' + icon("edit", 13) + ' 编辑用例</button>'
      + '<div class="tc-menu-sep" role="none"></div>'
      + '<button type="button" role="menuitem" class="danger" data-tc-del="' + esc(c.id) + '">' + icon("trash", 13) + ' 删除用例</button>'
      + '</div></span>';
  }
  var sel = caseRowSelected(c, segKey);
  var dragging = !!(caseDrag && (caseDrag.anchor === c.id || caseRowSelected(c, segKey)));
  var pick = w
    ? '<input type="checkbox" class="tc-pick" data-tc-pick="' + esc(c.id) + '"'
      + (segKey ? ' data-tc-pick-seg="' + esc(segKey) + '"' : "")
      + (sel ? " checked" : "") + ' aria-label="选择用例 ' + esc(c.title) + '" />'
    : "";
  return '<div class="tc-row' + (sel ? " is-selected" : "") + (dragging ? " is-dragging" : "") + '"'
    + ' data-tc-open="' + esc(c.id) + '"'
    + (manualOrderScope() ? ' data-tc-order-row="' + esc(c.id) + '"' : "")
    + (w && !caseScopeAll ? ' draggable="true" data-tc-drag="' + esc(c.id) + '"' : "")
    + '>'
    + pick
    + '<span class="tc-no" title="' + (caseNoText(c) ? "用例编号（项目内固定，可用于缺陷与评审引用）" : "该用例暂无编号") + '">'
    + esc(caseNoText(c)) + '</span>'
    + statusBadgeHTML(c.latestStatus)
    + '<div class="tc-main">'
    +   '<div class="tc-title">' + esc(c.title) + (c.priority ? ' <span class="tc-pri">' + priTagHTML(c.priority) + '</span>' : "") + '</div>'
    +   (line1.length ? '<div class="tc-meta">' + line1.join("") + '</div>' : "")
    +   (line2.length ? '<div class="tc-meta tc-meta-2">' + line2.join("") + blocked + '</div>' : (blocked ? '<div class="tc-meta">' + blocked + '</div>' : ""))
    +   (c.latestNote && !blocked ? '<div class="tc-note">' + esc(c.latestNote) + '</div>' : "")
    + '</div>'
    + '<div class="tc-acts">' + acts + '</div>'
    + '</div>';
}
function cut(s, n){
  s = String(s || "");
  return s.length > n ? s.substring(0, n) + "…" : s;
}

/* ---------- 用例编辑 ---------- */

function demandStatusLabel(st){
  if(!st) return "";
  return { review:"待评审", pass:"已通过", plan:"已排期", closed:"已关闭", rej:"已拒绝", canceled:"已取消", cancelled:"已取消" }[st] || "未知状态";
}
function demandPickLabel(d){
  var tag = demandStatusLabel(d.status);
  return d.title + (tag ? "（" + tag + "）" : "");
}
function loadDemandOptions(reqId){
  if(!reqId) return Promise.resolve([]);
  if(demandOptions.reqId === reqId && demandOptions.loading) return demandOptions.loading;
  if(demandOptions.reqId === reqId && demandOptions.list.length && !demandOptions.error) return Promise.resolve(demandOptions.list);
  demandOptions.reqId = reqId;
  demandOptions.list = [];
  demandOptions.total = 0;
  demandOptions.error = null;
  demandOptions.loading = API.get("/api/demands/page", {
    reqId: reqId, offset: 0, limit: DEMAND_OPTIONS_PAGE_SIZE, sort: "created"
  }).then(function(page){
    if(demandOptions.reqId === reqId){
      demandOptions.list = page.items || [];
      demandOptions.total = page.total || 0;
      demandOptions.error = null;
    }
    demandOptions.loading = null;
    return demandOptions.list;
  }).catch(function(ex){
    /* 失败不能返回 []：调用方会把"加载失败"当成"确实没有需求"并清空关联 */
    if(demandOptions.reqId === reqId){
      demandOptions.list = [];
      demandOptions.error = ex || new Error("需求候选加载失败");
    }
    demandOptions.loading = null;
    return null;
  });
  return demandOptions.loading;
}
/* ---------- 关联需求选择器：候选一页 + 关键词走服务端搜索 ---------- */

function demandMetaText(d){
  return [demandStatusLabel(d.status), d.priority, d.versionName].filter(Boolean).join(" · ");
}
function syncDemandTrigger(){
  var sel = $("cDemand"), text = $("cDemandPickerText");
  if(!sel || !text) return;
  var label = sel.value && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].textContent : "";
  text.textContent = sel.value ? (label || "原关联需求") : "搜索并选择需求";
  text.classList.toggle("placeholder", !sel.value);
  var btn = $("cDemandPicker");
  if(btn) btn.classList.toggle("is-empty", !sel.value);
  var state = $("cDemandState");
  if(state){
    var st = sel.getAttribute("data-status") || "";
    state.textContent = st;
    state.hidden = !st;
  }
  var clear = $("cDemandClear");
  if(clear) clear.hidden = !sel.value;
}
/* 隐藏的 select 只承载 id：候选浮层不依赖 option 列表，避免上百条 option 拖慢弹窗 */
function setDemandValue(id, label, status){
  var sel = $("cDemand");
  if(!sel) return;
  sel.innerHTML = id ? '<option value="' + esc(id) + '">' + esc(label || "原关联需求") + '</option>' : "";
  sel.value = id || "";
  if(status) sel.setAttribute("data-status", status); else sel.removeAttribute("data-status");
  syncDemandTrigger();
}
function resetDemandFirstPage(){
  var cached = demandOptions.reqId === caseFormReqId;
  demandPicker.list = cached ? demandOptions.list : [];
  demandPicker.total = cached ? demandOptions.total : 0;
}
function renderDemandPicker(){
  var el = demandPicker.el;
  if(!el) return;
  var box = el.querySelector("[data-demand-results]");
  var count = el.querySelector("[data-demand-count]");
  var selectedId = $("cDemand").value || "";
  if(demandPicker.error){
    box.innerHTML = '<div class="search-picker-error">' + esc(demandPicker.error) +
      '<br><button class="btn sm" type="button" data-demand-retry>重新加载</button></div>';
    if(count) count.textContent = "加载失败";
    return;
  }
  if(demandPicker.loading && !demandPicker.list.length){
    box.innerHTML = UI.skeletonRows(4);
    if(count) count.textContent = "搜索中";
    return;
  }
  if(count){
    count.textContent = demandPicker.loading
      ? "搜索中…"
      : (demandPicker.total > demandPicker.list.length
        ? "共 " + demandPicker.total + " 条 · 前 " + demandPicker.list.length + " 条"
        : demandPicker.list.length + " 条");
  }
  var html = '<button type="button" class="search-picker-clear' + (selectedId ? "" : " selected") + '"'
    + ' data-demand-clear aria-pressed="' + (selectedId ? "false" : "true") + '">'
    + icon("close", 13) + '<span>不关联需求</span></button>';
  if(!demandPicker.list.length){
    html += '<div class="search-picker-empty">'
      + (demandPicker.query ? "没有找到匹配的需求，换个关键词试试。" : "本项目需求池暂无需求。")
      + (demandPicker.query ? '<br><button class="btn sm" type="button" data-demand-reset>清除搜索</button>' : "")
      + '</div>';
    box.innerHTML = html;
    return;
  }
  demandPicker.list.forEach(function(d){
    var selected = d.id === selectedId;
    var meta = demandMetaText(d);
    html += '<button type="button" class="search-picker-option' + (selected ? " selected" : "") + '"'
      + ' data-demand-id="' + esc(d.id) + '" aria-pressed="' + (selected ? "true" : "false") + '">'
      + '<span class="search-picker-option-main">'
      + '<span class="search-picker-option-title">' + esc(d.title || "未命名需求") + '</span>'
      + (meta ? '<span class="search-picker-option-meta">' + esc(meta) + '</span>' : "")
      + '</span>' + (selected ? icon("check", 15) : "") + '</button>';
  });
  box.innerHTML = html;
}
function loadDemandFirstPage(el, seq){
  demandPicker.loading = true;
  demandPicker.error = null;
  renderDemandPicker();
  loadDemandOptions(caseFormReqId).then(function(list){
    if(seq !== demandPicker.seq) return;
    demandPicker.loading = false;
    if(list === null){
      demandPicker.error = "需求加载失败，请重试";
      demandPicker.list = [];
      demandPicker.total = 0;
    }else{
      resetDemandFirstPage();
    }
    renderDemandPicker();
  });
}
function searchDemands(el, seq, q){
  var reqSeq = ++demandPicker.reqSeq;
  demandPicker.loading = true;
  demandPicker.error = null;
  renderDemandPicker();
  API.get("/api/demands/page", {
    reqId: caseFormReqId, q: q, offset: 0, limit: DEMAND_SEARCH_PAGE_SIZE, sort: "created"
  }).then(function(page){
    if(seq !== demandPicker.seq || reqSeq !== demandPicker.reqSeq) return;
    demandPicker.loading = false;
    demandPicker.list = page.items || [];
    demandPicker.total = page.total || 0;
    renderDemandPicker();
  }).catch(function(ex){
    if(seq !== demandPicker.seq || reqSeq !== demandPicker.reqSeq) return;
    demandPicker.loading = false;
    demandPicker.list = [];
    demandPicker.total = 0;
    demandPicker.error = (ex && ex.message) || "需求搜索失败，请重试";
    renderDemandPicker();
  });
}
function chooseDemand(id){
  var picked = id ? demandPicker.list.filter(function(d){ return d.id === id; })[0] : null;
  if(id && !picked) return;
  var changed = ($("cDemand").value || "") !== (id || "");
  setDemandValue(id || "", picked ? picked.title : "", picked ? demandStatusLabel(picked.status) : "");
  UI.closeAllPops();
  var anchor = $("cDemandPicker");
  if(anchor) anchor.focus({ preventScroll:true });
  if(changed){
    applyDemandModule(picked);
    syncCaseTasksForDemand();
  }
}

/* ---------- 目录继承：需求上的模块作为用例目录的默认值 ---------- */
var caseModuleInherited = ""; /* 需求带出的目录；空表示这条需求没有指定模块 */

function setModuleValue(id){
  var sel = $("cModule");
  if(!sel || !id) return false;
  for(var i = 0; i < sel.options.length; i++){
    if(sel.options[i].value === id){ sel.value = id; return true; }
  }
  return false;
}
function applyDemandModule(demand){
  var catId = demand && demand.categoryId ? demand.categoryId : "";
  caseModuleInherited = catId;
  if(catId){
    caseFormModulePrev = catId;
    if(setModuleValue(catId)){
      renderModuleTag();
      return;
    }
    loadFormModules(caseFormReqId, catId).then(renderModuleTag);
    return;
  }
  renderModuleTag();
}
function renderModuleTag(){
  var tag = $("cModuleTag"), inherit = $("cModuleInherit"), sel = $("cModule");
  if(!tag || !sel) return;
  var v = sel.value || "";
  if(v === "__new") v = "";
  if(caseModuleInherited && v === caseModuleInherited){
    tag.textContent = "继承自需求";
    tag.className = "cf-tag ok";
  }else if(caseModuleInherited && v){
    tag.textContent = "已手动指定";
    tag.className = "cf-tag";
  }else if(v){
    tag.textContent = "已指定";
    tag.className = "cf-tag";
  }else{
    tag.textContent = "未归类";
    tag.className = "cf-tag warn";
  }
  tag.hidden = false;
  if(inherit) inherit.hidden = !(caseModuleInherited && v && v !== caseModuleInherited);
  syncModulePath();
}
/* 模块是项目内的目录：把「项目 › 目录 › 子目录」摊开，避免同名节点看不出归属 */
function syncModulePath(){
  var el = $("cModulePath");
  if(!el) return;
  var sel = $("cModule");
  var id = sel && sel.value !== "__new" ? sel.value : "";
  var nodes = caseFormModules.length ? caseFormModules : caseModuleNodes;
  var path = id ? modulePathOf(id, nodes) : "";
  if(!path){ el.hidden = true; el.innerHTML = ""; return; }
  var full = [reqNameOf(caseFormReqId), path.replace(/ \/ /g, " › ")].filter(Boolean).join(" › ");
  el.innerHTML = "位置：<b>" + esc(full) + "</b>";
  el.hidden = false;
}

/* ---------- 验证工作项：先选主需求，再选该需求下的工作项 ---------- */
function resetCaseTaskState(){
  caseTaskSel = {};
  caseTaskOptions = [];
  caseTaskLoading = false;
  caseTaskError = null;
  caseTaskQuery = "";
  caseTaskSeq++;
  var input = $("cTaskSearch");
  if(input) input.value = "";
}

function syncCaseTasksForDemand(){
  resetCaseTaskState();
  var demandId = $("cDemand").value || "";
  if(!demandId){ renderCaseTaskPicker(); return; }
  loadCaseTaskOptions();
}

function loadCaseTaskOptions(){
  var demandId = $("cDemand").value || "";
  if(!demandId){ renderCaseTaskPicker(); return; }
  var seq = ++caseTaskSeq;
  caseTaskLoading = true;
  caseTaskError = null;
  renderCaseTaskPicker();
  API.get("/api/test-cases/task-options", { reqId: caseFormReqId, demandId: demandId }).then(function(rows){
    if(seq !== caseTaskSeq) return;
    caseTaskLoading = false;
    caseTaskOptions = rows || [];
    /* 已选项如果不在候选里（历史悬空关联），保留标题但不再显示勾选；保存时按当前选择重算 */
    renderCaseTaskPicker();
  }).catch(function(ex){
    if(seq !== caseTaskSeq) return;
    caseTaskLoading = false;
    caseTaskError = (ex && ex.message) || "工作项加载失败";
    renderCaseTaskPicker();
  });
}

function renderCaseTaskPicker(){
  var box = $("cTaskBox"), list = $("cTaskList"), empty = $("cTaskEmpty");
  var tools = $("cTaskTools"), count = $("cTaskCount");
  if(!box || !list || !empty) return;
  var demandId = $("cDemand").value || "";
  var selected = Object.keys(caseTaskSel);
  var ro = !caseFormWritable();
  var search = $("cTaskSearch");
  if(search) search.disabled = ro;
  if(tools) tools.hidden = !demandId;
  if(count){
    count.textContent = caseTaskLoading ? "加载中…"
      : (caseTaskOptions.length
        ? "已选 " + selected.length + " / " + caseTaskOptions.length
        : (caseTaskError ? "加载失败" : "暂无工作项"));
  }
  if(!demandId){
    list.hidden = true;
    list.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "关联主需求后，可选择该需求下的工作项。";
    return;
  }
  if(caseTaskLoading && !caseTaskOptions.length){
    list.hidden = false;
    empty.hidden = true;
    list.innerHTML = UI.skeletonRows(3);
    return;
  }
  if(caseTaskError){
    list.hidden = false;
    empty.hidden = true;
    list.innerHTML = '<div class="case-task-empty">' + esc(caseTaskError)
      + ' <button class="btn sm ghost" type="button" data-task-retry>重试</button></div>';
    return;
  }
  if(!caseTaskOptions.length){
    list.hidden = true;
    list.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "该需求下还没有工作项；先在需求详情「拆分为工作项」。";
    return;
  }
  var q = caseTaskQuery.toLowerCase();
  var rows = caseTaskOptions.filter(function(t){
    if(!q) return true;
    return ((t.taskTitle || "") + " " + (itemNoText(t.itemNo) || "")).toLowerCase().indexOf(q) >= 0;
  });
  if(!rows.length){
    list.hidden = false;
    empty.hidden = true;
    list.innerHTML = '<div class="case-task-empty">没有匹配的工作项，换个关键词试试。</div>';
    return;
  }
  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = rows.map(function(t){
    var no = itemNoText(t.itemNo);
    var meta = [typeName(t.itemType), colName(t.boardColumn)];
    if(no) meta.unshift(no);
    return '<label class="case-task-option">'
      + '<input type="checkbox" data-case-task="' + esc(t.taskId) + '"'
      + (caseTaskSel[t.taskId] ? " checked" : "") + (ro ? " disabled" : "") + ' />'
      + '<span class="case-task-option-main">'
      +   '<span class="case-task-option-title">' + esc(t.taskTitle || t.taskId) + taskPublicationHTML(t) + '</span>'
      +   '<span class="case-task-option-meta">' + esc(meta.filter(Boolean).join(" · ")) + '</span>'
      + '</span></label>';
  }).join("");
}

function toggleCaseTask(taskId, on){
  if(on){
    var found = caseTaskOptions.filter(function(t){ return t.taskId === taskId; })[0];
    if(found) caseTaskSel[taskId] = found;
  }else{
    delete caseTaskSel[taskId];
  }
  renderCaseTaskPicker();
}

function openDemandPicker(){
  if(!caseFormWritable()) return;
  if(demandPicker.el && UI.popOpen(demandPicker.el)){ UI.closeAllPops(); return; }
  var anchor = $("cDemandPicker");
  if(!anchor || !caseFormReqId) return;
  clearTimeout(demandPicker.timer);
  var seq = ++demandPicker.seq;
  var el = document.createElement("div");
  el.className = "menu search-picker";
  el.id = "cDemandPickerPop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "选择关联需求");
  el.innerHTML = '<div class="search-picker-head">'
    + '<div class="search-picker-search">' + icon("search", 15)
    + '<input type="search" data-demand-search placeholder="搜索需求标题、描述或来源" aria-label="搜索需求" autocomplete="off" /></div>'
    + '<div class="search-picker-tools"><span class="search-picker-count" data-demand-count role="status"></span></div>'
    + '</div>'
    + '<div class="search-picker-results" data-demand-results></div>'
    + '<div class="search-picker-foot">仅本项目需求池；输入关键词可搜索全部条目</div>';
  demandPicker.el = el;
  demandPicker.query = "";
  demandPicker.error = null;
  demandPicker.list = [];
  demandPicker.total = 0;
  demandPicker.reqSeq++;
  anchor.setAttribute("aria-controls", el.id);
  var fieldWidth = anchor.getBoundingClientRect().width;
  UI.openPop(el, anchor, {
    align:"left",
    width:Math.max(280, Math.min(fieldWidth || 460, window.innerWidth - 24)),
    onClose:function(){
      if(demandPicker.el === el) demandPicker.el = null;
      demandPicker.seq++;
      clearTimeout(demandPicker.timer);
      el.remove();
    }
  });
  el.addEventListener("input", function(e){
    if(!e.target.closest("[data-demand-search]")) return;
    demandPicker.query = e.target.value.trim();
    clearTimeout(demandPicker.timer);
    if(!demandPicker.query){
      demandPicker.reqSeq++;
      demandPicker.loading = false;
      demandPicker.error = null;
      resetDemandFirstPage();
      renderDemandPicker();
      return;
    }
    demandPicker.timer = setTimeout(function(){
      if(seq !== demandPicker.seq) return;
      searchDemands(el, seq, demandPicker.query);
    }, DEMAND_SEARCH_DEBOUNCE);
  });
  el.addEventListener("click", function(e){
    var option = e.target.closest("[data-demand-id]");
    if(option){ chooseDemand(option.getAttribute("data-demand-id")); return; }
    if(e.target.closest("[data-demand-clear]")){ chooseDemand(""); return; }
    if(e.target.closest("[data-demand-reset]")){
      var input = el.querySelector("[data-demand-search]");
      input.value = "";
      demandPicker.query = "";
      demandPicker.reqSeq++;
      demandPicker.loading = false;
      demandPicker.error = null;
      resetDemandFirstPage();
      renderDemandPicker();
      input.focus();
      return;
    }
    if(e.target.closest("[data-demand-retry]")){
      if(demandPicker.query) searchDemands(el, seq, demandPicker.query);
      else loadDemandFirstPage(el, seq);
    }
  });
  el.addEventListener("keydown", function(e){
    if(e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var buttons = Array.prototype.slice.call(el.querySelectorAll(".search-picker-clear,.search-picker-option"));
    if(!buttons.length) return;
    e.preventDefault();
    var index = buttons.indexOf(document.activeElement);
    var next = e.key === "ArrowDown" ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
    buttons[next].focus();
  });
  if(demandOptions.reqId === caseFormReqId && demandOptions.list.length && !demandOptions.error){
    resetDemandFirstPage();
    renderDemandPicker();
  }else{
    loadDemandFirstPage(el, seq);
  }
  setTimeout(function(){
    var input = el.querySelector("[data-demand-search]");
    if(input) input.focus();
  }, 40);
}
function syncPriOptions(){
  $("cPri").innerHTML = '<option value="">不设置</option>'
    + PRIORITIES.map(function(p){
      return '<option value="' + p + '">' + p + ' · ' + esc(priName(p)) + '</option>';
    }).join("");
  renderPriSeg();
}
/* 优先级分段：原生 select 只承载取值，按钮负责展示与点击 */
function renderPriSeg(){
  var seg = $("cPriSeg"), sel = $("cPri");
  if(!seg || !sel) return;
  var cur = sel.value || "";
  var html = '<button type="button" data-pri="" class="' + (cur ? "" : "on") + '" aria-pressed="' + (cur ? "false" : "true") + '">不设置</button>';
  PRIORITIES.forEach(function(p){
    var on = cur === p;
    html += '<button type="button" data-pri="' + p + '" class="' + (on ? "on" : "") + '" aria-pressed="' + on + '" title="' + esc(priName(p)) + '">' + p + '</button>';
  });
  seg.innerHTML = html;
  seg.querySelectorAll("button").forEach(function(b){ b.disabled = !caseFormWritable(); });
}

/* ---------- 头部上下文 / 字数 / 错误汇总 ---------- */
function syncCaseFormCtx(c){
  var el = $("caseFormCtx");
  if(!el) return;
  var parts = [];
  if(!caseFormWritable()) parts.push('<span class="cf-ro">' + icon("lock", 11) + '只读</span>');
  var req = reqNameOf(caseFormReqId);
  if(req) parts.push(esc(req));
  var no = c && caseNoText(c);
  if(no) parts.push("编号 <b>" + esc(no) + "</b>");
  else if(caseFormWritable()) parts.push("保存后自动编号");
  if(!c && caseFormWritable()) parts.push('<span class="cf-only">只有标题必填</span>');
  el.innerHTML = parts.join('<span class="cf-sep" aria-hidden="true">·</span>');
  el.hidden = !parts.length;
}
function syncCaseTitleMeta(){
  var input = $("cTitle"), count = $("cTitleCount");
  if(!input || !count) return;
  count.textContent = input.value.length + " / " + (input.maxLength > 0 ? input.maxLength : 100);
}
function showCaseErrors(list){
  var box = $("caseErrSum"), title = $("caseErrTitle"), links = $("caseErrLinks");
  if(!box) return;
  list = list || [];
  box.hidden = !list.length;
  if(!list.length){
    if(links) links.innerHTML = "";
    return;
  }
  if(title) title.textContent = "还有 " + list.length + " 处需要处理";
  if(links){
    links.innerHTML = list.map(function(it){
      return '<button type="button" data-case-err="' + esc(it.id) + '">' + esc(it.label) + '</button>';
    }).join("");
  }
}
function syncCaseMore(){
  var more = $("caseMore");
  if(!more) return;
  more.open = !!($("cPrecondition").value.trim() || $("cTestData").value.trim());
  syncCaseMoreMeta();
}
/* 收起时也能看出填了几项，不用展开确认 */
function syncCaseMoreMeta(){
  var meta = $("caseMoreMeta");
  if(!meta) return;
  var n = ($("cPrecondition").value.trim() ? 1 : 0) + ($("cTestData").value.trim() ? 1 : 0);
  meta.textContent = (n ? "已填 " + n + " 项" : "未填") + " · 选填";
}

/* 弹窗所属项目的目录树：全部项目下新建到别的项目时，不能拿浏览项目的节点当候选 */
function loadFormModules(reqId, selected){
  caseFormModuleReq = reqId;
  if(reqId === caseReqId && !caseScopeAll && caseModuleNodes.length){
    caseFormModules = caseModuleNodes;
    fillModuleSelect($("cModule"), caseFormModules, selected, false);
    appendNewModuleOption();
    renderModuleTag();
    return Promise.resolve(caseFormModules);
  }
  fillModuleSelect($("cModule"), [], selected, false);
  appendNewModuleOption();
  renderModuleTag();
  return API.get("/api/test-modules", { reqId: reqId }).then(function(nodes){
    if(caseFormModuleReq !== reqId) return caseFormModules;
    caseFormModules = nodes || [];
    fillModuleSelect($("cModule"), caseFormModules, selected, false);
    appendNewModuleOption();
    renderModuleTag();
    return caseFormModules;
  }).catch(function(){
    if(caseFormModuleReq === reqId) caseFormModules = [];
    renderModuleTag();
    return caseFormModules;
  });
}
function moduleNameById(nodes, id){
  if(!id) return "";
  var hit = (nodes || []).filter(function(n){ return n.id === id; })[0];
  return hit ? hit.name || "" : "";
}
function appendNewModuleOption(){
  var sel = $("cModule");
  if(!sel || !caseFormWritable()) return;
  var o = document.createElement("option");
  o.value = "__new";
  o.textContent = "＋ 新建目录…";
  sel.appendChild(o);
}
function openNewDialog(targetReqId){
  caseFormReqId = targetReqId || caseReqId || null;
  if(!caseFormReqId){ toast("先选择项目，再新建用例", "warn"); return; }
  editingCase = { id: null, steps: [{ action: "", expected: "" }] };
  $("caseFormTitle").textContent = "新建用例";
  resetCaseTimeline();
  $("cTitle").value = "";
  /* 从目录节点筛选进来时，新用例默认落在该节点，省一次归类 */
  var preset = !caseScopeAll && moduleFilter !== "all" && moduleFilter !== "__none" ? moduleFilter : "";
  caseFormModulePrev = preset;
  caseModuleInherited = "";
  loadFormModules(caseFormReqId, preset);
  syncPriOptions();
  $("cPri").value = "P2";
  renderPriSeg();
  $("cPrecondition").value = "";
  $("cTestData").value = "";
  setDemandValue("", "");
  resetCaseTaskState();
  renderCaseTaskPicker();
  loadDemandOptions(caseFormReqId);
  renderStepRows();
  applyReadOnly(!caseFormWritable());
  syncCaseFormCtx(null);
  syncCaseTitleMeta();
  syncCaseMore();
  showCaseErrors([]);
  caseFormBaseline = caseFormSnapshot();
  caseDetailId = null;
  caseDetailRuns = null;
  caseDetailSeq++;
  $("caseDetailView").hidden = true;
  $("caseEditBody").hidden = false;
  $("caseEditBack").hidden = false;
  UI.openModal($("dlgCase"), "#cTitle");
}
/* 全部项目下新建用例必须先落到一个可写项目：只有一个目标就直接开，多个目标用菜单选 */
function openCaseCreate(){
  var targets = caseCreateTargets();
  if(!targets.length){
    toast(caseScopeAll ? "全部项目里没有可写项目，无法新建用例" : "当前项目只读，无法新建用例", "warn");
    return;
  }
  if(targets.length === 1){ openNewDialog(targets[0]); return; }
  var btn = $("btnCaseNew");
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = '<div class="menu-title">新建用例到</div>'
    + targets.map(function(id){
      return '<button class="menu-item" type="button" data-case-target="' + esc(id) + '">'
        + '<span>' + esc(reqNameOf(id)) + '</span></button>';
    }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-case-target]");
    if(!b) return;
    var id = b.getAttribute("data-case-target");
    UI.closeAllPops();
    openNewDialog(id);
  });
  UI.openPop(el, btn, { align: "right", width: 240, onClose: function(){ el.remove(); } });
}
/* 改成右侧抽屉后，列表点行先看，再看细节；编辑是抽屉内的显式动作 */
function openCaseDetail(id){
  var c = caseById(id);
  if(!c) return;
  caseDetailId = id;
  caseDetailTab = "overview";
  caseDetailRuns = null;
  caseDetailEditing = false;
  caseDetailDraft = null;
  caseInlineEdit = null;
  caseInlineNewStep = null;
  caseDetailFocusTitle = false;
  caseDraftFocusStep = null;
  caseFormReqId = c.reqId || caseReqId;
  $("caseEditBody").hidden = true;
  $("caseDetailView").hidden = false;
  $("caseEditBack").hidden = true;
  renderCaseDetail();
  UI.openModal($("dlgCase"));
  loadCaseDetailRuns(id);
  loadCaseDetailModules(c.reqId);
  /* 每次打开都取最新归属：分组可能在左侧面板或其他会话里改过 */
  loadCaseDetailSets(c, true);
}
function openEditDialog(id){
  var c = caseById(id);
  if(!c) return;
  if(caseDetailId !== id){
    openCaseDetail(id);
  }else if(!caseDetailEditing){
    renderCaseDetail();
  }
  startCaseDetailEdit();
}
function caseDefectsOf(runs){
  var seen = {}, out = [];
  (runs || []).forEach(function(r){
    if(!r.bugTaskId || seen[r.bugTaskId]) return;
    seen[r.bugTaskId] = 1;
    out.push({ id: r.bugTaskId, title: r.bugTaskTitle || "", at: r.createdAt });
  });
  return out;
}
function loadCaseDetailRuns(id){
  var seq = ++caseDetailSeq;
  API.getAllPages("/api/test-cases/" + encodeURIComponent(id) + "/runs").then(function(list){
    if(seq !== caseDetailSeq || caseDetailId !== id) return;
    caseDetailRuns = list || [];
    syncCaseDetailCounts();
    if(caseDetailTab === "runs" || caseDetailTab === "defects") renderCaseDetail();
  }).catch(function(){
    if(seq !== caseDetailSeq || caseDetailId !== id) return;
    caseDetailRuns = [];
    syncCaseDetailCounts();
  });
}
function caseDetailCounts(c){
  return {
    runs: caseDetailRuns ? caseDetailRuns.length : "…",
    defects: caseDetailRuns ? caseDefectsOf(caseDetailRuns).length : "…"
  };
}
function syncCaseDetailCounts(){
  var c = caseById(caseDetailId), box = $("caseDetailView");
  if(!c || !box) return;
  var n = caseDetailCounts(c);
  ["runs", "defects"].forEach(function(k){
    var el = box.querySelector('[data-count="' + k + '"]');
    if(el) el.textContent = n[k];
  });
}

/* ---------- 抽屉字段说明：默认只留 ?，点开看口径 ---------- */
var CASE_HINTS = {
  priority: { t: "优先级口径", b: "P0 阻塞主流程、必须回归；P1 核心功能；P2 一般功能；P3 边缘场景。不设置表示暂不区分，不影响保存与执行。" },
  module: { t: "模块取自哪里", b: "模块就是项目目录节点：一条用例只归一个模块，用于筛选、分组与统计。需求带了目录时新建会默认继承，之后可单独调整。" },
  demand: { t: "关联需求能带出什么", b: "候选只列本项目需求。关联后可从该需求下挑验证工作项，覆盖会同时记到需求与工作项。" },
  step: { t: "步骤怎么写", b: "操作写做了什么，预期写看到什么；预期可留空，表示只记录操作。最多 30 行。" }
};
function caseHintBtn(key){
  var h = CASE_HINTS[key];
  return h ? '<button class="case-hint-btn" type="button" data-case-hint="' + key + '" aria-label="' + esc(h.t) + '">?</button>' : "";
}
function openCaseHint(key, anchor){
  var h = CASE_HINTS[key];
  if(!h) return;
  var el = document.createElement("div");
  el.className = "menu case-hint-pop";
  el.innerHTML = '<div class="menu-title">' + esc(h.t) + '</div><p class="case-hint-text">' + esc(h.b) + '</p>';
  UI.openPop(el, anchor, { width: 300 });
}
function casePriText(p){
  return p ? esc(priName(p) || p) : '<span class="muted">未设置</span>';
}
/* 目录节点只存 parentId：抽屉按祖先链拼「一级 / 二级 / 末级」，末段加粗 */
function modulePathById(nodes, id){
  if(!id) return [];
  var map = {};
  (nodes || []).forEach(function(n){ map[n.id] = n; });
  var out = [], cur = map[id], guard = 0;
  while(cur && guard++ < 64){
    out.unshift(cur.name || "");
    cur = cur.parentId ? map[cur.parentId] : null;
  }
  return out;
}
function caseModuleText(c){
  var path = modulePathById(caseDetailModules.list, c.moduleId);
  if(path.length){
    return path.map(function(n, i){
      return i === path.length - 1 ? '<b>' + esc(n) + '</b>' : esc(n);
    }).join(' <span class="case-path-sep">/</span> ');
  }
  return c.module ? esc(c.module) : '<span class="muted">未归类</span>';
}
/* 关键信息才用小卡：优先级可改，执行人 / 最近执行为派生值 */
function caseKeyCard(k, v, opts){
  opts = opts || {};
  return '<div class="case-kcard' + (opts.act ? ' is-edit' : '') + '"'
    + (opts.act ? ' data-case-act="' + opts.act + '" role="button" tabindex="0" title="修改' + esc(k) + '"' : "") + '>'
    + '<span class="kk">' + esc(k) + (opts.hint ? caseHintBtn(opts.hint) : "")
    + (opts.derived ? '<span class="case-derived">' + opts.derived + '</span>' : "")
    + (opts.act ? '<span class="case-pencil" aria-hidden="true">' + icon("edit", 11) + '</span>' : "")
    + '</span><div class="kv">' + v + '</div></div>';
}
function caseSetScopeLabel(s){
  return s.visibility === "personal" ? "仅我" : (s.visibility === "members" ? "指定" : "团队");
}
function caseSetChipsHTML(c, writable){
  var sets = caseDetailSets.caseId === c.id ? caseDetailSets.list : null;
  var html = "";
  if(caseDetailSets.caseId === c.id && caseDetailSets.error){
    html = '<span class="case-empty-v">分组加载失败</span>';
  }else if(sets === null || (caseDetailSets.caseId === c.id && caseDetailSets.loading && !sets.length)){
    html = '<span class="case-empty-v">分组加载中…</span>';
  }else{
    var mine = sets.filter(function(s){ return s.inCase; });
    html = mine.length ? mine.map(function(s){
      return '<span class="case-setchip">' + esc(s.name)
        + '<span class="sh">' + esc(caseSetScopeLabel(s)) + '</span></span>';
    }).join("") : '<span class="case-empty-v">未加入分组</span>';
  }
  if(writable){
    var has = sets && sets.some(function(s){ return s.inCase; });
    html += '<button type="button" class="case-affil-link" data-case-act="sets">' + (has ? "管理分组" : "加入分组") + '</button>';
  }
  return html;
}
function caseWorkChipsHTML(tasks, clickable){
  return tasks.map(function(t){
    var inner = '<span class="case-wdot' + (t.boardColumn === "done" ? ' done' : '') + '"></span>'
      + '<span class="t">' + esc(t.taskTitle || t.taskId) + '</span>';
    return clickable
      ? '<button type="button" class="case-witem" data-case-task="' + esc(t.taskId) + '" title="打开工作项">' + inner + '</button>'
      : '<span class="case-witem is-ro">' + inner + '</span>';
  }).join("");
}
/* 区块标题在卡片外：追溯 / 归类，一行一个维度 */
function caseSecHeadHTML(title, sub, tag){
  return '<div class="case-sec-head"><h4>' + esc(title) + '</h4>'
    + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '')
    + (tag ? '<span class="tag">' + esc(tag) + '</span>' : '') + '</div>';
}
function caseSecHTML(title, sub, tag, rows, note){
  return '<section class="case-sec">' + caseSecHeadHTML(title, sub, tag)
    + '<div class="case-affil">' + rows + '</div>'
    + (note ? '<p class="case-sec-note">' + note + '</p>' : '') + '</section>';
}
function caseAffilRowHTML(label, inner, opts){
  opts = opts || {};
  var cls = "case-affil-row" + (opts.act ? " is-edit" : "") + (opts.ro ? " is-ro" : "");
  var tag = opts.act ? ' data-case-act="' + opts.act + '" role="button" tabindex="0"'
    + (opts.title ? ' title="' + esc(opts.title) + '"' : "") : "";
  return '<div class="' + cls + '"' + tag + '><span class="ak">' + esc(label)
    + (opts.hint ? caseHintBtn(opts.hint) : "")
    + (opts.act ? '<span class="case-pencil" aria-hidden="true">' + icon("edit", 11) + '</span>' : "")
    + '</span><div class="av">' + inner + '</div></div>';
}
/* 验证工作项一行说完：chips 带完成点；编辑态每项可就地移除 */
function caseWorkValueHTML(tasks, writable, edit){
  if(!tasks.length){
    return '<span class="case-empty-v">未挂工作项</span>'
      + (writable ? '<button type="button" class="case-affil-link" data-case-act="tasks">挂工作项</button>' : '');
  }
  var chips = edit
    ? tasks.map(function(t){
      var title = t.taskTitle || t.taskId;
      return '<span class="case-witem"><span class="case-wdot' + (t.boardColumn === "done" ? ' done' : '') + '"></span>'
        + '<span class="t">' + esc(title) + '</span>'
        + '<button type="button" class="x" data-case-act="edit-task-remove" data-task-id="' + esc(t.taskId) + '"'
        + ' aria-label="移除 ' + esc(title) + '">' + icon("close", 11) + '</button></span>';
    }).join("")
    : caseWorkChipsHTML(tasks, writable);
  return chips + (writable
    ? '<button type="button" class="' + (edit ? 'case-wadd' : 'case-affil-link') + '" data-case-act="tasks">'
      + (edit ? icon("plus", 11) + ' 挂工作项' : '调整') + '</button>'
    : '');
}
function caseDetailMetaText(c){
  var parts = [reqNameOf(c.reqId), caseNoText(c)];
  if(c.latestStatus) parts.push("最近执行 " + (STATUS_LABEL[c.latestStatus] || c.latestStatus));
  return esc(parts.filter(Boolean).join(" · "));
}
function caseReadBlock(title, text, empty, field, writable){
  if(field && writable && caseInlineEdit && caseInlineEdit.kind === field){
    return '<section class="case-read-block is-editing"><h4>' + esc(title) + '</h4>'
      + '<textarea class="case-block-input" data-case-block-edit="' + field + '" maxlength="1000"'
      + ' placeholder="' + esc(field === "pre" ? "选填：数据准备、环境要求…" : "执行时要准备的账号、金额、边界值") + '">'
      + esc(text || "") + '</textarea>'
      + '<span class="case-kbd-note">失焦或 Ctrl+Enter 保存 · Esc 还原</span></section>';
  }
  return '<section class="case-read-block' + (field && writable ? " case-block-edit" : "") + '"'
    + (field && writable ? ' data-case-act="' + field + '" role="button" tabindex="0" title="点击编辑' + esc(title) + '"' : "") + '>'
    + '<h4>' + esc(title) + '</h4>'
    + '<p class="case-read-text' + (text ? '' : ' muted') + '">' + (text ? esc(text) : esc(empty || "未设置")) + '</p></section>';
}
function caseDemandCell(c, writable){
  if(!c.demandId){
    return writable
      ? '<button type="button" class="case-affil-link" data-case-act="demand">关联需求</button>'
      : '<span class="muted">未关联</span>';
  }
  return '<span class="case-demand-title">' + esc(c.demandTitle || c.demandId) + '</span>'
    + '<button type="button" class="case-jump" data-case-jump="demand" title="打开需求详情" aria-label="打开需求详情">'
    + icon("extlink", 12) + '</button>';
}
function caseDetailOverview(c, writable){
  var tasks = c.tasks || [];
  var keys = '<div class="case-keyrow">'
    + caseKeyCard("优先级", casePriText(c.priority), { act: writable ? "priority" : "", hint: "priority" })
    + caseKeyCard("执行人", c.latestBy ? esc(c.latestBy) : '<span class="muted">未执行</span>', { derived: "派生" })
    + caseKeyCard("最近执行", c.latestAt
      ? esc(fmtTs(c.latestAt)) + (c.latestStatus ? '<span class="case-kv-sub">' + (STATUS_LABEL[c.latestStatus] || "") + '</span>' : "")
      : '<span class="muted">未执行</span>', { derived: "派生" })
    + '</div>';
  var last = "";
  if(c.latestStatus){
    var bug = c.latestBugTaskId
      ? '<button class="btn sm ghost" type="button" data-case-bug="' + esc(c.latestBugTaskId) + '">缺陷 · '
        + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 18)) + '</button>'
      : (writable && c.latestStatus !== "passed"
        ? '<button class="btn sm ghost" type="button" data-case-defect>转缺陷</button>' : '');
    last = '<section class="case-read-block"><h4>最近一次执行'
      + '<button class="btn sm ghost" type="button" data-case-tab="runs">全部记录</button></h4>'
      + '<div class="case-last-run">'
      + '<div>' + statusBadgeHTML(c.latestStatus)
      + ' <span class="when">' + esc(c.latestBy || "") + (c.latestAt ? ' · ' + fmtTs(c.latestAt) : '') + '</span></div>'
      + (c.latestNote ? '<p class="note">' + esc(c.latestNote) + '</p>' : '')
      + '<div class="case-last-acts">'
      + (c.latestEvidenceCount ? '<span>证据 ' + c.latestEvidenceCount + ' 个</span>' : '')
      + bug + '</div></div></section>';
  } else {
    last = '<section class="case-read-block"><h4>最近一次执行</h4>'
      + '<p class="case-read-text muted">还没有执行记录；' + (writable ? '点右上「记录执行」记录第一次结果。' : '等待有权限的成员执行。') + '</p></section>';
  }
  return keys
    + caseSecHTML("追溯", "这条用例在验证什么", "建议关联",
      caseAffilRowHTML("关联需求", caseDemandCell(c, writable),
        { act: writable ? "demand" : "", title: "修改关联需求" })
      + caseAffilRowHTML("验证工作项", caseWorkValueHTML(tasks, writable, false)),
      writable ? '未挂工作项时按<b>需求级</b>统计覆盖；挂上后可按工作项追溯。' : '')
    + caseSecHTML("归类", "放在哪、归谁管", "可选",
      caseAffilRowHTML("模块", caseModuleText(c),
        { act: writable ? "module" : "", title: "修改模块" })
      + caseAffilRowHTML("分组", caseSetChipsHTML(c, writable)))
    + caseReadBlock("前置条件", c.precondition, "未设置前置条件", "pre", writable)
    + caseReadBlock("测试数据", c.testData, "未设置测试数据", "testData", writable)
    + caseDetailSteps(c, writable)
    + last
    + '<details class="entity-log case-timeline" id="caseTimeline" hidden>'
    + '<summary><span class="caret" aria-hidden="true">▶</span>变更记录 <span class="cnt" id="caseTimelineCount"></span></summary>'
    + '<div class="timeline" id="caseTimelineList"></div></details>';
}
function caseStepCellHTML(step, i, k, writable){
  var editing = caseInlineEdit && caseInlineEdit.kind === "step" && caseInlineEdit.i === i && caseInlineEdit.k === k;
  var val = k === "action" ? (step.action || "") : (step.expected || "");
  if(editing){
    return '<textarea class="case-step-input" data-case-step-edit="' + k + '" data-i="' + i + '" maxlength="' + (k === "action" ? 200 : 500)
      + '" placeholder="' + (k === "action" ? "做了什么" : "看到什么（可留空）") + '">' + esc(caseInlineEdit.text || "") + '</textarea>';
  }
  var text = val || (k === "action" ? "（未填写操作）" : "（未填写预期）");
  var cls = "case-step-cell" + (val ? "" : " muted") + (writable ? " editable" : "");
  return '<div class="' + cls + '"' + (writable ? ' data-case-act="step" data-i="' + i + '" data-k="' + k + '" role="button" tabindex="0"' : "") + '>'
    + esc(text) + '</div>';
}
function caseStepRowHTML(step, i, total, writable){
  var acts = writable ? '<span class="case-step-acts">'
    + '<button type="button" data-case-act="step-ins" data-i="' + i + '" title="在下方插入" aria-label="在步骤 ' + (i + 1) + ' 下方插入">' + icon("plus", 13) + '</button>'
    + '<button type="button" data-case-act="step-up" data-i="' + i + '" title="上移"' + (i === 0 ? " disabled" : "") + '>' + icon("up", 13) + '</button>'
    + '<button type="button" data-case-act="step-down" data-i="' + i + '" title="下移"' + (i === total - 1 ? " disabled" : "") + '>' + icon("down", 13) + '</button>'
    + '<button type="button" class="danger" data-case-act="step-del" data-i="' + i + '" title="删除该步骤">' + icon("trash", 13) + '</button>'
    + '</span>' : '<span></span>';
  return '<div class="case-step-row"><span class="case-step-no">' + (i + 1) + '</span>'
    + caseStepCellHTML(step, i, "action", writable)
    + caseStepCellHTML(step, i, "expected", writable)
    + acts + '</div>';
}
/* 阅读态新增/插入的步骤只是本地占位行，不写进 c.steps（关抽屉或改点别处时不会留下空行） */
function caseStepsView(c){
  var steps = (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; });
  if(caseInlineNewStep !== null && caseInlineNewStep >= 0 && caseInlineNewStep <= steps.length){
    steps.splice(caseInlineNewStep, 0, { action: "", expected: "" });
  }
  return steps;
}
function caseDetailSteps(c, writable){
  var steps = caseStepsView(c);
  var rows = steps.map(function(s, i){ return caseStepRowHTML(s, i, steps.length, writable); }).join("");
  if(!steps.length){
    rows = '<div class="case-step-empty">还没有步骤'
      + (writable ? '；点下方「添加步骤」补充操作与预期。' : "。") + '</div>';
  }
  return '<section class="case-read-block case-steps-block">'
    + '<h4>怎么测：步骤与预期' + caseHintBtn("step")
    + '<span class="cnt">' + steps.length + " / 30 行</span></h4>"
    + '<div class="case-steps-grid' + (writable ? "" : " is-ro") + '">'
    + '<div class="case-steps-head"><span>#</span><span>操作步骤<span class="case-req">*</span></span><span>预期结果</span><span></span></div>'
    + rows + '</div>'
    + (writable ? '<div class="case-step-foot"><button class="btn sm ghost" type="button" data-case-act="step-add">'
      + icon("plus", 13) + ' 添加步骤</button>'
      + '<span class="case-kbd-note">点单元格直接改；失焦或 Ctrl+Enter 保存，Esc 还原</span></div>' : "")
    + '</section>';
}
function caseDetailRunsHTML(c, writable){
  if(caseDetailRuns === null) return '<p class="case-empty">正在加载执行记录…</p>';
  if(!caseDetailRuns.length){
    return '<p class="case-empty">还没有执行记录；' + (writable ? '点右上「记录执行」记录第一次结果。' : '等待有权限的成员执行。') + '</p>';
  }
  return caseDetailRuns.map(function(r){
    var bug = r.bugTaskId
      ? '<button class="btn sm ghost" type="button" data-case-bug="' + esc(r.bugTaskId) + '">缺陷工作项</button>' : '';
    return '<div class="run-item"><div class="run-top">' + statusBadgeHTML(r.status)
      + '<span class="run-by">' + esc(r.executedBy || "—") + '</span>'
      + '<span class="run-at">' + esc(fmtTs(r.createdAt) || "—") + '</span>'
      + (r.environment ? '<span class="run-env">' + esc(cut(r.environment, 26)) + '</span>' : '')
      + (bug ? '<span class="run-acts">' + bug + '</span>' : '')
      + '</div>' + (r.note ? '<p class="run-note">' + esc(r.note) + '</p>' : '') + '</div>';
  }).join("");
}
function caseDetailDefectsHTML(){
  if(caseDetailRuns === null) return '<p class="case-empty">正在加载关联缺陷…</p>';
  var list = caseDefectsOf(caseDetailRuns);
  if(!list.length) return '<p class="case-empty">还没有转出缺陷；失败执行后可在概览里「转缺陷」。</p>';
  return '<div class="case-assoc">' + list.map(function(b){
    return '<button class="chip" type="button" data-case-bug="' + esc(b.id) + '">'
      + esc(b.title || b.id) + '</button>';
  }).join("") + '</div>';
}
function renderCaseDetail(){
  var c = caseById(caseDetailId);
  var box = $("caseDetailView");
  if(!c || !box){ if(box) box.innerHTML = ""; return; }
  var writable = caseWritable(c);
  var prevBody = box.querySelector(".case-detail-body");
  var keepTop = prevBody ? prevBody.scrollTop : 0;
  function restoreScroll(){
    var nb = box.querySelector(".case-detail-body");
    if(nb) nb.scrollTop = keepTop;
  }
  if(caseDetailEditing && caseDetailDraft){
    box.innerHTML = caseDetailEditHTML(c, writable);
    syncCaseDraftDirty();
    restoreScroll();
    var t = $("caseEditTitle");
    if(t) autoGrowCaseTitle(t);
    if(caseDetailFocusTitle){
      caseDetailFocusTitle = false;
      if(t){ t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    }
    if(caseDraftFocusStep !== null){
      var fs = caseDraftFocusStep;
      caseDraftFocusStep = null;
      var fta = box.querySelector('[data-case-draft-step="' + fs + '"][data-k="action"]');
      if(fta) fta.focus();
    }
    return;
  }
  var counts = caseDetailCounts(c);
  var tabs = [
    ["overview", "概览", null],
    ["runs", "执行历史", counts.runs],
    ["defects", "缺陷", counts.defects]
  ];
  var pane = caseDetailTab === "runs" ? caseDetailRunsHTML(c, writable)
    : caseDetailTab === "defects" ? caseDetailDefectsHTML()
      : caseDetailOverview(c, writable);
  box.innerHTML = '<div class="case-detail-head"><div class="case-detail-headline">'
    + '<div class="case-detail-titleline">' + statusBadgeHTML(c.latestStatus)
    + '<h2' + (writable ? ' class="case-title-edit" data-case-title-edit tabindex="0" title="点击修改标题" role="button"' : '') + '>'
    + esc(c.title || "未命名用例") + '</h2></div>'
    + '<p class="case-detail-meta">' + caseDetailMetaText(c) + '</p></div>'
    + '<div class="case-detail-acts">'
    + (writable ? '<button class="btn sm" type="button" data-case-run>记录执行</button>'
      + '<button class="btn sm primary" type="button" data-case-edit>编辑</button>' : '')
    + '<button class="icon-btn sm" type="button" data-case-close aria-label="关闭">' + icon("close", 15) + '</button>'
    + '</div></div>'
    + '<div class="case-detail-tabs" role="tablist">' + tabs.map(function(t){
      return '<button type="button" role="tab" data-case-tab="' + t[0] + '" aria-selected="' + (caseDetailTab === t[0]) + '"'
        + ' class="' + (caseDetailTab === t[0] ? 'on' : '') + '">' + t[1]
        + (t[2] === null ? '' : ' <span class="cnt" data-count="' + t[0] + '">' + t[2] + '</span>') + '</button>';
    }).join("") + '</div>'
    + '<div class="case-detail-body" role="tabpanel">' + pane + '</div>';
  restoreScroll();
  if(caseDetailTab === "overview") bindCaseTimeline(c.id);
}

/* ---------- 抽屉编辑态：与阅读态同一结构，草稿一次保存 ---------- */
var caseDetailFocusTitle = false;
var caseDraftFocusStep = null;
function caseDraftFrom(c){
  return {
    title: c.title || "",
    priority: c.priority || "",
    moduleId: c.moduleId || "",
    module: c.module || "",
    demandId: c.demandId || "",
    demandTitle: c.demandTitle || "",
    tasks: (c.tasks || []).map(function(t){
      return {
        taskId: t.taskId,
        taskTitle: t.taskTitle || "",
        itemType: t.itemType || "",
        boardColumn: t.boardColumn || "",
        itemNo: t.itemNo || null
      };
    }),
    precondition: c.precondition || "",
    testData: c.testData || "",
    steps: (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
}
function caseDraftBody(d, c){
  return {
    reqId: c.reqId,
    title: (d.title || "").trim(),
    precondition: (d.precondition || "").trim() || null,
    testData: (d.testData || "").trim() || null,
    moduleId: d.moduleId || null,
    module: null,
    priority: d.priority || null,
    demandId: d.demandId || null,
    taskIds: (d.tasks || []).map(function(t){ return t.taskId; }),
    steps: (d.steps || []).filter(function(s){ return s.action || s.expected; })
      .map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
}
function caseDraftDirty(){
  var c = caseById(caseDetailId);
  if(!c || !caseDetailDraft) return false;
  return JSON.stringify(caseDraftBody(caseDetailDraft, c)) !== JSON.stringify(caseDraftBody(caseDraftFrom(c), c));
}
function syncCaseDraftDirty(){
  var el = $("caseDraftDirty");
  if(el) el.hidden = !caseDraftDirty();
  var count = $("caseTitleCount");
  if(count && caseDetailDraft) count.textContent = (caseDetailDraft.title || "").length + " / 100";
}
function autoGrowCaseTitle(el){
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 68) + "px";
}
function caseDraftModuleOptions(d){
  var list = caseDetailModules.reqId === caseById(caseDetailId).reqId ? caseDetailModules.list : [];
  var html = '<option value=""' + (d.moduleId ? "" : " selected") + '>未归类（不选目录）</option>';
  list.forEach(function(n){
    var pad = "";
    for(var i = 1; i < Math.min(n.level || 1, 7); i++) pad += "　";
    html += '<option value="' + esc(n.id) + '"' + (d.moduleId === n.id ? " selected" : "") + '>'
      + esc(pad + (n.name || "")) + '</option>';
  });
  if(d.moduleId && !list.some(function(n){ return n.id === d.moduleId; })){
    html += '<option value="' + esc(d.moduleId) + '" selected>' + esc(d.module || "当前模块") + '</option>';
  }
  return html;
}
function caseDraftStepRowsHTML(d){
  return d.steps.map(function(s, i){
    return '<div class="case-step-row"><span class="case-step-no">' + (i + 1) + '</span>'
      + '<textarea class="case-step-input" data-case-draft-step="' + i + '" data-k="action" maxlength="200" placeholder="做了什么">' + esc(s.action) + '</textarea>'
      + '<textarea class="case-step-input" data-case-draft-step="' + i + '" data-k="expected" maxlength="500" placeholder="看到什么（可留空）">' + esc(s.expected) + '</textarea>'
      + '<span class="case-step-acts">'
      + '<button type="button" data-case-act="d-step-ins" data-i="' + i + '" title="在下方插入">' + icon("plus", 13) + '</button>'
      + '<button type="button" data-case-act="d-step-up" data-i="' + i + '" title="上移"' + (i === 0 ? " disabled" : "") + '>' + icon("up", 13) + '</button>'
      + '<button type="button" data-case-act="d-step-down" data-i="' + i + '" title="下移"' + (i === d.steps.length - 1 ? " disabled" : "") + '>' + icon("down", 13) + '</button>'
      + '<button type="button" class="danger" data-case-act="d-step-del" data-i="' + i + '" title="删除">' + icon("trash", 13) + '</button>'
      + '</span></div>';
  }).join("");
}
function caseDetailEditHTML(c, writable){
  var d = caseDetailDraft;
  var priSeg = [["", "不设置"]].concat(PRIORITIES.map(function(p){ return [p, p]; })).map(function(o){
    return '<button type="button" data-case-pri="' + o[0] + '" aria-pressed="' + (d.priority === o[0]) + '"'
      + ' title="' + esc(o[0] ? priName(o[0]) : "暂不区分") + '">' + o[1] + '</button>';
  }).join("");
  var keys = '<div class="case-keyrow">'
    + '<div class="case-kcard"><span class="kk">优先级' + caseHintBtn("priority") + '</span>'
    + '<div class="kv"><div class="case-seg" data-case-pri-seg role="group" aria-label="优先级">' + priSeg + '</div></div></div>'
    + caseKeyCard("执行人", c.latestBy ? esc(c.latestBy) : '<span class="muted">未执行</span>', { derived: "派生" })
    + caseKeyCard("最近执行", c.latestAt ? esc(fmtTs(c.latestAt)) : '<span class="muted">未执行</span>', { derived: "派生" })
    + '</div>';
  var trace = caseSecHTML("追溯", "这条用例在验证什么", "建议关联",
    caseAffilRowHTML("关联需求",
      (d.demandId
        ? '<span class="case-demand-title">' + esc(d.demandTitle || d.demandId) + '</span>'
          + '<button type="button" class="case-affil-link" data-case-act="edit-demand-clear">暂不关联</button>'
        : '<span class="muted">未关联</span>'),
      { act: "edit-demand", title: "修改关联需求" })
    + caseAffilRowHTML("验证工作项", caseWorkValueHTML(d.tasks, true, true)));
  var classify = caseSecHTML("归类", "放在哪、归谁管", "可选",
    caseAffilRowHTML("项目",
      esc(reqNameOf(c.reqId))
      + '<span class="case-dtag">' + icon("lock", 11) + ' 只读</span>'
      + '<span class="case-ro-note">由创建入口决定，不能在详情里改</span>',
      { ro: true })
    + caseAffilRowHTML("模块",
      '<select class="case-select" data-case-draft="moduleId" aria-label="模块">'
      + caseDraftModuleOptions(d) + '</select>')
    + caseAffilRowHTML("分组", caseSetChipsHTML(c, true)),
    '<b>模块是项目内的目录</b>：只能选「' + esc(reqNameOf(c.reqId)) + '」下的节点，选它不会改变所属项目。');
  var steps = d.steps.length
    ? caseDraftStepRowsHTML(d)
    : '<div class="case-step-empty">还没有步骤；点下方「添加步骤」补充操作与预期。</div>';
  return '<div class="case-detail-head case-detail-head-edit"><div class="case-detail-headline">'
    + '<div class="case-detail-titleline">' + statusBadgeHTML(c.latestStatus)
    + '<textarea class="case-title-input" id="caseEditTitle" rows="1" maxlength="100" aria-label="用例标题">'
    + esc(d.title) + '</textarea></div>'
    + '<p class="case-detail-meta">' + caseDetailMetaText(c)
    + '<span class="case-title-count" id="caseTitleCount">' + (d.title || "").length + ' / 100</span></p></div>'
    + '<div class="case-detail-acts"><span class="case-edit-badge">编辑中</span>'
    + '<button class="icon-btn sm" type="button" data-case-edit-cancel aria-label="退出编辑" title="退出编辑">' + icon("close", 15) + '</button>'
    + '</div></div>'
    + '<div class="case-detail-body" role="group" aria-label="编辑用例">' + keys + trace + classify
    + '<section class="case-read-block"><h4>前置条件</h4>'
    + '<textarea class="case-block-input" data-case-draft="precondition" maxlength="1000" placeholder="选填：数据准备、环境要求…">'
    + esc(d.precondition) + '</textarea></section>'
    + '<section class="case-read-block"><h4>测试数据</h4>'
    + '<textarea class="case-block-input" data-case-draft="testData" maxlength="1000" placeholder="执行时要准备的账号、金额、边界值">'
    + esc(d.testData) + '</textarea></section>'
    + '<section class="case-read-block case-steps-block">'
    + '<h4>怎么测：步骤与预期' + caseHintBtn("step")
    + '<span class="cnt">' + d.steps.length + ' / 30 行</span></h4>'
    + '<div class="case-steps-grid">'
    + '<div class="case-steps-head"><span>#</span><span>操作步骤<span class="case-req">*</span></span><span>预期结果</span><span></span></div>'
    + steps + '</div>'
    + '<div class="case-step-foot"><button class="btn sm ghost" type="button" data-case-act="d-step-add">'
    + icon("plus", 13) + ' 添加步骤</button>'
    + '<span class="case-kbd-note">步骤输入中按 Ctrl+Enter 可在下方插入新行</span></div></section>'
    + '</div>'
    + '<div class="case-detail-foot"><span class="case-dirty" id="caseDraftDirty" hidden><i aria-hidden="true"></i>有未保存的修改</span>'
    + '<span class="grow"></span>'
    + '<button class="btn" type="button" data-case-edit-cancel>取消</button>'
    + '<button class="btn primary" type="button" data-case-edit-save>保存</button></div>';
}
function startCaseDetailEdit(){
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  var draft = caseDraftFrom(c);
  /* 标题刚改完就点「编辑」时保存还在路上：以标题框里的文字为准带进草稿 */
  var titleEl = $("caseDetailView").querySelector("[data-case-title-edit]");
  if(titleEl){
    var typed = (titleEl.textContent || "").replace(/\s+/g, " ").trim();
    if(typed && typed !== c.title) draft.title = typed;
  }
  /* 点「编辑」前可能正停在某个就地编辑框里：把已输入的文字带进草稿，避免被这次切换吞掉 */
  if(caseInlineEdit){
    if(caseInlineEdit.kind === "step"){
      if(caseInlineNewStep !== null && caseInlineEdit.i >= draft.steps.length){
        draft.steps.push({ action: "", expected: "" });
      }
      var row = draft.steps[caseInlineEdit.i];
      if(row) row[caseInlineEdit.k === "action" ? "action" : "expected"] = caseInlineEdit.text || "";
    }else if(caseInlineEdit.kind === "pre"){
      draft.precondition = caseInlineEdit.text || "";
    }else if(caseInlineEdit.kind === "testData"){
      draft.testData = caseInlineEdit.text || "";
    }
  }
  caseDetailEditing = true;
  caseDetailDraft = draft;
  caseDetailTab = "overview";
  caseInlineEdit = null;
  caseInlineNewStep = null;
  caseDetailFocusTitle = true;
  loadCaseDetailModules(c.reqId);
  renderCaseDetail();
}
function cancelCaseDetailEdit(){
  if(!caseDetailEditing) return;
  function go(){
    caseDetailEditing = false;
    caseDetailDraft = null;
    caseInlineEdit = null;
    caseInlineNewStep = null;
    renderCaseDetail();
  }
  if(!caseDraftDirty()){ go(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: "退出编辑后，本次填写的内容不会保存。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) go(); });
}
function loadCaseDetailModules(reqId){
  if(!reqId) return Promise.resolve([]);
  if(caseDetailModules.reqId === reqId && caseDetailModules.list.length) return Promise.resolve(caseDetailModules.list);
  if(caseDetailModules.reqId === reqId && caseDetailModules.loading) return caseDetailModules.loading;
  caseDetailModules.reqId = reqId;
  caseDetailModules.list = [];
  caseDetailModules.loading = API.get("/api/test-modules", { reqId: reqId }).then(function(nodes){
    if(caseDetailModules.reqId !== reqId) return caseDetailModules.list;
    caseDetailModules.list = nodes || [];
    caseDetailModules.loading = null;
    /* 模块名以目录树为准：加载完成后补一次渲染，免得先显示「未归类」 */
    if(caseDetailId && !$("caseDetailView").hidden) renderCaseDetail();
    return caseDetailModules.list;
  }).catch(function(){
    caseDetailModules.loading = null;
    return [];
  });
  return caseDetailModules.loading;
}
/* 分组列表带 inCase 标记：一次请求同时拿到「可选分组」和「当前归属」 */
function loadCaseDetailSets(c, force){
  if(!c || !c.id || !c.reqId) return Promise.resolve([]);
  if(!force && caseDetailSets.caseId === c.id && caseDetailSets.list.length) return Promise.resolve(caseDetailSets.list);
  if(!force && caseDetailSets.caseId === c.id && caseDetailSets.loading) return caseDetailSets.loading;
  var id = c.id, reqId = c.reqId, my = ++caseDetailSets.seq;
  caseDetailSets.reqId = reqId;
  caseDetailSets.caseId = id;
  caseDetailSets.error = "";
  if(force) caseDetailSets.list = [];
  var p = API.get("/api/case-sets", { reqId: reqId, caseId: id }).then(function(list){
    if(my !== caseDetailSets.seq) return caseDetailSets.list;
    caseDetailSets.list = list || [];
    caseDetailSets.loading = null;
    if(caseDetailId === id) renderCaseDetail();
    return caseDetailSets.list;
  }).catch(function(ex){
    if(my !== caseDetailSets.seq) return caseDetailSets.list;
    caseDetailSets.loading = null;
    /* 分组读失败不影响抽屉其余内容：归属行给出失败态，不弹全局错误 */
    caseDetailSets.error = ex.message || "分组加载失败";
    if(caseDetailId === id) renderCaseDetail();
    return caseDetailSets.list;
  });
  caseDetailSets.loading = p;
  return p;
}
function saveCaseDetailDraft(){
  var c = caseById(caseDetailId);
  if(!c || !caseDetailDraft || caseDetailSaving) return;
  var d = caseDetailDraft;
  var title = (d.title || "").replace(/\s+/g, " ").trim();
  if(!title){
    toast("请填写用例标题", "warn");
    var t = $("caseEditTitle");
    if(t) t.focus();
    return;
  }
  d.title = title;
  var body = caseDraftBody(d, c);
  body.module = null;
  caseDetailSaving = true;
  var btn = $("caseDetailView").querySelector("[data-case-edit-save]");
  setCaseBusy(btn, true, "保存中…");
  API.put("/api/test-cases/" + encodeURIComponent(c.id), body).then(function(){
    caseDetailSaving = false;
    caseDetailEditing = false;
    caseDetailDraft = null;
    applyCaseBody(caseById(c.id) || c, body, {
      module: moduleNameById(caseDetailModules.list, body.moduleId),
      demandTitle: d.demandTitle || "",
      tasks: (d.tasks || []).map(function(t){
        return {
          taskId: t.taskId,
          taskTitle: t.taskTitle || "",
          itemType: t.itemType || "",
          boardColumn: t.boardColumn || "",
          itemNo: t.itemNo || null
        };
      })
    });
    toast("用例已保存");
    renderCaseDetail();
    loadCases();
  }).catch(function(ex){
    caseDetailSaving = false;
    setCaseBusy(btn, false);
    toast(ex.message || "保存失败，修改仍在编辑态", "bad");
  });
}
function startCaseTitleEdit(el){
  if(!el || el.isContentEditable) return;
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  el.dataset.original = c.title || "";
  el.contentEditable = "true";
  el.focus();
  var r = document.createRange();
  r.selectNodeContents(el);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
/* 标题就地保存：仍走整条 PUT，避免出现只改标题的第二个写入口 */
function saveCaseTitle(c, title){
  saveCasePatch(c, { title: title }, "标题已更新");
}
/* 整条 PUT 的唯一入口：阅读态就地改、字段浮层、编辑态保存都走这里拼 body */
function caseBodyOf(c, patch){
  patch = patch || {};
  return {
    reqId: c.reqId,
    title: patch.title !== undefined ? patch.title : (c.title || ""),
    precondition: patch.precondition !== undefined ? patch.precondition : (c.precondition || null),
    testData: patch.testData !== undefined ? patch.testData : (c.testData || null),
    moduleId: patch.moduleId !== undefined ? patch.moduleId : (c.moduleId || null),
    module: null,
    priority: patch.priority !== undefined ? patch.priority : (c.priority || null),
    demandId: patch.demandId !== undefined ? patch.demandId : (c.demandId || null),
    taskIds: patch.taskIds !== undefined ? patch.taskIds : (c.tasks || []).map(function(t){ return t.taskId; }),
    steps: patch.steps !== undefined ? patch.steps
      : (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; })
  };
}
function applyCaseBody(c, body, patch){
  patch = patch || {};
  c.title = body.title || "";
  c.precondition = body.precondition || "";
  c.testData = body.testData || "";
  c.moduleId = body.moduleId || "";
  c.module = body.moduleId ? (patch.module || moduleNameById(caseDetailModules.list, body.moduleId) || c.module || "") : "";
  c.priority = body.priority || "";
  c.demandId = body.demandId || "";
  if(patch.demandTitle !== undefined) c.demandTitle = patch.demandTitle;
  if(patch.tasks !== undefined) c.tasks = patch.tasks;
  c.steps = (body.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; });
}
/* 保存串行化：连点两个格子时，后一次提交要等前一次的返回值落到本地对象上再拼 body */
var casePatchChain = Promise.resolve();
function saveCasePatch(c, patch, okMsg, ed){
  if(!c || !caseWritable(c)) return Promise.resolve(false);
  var id = c.id;
  function run(){
    var cur = caseById(id);
    if(!cur) return false;
    var body = caseBodyOf(cur, patch);
    return API.put("/api/test-cases/" + encodeURIComponent(id), body).then(function(){
      /* 列表可能已被刷新替换成新对象，就地更新抽屉当前引用的那一条 */
      applyCaseBody(caseById(id) || cur, body, patch);
      /* 请求期间用户可能已经在改别的字段：只清理本次提交对应的就地编辑 */
      if(!ed || caseInlineEdit === ed){ caseInlineEdit = null; caseInlineNewStep = null; }
      toast(okMsg || "已保存");
      renderCaseDetail();
      loadCases();
      return true;
    }).catch(function(ex){
      toast(ex.message || "保存失败", "bad");
      renderCaseDetail();
      return false;
    });
  }
  casePatchChain = casePatchChain.then(run, run);
  return casePatchChain;
}

/* ---------- 阅读态就地编辑：前置条件 / 测试数据 / 步骤 ---------- */
function beginCaseBlockEdit(field){
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  caseInlineEdit = {
    kind: field,
    text: field === "pre" ? (c.precondition || "") : (c.testData || "")
  };
  renderCaseDetail();
  var ta = $("caseDetailView").querySelector("[data-case-block-edit]");
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function beginCaseStepEdit(i, k){
  var c = caseById(caseDetailId);
  var s = c && caseStepsView(c)[i];
  if(!s) return;
  caseInlineEdit = { kind: "step", i: i, k: k, text: k === "action" ? (s.action || "") : (s.expected || "") };
  renderCaseDetail();
  var ta = $("caseDetailView").querySelector("[data-case-step-edit]");
  if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function cancelCaseInlineEdit(){
  if(!caseInlineEdit && caseInlineNewStep === null) return;
  caseInlineEdit = null;
  caseInlineNewStep = null;
  renderCaseDetail();
}
/* 新增 / 插入步骤只挂一条本地占位行并直接进入编辑，避免空行提交后被服务端过滤掉 */
function insertCaseStepRow(after){
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  var len = (c.steps || []).length + (caseInlineNewStep !== null ? 1 : 0);
  if(len >= 30){ toast("步骤最多 30 条", "warn"); return; }
  var at = after === null || after === undefined ? len : after + 1;
  caseInlineNewStep = at;
  caseInlineEdit = { kind: "step", i: at, k: "action", text: "" };
  renderCaseDetail();
  var ta = $("caseDetailView").querySelector("[data-case-step-edit]");
  if(ta) ta.focus();
}
function commitCaseInlineEdit(el){
  var ed = caseInlineEdit;
  var c = caseById(caseDetailId);
  if(!ed || !c) return;
  if(ed.kind === "step"){
    var steps = caseStepsView(c);
    var row = steps[ed.i];
    if(!row){ cancelCaseInlineEdit(); return; }
    row[ed.k] = (ed.text || "").trim();
    if(!row.action && row.expected){
      toast("请先填写操作步骤", "warn");
      if(el) el.focus();
      return;
    }
    if(caseInlineNewStep !== null && !row.action && !row.expected){
      /* 占位行没填内容：直接撤掉，不打扰服务端 */
      cancelCaseInlineEdit();
      return;
    }
    steps = steps.filter(function(s){ return s.action || s.expected; });
    saveCasePatch(c, { steps: steps }, "步骤已更新", ed);
    return;
  }
  var val = (ed.text || "").trim();
  var old = ed.kind === "pre" ? (c.precondition || "") : (c.testData || "");
  if(val === old){ cancelCaseInlineEdit(); return; }
  var patch = {};
  patch[ed.kind] = val || null;
  saveCasePatch(c, patch, "已更新", ed);
}
function mutateCaseSteps(fn, msg){
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  var steps = (c.steps || []).map(function(s){ return { action: s.action || "", expected: s.expected || "" }; });
  fn(steps);
  saveCasePatch(c, { steps: steps.slice(0, 30) }, msg);
}

/* ---------- 字段浮层：优先级 / 模块 / 关联需求 / 验证工作项 ---------- */
function casePickTarget(){
  return caseDetailEditing ? caseDetailDraft : caseById(caseDetailId);
}
function applyCasePick(patch, msg){
  if(caseDetailEditing && caseDetailDraft){
    Object.keys(patch).forEach(function(k){
      if(k === "demandTitle") return;
      if(k === "tasks") caseDetailDraft.tasks = patch.tasks;
      else caseDetailDraft[k] = patch[k];
    });
    if(patch.demandTitle !== undefined) caseDetailDraft.demandTitle = patch.demandTitle;
    UI.closeAllPops();
    renderCaseDetail();
    return;
  }
  UI.closeAllPops();
  saveCasePatch(caseById(caseDetailId), patch, msg);
}
function openCasePick(kind, anchor){
  var c = caseById(caseDetailId);
  if(!c || !caseWritable(c)) return;
  if(kind === "priority") openCasePriPop(anchor);
  else if(kind === "module") openCaseModulePop(anchor, c);
  else if(kind === "demand") openCaseDemandPop(anchor, c);
  else if(kind === "tasks") openCaseTasksPop(anchor, c);
  else if(kind === "sets") openCaseSetsPop(anchor, c);
}
function openCasePriPop(anchor){
  var target = casePickTarget();
  var cur = target.priority || "";
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = '<div class="menu-title">优先级</div>'
    + [["", "不设置"]].concat(PRIORITIES.map(function(p){ return [p, p + " · " + priName(p)]; })).map(function(o){
      return '<button class="menu-item' + (cur === o[0] ? " on" : "") + '" type="button" data-pick="' + o[0] + '">'
        + '<span>' + esc(o[1]) + '</span>' + (cur === o[0] ? icon("check", 14) : "") + '</button>';
    }).join("");
  UI.openPop(el, anchor, { width: 220 });
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-pick]");
    if(!b) return;
    applyCasePick({ priority: b.getAttribute("data-pick") || null },
      b.getAttribute("data-pick") ? "优先级已改为 " + b.getAttribute("data-pick") : "已清除优先级");
  });
}
function openCaseModulePop(anchor, c){
  if(caseDetailModules.reqId !== c.reqId || (!caseDetailModules.list.length && !caseDetailModules.loading)){
    loadCaseDetailModules(c.reqId).then(function(){
      if(caseDetailEditing) renderCaseDetail();
    });
  }
  var target = casePickTarget();
  var cur = target.moduleId || "";
  var list = caseDetailModules.reqId === c.reqId ? caseDetailModules.list : [];
  var el = document.createElement("div");
  el.className = "menu case-module-pop";
  el.innerHTML = '<div class="menu-title">模块 <span class="case-pop-note">项目目录节点</span></div>'
    + '<button class="menu-item' + (cur ? "" : " on") + '" type="button" data-pick=""><span>未归类（不选目录）</span>'
    + (cur ? "" : icon("check", 14)) + '</button>'
    + (list.length ? list.map(function(n){
      var pad = "";
      for(var i = 1; i < Math.min(n.level || 1, 7); i++) pad += "　";
      return '<button class="menu-item' + (cur === n.id ? " on" : "") + '" type="button" data-pick="' + esc(n.id) + '">'
        + '<span>' + esc(pad + (n.name || "")) + '</span>' + (cur === n.id ? icon("check", 14) : "") + '</button>';
    }).join("") : '<div class="menu-empty">' + (caseDetailModules.loading ? "模块加载中…" : "该项目还没有目录节点") + '</div>');
  UI.openPop(el, anchor, { width: 260 });
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-pick]");
    if(!b) return;
    var id = b.getAttribute("data-pick") || "";
    applyCasePick({ moduleId: id || null, module: id ? moduleNameById(list, id) : "" }, id ? "模块已更新" : "已移出模块");
  });
}
function openCaseDemandPop(anchor, c){
  var target = casePickTarget();
  var el = document.createElement("div");
  el.className = "menu search-picker case-demand-pop";
  el.innerHTML = '<div class="search-picker-head"><div class="search-picker-search">' + icon("search", 15)
    + '<input type="search" placeholder="搜索需求标题、描述或来源" aria-label="搜索需求" autocomplete="off" /></div>'
    + '<div class="search-picker-tools"><span class="search-picker-count" role="status"></span></div></div>'
    + '<div class="search-picker-results"></div>'
    + '<div class="search-picker-foot">仅本项目需求池；输入关键词可搜索全部条目</div>';
  UI.openPop(el, anchor, { width: 360 });
  var box = el.querySelector(".search-picker-results"), count = el.querySelector(".search-picker-count");
  var seq = 0, timer = null, cache = {};
  function render(list, q){
    list.forEach(function(d){ cache[d.id] = d; });
    var cur = target.demandId || "";
    var html = '<button type="button" class="search-picker-clear' + (cur ? "" : " selected") + '" data-pick="">'
      + icon("close", 13) + '<span>不关联需求</span></button>';
    if(!list.length){
      html += '<div class="search-picker-empty">' + (q ? "没有找到匹配的需求，换个关键词试试。" : "本项目需求池暂无需求。") + '</div>';
    }else{
      html += list.map(function(d){
        return '<button type="button" class="search-picker-option' + (d.id === cur ? " selected" : "") + '" data-pick="' + esc(d.id) + '">'
          + '<span class="search-picker-option-main"><span class="search-picker-option-title">' + esc(d.title || "未命名需求") + '</span>'
          + (demandMetaText(d) ? '<span class="search-picker-option-meta">' + esc(demandMetaText(d)) + '</span>' : "")
          + '</span>' + (d.id === cur ? icon("check", 15) : "") + '</button>';
      }).join("");
    }
    box.innerHTML = html;
    count.textContent = list.length + " 条";
  }
  function load(q){
    var my = ++seq;
    count.textContent = "搜索中…";
    API.get("/api/demands/page", { reqId: c.reqId, q: q || "", offset: 0, limit: 20, sort: "created" }).then(function(page){
      if(my !== seq) return;
      render(page.items || [], q);
    }).catch(function(){
      if(my !== seq) return;
      box.innerHTML = '<div class="search-picker-error">需求加载失败，请重试</div>';
      count.textContent = "加载失败";
    });
  }
  load("");
  var input = el.querySelector("input");
  input.addEventListener("input", function(){
    clearTimeout(timer);
    var q = input.value.trim();
    timer = setTimeout(function(){ load(q); }, 250);
  });
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-pick]");
    if(!b) return;
    var id = b.getAttribute("data-pick") || "";
    if(id === (casePickTarget().demandId || "")){ UI.closeAllPops(); return; }
    var picked = id ? cache[id] || null : null;
    var currentTasks = (casePickTarget().tasks || []).length;
    function apply(){
      var patch = { demandId: id || null, demandTitle: picked ? picked.title : "", tasks: [], taskIds: [] };
      if(id && picked && picked.categoryId){
        patch.moduleId = picked.categoryId;
        loadCaseDetailModules(c.reqId);
      }
      applyCasePick(patch, id ? "关联需求已更新" : "已取消关联需求");
    }
    if(id && currentTasks){
      UI.showConfirm({
        title: "更换关联需求",
        msg: "现有 " + currentTasks + " 个验证工作项可能不属于新需求，保存时会一并移除。",
        okText: "更换并移除",
        cancelText: "取消"
      }).then(function(ok){ if(ok) apply(); });
    }else{
      apply();
    }
  });
}
function openCaseTasksPop(anchor, c){
  var target = casePickTarget();
  if(!target.demandId){
    var el = document.createElement("div");
    el.className = "menu case-hint-pop";
    el.innerHTML = '<div class="menu-title">验证工作项</div>'
      + '<p class="case-hint-text">工作项从关联需求下挑选；先关联需求，再回来挂工作项。</p>'
      + '<button class="btn sm primary case-pop-act" type="button" data-go-demand>去关联需求</button>';
    UI.openPop(el, anchor, { width: 280 });
    el.addEventListener("click", function(e){
      if(!e.target.closest("[data-go-demand]")) return;
      UI.closeAllPops();
      openCasePick("demand", anchor);
    });
    return;
  }
  var el = document.createElement("div");
  el.className = "menu case-task-pop";
  el.innerHTML = '<div class="menu-title">验证工作项<span class="case-pop-note">已选 0 项</span></div>'
    + '<div class="case-task-pop-list">' + UI.skeletonRows(3) + '</div>';
  UI.openPop(el, anchor, { width: 340 });
  var seq = ++caseInlinePickSeq;
  var sel = {};
  (target.tasks || []).forEach(function(t){ sel[t.taskId] = t; });
  API.get("/api/test-cases/task-options", { reqId: c.reqId, demandId: target.demandId }).then(function(rows){
    if(seq !== caseInlinePickSeq) return;
    var list = rows || [];
    var note = el.querySelector(".case-pop-note");
    function syncNote(){
      if(note) note.textContent = "已选 " + Object.keys(sel).length + " 项";
    }
    function render(){
      var box = el.querySelector(".case-task-pop-list");
      if(!list.length){ box.innerHTML = '<div class="menu-empty">该需求下还没有工作项；先在需求详情「拆分为工作项」。</div>'; return; }
      box.innerHTML = list.map(function(t){
        return '<label class="case-task-pick"><input type="checkbox" data-task="' + esc(t.taskId) + '"'
          + (sel[t.taskId] ? " checked" : "") + ' /><span class="case-task-pick-main"><span class="case-task-pick-title">'
          + esc(t.taskTitle || t.taskId) + '</span><span class="case-task-pick-meta">'
          + esc([itemNoText(t.itemNo), typeName(t.itemType), colName(t.boardColumn)].filter(Boolean).join(" · "))
          + '</span></span></label>';
      }).join("");
      syncNote();
    }
    render();
    el.querySelector(".case-task-pop-list").addEventListener("change", function(e){
      var cb = e.target.closest("[data-task]");
      if(!cb) return;
      var id = cb.getAttribute("data-task");
      if(cb.checked){
        var hit = list.filter(function(t){ return t.taskId === id; })[0];
        /* 保留看板列等派生字段：抽屉 chips 的完成态直接读本地数据，不再逐条查 */
        if(hit) sel[id] = {
          taskId: id,
          taskTitle: hit.taskTitle || "",
          itemType: hit.itemType || "",
          boardColumn: hit.boardColumn || "",
          itemNo: hit.itemNo || null
        };
      }else{
        delete sel[id];
      }
      syncNote();
    });
    var foot = document.createElement("div");
    foot.className = "case-pop-foot";
    foot.innerHTML = '<button class="btn" type="button" data-close>取消</button>'
      + '<button class="btn primary" type="button" data-save-tasks>保存</button>';
    el.appendChild(foot);
    foot.addEventListener("click", function(e){
      if(e.target.closest("[data-close]")){ UI.closeAllPops(); return; }
      if(!e.target.closest("[data-save-tasks]")) return;
      var tasks = Object.keys(sel).map(function(id){ return sel[id]; });
      applyCasePick({ tasks: tasks, taskIds: tasks.map(function(t){ return t.taskId; }) }, "验证工作项已更新");
    });
  }).catch(function(){
    if(seq !== caseInlinePickSeq) return;
    el.querySelector(".case-task-pop-list").innerHTML = '<div class="menu-empty">工作项加载失败，请关闭后重试。</div>';
  });
}
/* 分组浮层：成员是引用，增删走分组自己的接口；应用后按差集各发一次请求 */
function applyCaseSetMembership(c, ids){
  var cur = (caseDetailSets.list || []).filter(function(s){ return s.inCase; }).map(function(s){ return s.id; });
  var add = ids.filter(function(id){ return cur.indexOf(id) < 0; });
  var del = cur.filter(function(id){ return ids.indexOf(id) < 0; });
  if(!add.length && !del.length){ UI.closeAllPops(); return; }
  var chain = Promise.resolve();
  add.forEach(function(id){
    chain = chain.then(function(){
      return API.post("/api/case-sets/" + encodeURIComponent(id) + "/members", { ids: [c.id] });
    });
  });
  del.forEach(function(id){
    chain = chain.then(function(){
      return API.post("/api/case-sets/" + encodeURIComponent(id) + "/members/remove", { ids: [c.id] });
    });
  });
  chain.then(function(){
    UI.closeAllPops();
    toast("分组已更新");
    loadCaseDetailSets(c, true);
    /* 左侧分组面板的成员数也要跟着变 */
    if(typeof loadCaseSets === "function") loadCaseSets(true);
  }).catch(function(ex){
    toast(ex.message || "分组更新失败", "bad");
  });
}
function openCaseSetsPop(anchor, c){
  var pending = {};
  function currentList(){
    return caseDetailSets.caseId === c.id ? caseDetailSets.list : [];
  }
  function resetPending(){
    pending = {};
    currentList().forEach(function(s){ if(s.inCase) pending[s.id] = true; });
  }
  resetPending();
  var el = document.createElement("div");
  el.className = "menu case-set-pop";
  function renderRows(){
    var list = currentList();
    var rows = list.length ? list.map(function(s){
      var locked = !s.editable || s.kind === "dynamic";
      var why = s.kind === "dynamic" ? "规则自动收录" : (!s.editable ? "只有创建人可以修改" : "");
      return '<label class="case-task-pick' + (locked ? " is-locked" : "") + '" title="' + esc(why) + '">'
        + '<input type="checkbox" data-set="' + esc(s.id) + '"' + (pending[s.id] ? " checked" : "")
        + (locked ? " disabled" : "") + ' />'
        + '<span class="case-task-pick-main"><span class="case-task-pick-title">' + esc(s.name) + '</span>'
        + '<span class="case-task-pick-meta">' + esc(caseSetScopeLabel(s) + ' · ' + (s.caseCount || 0) + ' 条'
          + (why ? ' · ' + why : '')) + '</span></span></label>';
    }).join("") : (caseDetailSets.loading
      ? '<div class="menu-empty">分组加载中…</div>'
      : '<div class="menu-empty">该项目还没有分组；先在左侧「分组」面板新建。</div>');
    var box = el.querySelector(".case-task-pop-list");
    if(box) box.innerHTML = rows;
    var note = el.querySelector(".case-pop-note");
    if(note) note.textContent = "已选 " + Object.keys(pending).length + " 个";
  }
  el.innerHTML = '<div class="menu-title">分组<span class="case-pop-note"></span></div>'
    + '<div class="case-task-pop-list"></div>'
    + '<div class="case-pop-foot"><button class="btn" type="button" data-set-close>取消</button>'
    + '<button class="btn primary" type="button" data-set-apply>应用</button></div>';
  renderRows();
  UI.openPop(el, anchor, { width: 340 });
  if(caseDetailSets.caseId !== c.id){
    loadCaseDetailSets(c, true).then(function(){ resetPending(); renderRows(); });
  }else if(caseDetailSets.loading){
    caseDetailSets.loading.then(function(){ resetPending(); renderRows(); });
  }
  el.querySelector(".case-task-pop-list").addEventListener("change", function(e){
    var cb = e.target.closest("[data-set]");
    if(!cb || cb.disabled) return;
    var id = cb.getAttribute("data-set");
    if(cb.checked) pending[id] = true;
    else delete pending[id];
    var note = el.querySelector(".case-pop-note");
    if(note) note.textContent = "已选 " + Object.keys(pending).length + " 个";
  });
  el.querySelector(".case-pop-foot").addEventListener("click", function(e){
    if(e.target.closest("[data-set-close]")){ UI.closeAllPops(); return; }
    if(!e.target.closest("[data-set-apply]")) return;
    applyCaseSetMembership(c, Object.keys(pending));
  });
}
var caseInlinePickSeq = 0;

function commitCaseTitleEdit(el){
  if(!el || !el.isContentEditable) return;
  el.contentEditable = "false";
  var c = caseById(caseDetailId);
  if(!c){ renderCaseDetail(); return; }
  var val = (el.textContent || "").replace(/\s+/g, " ").trim();
  if(!val){ el.textContent = c.title || ""; toast("用例标题不能为空", "warn"); return; }
  if(val === c.title){ el.textContent = c.title || ""; return; }
  saveCaseTitle(c, val);
}
function renderStepRows(){
  var rows = editingCase.steps;
  $("tcSteps").innerHTML = rows.length
    ? rows.map(function(s, i){
      return '<div class="tc-step-row">'
        + '<span class="tc-step-no">' + (i + 1) + '</span>'
        + '<textarea rows="1" maxlength="200" placeholder="操作步骤（必填）" aria-label="步骤 ' + (i + 1) + ' 操作">' + esc(s.action) + '</textarea>'
        + '<textarea rows="1" maxlength="500" placeholder="预期结果（选填）" aria-label="步骤 ' + (i + 1) + ' 预期">' + esc(s.expected) + '</textarea>'
        + '<span class="tc-step-acts">'
        + '<button class="icon-btn sm" type="button" data-step-add="' + i + '" title="在下方插入新步骤" aria-label="在步骤 ' + (i + 1) + ' 下方插入新步骤">' + icon("plus", 14) + '</button>'
        + '<button class="icon-btn sm" type="button" data-step-up="' + i + '" title="上移" aria-label="上移步骤 ' + (i + 1) + '"' + (i === 0 ? " disabled" : "") + '>' + icon("up", 14) + '</button>'
        + '<button class="icon-btn sm" type="button" data-step-down="' + i + '" title="下移" aria-label="下移步骤 ' + (i + 1) + '"' + (i === rows.length - 1 ? " disabled" : "") + '>' + icon("down", 14) + '</button>'
        + '<button class="icon-btn sm danger" type="button" data-step-del="' + i + '" title="删除该步骤" aria-label="删除步骤 ' + (i + 1) + '">' + icon("trash", 14) + '</button>'
        + '</span>'
        + '</div>';
    }).join("")
    : '<p class="foot-note">还没有步骤，点下方「添加步骤」录入操作与预期结果，或在步骤里按 Ctrl+Enter 快捷插入新行。</p>';
  var count = $("caseStepCount");
  if(count) count.textContent = rows.length + " 行";
}
function focusStep(i){
  var row = $("tcSteps").querySelectorAll(".tc-step-row")[i];
  var ta = row && row.querySelector("textarea");
  if(ta) ta.focus();
}
/* 排序后把焦点留在移动行的同向按钮上，可连点/连按；到边界时退回到输入框 */
function focusStepAct(i, sel){
  var row = $("tcSteps").querySelectorAll(".tc-step-row")[i];
  var b = row && row.querySelector(sel);
  if(b && !b.disabled) b.focus();
  else focusStep(i);
}
function applyReadOnly(on){
  ["cTitle", "cPrecondition", "cTestData", "cDemand", "cModule", "cPri", "cTaskSearch"].forEach(function(id){ $(id).disabled = on; });
  $("cDemandPicker").disabled = on;
  $("tcSteps").querySelectorAll("textarea").forEach(function(inp){ inp.disabled = on; });
  $("cTaskList").querySelectorAll("input").forEach(function(inp){ inp.disabled = on; });
  $("cPriSeg").querySelectorAll("button").forEach(function(b){ b.disabled = on; });
  $("tcSteps").querySelectorAll(".tc-step-acts").forEach(function(b){ b.style.display = on ? "none" : ""; });
  $("btnCaseAddStep").style.display = on ? "none" : "";
  $("caseSaveRow").style.display = on ? "none" : "";
  syncDemandTrigger();
  renderModuleTag();
  $("cModuleNew").hidden = !!on;
  if(on){
    $("cModuleInherit").hidden = true;
    $("cDemandClear").hidden = true;
  }
  $("caseEditBody").classList.toggle("is-readonly", !!on);
  $("caseReadonlyHint").hidden = !on;
}
function collectSteps(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    var a = tas[0].value.trim();
    var e = tas[1].value.trim();
    if(!a && !e) return;
    rows.push({ action: a, expected: e });
  });
  return rows;
}
function syncStepsFromDom(){
  if(!editingCase) return;
  editingCase.steps = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    editingCase.steps.push({
      action: tas[0].value.trim(),
      expected: (tas[1].value || "").trim()
    });
  });
}
function stepsSnapshot(){
  var rows = [];
  $("tcSteps").querySelectorAll(".tc-step-row").forEach(function(row){
    var tas = row.querySelectorAll("textarea");
    rows.push([tas[0] ? tas[0].value : "", tas[1] ? tas[1].value : ""]);
  });
  return rows;
}
function caseFormSnapshot(){
  return JSON.stringify([$("cTitle").value, $("cModule").value, $("cPri").value,
    $("cDemand").value, Object.keys(caseTaskSel).sort(), $("cPrecondition").value, $("cTestData").value, stepsSnapshot()]);
}
function caseFormDirty(){
  return !!caseFormBaseline && caseFormSnapshot() !== caseFormBaseline;
}
function runFormSnapshot(){
  var files = runKit ? runKit.files().map(function(f){ return f.name + ":" + f.size; }) : [];
  return JSON.stringify([runStatus, $("runNote").value, $("runExecutor").value, $("runEnvironment").value, files]);
}
function runFormDirty(){ return !!runFormBaseline && runFormSnapshot() !== runFormBaseline; }
function defectFormSnapshot(){
  return JSON.stringify([$("defectSeverity").value, $("defectEnvironment").value, $("defectNote").value, $("defectCarry").checked]);
}
function defectFormDirty(){
  return !!defectFormBaseline && defectFormSnapshot() !== defectFormBaseline;
}
function closeCaseDialog(){
  caseFormBaseline = null;
  editingCase = null;
  caseFormReqId = null;
  caseDetailId = null;
  caseDetailRuns = null;
  caseDetailSeq++;
  caseDetailEditing = false;
  caseDetailDraft = null;
  caseInlineEdit = null;
  caseInlineNewStep = null;
  caseDetailSaving = false;
  $("caseDetailView").innerHTML = "";
  UI.closeModal($("dlgCase"));
}
/* X、Esc、遮罩、路由与取消统一走这里；只有真正改过内容才确认 */
function tryCloseCaseDialog(afterClose){
  function finish(){
    closeCaseDialog();
    if(afterClose) afterClose();
  }
  var drawerDirty = caseDetailEditing && caseDraftDirty();
  var formDirty = !$("caseEditBody").hidden && caseFormWritable() && caseFormDirty();
  /* 阅读态就地编辑不阻塞关闭会把刚输入的内容一起丢掉，所以也纳入判断 */
  var inlineDirty = false;
  if(caseInlineEdit){
    var ic = caseById(caseDetailId);
    if(ic){
      if(caseInlineEdit.kind === "step"){
        var st = caseStepsView(ic)[caseInlineEdit.i];
        if(st) inlineDirty = (caseInlineEdit.text || "") !== (caseInlineEdit.k === "action" ? (st.action || "") : (st.expected || ""));
      }else{
        inlineDirty = (caseInlineEdit.text || "") !== (caseInlineEdit.kind === "pre" ? (ic.precondition || "") : (ic.testData || ""));
      }
    }
  }
  if(!drawerDirty && !formDirty && !inlineDirty){ finish(); return; }
  UI.showConfirm({
    title: "放弃未保存的修改？",
    msg: drawerDirty ? "退出编辑后，本次填写的内容不会保存。"
      : inlineDirty ? "正在编辑的内容还没有保存。" : "用例还没有保存，关闭后填写的内容会丢失。",
    okText: "放弃修改",
    cancelText: "继续编辑"
  }).then(function(ok){ if(ok) finish(); });
}
function closeRunDialog(){
  runFormBaseline = null;
  runningCaseId = null;
  if(runKit){ runKit.destroy(); runKit = null; }
  UI.closeModal($("dlgCaseRun"));
}
function tryCloseRunDialog(afterClose){
  function finish(){
    closeRunDialog();
    if(afterClose) afterClose();
  }
  if(!runFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃本次执行记录？",
    msg: "已填写的结果或备注不会保存。",
    okText: "放弃",
    cancelText: "继续填写"
  }).then(function(ok){ if(ok) finish(); });
}
function closeDefectDialog(){
  defectFormBaseline = null;
  defectCaseId = null;
  defectEvidence = [];
  UI.closeModal($("dlgCaseDefect"));
}
function closeRunsDialog(){
  runsCaseId = null;
  runsCaseTitle = "";
  runsList = [];
  UI.closeModal($("dlgCaseRuns"));
}
function tryCloseDefectDialog(afterClose){
  function finish(){
    closeDefectDialog();
    if(afterClose) afterClose();
  }
  if(!defectFormDirty()){ finish(); return; }
  UI.showConfirm({
    title: "放弃填写的内容？",
    msg: "缺陷还没有创建，填写的严重度与环境不会保存。",
    okText: "放弃",
    cancelText: "继续填写"
  }).then(function(ok){ if(ok) finish(); });
}
function setCaseBusy(btn, busy, label){
  if(!btn) return;
  btn.disabled = !!busy;
  if(busy){
    if(!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.textContent = label || "处理中…";
  }else if(btn.dataset.label){
    btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
}
function saveCase(){ submitCase(false); }
function saveCaseAgain(){ submitCase(true); }
function submitCase(again){
  if(caseSaving || !caseFormWritable()) return;
  var title = $("cTitle").value.trim();
  if(!title){
    $("fCaseTitle").classList.add("invalid");
    showCaseErrors([{ id: "cTitle", label: "标题：请填写用例标题" }]);
    $("cTitle").focus();
    return;
  }
  $("fCaseTitle").classList.remove("invalid");
  showCaseErrors([]);
  var body = {
    reqId: caseFormReqId,
    title: title,
    precondition: $("cPrecondition").value.trim() || null,
    testData: $("cTestData").value.trim() || null,
    moduleId: $("cModule").value || null,
    priority: $("cPri").value || null,
    demandId: $("cDemand").value || null,
    taskIds: Object.keys(caseTaskSel),
    steps: collectSteps()
  };
  var btn = again ? $("btnSaveCaseAgain") : $("btnSaveCase");
  caseSaving = true;
  setCaseBusy(btn, true, "保存中…");
  API.post("/api/test-cases", body).then(function(created){
    caseSaving = false;
    setCaseBusy(btn, false);
    if(again){
      toast("已创建 " + (caseNoText(created) || "用例") + "，接着写下一条");
      resetCaseFormForNext();
      loadCases();
      return;
    }
    closeCaseDialog();
    toast("用例已创建");
    loadCases();
  }).catch(function(ex){
    caseSaving = false;
    setCaseBusy(btn, false);
    toast(ex.message || "保存失败", "bad");
  });
}
/* 再建一条：保留需求 / 模块 / 工作项 / 优先级，只清本条的标题、步骤与更多字段 */
function resetCaseFormForNext(){
  $("cTitle").value = "";
  $("cPrecondition").value = "";
  $("cTestData").value = "";
  editingCase = { id: null, steps: [{ action: "", expected: "" }] };
  renderStepRows();
  applyReadOnly(!caseFormWritable());
  syncCaseFormCtx(null);
  syncCaseTitleMeta();
  syncCaseMore();
  showCaseErrors([]);
  caseFormBaseline = caseFormSnapshot();
  $("cTitle").focus();
}
function removeCase(id){
  var c = caseById(id);
  if(!c) return;
  if(!caseWritable(c)){ toast("当前项目只读，无法删除用例", "warn"); return; }
  if(!window.confirm("删除用例「" + c.title + "」？其执行记录将一并删除。")) return;
  API.del("/api/test-cases/" + encodeURIComponent(id)).then(function(){
    toast("用例已删除");
    loadCases();
  }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
}

/* ---------- AI 生成用例 ---------- */

function openAiCaseSource(keepState){
  if(caseScopeAll){ toast("AI 生成用例需要先切到单个项目", "warn"); return; }
  if(!caseReqId){ toast("先在上方选择一个项目，再生成用例", "warn"); if($("tcReq")) $("tcReq").focus(); return; }
  if(!isWritable()){ toast("当前项目只读，无法生成用例", "warn"); return; }
  aiCaseSourceReqId = caseReqId;
  if(!keepState) aiCaseSource = "doc";
  aiCaseDocs = { reqId: null, list: [], error: null };
  syncAiCaseSource();
  var req = null;
  for(var i = 0; i < rt.reqList.length; i++){
    if(rt.reqList[i].id === caseReqId){ req = rt.reqList[i]; break; }
  }
  $("aiCaseSourceHint").textContent = "当前项目：" + (req ? req.name : caseReqId);
  loadAiCaseDocs(caseReqId);
  loadAiCaseDemands(caseReqId);
  UI.openModal($("dlgAiCaseSource"), "#aiCaseDocSel");
}
function syncAiCaseSource(){
  document.querySelectorAll("#aiCaseSourceSeg [data-ai-src]").forEach(function(b){
    var on = b.dataset.aiSrc === aiCaseSource;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  $("aiCaseDocField").hidden = aiCaseSource !== "doc";
  $("aiCaseDemandField").hidden = aiCaseSource !== "demand";
}
function loadAiCaseDocs(reqId){
  aiCaseDocs = { reqId: reqId, list: [], error: null };
  var sel = $("aiCaseDocSel");
  sel.innerHTML = '<option value="">文档加载中…</option>';
  return API.get("/api/req-docs", { reqId: reqId, offset: 0, limit: 100 }).then(function(page){
    if(aiCaseDocs.reqId !== reqId) return;
    aiCaseDocs.list = page.items || [];
    var opts = ['<option value="">请选择文档</option>'];
    aiCaseDocs.list.forEach(function(d){
      opts.push('<option value="' + esc(d.id) + '">' + esc(d.title) + (d.publishedAt ? "" : "（草稿）") + '</option>');
    });
    sel.innerHTML = opts.join("");
    if(aiCaseDocs.list.length === 1) sel.value = aiCaseDocs.list[0].id;
  }).catch(function(ex){
    if(aiCaseDocs.reqId !== reqId) return;
    aiCaseDocs.error = ex || new Error("文档加载失败");
    sel.innerHTML = '<option value="">文档加载失败，请关闭后重试</option>';
  });
}
function loadAiCaseDemands(reqId){
  var sel = $("aiCaseDemandSel");
  sel.innerHTML = '<option value="">需求加载中…</option>';
  return loadDemandOptions(reqId).then(function(list){
    if(aiCaseSourceReqId !== reqId) return;
    if(list === null){
      sel.innerHTML = '<option value="">需求加载失败，请关闭后重试</option>';
      return;
    }
    var opts = ['<option value="">请选择需求</option>'];
    list.forEach(function(d){
      opts.push('<option value="' + esc(d.id) + '">' + esc(demandPickLabel(d)) + '</option>');
    });
    if(demandOptions.total > list.length){
      opts.push('<option value="" disabled>仅显示前 ' + list.length + ' 条，共 ' + demandOptions.total + ' 条</option>');
    }
    sel.innerHTML = opts.join("");
    if(list.length === 1) sel.value = list[0].id;
  });
}
function generateAiCases(){
  if(aiCaseGenerating) return;
  if(!caseReqId || caseReqId !== aiCaseSourceReqId){
    toast("项目已切换，请重新打开生成入口", "warn");
    return;
  }
  var sel = aiCaseSource === "doc" ? $("aiCaseDocSel") : $("aiCaseDemandSel");
  if(!sel.value){
    toast(aiCaseSource === "doc" ? "先选择来源文档" : "先选择来源需求", "warn");
    sel.focus();
    return;
  }
  var sourceId = sel.value;
  var sourceLabel = sel.options[sel.selectedIndex].textContent;
  var reqId = aiCaseSourceReqId;
  var demandId = aiCaseSource === "demand" ? sourceId : "";
  var maxCases = Number($("aiCaseMax").value) || 8;
  aiCaseGenerating = true;
  UI.closeModal($("dlgAiCaseSource"));
  AIProgress.run({
    title: "AI 生成测试用例",
    desc: "正在读「" + sourceLabel + "」，拆出可执行的用例和步骤…",
    hint: "通常需要 20–60 秒，可以随时取消",
    errorText: aiErrorText,
    request: function(signal){
      return API.postWithSignal("/api/ai/testcases/generate", {
        source: aiCaseSource, sourceId: sourceId, maxCases: maxCases
      }, signal);
    },
    onSuccess: function(d){
      aiCaseDrafts = d.cases || [];
      aiCaseApplyReqId = reqId;
      aiCaseDemandId = demandId;
      renderAiCaseResult(d);
      UI.openModal($("dlgAiCaseResult"));
    },
    onCancel: function(){ openAiCaseSource(true); }
  }).then(function(){ aiCaseGenerating = false; });
}
function aiCasePriOptions(selected){
  var p = String(selected || "P2").toUpperCase();
  return PRIORITIES.map(function(x){
    return '<option value="' + x + '"' + (x === p ? " selected" : "") + '>' + x + ' · ' + esc(priName(x)) + '</option>';
  }).join("");
}
function renderAiCaseResult(d){
  $("aiCaseResultTitle").textContent = "AI 生成用例 · " + (d.sourceTitle || "");
  var msg = "从「" + (d.sourceTitle || "所选来源") + "」生成 " + aiCaseDrafts.length + " 条草稿"
    + (aiCaseDemandId ? "，创建后关联该需求" : "") + "。标题可直接改，优先级和模块也能调；没勾的不会创建。";
  if(d.truncated) msg += " 来源共 " + (d.sourceChars || 0) + " 字，AI 只读取了前 12000 字。";
  $("aiCaseResultMsg").textContent = msg;
  $("aiCaseList").innerHTML = aiCaseDrafts.map(function(c, i){
    var steps = c.steps || [];
    return '<div class="ai-item on" data-i="' + i + '">' +
      '<input type="checkbox" checked data-pick="' + i + '" aria-label="选择用例">' +
      '<div class="ai-main">' +
        '<input class="ai-title" type="text" maxlength="100" value="' + esc(c.title) + '" data-title="' + i + '" aria-label="用例标题">' +
        '<div class="ai-meta">' +
          '<select class="ai-case-pri" data-pri="' + i + '" aria-label="优先级">' + aiCasePriOptions(c.priority) + '</select>' +
          '<input class="ai-case-module" type="text" maxlength="50" value="' + esc(c.module || "") + '" data-module="' + i + '" placeholder="功能模块" aria-label="功能模块">' +
          (c.precondition ? '<span>前置：' + esc(cut(c.precondition, 36)) + '</span>' : "") +
          (c.reason ? '<span class="ai-reason">' + esc(c.reason) + '</span>' : "") +
        '</div>' +
        (steps.length
          ? '<details class="ai-case-steps"><summary>' + steps.length + ' 个步骤（点击核对）</summary><ol>'
            + steps.map(function(s){
              return '<li><div class="act">' + esc(s.action) + '</div>'
                + (s.expected ? '<div class="exp">预期：' + esc(s.expected) + '</div>' : "") + '</li>';
            }).join("") + '</ol></details>'
          : '<div class="ai-reason">这条没有步骤，建议取消勾选后手动补充</div>') +
      '</div>' +
    '</div>';
  }).join("");
  $("aiCaseUsage").textContent = aiUsageText(d.usage);
}
function collectAiCaseDrafts(){
  var nodes = document.querySelectorAll("#aiCaseList .ai-item");
  var picked = [];
  for(var i = 0; i < nodes.length; i++){
    var cb = nodes[i].querySelector("input[type=checkbox]");
    if(!cb || !cb.checked) continue;
    var idx = Number(nodes[i].dataset.i);
    var src = aiCaseDrafts[idx] || {};
    var titleEl = nodes[i].querySelector(".ai-title");
    var title = (titleEl ? titleEl.value : src.title || "").trim();
    if(!title) continue;
    var priEl = nodes[i].querySelector("[data-pri]");
    var modEl = nodes[i].querySelector("[data-module]");
    picked.push({
      title: title,
      precondition: src.precondition || "",
      module: modEl ? modEl.value.trim() : (src.module || ""),
      priority: priEl ? priEl.value : (src.priority || "P2"),
      steps: src.steps || [],
      reason: src.reason || ""
    });
  }
  return picked;
}
function applyAiCases(){
  if(aiCaseApplying) return;
  var picked = collectAiCaseDrafts();
  if(!picked.length){ toast("至少选一条要创建的用例", "warn"); return; }
  var reqId = aiCaseApplyReqId || caseReqId;
  var btn = $("dlgAiCaseResultOk");
  aiCaseApplying = true;
  btn.disabled = true;
  btn.textContent = "新建中…";
  API.post("/api/ai/testcases/apply", {
    reqId: reqId,
    demandId: aiCaseDemandId || null,
    cases: picked
  }).then(function(r){
    aiCaseApplying = false;
    btn.disabled = false;
    btn.textContent = "新建选中用例";
    UI.closeModal($("dlgAiCaseResult"));
    var msg = "已创建 " + r.created + " 条用例";
    if(r.skipped) msg += "，跳过 " + r.skipped + " 条同名";
    msg += aiApplyFailText(r.failed, "条");
    toast(msg, r.failed && r.failed.length ? "warn" : "fs");
    if(reqId === caseReqId) loadCases();
  }).catch(function(ex){
    aiCaseApplying = false;
    btn.disabled = false;
    btn.textContent = "新建选中用例";
    toast(ex.message || "新建失败", "bad");
  });
}
/* ---------- 执行结果 ---------- */

function openRunDialog(id){
  var c = caseById(id);
  if(!caseWritable(c)){ toast("当前项目只读，无法记录执行结果", "warn"); return; }
  runningCaseId = id;
  runStatus = "passed";
  runRoundNo = 0;
  $("runNote").value = "";
  $("runEnvironment").value = "";
  fillRunExecutor();
  var no = caseNoText(c);
  $("runFormTitle").textContent = (c && c.latestStatus ? "重新执行" : "执行") + " · " + (no ? no + " " : "") + (c ? cut(c.title, 20) : "");
  renderRunContext(c, null);
  syncRunSeg();
  if(runKit){ runKit.destroy(); runKit = null; }
  runKit = createAttachKit({
    mount: $("runKitMount"),
    paste: true,
    pasteTarget: $("dlgCaseRun"),
    label: "选择证据文件",
    onChange: function(){ /* 待传文件变化纳入脏检查：快照实时读取 runKit.files() */ }
  });
  runFormBaseline = null;
  UI.openModal($("dlgCaseRun"), "#segCaseRun [data-run-status]");
  /* 上一轮结果与环境、累计轮次：打开后异步补齐，不阻塞填写 */
  API.get("/api/test-cases/" + encodeURIComponent(id) + "/runs", { limit: 1 }).then(function(page){
    if(runningCaseId !== id) return;
    var items = (page && page.items) || [];
    runRoundNo = ((page && page.total) || 0) + 1;
    var last = items[0] || null;
    if(last && last.environment && !$("runEnvironment").value) $("runEnvironment").value = last.environment;
    renderRunContext(c, last);
    runFormBaseline = runFormSnapshot();
  }).catch(function(){
    if(runningCaseId === id){
      renderRunContext(c, null);
      runFormBaseline = runFormSnapshot();
    }
  });
}
function fillRunExecutor(){
  var sel = $("runExecutor");
  if(!sel) return;
  var me = rt.currentUser || {};
  var members = rt.wsMembersCache || [];
  var opts = members.length
    ? members.map(function(m){
        return '<option value="' + esc(m.userId) + '">' + esc(m.displayName || m.userId) + (m.userId === me.id ? "（我）" : "") + '</option>';
      }).join("")
    : '<option value="' + esc(me.id || "") + '">' + esc(me.displayName || "当前登录人") + '</option>';
  sel.innerHTML = opts;
  sel.value = me.id || "";
}
function runStepListHTML(steps){
  if(!steps || !steps.length) return '<p class="rc-empty">该用例没有填写执行步骤。</p>';
  return '<ol class="rc-steps">' + steps.map(function(s){
    return '<li><span class="rc-act">' + esc(s.action || "") + '</span>'
      + (s.expected ? '<span class="rc-exp">预期：' + esc(s.expected) + '</span>' : "") + '</li>';
  }).join("") + '</ol>';
}
function renderRunContext(c, last){
  var box = $("runContext");
  if(!box || !c) return;
  var retestHint = "";
  if(c.latestBugResolved && c.latestStatus === "failed" && c.latestBugTaskId){
    retestHint = '<div class="tc-run-retest">' + icon("refresh", 14)
      + '<span>关联缺陷「' + esc(cut(c.latestBugTaskTitle || c.latestBugTaskId, 24)) + '」已修复关闭，本轮执行用于复测确认。</span>'
      + '<button type="button" data-run-bug="' + esc(c.latestBugTaskId) + '">查看缺陷</button></div>';
  }
  var head = '<div class="rc-head">' + statusBadgeHTML(c.latestStatus)
    + '<span class="rc-round">' + (runRoundNo > 1 ? "本次为第 " + runRoundNo + " 轮执行" : "首次执行") + '</span></div>';
  var facts = [];
  if(c.createdBy) facts.push("创建人：" + esc(c.createdBy));
  if(c.module) facts.push("模块：" + esc(c.module));
  if(c.priority) facts.push("优先级：" + esc(c.priority));
  var prev = "";
  if(last){
    prev = '<div class="rc-prev"><span class="rc-prev-t">上一轮</span>' + statusBadgeHTML(last.status)
      + '<span class="rc-prev-by">' + esc(last.executedBy || "—") + " · " + esc(fmtTs(last.createdAt) || "—") + '</span>'
      + (last.environment ? '<span class="rc-prev-env">' + esc(cut(last.environment, 30)) + '</span>' : "")
      + (last.note ? '<p class="rc-prev-note">' + esc(cut(last.note, 80)) + '</p>' : "")
      + '</div>';
  }
  box.innerHTML = retestHint + head
    + (facts.length ? '<p class="rc-facts">' + facts.join(" · ") + '</p>' : "")
    + prev
    + (c.precondition ? '<div class="rc-block"><h4>前置条件</h4><p>' + esc(c.precondition) + '</p></div>' : "")
    + (c.testData ? '<div class="rc-block"><h4>测试数据</h4><p>' + esc(c.testData) + '</p></div>' : "")
    + '<div class="rc-block rc-steps-block"><h4>执行步骤</h4>' + runStepListHTML(c.steps) + '</div>';
}
function syncRunSeg(){
  document.querySelectorAll("#segCaseRun [data-run-status]").forEach(function(b){
    var on = b.dataset.runStatus === runStatus;
    b.classList.toggle("primary", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
function doRun(){
  if(caseRunning || !runningCaseId) return;
  var caseId = runningCaseId;
  var files = runKit ? runKit.files() : [];
  caseRunning = true;
  setCaseBusy($("btnDoRun"), true, files.length ? "记录并上传…" : "记录中…");
  var me = rt.currentUser || {};
  var executor = $("runExecutor").value;
  recordEnv($("runEnvironment").value);
  API.post("/api/test-cases/" + encodeURIComponent(caseId) + "/runs", {
    status: runStatus,
    note: $("runNote").value.trim() || null,
    environment: $("runEnvironment").value.trim() || null,
    executedByUserId: executor && executor !== me.id ? executor : null
  }).then(function(run){
    var runId = run && run.id;
    if(!runId || !files.length){
      return { uploaded: 0, failed: 0 };
    }
    var path = "/api/test-cases/" + encodeURIComponent(caseId) + "/runs/" + encodeURIComponent(runId) + "/attachments";
    var uploaded = 0, failed = 0;
    var chain = Promise.resolve();
    files.forEach(function(f){
      chain = chain.then(function(){
        return uploadAttachment(path, f).then(function(){ uploaded++; }, function(){ failed++; });
      });
    });
    return chain.then(function(){ return { uploaded: uploaded, failed: failed }; });
  }).then(function(res){
    caseRunning = false;
    setCaseBusy($("btnDoRun"), false);
    closeRunDialog();
    var msg = runStatus === "failed" ? "已记录失败，可点击「转缺陷」生成缺陷工作项" : "执行结果已记录";
    if(res.uploaded) msg += "，已上传 " + res.uploaded + " 个证据";
    if(res.failed) msg += "，" + res.failed + " 个证据上传失败（可在「记录」里补传）";
    toast(msg, res.failed ? "warn" : "fs");
    loadCases().then(function(){
      if(caseDetailId === caseId){
        renderCaseDetail();
        loadCaseDetailRuns(caseId);
      }
    });
  }).catch(function(ex){
    caseRunning = false;
    setCaseBusy($("btnDoRun"), false);
    toast(ex.message || "记录失败", "bad");
  });
}

/* ---------- 失败转缺陷 ---------- */

function openDefectDialog(id){
  var c = caseById(id);
  if(!caseWritable(c)){ toast("当前项目只读，无法新建缺陷", "warn"); return; }
  defectCaseId = id;
  $("caseDefectDesc").textContent = "「" + (c ? c.title : "") + "」将生成一条缺陷工作项：执行步骤、失败备注、执行人与环境自动写入描述。";
  $("defectSeverity").value = "";
  $("defectEnvironment").value = "";
  $("defectNote").value = "";
  $("defectCarry").checked = true;
  $("defectCarry").disabled = true;
  $("defectEvCount").textContent = "";
  $("defectEvidenceList").innerHTML = "";
  $("fDefectSeverity").classList.remove("invalid");
  defectEvidence = [];
  var seq = ++defectEvSeq;
  defectFormBaseline = defectFormSnapshot();
  UI.openModal($("dlgCaseDefect"), "select");
  /* 发现环境预填上一轮执行环境；证据清单取最近一轮失败附件 */
  API.get("/api/test-cases/" + encodeURIComponent(id) + "/runs", { limit: 1 }).then(function(page){
    if(seq !== defectEvSeq || defectCaseId !== id) return;
    var last = page && page.items && page.items[0];
    if(!last) return;
    if(last.environment && !$("defectEnvironment").value) $("defectEnvironment").value = last.environment;
    defectEvidence = last.status === "failed" ? (last.attachments || []) : [];
    renderDefectEvidence();
    defectFormBaseline = defectFormSnapshot();
  }).catch(function(){ /* 预填失败不阻塞转缺陷 */ });
}
function renderDefectEvidence(){
  var n = defectEvidence.length;
  $("defectEvCount").textContent = n ? "（" + n + " 个，复制为缺陷附件）" : "（本轮没有证据附件）";
  $("defectCarry").disabled = !n;
  if(!n) $("defectCarry").checked = false;
  $("defectEvidenceList").innerHTML = n
    ? defectEvidence.map(function(a){ return attachmentChipHTML(a, {}); }).join("")
    : "";
  syncDefectCarryDim();
}
function syncDefectCarryDim(){
  var box = $("defectEvidenceList");
  if(box) box.classList.toggle("is-muted", !$("defectCarry").checked);
}
function doDefect(){
  if(caseDefecting || !defectCaseId) return;
  var severity = $("defectSeverity").value;
  if(!severity){
    $("fDefectSeverity").classList.add("invalid");
    toast("缺陷必须选择严重度", "warn");
    return;
  }
  caseDefecting = true;
  setCaseBusy($("btnDoDefect"), true, "新建中…");
  recordEnv($("defectEnvironment").value);
  API.post("/api/test-cases/" + encodeURIComponent(defectCaseId) + "/defect", {
    severity: severity,
    environment: $("defectEnvironment").value.trim() || null,
    note: $("defectNote").value.trim() || null,
    carryEvidence: $("defectCarry").checked
  }).then(function(task){
    caseDefecting = false;
    setCaseBusy($("btnDoDefect"), false);
    var carried = $("defectCarry").checked && defectEvidence.length > 0;
    closeDefectDialog();
    toast("缺陷已创建" + (carried ? "，失败证据已复制到缺陷附件" : ""));
    loadCases().then(function(){ if(caseDetailId) renderCaseDetail(); });
    openTaskById(task.id);
  }).catch(function(ex){
    caseDefecting = false;
    setCaseBusy($("btnDoDefect"), false);
    toast(ex.message || "新建失败", "bad");
  });
}

/* ---------- 测试计划（A2：圈选用例 → 批量执行 → 按版本留痕） ---------- */

var plans = [];
var planSeq = 0;
var planDetail = null;        /* { plan, cases, passRate }，非空 = 正在看计划详情 */
var planDetailSeq = 0;
var planPendingOpen = null;   /* 跨视图跳转（交付说明）待打开的计划：列表加载完后落到详情，避免被 loadPlans 清掉 */
var planSel = {};             /* 详情页批量执行勾选：caseId -> true */
var planBatchStatus = "passed";
var editingPlanId = null;
var planFormReqId = null;     /* 当前计划弹窗的所属项目：编辑取计划自身，新增取选定目标 */
var planSaving = false;
var planDialogSeq = 0;
var planPickCases = [];
var planPickSel = {};
var planPickDemand = "";
var pickingPlan = false;
var planGroupErrors = {};     /* 全部项目下记录拉取失败的项目，渲染时逐项目提示 */
var planSearch = "";          /* 计划搜索：名称 / 版本 / 备注 / 项目名 */
var planStatus = "all";       /* 计划状态：all / draft / running / done */
var planSearchTimer = null;

var PLAN_STATUS = { draft: ["草稿", "mute"], running: ["执行中", "warn"], done: ["已完成", "ok"] };
function planBadgeHTML(s){
  var it = PLAN_STATUS[s] || PLAN_STATUS.draft;
  return '<span class="mini-tag ' + it[1] + '">' + it[0] + '</span>';
}
function planNextStatus(s){
  return s === "draft" ? "running" : (s === "running" ? "done" : "draft");
}
function planNextLabel(s){
  return s === "draft" ? "开始执行" : (s === "running" ? "标记完成" : "重新打开");
}
function planHasFilter(){ return !!(planSearch || planStatus !== "all"); }
function filteredPlans(){
  var q = planSearch.trim().toLowerCase();
  return plans.filter(function(p){
    if(planStatus !== "all" && p.status !== planStatus) return false;
    if(q){
      var hay = [p.name, p.versionName, p.note, reqNameOf(p.reqId)].join(" ").toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function syncPlanBar(){
  var bar = $("tcPlanBar");
  if(!bar) return;
  bar.hidden = tcMode !== "plans" || !!planDetail;
  var s = $("tcPlanSearch");
  if(s){
    s.placeholder = caseScopeAll ? "搜索全部项目计划…" : "搜索本项目计划…";
    s.title = caseScopeAll ? "在全部项目中搜索计划名称 / 版本" : "在所选项目内搜索计划名称 / 版本";
    s.setAttribute("aria-label", caseScopeAll ? "在全部项目中搜索测试计划" : "在所选项目内搜索测试计划");
  }
  var st = $("tcPlanStatus");
  if(st){
    st.value = planStatus;
    UI.markFiltered(st, planStatus === "all");
  }
  var clr = $("tcPlanClearFilter");
  if(clr) clr.hidden = !planHasFilter();
}
function clearPlanFilters(){
  if(planSearchTimer){ clearTimeout(planSearchTimer); planSearchTimer = null; }
  var had = planHasFilter();
  planSearch = "";
  planStatus = "all";
  var s = $("tcPlanSearch");
  if(s) s.value = "";
  syncPlanBar();
  renderPlans();
  if(had) toast("已清空计划筛选", "fs");
}
function planFilterEmptyHTML(){
  return UI.emptyState({
    icon: "search", title: "没有匹配的测试计划",
    text: "调整搜索关键词或状态筛选，也可以清空筛选后再看。",
    actionLabel: "清空计划筛选"
  });
}
function wirePlanFilterEmpty(){
  var btn = $("tcPlans").querySelector(".empty-state .btn");
  if(btn) btn.addEventListener("click", clearPlanFilters);
}

function loadPlans(){
  render();
  var box = $("tcPlans");
  if(!box) return;
  if(caseScopeAll){ loadPlansAll(++planSeq); return; }
  if(!caseReqId){
    plans = []; planDetail = null;
    box.innerHTML = UI.emptyState({
      icon: "folder", title: "还没有项目",
      text: "先创建项目，测试计划按项目收纳；一个版本或一轮回归建一个计划。"
    });
    return;
  }
  var seq = ++planSeq;
  box.innerHTML = UI.skeletonRows(3);
  API.getAllPages("/api/test-plans", { reqId: caseReqId }).then(function(rows){
    if(seq !== planSeq) return;
    plans = rows || [];
    planDetail = null;
    planDetailSeq++;
    renderPlans();
    if(planPendingOpen){ var pend = planPendingOpen; planPendingOpen = null; openPlanDetail(pend); }
  }).catch(function(ex){
    if(seq !== planSeq) return;
    box.innerHTML = UI.errorState(ex.message || "测试计划加载失败");
  });
}
/* 全部项目：逐项目取计划（每个项目内部仍按服务端顺序），项目加载失败只影响该段 */
function fetchPlansScoped(){
  var projects = caseScopeVisibleProjects();
  return Promise.all(projects.map(function(p){
    return API.getAllPages("/api/test-plans", { reqId: p.id }).then(function(rows){
      return { reqId: p.id, name: p.name, rows: rows || [], error: false };
    }).catch(function(){
      return { reqId: p.id, name: p.name, rows: [], error: true };
    });
  })).then(function(rs){
    var list = [], errors = {};
    rs.forEach(function(g){
      if(g.error){ errors[g.reqId] = true; return; }
      g.rows.forEach(function(p){ list.push(p); });
    });
    return { list: list, errors: errors };
  });
}
function loadPlansAll(seq){
  var box = $("tcPlans");
  if(!caseScopeVisibleProjects().length){
    plans = []; planDetail = null; planGroupErrors = {};
    box.innerHTML = UI.emptyState({
      icon: "folder", title: "没有可用项目",
      text: "项目都已归档，暂无测试计划可看。"
    });
    return;
  }
  box.innerHTML = UI.skeletonRows(3);
  fetchPlansScoped().then(function(r){
    if(seq !== planSeq || !caseScopeAll) return;
    plans = r.list;
    planGroupErrors = r.errors;
    planDetail = null;
    planDetailSeq++;
    renderPlans();
  });
}
/* 详情里的批量执行、加减用例只刷新了详情；回列表时再取一次，卡片上的通过率与执行数才不会停在旧值 */
var planListSeq = 0;
function refreshPlansQuiet(){
  if(caseScopeAll){
    var seqAll = ++planListSeq;
    return fetchPlansScoped().then(function(r){
      if(seqAll !== planListSeq || planDetail || !caseScopeAll) return;
      plans = r.list;
      planGroupErrors = r.errors;
      renderPlans();
    }).catch(function(){ /* 拉取失败保留当前列表 */ });
  }
  if(!caseReqId) return Promise.resolve();
  var seq = ++planListSeq;
  return API.getAllPages("/api/test-plans", { reqId: caseReqId }).then(function(rows){
    if(seq !== planListSeq || planDetail || caseScopeAll) return;
    plans = rows || [];
    renderPlans();
  }).catch(function(){ /* 拉取失败保留当前列表 */ });
}
function planRowHTML(p){
  var pct = p.caseCount ? Math.round((p.executedCount || 0) * 100 / p.caseCount) : 0;
  var meta = [];
  if(p.versionName) meta.push("版本：" + p.versionName);
  if(p.plannedStart || p.plannedEnd) meta.push((p.plannedStart || "—") + " → " + (p.plannedEnd || "—"));
  meta.push("用例 " + (p.caseCount || 0) + " · 已执行 " + (p.executedCount || 0));
  if(p.createdBy) meta.push(p.createdBy + " · " + (fmtTs(p.createdAt) || ""));
  /* 全部项目下每行可能来自不同项目，写权限必须按计划自身项目判断 */
  var w = canEditReq(p.reqId);
  var acts = '<button class="btn sm" type="button" data-plan-open="' + esc(p.id) + '">打开</button>';
  if(w){
    /* 已完成计划是快照：update 服务端同样拒绝，这里不再提供编辑入口 */
    acts += '<span class="tc-secondary">'
      + (p.status !== "done"
          ? '<button class="btn sm ghost" type="button" data-plan-edit="' + esc(p.id) + '">' + icon("edit", 13) + ' 编辑</button>'
          : "")
      + '<button class="icon-btn sm" type="button" data-plan-del="' + esc(p.id) + '" aria-label="删除计划">' + icon("trash", 14) + '</button>'
      + '</span>';
  }
  return '<div class="tc-row" data-plan-open="' + esc(p.id) + '">'
    + planBadgeHTML(p.status)
    + '<div class="tc-main">'
    +   '<div class="tc-title">' + esc(p.name) + '</div>'
    +   '<div class="tc-meta">' + meta.map(esc).join(" · ") + '</div>'
    +   '<div class="plan-bar"><i style="width:' + pct + '%"></i></div>'
    + '</div>'
    + '<div class="plan-counts">'
    +   '<span class="mini-tag ok">通过 ' + (p.passedCount || 0) + '</span>'
    +   '<span class="mini-tag over">失败 ' + (p.failedCount || 0) + '</span>'
    +   (p.skippedCount ? '<span class="mini-tag mute">跳过 ' + p.skippedCount + '</span>' : "")
    +   (p.defectCount ? '<span class="mini-tag over">缺陷 ' + p.defectCount + '</span>' : "")
    + '</div>'
    + '<div class="tc-acts">' + acts + '</div>'
    + '</div>';
}
function renderPlans(){
  var box = $("tcPlans");
  if(!box) return;
  syncPlanBar();
  if(planDetail){ renderPlanDetail(); return; }
  var list = filteredPlans();
  if(caseScopeAll){
    var projects = caseScopeVisibleProjects();
    if(!list.length && !Object.keys(planGroupErrors).length){
      box.innerHTML = planHasFilter()
        ? planFilterEmptyHTML()
        : UI.emptyState({
          icon: "checklist", title: "全部项目下还没有测试计划",
          text: caseScopeVisibleProjects().some(function(p){ return canEditReq(p.id); })
            ? "点右上角「新建计划」，选择目标项目后创建；计划按项目收纳，全部项目只做汇总浏览。"
            : "当前没有可写的项目；获得写权限后即可新建计划。"
        });
      if(planHasFilter()) wirePlanFilterEmpty();
      return;
    }
    box.innerHTML = projects.filter(function(p){
      return planGroupErrors[p.id] || list.some(function(x){ return x.reqId === p.id; });
    }).map(function(p){
      var rows = list.filter(function(x){ return x.reqId === p.id; });
      var body;
      if(planGroupErrors[p.id]) body = '<p class="tc-group-empty">该项目计划加载失败；可切到单个项目重试。</p>';
      else if(!rows.length) body = '<p class="tc-group-empty">还没有测试计划</p>';
      else body = rows.map(planRowHTML).join("");
      return '<section class="tc-group" data-plan-group="' + esc(p.id) + '">'
        + '<div class="tc-group-head"><span class="tc-group-name">' + esc(p.name) + '</span>'
        + '<span class="tc-group-count">' + rows.length + ' 个计划</span>'
        + '<span class="tc-group-bar" aria-hidden="true"></span></div>'
        + '<div class="tc-group-rows">' + body + '</div></section>';
    }).join("");
    return;
  }
  if(!list.length){
    box.innerHTML = planHasFilter() ? planFilterEmptyHTML() : UI.emptyState({
      icon: "checklist", title: "还没有测试计划",
      text: isWritable()
        ? "点右上角「新建计划」：圈选一批用例，批量记录结果，完成即留痕。"
        : "测试计划按项目收纳；你在该项目只有查看权限。"
    });
    if(planHasFilter()) wirePlanFilterEmpty();
    return;
  }
  box.innerHTML = list.map(planRowHTML).join("");
}

/* ---------- 计划变更记录 ---------- */

var planTimeline = { id: null, rows: null, error: "", loading: false, open: false };
var planTimelineSeq = 0;

function planTimelineHTML(){
  var count = planTimeline.rows ? String(planTimeline.rows.length) : "";
  var body;
  if(planTimeline.error){
    body = '<p class="tl-empty">变更记录加载失败：' + esc(planTimeline.error) + '</p>';
  }else if(!planTimeline.rows){
    body = '<p class="tl-empty">展开后加载变更记录。</p>';
  }else{
    body = timelineRowsHTML(planTimeline.rows, "暂无变更记录；新建、编辑、圈选与批量执行都会记录在这里。");
  }
  return '<details class="entity-log" data-plan-timeline' + (planTimeline.open ? " open" : "") + '>'
    + '<summary><span class="caret" aria-hidden="true">▶</span>变更记录 <span class="cnt" data-plan-timeline-count>' + esc(count) + '</span></summary>'
    + '<div class="timeline" data-plan-timeline-list>' + body + '</div>'
    + '<p class="foot-note">执行结果与失败证据按用例在「执行历史」中查看；此处只记计划本身的变更。</p>'
    + '</details>';
}

function planTimelineMount(planId){
  var base = $("tcPlans");
  var el = base && base.querySelector("[data-plan-timeline]");
  if(!el) return;
  /* 详情重绘后节点会换，监听重新挂到新节点上 */
  el.addEventListener("toggle", function(){
    planTimeline.open = el.open;
    if(el.open && planTimeline.rows === null && !planTimeline.loading && !planTimeline.error){
      loadPlanTimeline(planId);
    }
  });
  if(planTimeline.open && planTimeline.rows === null && !planTimeline.loading && !planTimeline.error){
    loadPlanTimeline(planId);
  }
}

function loadPlanTimeline(planId){
  var seq = ++planTimelineSeq;
  planTimeline.loading = true;
  paintPlanTimeline("加载中…");
  API.get("/api/test-plans/" + encodeURIComponent(planId) + "/timeline").then(function(rows){
    if(seq !== planTimelineSeq || planTimeline.id !== planId) return;
    planTimeline.rows = rows || [];
    planTimeline.error = "";
    planTimeline.loading = false;
    paintPlanTimeline();
  }).catch(function(ex){
    if(seq !== planTimelineSeq || planTimeline.id !== planId) return;
    planTimeline.error = ex.message || "网络异常";
    planTimeline.loading = false;
    paintPlanTimeline();
  });
}

/* 只重画时间线区域：详情里的勾选、备注输入不因异步到达而丢失 */
function paintPlanTimeline(loadingText){
  var base = $("tcPlans");
  var el = base && base.querySelector("[data-plan-timeline]");
  if(!el) return;
  var cnt = el.querySelector("[data-plan-timeline-count]");
  var list = el.querySelector("[data-plan-timeline-list]");
  if(loadingText){
    if(cnt) cnt.textContent = "";
    if(list) list.innerHTML = '<p class="tl-empty">' + esc(loadingText) + '</p>';
    return;
  }
  if(planTimeline.error){
    if(cnt) cnt.textContent = "";
    if(list) list.innerHTML = '<p class="tl-empty">变更记录加载失败：' + esc(planTimeline.error) + '</p>';
    return;
  }
  var rows = planTimeline.rows || [];
  if(cnt) cnt.textContent = rows.length ? String(rows.length) : "";
  if(list) list.innerHTML = timelineRowsHTML(rows, "暂无变更记录；新建、编辑、圈选与批量执行都会记录在这里。");
}

function openPlanDetail(id){
  var seq = ++planDetailSeq;
  planSel = {};
  var bar = $("tcPlanBar");
  if(bar) bar.hidden = true;
  $("tcPlans").innerHTML = UI.skeletonRows(4);
  Promise.all([
    API.get("/api/test-plans/" + encodeURIComponent(id)),
    API.getAllPages("/api/test-plans/" + encodeURIComponent(id) + "/cases")
  ]).then(function(results){
    if(seq !== planDetailSeq) return;
    var d = results[0];
    planDetail = d && d.plan ? d : null;
    if(!planDetail){ $("tcPlans").innerHTML = UI.errorState("计划不存在或无权查看"); return; }
    planDetail.cases = results[1] || [];
    renderPlanDetail();
  }).catch(function(ex){
    if(seq !== planDetailSeq) return;
    $("tcPlans").innerHTML = UI.errorState(ex.message || "计划加载失败");
  });
}
function renderPlanDetail(){
  var box = $("tcPlans");
  var d = planDetail;
  if(!box || !d) return;
  var p = d.plan;
  if(planTimeline.id !== p.id){
    planTimelineSeq++;
    planTimeline = { id: p.id, rows: null, error: "", loading: false, open: false };
  }
  var cs = d.cases || [];
  var done = p.status === "done";
  var w = canEditReq(p.reqId);
  var editable = w && !done;
  var untested = (p.caseCount || 0) - (p.executedCount || 0);
  var selCount = 0;
  for(var k in planSel) if(planSel[k]) selCount++;
  var meta = [];
  if(p.versionName) meta.push("版本：" + assocLinkHTML("version", p.versionId, p.versionName, {req:p.reqId}));
  if(p.plannedStart || p.plannedEnd) meta.push(esc("计划 " + (p.plannedStart || "—") + " → " + (p.plannedEnd || "—")));
  if(p.createdBy) meta.push(esc(p.createdBy + " 创建"));
  var head = '<div class="plan-head">'
    + '<button class="btn sm ghost" type="button" data-plan-back>' + icon("left", 13) + ' 返回</button>'
    + '<span class="toolbar-title">' + esc(p.name) + '</span>' + planBadgeHTML(p.status)
    + '<span class="toolbar-meta">' + meta.join(" · ") + '</span>'
    + (w ? '<button class="btn sm" type="button" data-plan-status="' + esc(planNextStatus(p.status)) + '">'
        + planNextLabel(p.status) + '</button>' : "")
    + '</div>';
  if(p.note) head += '<p class="foot-note">' + esc(p.note) + '</p>';
  if(done) head += '<p class="foot-note">已完成计划是结果快照：圈选与批量执行已锁定，可重新打开后继续编辑。</p>';
  /* 需求范围：由计划内用例的主需求派生，不单独存计划字段 */
  var scope = [], scopeMap = {};
  cs.forEach(function(c){
    var key = c.demandId || "__none__";
    if(!scopeMap[key]){
      scopeMap[key] = { id: c.demandId || "", title: c.demandTitle || "未关联需求", cases: 0, workItems: {}, required: 0 };
      scope.push(scopeMap[key]);
    }
    var s = scopeMap[key];
    s.cases++;
    if(c.required) s.required++;
    (c.tasks || []).forEach(function(t){ s.workItems[t.taskId] = true; });
  });
  if(scope.length){
    head += '<div class="plan-scope" role="list" aria-label="计划需求范围">'
      + '<span class="plan-scope-label">需求范围</span>'
      + scope.map(function(s){
          var wi = Object.keys(s.workItems).length;
          return '<span class="plan-scope-chip" role="listitem" title="' + esc(s.title) + '">'
            + '<b>' + assocLinkHTML("demand", s.id, s.title) + '</b>'
            + '<span class="plan-scope-count">' + s.cases + ' 条用例'
            + (wi ? ' · ' + wi + ' 项工作项' : ' · 需求级') + '</span>'
            + (s.required ? '<span class="plan-req-tag" title="发布必测">必测 ' + s.required + '</span>' : "")
            + '</span>';
        }).join("")
      + '</div>';
  }
  var pct = p.caseCount ? Math.round((p.executedCount || 0) * 100 / p.caseCount) : 0;
  head += '<div class="tc-stats plan-stats">'
    + '<span class="tc-stat"><b>' + (p.caseCount || 0) + '</b>圈选</span>'
    + '<span class="tc-stat mute"><b>' + Math.max(0, untested) + '</b>未执行</span>'
    + '<span class="tc-stat ok"><b>' + (p.passedCount || 0) + '</b>通过</span>'
    + '<span class="tc-stat over"><b>' + (p.failedCount || 0) + '</b>失败</span>'
    + '<span class="tc-stat warn"><b>' + (p.blockedCount || 0) + '</b>阻塞</span>'
    + '<span class="tc-stat' + ((p.skippedCount || 0) > 0 ? "" : " mute") + '" title="本次不执行 / 不适用，不计入通过率"><b>' + (p.skippedCount || 0) + '</b>跳过</span>'
    + '<span class="tc-stat"><b>' + pct + '%</b>进度</span>'
    + '<span class="tc-stat"><b>' + (d.passRate == null ? "—" : d.passRate + "%") + '</b>通过率</span>'
    + '<span class="tc-stat over"><b>' + (p.defectCount || 0) + '</b>转缺陷</span>'
    + '</div>';
  var acts = '<div class="plan-acts">';
  if(editable){
    acts += '<button class="btn sm" type="button" data-plan-pick>' + icon("plus", 13) + ' 圈选用例</button>';
    acts += '<span class="seg mini" data-plan-batch role="group" aria-label="批量执行结果">'
      + '<button type="button" data-pbatch="passed" aria-pressed="' + (planBatchStatus === "passed") + '">通过</button>'
      + '<button type="button" data-pbatch="failed" aria-pressed="' + (planBatchStatus === "failed") + '">失败</button>'
      + '<button type="button" data-pbatch="blocked" aria-pressed="' + (planBatchStatus === "blocked") + '">阻塞</button>'
      + '<button type="button" data-pbatch="skipped" aria-pressed="' + (planBatchStatus === "skipped") + '" title="本次不执行 / 不适用，不计入通过率">跳过</button>'
      + '</span>'
      + '<input id="planRunNote" type="text" maxlength="500" class="plan-note-inp" placeholder="批量备注（选填，写入本轮执行记录）" />'
      + '<button class="btn sm primary" type="button" data-plan-runs>记录选中 ' + selCount + ' 条</button>';
  }
  acts += '<button class="btn sm ghost" type="button" data-plan-csv>' + icon("download", 13) + ' 导出报告</button>';
  acts += '</div>';
  var selBar = "";
  if(editable && cs.length){
    var noneN = 0, failedN = 0, blockedN = 0, skippedN = 0;
    cs.forEach(function(c){
      if(!c.result) noneN++;
      else if(c.result === "failed") failedN++;
      else if(c.result === "blocked") blockedN++;
      else if(c.result === "skipped") skippedN++;
    });
    selBar = '<div class="plan-selbar" data-plan-selbar>'
      + '<label><input type="checkbox" class="cbx" data-plan-select-all aria-label="全选计划内用例" />全选</label>'
      + '<button class="btn sm ghost" type="button" data-plan-pick-status="none" title="替换当前选择"' + (noneN ? "" : " disabled") + '>选未执行 (' + noneN + ')</button>'
      + (failedN ? '<button class="btn sm ghost" type="button" data-plan-pick-status="failed" title="替换当前选择">选失败 (' + failedN + ')</button>' : "")
      + (blockedN ? '<button class="btn sm ghost" type="button" data-plan-pick-status="blocked" title="替换当前选择">选阻塞 (' + blockedN + ')</button>' : "")
      + (skippedN ? '<button class="btn sm ghost" type="button" data-plan-pick-status="skipped" title="替换当前选择">选跳过 (' + skippedN + ')</button>' : "")
      + '<button class="btn sm ghost" type="button" data-plan-clear' + (selCount ? "" : " disabled") + '>清除选择</button>'
      + '<span class="plan-sel-count" data-plan-sel-count>已选 ' + selCount + ' / ' + cs.length + '</span>'
      + '</div>';
  }
  var rows = "";
  if(!cs.length){
    rows = UI.emptyState({
      icon: "checklist", title: "计划里还没有用例",
      text: editable ? "点「圈选用例」从项目用例库挑一批。" : "该计划暂未圈选用例。"
    });
  }else{
    rows = cs.map(function(c){
      var chk = editable
        ? '<input type="checkbox" data-pcase="' + esc(c.caseId) + '"' + (planSel[c.caseId] ? " checked" : "")
          + ' aria-label="选择用例「' + esc(c.title) + '」" />'
        : "";
      var tail = [];
      if(c.demandTitle) tail.push("需求：" + cut(c.demandTitle, 24));
      var tasks = c.tasks || [];
      if(tasks.length){
        var names = tasks.map(function(t){ return (itemNoText(t) || "WI") + " " + t.taskTitle; });
        tail.push("工作项：" + cut(names.join("、"), 40));
      }else{
        tail.push("需求级覆盖");
      }
      if(c.module) tail.push(c.module);
      tail.push((c.priority || "—"));
      if(c.executedBy) tail.push(c.executedBy + " " + (fmtTs(c.executedAt) || ""));
      var reqTag = c.required
        ? '<span class="plan-req-tag" title="发布检查必须执行并通过">发布必测</span>' : "";
      var reqToggle = editable
        ? '<button class="plan-req-toggle' + (c.required ? " on" : "") + '" type="button"'
          + ' data-plan-req="' + esc(c.caseId) + '" data-required="' + (c.required ? "1" : "0") + '"'
          + ' aria-pressed="' + (c.required ? "true" : "false") + '"'
          + ' title="' + (c.required ? "取消发布必测" : "标记为发布必测") + '">'
          + icon("star", 13) + '</button>'
        : "";
      var del = editable
        ? '<button class="icon-btn sm" type="button" data-plan-rm="' + esc(c.caseId) + '" aria-label="移出计划" title="移出计划（不删用例）">' + icon("minus", 14) + '</button>'
        : "";
      return '<div class="tc-row plan-case">' + chk
        + '<span class="tc-no" title="用例编号">' + esc(caseNoText(c)) + '</span>'
        + statusBadgeHTML(c.result)
        + '<div class="tc-main">'
        +   '<div class="tc-title">' + assocLinkHTML("case", c.caseId, c.title, {req:p.reqId}) + ' ' + reqTag + '</div>'
        +   '<div class="tc-meta">' + tail.map(esc).join(" · ") + '</div>'
        +   (c.note ? '<div class="tc-note">' + esc(c.note) + '</div>' : "")
        + '</div>'
        + '<div class="tc-acts">' + (c.latestStatus ? '<span class="toolbar-meta">用例库最近：'
            + (STATUS_LABEL[c.latestStatus] || c.latestStatus) + '</span>' : "") + reqToggle + del + '</div>'
        + '</div>';
    }).join("");
  }
  box.innerHTML = head + acts + selBar + '<div class="tc-list">' + rows + '</div>' + planTimelineHTML();
  syncPlanSelUI();
  planTimelineMount(p.id);
}
/* 勾选状态与批量按钮、表头全选保持同步：所有变更都走这里收口 */
function syncPlanSelUI(){
  var box = $("tcPlans");
  if(!box) return;
  var rows = Array.prototype.slice.call(box.querySelectorAll("[data-pcase]"));
  var n = 0;
  rows.forEach(function(c){
    c.checked = !!planSel[c.dataset.pcase];
    if(c.checked) n++;
  });
  var all = box.querySelector("[data-plan-select-all]");
  if(all){
    all.checked = rows.length > 0 && n === rows.length;
    all.indeterminate = n > 0 && n < rows.length;
    all.disabled = !rows.length;
  }
  var cnt = box.querySelector("[data-plan-sel-count]");
  if(cnt) cnt.textContent = "已选 " + n + " / " + rows.length;
  var clr = box.querySelector("[data-plan-clear]");
  if(clr) clr.disabled = n === 0;
  var btn = box.querySelector("[data-plan-runs]");
  if(btn) btn.textContent = "记录选中 " + n + " 条";
}
function planCaseIds(){
  return (planDetail && planDetail.cases || []).map(function(c){ return c.caseId; });
}
var planRunBusy = false;
function doPlanBatchRun(){
  /* 执行记录是追加写：连点会重复记一批结果，提交中直接忽略 */
  if(planRunBusy || !planDetail) return;
  var ids = [];
  for(var k in planSel) if(planSel[k]) ids.push(k);
  if(!ids.length){ toast("先勾选要标记结果的用例", "warn"); return; }
  var note = $("planRunNote") ? $("planRunNote").value.trim() : "";
  var planId = planDetail.plan.id;
  var btn = document.querySelector("[data-plan-runs]");
  planRunBusy = true;
  if(btn) btn.disabled = true;
  API.post("/api/test-plans/" + encodeURIComponent(planId) + "/runs",
    { caseIds: ids, status: planBatchStatus, note: note || null })
  .then(function(n){
    toast("已记录 " + (n || 0) + " 条执行结果", "fs");
    if(planDetail && planDetail.plan.id === planId) openPlanDetail(planId);
  }).catch(function(ex){ toast(ex.message || "批量记录失败", "bad"); })
  .then(function(){ planRunBusy = false; if(btn) btn.disabled = false; });
}
var planReqBusy = {};
function togglePlanRequired(caseId, required){
  if(!planDetail || planReqBusy[caseId]) return;
  var planId = planDetail.plan.id;
  planReqBusy[caseId] = true;
  API.put("/api/test-plans/" + encodeURIComponent(planId) + "/cases/" + encodeURIComponent(caseId)
      + "/required?required=" + (required ? "true" : "false"), {})
    .then(function(){
      (planDetail.cases || []).forEach(function(c){ if(c.caseId === caseId) c.required = required; });
      renderPlanDetail();
      toast(required ? "已标记为发布必测" : "已取消发布必测", "fs");
    })
    .catch(function(ex){ toast(ex.message || "更新失败", "bad"); })
    .then(function(){ delete planReqBusy[caseId]; });
}
function planStatusTo(status){
  API.put("/api/test-plans/" + encodeURIComponent(planDetail.plan.id) + "/status?status=" + encodeURIComponent(status), {})
  .then(function(){
    toast(status === "done" ? "计划已完成并留痕" : (status === "running" ? "计划已开始执行" : "计划已回到草稿"), "fs");
    openPlanDetail(planDetail.plan.id);
  }).catch(function(ex){ toast(ex.message || "状态更新失败", "bad"); });
}
function exportPlanCsv(){
  var d = planDetail;
  if(!d) return;
  var rows = [["编号", "标题", "需求", "工作项", "发布必测", "模块", "优先级", "计划结果", "执行人", "执行时间", "备注"]];
  (d.cases || []).forEach(function(c){
    var tasks = (c.tasks || []).map(function(t){ return (itemNoText(t) || "WI") + " " + t.taskTitle; }).join("、");
    rows.push([caseNoText(c), c.title, c.demandTitle || "", tasks || "需求级覆盖", c.required ? "是" : "",
      c.module || "", c.priority || "",
      c.result ? (STATUS_LABEL[c.result] || c.result) : "未执行",
      c.executedBy || "", c.executedAt ? fmtTs(c.executedAt) : "", c.note || ""]);
  });
  downloadCsv("测试计划-" + d.plan.name + ".csv", rows);
  toast("已导出计划报告 CSV", "fs");
}

/* 新建 / 编辑计划 */
function openPlanDialog(id, targetReqId){
  editingPlanId = id || null;
  var p = null;
  if(id) for(var i = 0; i < plans.length; i++) if(plans[i].id === id) p = plans[i];
  planFormReqId = p && p.reqId ? p.reqId : (targetReqId || caseReqId || null);
  if(!planFormReqId){ toast("先选择项目，再新建测试计划", "warn"); return; }
  if(!canEditReq(planFormReqId)){ toast("当前项目只读，无法编辑测试计划", "warn"); return; }
  $("planFormTitle").textContent = (p ? "编辑测试计划" : "新建测试计划")
    + (caseScopeAll ? " · " + reqNameOf(planFormReqId) : "");
  $("pName").value = p ? p.name : "";
  $("fPlanName").classList.remove("invalid");
  $("pStart").value = p && p.plannedStart ? p.plannedStart : "";
  $("pEnd").value = p && p.plannedEnd ? p.plannedEnd : "";
  $("pNote").value = p && p.note ? p.note : "";
  /* 编辑时先放入当前关联版本：版本列表未回来（或加载失败）就保存，也不会把关联清成 null */
  var keepVersion = p && p.versionId ? p.versionId : "";
  $("pVersion").innerHTML = '<option value="">不关联版本</option>' +
    (keepVersion ? '<option value="' + esc(keepVersion) + '">当前关联版本</option>' : "");
  $("pVersion").value = keepVersion;
  $("btnSavePlan").textContent = "保存";
  UI.openModal($("dlgPlan"), "input");
  var dialogSeq = ++planDialogSeq;
  API.get("/api/versions", { reqId: planFormReqId }).then(function(vs){
    if(dialogSeq !== planDialogSeq) return;
    var cur = $("pVersion").value;
    var html = '<option value="">不关联版本</option>', found = false;
    (vs || []).forEach(function(v){
      if(v.id === cur) found = true;
      html += '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>';
    });
    if(cur && !found) html += '<option value="' + esc(cur) + '">当前关联版本（不在列表中）</option>';
    $("pVersion").innerHTML = html;
    $("pVersion").value = cur;
  }).catch(function(){ /* 版本下拉失败不阻塞：保留当前关联 */ });
}
/* 全部项目下新建计划先选项目；只有一个可写项目时直接开弹窗 */
function openPlanCreate(){
  if(caseScopeAll){
    var targets = caseScopeVisibleProjects().filter(function(r){ return canEditReq(r.id); });
    if(!targets.length){ toast("全部项目里没有可写项目，无法新建测试计划", "warn"); return; }
    if(targets.length === 1){ openPlanDialog(null, targets[0].id); return; }
    var btn = $("btnPlanNew");
    var el = document.createElement("div");
    el.className = "menu";
    el.innerHTML = '<div class="menu-title">新建测试计划到</div>'
      + targets.map(function(r){
        return '<button class="menu-item" type="button" data-plan-target="' + esc(r.id) + '">'
          + '<span>' + esc(r.name) + '</span></button>';
      }).join("");
    el.addEventListener("click", function(e){
      var b = e.target.closest("[data-plan-target]");
      if(!b) return;
      var id = b.getAttribute("data-plan-target");
      UI.closeAllPops();
      openPlanDialog(null, id);
    });
    UI.openPop(el, btn, { align: "right", width: 240, onClose: function(){ el.remove(); } });
    return;
  }
  if(!caseReqId){ toast("先在上方选择一个项目，再新建测试计划", "warn"); if($("tcReq")) $("tcReq").focus(); return; }
  if(!isWritable()){ toast("当前项目只读，无法新建测试计划", "warn"); return; }
  openPlanDialog(null, caseReqId);
}
function savePlan(){
  if(planSaving) return;
  if(!planFormReqId || !canEditReq(planFormReqId)){ toast("当前项目只读，无法保存测试计划", "warn"); return; }
  var name = $("pName").value.trim();
  if(!name){ $("fPlanName").classList.add("invalid"); toast("请填写计划名称", "warn"); return; }
  var body = {
    reqId: planFormReqId,
    name: name,
    versionId: $("pVersion").value || null,
    plannedStart: $("pStart").value || null,
    plannedEnd: $("pEnd").value || null,
    note: $("pNote").value.trim() || null
  };
  planSaving = true;
  setCaseBusy($("btnSavePlan"), true, "保存中…");
  var call = editingPlanId
    ? API.put("/api/test-plans/" + encodeURIComponent(editingPlanId), body)
    : API.post("/api/test-plans", body);
  call.then(function(){
    planSaving = false;
    setCaseBusy($("btnSavePlan"), false);
    UI.closeModal($("dlgPlan"));
    toast(editingPlanId ? "计划已更新" : "计划已创建", "fs");
    loadPlans();
  }).catch(function(ex){
    planSaving = false;
    setCaseBusy($("btnSavePlan"), false);
    toast(ex.message || "保存失败", "bad");
  });
}
function deletePlan(id){
  var p = null;
  for(var i = 0; i < plans.length; i++) if(plans[i].id === id) p = plans[i];
  if(!p) return;
  if(!canEditReq(p.reqId)){ toast("当前项目只读，无法删除测试计划", "warn"); return; }
  UI.showConfirm({
    title: "删除测试计划",
    msg: "删除计划「" + esc(p.name) + "」？已登记的执行记录会保留在「用例」页的执行历史中，仅计划汇总随之删除。",
    okText: "删除计划"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/test-plans/" + encodeURIComponent(id)).then(function(){
      toast("计划已删除", "fs");
      loadPlans();
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}

/* 圈选用例弹窗 */
function openPlanPick(){
  var d = planDetail;
  if(!d) return;
  pickingPlan = false;
  planPickSel = {};
  planPickDemand = "";
  $("planPickList").innerHTML = UI.skeletonRows(3);
  $("planPickCount").textContent = "";
  var demandSel = $("planPickDemand");
  if(demandSel) demandSel.innerHTML = '<option value="">全部需求</option>';
  UI.openModal($("dlgPlanPick"), "input");
  loadAllCases({ reqId: d.plan.reqId }).then(function(page){
    var inPlan = {};
    (d.cases || []).forEach(function(c){ inPlan[c.caseId] = true; });
    planPickCases = (page && page.items || []).filter(function(c){ return !inPlan[c.id]; });
    if(!planPickCases.length){
      $("planPickList").innerHTML = '<p class="rep-empty">项目用例库里的用例都已在本计划中。要更多用例可先在「用例」页录入或 Excel / CSV 导入。</p>';
      $("btnDoPlanPick").disabled = true;
      renderPlanPickDemandOptions();
      return;
    }
    $("btnDoPlanPick").disabled = false;
    renderPlanPickDemandOptions();
    renderPlanPickList();
  }).catch(function(ex){
    $("planPickList").innerHTML = UI.errorState(ex.message || "用例加载失败");
  });
}
/* 按需求归组候选用例：需求下拉只列还有可加入用例的需求 */
function renderPlanPickDemandOptions(){
  var sel = $("planPickDemand");
  if(!sel) return;
  var map = {}, list = [];
  planPickCases.forEach(function(c){
    var key = c.demandId || "__none__";
    if(!map[key]){
      map[key] = { id: key, title: c.demandTitle || "未关联需求", count: 0 };
      list.push(map[key]);
    }
    map[key].count++;
  });
  list.sort(function(a, b){
    if(a.id === "__none__") return 1;
    if(b.id === "__none__") return -1;
    return a.title.localeCompare(b.title, "zh-CN");
  });
  sel.innerHTML = '<option value="">全部需求（' + planPickCases.length + '）</option>'
    + list.map(function(d){
        return '<option value="' + esc(d.id) + '">' + esc(d.title) + '（' + d.count + '）</option>';
      }).join("");
  sel.value = planPickDemand || "";
}
function planPickVisibleCases(){
  if(!planPickDemand) return planPickCases;
  return planPickCases.filter(function(c){
    return (c.demandId || "__none__") === planPickDemand;
  });
}
function renderPlanPickList(){
  var list = planPickVisibleCases();
  if(!list.length){
    $("planPickList").innerHTML = '<p class="rep-empty">该需求下没有可加入的用例。</p>';
    syncPickCount();
    return;
  }
  $("planPickList").innerHTML = list.map(function(c){
    return '<label class="pick-row"><input type="checkbox" data-pick-case="' + esc(c.id) + '"'
      + (planPickSel[c.id] ? " checked" : "") + ' />'
      + statusBadgeHTML(c.latestStatus)
      + '<span class="pick-main"><b>' + esc(c.title) + '</b>'
      + '<small>' + esc([c.demandTitle || "未关联需求", c.module, c.priority || "—"].filter(Boolean).join(" · ")) + '</small></span></label>';
  }).join("");
  syncPickCount();
}
function syncPickCount(){
  var n = Object.keys(planPickSel).length;
  var label = "";
  if(planPickDemand){
    var hit = planPickCases.filter(function(c){ return (c.demandId || "__none__") === planPickDemand; })[0];
    label = " · 当前需求：" + (hit ? (hit.demandTitle || "未关联需求") : "");
  }
  $("planPickCount").textContent = "已选 " + n + " / 可加入 " + planPickCases.length + " 条" + label;
}
function doPlanPick(){
  if(pickingPlan) return;
  var ids = Object.keys(planPickSel);
  if(!ids.length){ toast("先勾选要加入的用例", "warn"); return; }
  pickingPlan = true;
  setCaseBusy($("btnDoPlanPick"), true, "加入中…");
  API.post("/api/test-plans/" + encodeURIComponent(planDetail.plan.id) + "/cases", { caseIds: ids })
  .then(function(added){
    pickingPlan = false;
    setCaseBusy($("btnDoPlanPick"), false);
    UI.closeModal($("dlgPlanPick"));
    toast("已加入 " + (added || 0) + " 条用例" + (ids.length - (added || 0) ? "（重复的已跳过）" : ""), "fs");
    openPlanDetail(planDetail.plan.id);
  }).catch(function(ex){
    pickingPlan = false;
    setCaseBusy($("btnDoPlanPick"), false);
    toast(ex.message || "加入失败", "bad");
  });
}

/* ---------- 用例导入导出（Excel / CSV） ---------- */

/* 格式与范围写进菜单（Excel / CSV × 当前筛选 / 所选 / 项目全部），
   Excel 默认并记住上次选择；筛选与所选都含未加载的行。模板放在「导入」菜单里，
   因为它是导入的前置动作，而不是导出产物。 */
var TC_EXPORT_FMT_KEY = "hg.tcExportFmt";
var tcExportFmt = "xlsx";
try{ if(localStorage.getItem(TC_EXPORT_FMT_KEY) === "csv") tcExportFmt = "csv"; }catch(e){}
function tcExportExt(fmt){ return fmt === "csv" ? ".csv" : ".xlsx"; }
function renderExportMenu(){
  var el = $("tcExportMenu");
  if(!el) return;
  var n = caseSelCount();
  var fmt = tcExportFmt;
  el.innerHTML = '<div class="menu-title">导出测试用例</div>'
    + '<div class="tc-export-fmt"><span class="seg mini" role="group" aria-label="导出格式">'
    +   '<button type="button" data-tc-export-fmt="xlsx" aria-pressed="' + (fmt === "xlsx") + '">Excel</button>'
    +   '<button type="button" data-tc-export-fmt="csv" aria-pressed="' + (fmt === "csv") + '">CSV</button>'
    + '</span></div>'
    + '<button class="menu-item" type="button" data-tc-export="filter">' + icon("filter", 13)
    +   '<span>导出当前筛选结果</span><span class="k">' + caseTotal + '</span></button>'
    + '<button class="menu-item" type="button" data-tc-export="ids"' + (n ? "" : " disabled") + '>'
    +   icon("check", 13) + '<span>导出所选</span><span class="k">' + n + '</span></button>'
    + '<button class="menu-item" type="button" data-tc-export="all">' + icon("download", 13)
    +   '<span>导出项目全部</span><span class="k">' + ((stats && stats.total) || 0) + '</span></button>'
    + '<div class="menu-note">' + (fmt === "csv" ? "CSV 不含样式；" : "Excel 含表头样式、列宽与执行结果列；")
    +   '筛选与所选都包含未加载的行；一次最多 2000 条。</div>';
}
function renderImportMenu(){
  var el = $("tcImportMenu");
  if(!el) return;
  el.innerHTML = '<div class="menu-title">导入测试用例</div>'
    + '<button class="menu-item" type="button" data-tc-import="file">' + icon("upload", 13)
    +   '<span>从文件导入…</span><span class="k">Excel / CSV</span></button>'
    + '<div class="menu-sep"></div>'
    + '<button class="menu-item" type="button" data-tc-template="xlsx">' + icon("download", 13)
    +   '<span>下载 Excel 导入模板</span><span class="k">推荐</span></button>'
    + '<button class="menu-item" type="button" data-tc-template="csv">' + icon("download", 13)
    +   '<span>下载 CSV 导入模板</span></button>'
    + '<div class="menu-note">模板含示例行、优先级下拉与「填写说明」页；导入按表头识别列，只读第一个工作表。</div>';
}
function csvQuery(params){
  var parts = [];
  Object.keys(params || {}).forEach(function(k){
    var v = params[k];
    if(v === null || v === undefined || v === "") return;
    if(Array.isArray(v)){
      if(!v.length) return;
      v = v.join(",");
    }
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  });
  if(window.CURRENT_WORKSPACE) parts.push("workspace=" + encodeURIComponent(window.CURRENT_WORKSPACE));
  return parts.length ? "?" + parts.join("&") : "";
}
function downloadCasesFile(path, params, filename){
  fetch(API.url(path + csvQuery(params)), { credentials: "same-origin" }).then(function(res){
    if(res.status === 401){ window.location.href = API.loginUrl; throw new Error("未登录"); }
    if(!res.ok){
      return res.json().catch(function(){ return null; }).then(function(j){
        throw new Error((j && j.message) || "导出失败");
      });
    }
    return res.blob();
  }).then(function(blob){
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(u); }, 1500);
    toast("已导出 " + filename, "fs");
  }).catch(function(ex){ toast(ex.message || "导出失败", "bad"); });
}
function exportCases(scope){
  if(caseScopeAll){ toast("导出需要先切到单个项目", "warn"); return; }
  if(!caseReqId){ toast("先选择项目", "warn"); return; }
  scope = scope || "all";
  var ext = tcExportExt(tcExportFmt);
  var base = "/api/test-cases/export" + ext;
  var proj = reqNameOf(caseReqId);
  if(scope === "ids"){
    if(!caseHasSel()){ toast("请先勾选要导出的用例", "warn"); return; }
    /* 全选筛选结果时没有明确 ID 列表，改用「筛选 + 排除」口径，与批量动作一致 */
    if(caseSelAll){
      var q = caseSelectionFilter();
      q.scope = "filter";
      q.excludeIds = Object.keys(caseExclude);
      downloadCasesFile(base, q, "测试用例-" + proj + "-所选" + ext);
      return;
    }
    downloadCasesFile(base, { scope: "ids", ids: caseSelIds() }, "测试用例-" + proj + "-所选" + ext);
    return;
  }
  if(scope === "filter"){
    var f = caseFilterQuery();
    f.scope = "filter";
    downloadCasesFile(base, f, "测试用例-" + proj + "-筛选结果" + ext);
    return;
  }
  downloadCasesFile(base, { reqId: caseReqId }, "测试用例-" + proj + ext);
}
/* Excel 在中文 Windows 上默认导出的 CSV 是 GBK：先按 UTF-8 严格解码，失败再退 GBK */
function readCsvFile(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){
      var buf = new Uint8Array(reader.result || new ArrayBuffer(0));
      var text;
      try{
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      }catch(e){
        try{ text = new TextDecoder("gbk").decode(buf); }
        catch(e2){ text = new TextDecoder("utf-8").decode(buf); }
      }
      resolve(String(text || "").replace(/^\uFEFF/, ""));
    };
    reader.onerror = function(){ reject(new Error("读取文件失败")); };
    reader.readAsArrayBuffer(file);
  });
}
/* Excel 文件以 base64 提交：按块转二进制字符串，避免大文件触发参数上限 */
function readFileBase64(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){
      var bytes = new Uint8Array(reader.result || new ArrayBuffer(0));
      var chunks = [];
      for(var i = 0; i < bytes.length; i += 0x8000){
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
      }
      try{ resolve(btoa(chunks.join(""))); }
      catch(e){ reject(new Error("读取文件失败")); }
    };
    reader.onerror = function(){ reject(new Error("读取文件失败")); };
    reader.readAsArrayBuffer(file);
  });
}
function showImportResult(r){
  r = r || {};
  var msg = "导入完成：新增 " + (r.created || 0) + " 条";
  if(r.failed) msg += "，失败 " + r.failed + " 条";
  if((r.total || 0) > 1000 || r.skipped) msg += "，超限跳过 " + (r.skipped || 0) + " 条";
  if(r.renumbered) msg += "；原编号未保留，已按项目重新分配";
  if(r.ignored && r.ignored.length){
    msg += "；忽略列：" + r.ignored.slice(0, 3).join("、") + (r.ignored.length > 3 ? " 等" : "");
  }
  toast(msg, r.failed ? "warn" : "fs");
  if(r.errors && r.errors.length){
    UI.showConfirm({
      title: "导入明细",
      msg: "以下行未导入：<br>" + r.errors.map(esc).join("<br>"),
      danger: false, okText: "知道了", cancelText: "关闭"
    });
  }
  loadCases();
}
function importCasesFile(file){
  if(caseScopeAll){ toast("导入需要先切到单个项目", "warn"); return; }
  if(!caseReqId){ toast("先选择项目", "warn"); return; }
  var excel = /\.(xlsx|xls)$/i.test(file.name || "");
  var limit = (excel ? 8 : 2) * 1024 * 1024;
  if(file.size > limit){
    toast((excel ? "Excel 文件超过 8MB" : "CSV 超过 2MB") + " 上限，请拆分后导入", "warn");
    return;
  }
  var post;
  if(excel){
    post = readFileBase64(file).then(function(b64){
      return API.post("/api/test-cases/import.xlsx?reqId=" + encodeURIComponent(caseReqId), { file: b64 });
    });
  } else {
    post = readCsvFile(file).then(function(text){
      if(!text.trim()){ toast("CSV 内容为空", "warn"); return null; }
      return API.post("/api/test-cases/import?reqId=" + encodeURIComponent(caseReqId), { csv: text });
    });
  }
  post.then(function(r){
    if(r) showImportResult(r);
  }).catch(function(ex){ toast(ex.message || "导入失败", "bad"); });
}

/* ---------- 左侧面板：项目目录（单归属）与分组（多归属） ----------
   目录回答「这条用例属于哪个功能域」：单归属，计数不重叠，用于归类、筛选与分组统计；
   分组回答「这批用例服务于哪次测试目的」：计数可重叠，删分组不删用例。 */

var caseSetsReq = null;
var caseSetsLoading = false;
var caseSetsError = "";
var caseDropEl = null;
var dirBusy = false;
var editingSetId = null;
var setSaving = false;
var setPickSel = "";
var setPickBusy = false;
var setDialogParent = "";   /* 在某个父分组下新建时暂存父组 id；编辑时为空 */
var setDialogParentVis = ""; /* 子分组继承的可见范围（继承后弹窗里不可改） */
var caseSetDrag = null;     /* 正在拖动的分组：{id,name,target,action} */
var caseDirDrag = null;     /* 正在拖动的目录节点：{id,name,target,action} */
var reorderBusy = false;

/* 左栏只回答「这批用例服务于哪次测试目的」：自定义分组可多归属、可嵌套。
   目录是单归属的功能域归类，已收进顶部筛选，不再占左栏。 */
function toggleSidePanel(show){
  caseSide = show ? "set" : "";
  if(caseSide) loadCaseSets();
  syncSidePanel();
  syncQueryBar();
}
function syncSidePanel(){
  var panel = $("tcSidePanel"), wrap = $("tcCasesWrap");
  if(!panel || !wrap) return;
  var show = tcMode === "cases" && !caseScopeAll && !!caseReqId && !!caseSide;
  panel.hidden = !show;
  wrap.classList.toggle("has-side", show);
  if(!show){ closeTcSetCtx(); return; }
  /* 左栏默认展开：首次进入项目就取分组，不用等用户再点一次 */
  if(caseSetsReq !== caseReqId) loadCaseSets();
  renderSetPanel();
}
/* 目录 / 分组变更后统一刷新：目录计数随列表回来，分组计数要单独再取一次 */
function afterStructureChange(){
  var sets = caseSetsReq === caseReqId ? loadCaseSets(true) : Promise.resolve(caseSets);
  loadCases();
  return sets;
}

/* ---------- 项目目录面板 ---------- */

/* 目录计数是项目内全量（服务端 tree 不带筛选），与筛选下拉的「命中数」口径不同，脚注写明 */
function dirNoneCount(){
  var used = 0;
  (caseModuleNodes || []).forEach(function(n){ used += n.caseCount || 0; });
  return Math.max(0, (stats.total || 0) - used);
}
function dirNodeOpen(n){ return caseDirOpen[n.id] !== false; }
function dirHasKids(id){
  for(var i = 0; i < caseModuleNodes.length; i++) if(caseModuleNodes[i].parentId === id) return true;
  return false;
}
function dirVisibleNodes(){
  var nodes = caseModuleNodes || [];
  var byId = {};
  nodes.forEach(function(n){ byId[n.id] = n; });
  var q = (caseDirQuery || "").trim().toLowerCase();
  if(!q){
    return nodes.filter(function(n){
      var p = n.parentId, guard = 0;
      while(p && byId[p] && guard++ <= nodes.length){
        if(!dirNodeOpen(byId[p])) return false;
        p = byId[p].parentId;
      }
      return true;
    });
  }
  /* 搜索命中时保留祖先链：子节点脱离父目录就看不出归属 */
  var keep = {};
  nodes.forEach(function(n){
    if(String(n.name || "").toLowerCase().indexOf(q) < 0) return;
    keep[n.id] = true;
    var p = n.parentId, guard = 0;
    while(p && byId[p] && guard++ <= nodes.length){ keep[p] = true; p = byId[p].parentId; }
  });
  return nodes.filter(function(n){ return keep[n.id]; });
}
/* 目录弹层：筛选入口在顶栏，目录的增删改与拖拽排序也在这里完成（单归属，拖入＝移动） */
function syncDirBtn(){
  var box = $("tcDirFilter"), btn = $("tcDirBtn"), label = $("tcDirBtnLabel");
  if(!box || !btn) return;
  var show = tcMode === "cases" && !caseScopeAll && !!caseReqId;
  box.hidden = !show;
  var on = moduleFilter !== "all";
  btn.classList.toggle("soft", on);
  /* 入口只放叶子名，全路径放 title：筛选条宽度有限，路径一长就把目录名截没了 */
  var path = moduleFilter === "__none" ? "未归类" : (modulePathOf(moduleFilter) || "未归类");
  var leaf = path.split(" / ").pop();
  if(label) label.textContent = on ? "目录：" + cut(leaf, 14) : "目录：全部";
  btn.title = on
    ? "当前只显示「" + path + "」下的用例；点击更换或清除目录，并可维护目录"
    : "按项目目录筛选用例；新建、改名与删除目录也在弹层里";
  btn.setAttribute("aria-expanded", UI.popOpen($("tcDirMenu")) ? "true" : "false");
}
function renderDirPanel(){
  var menu = $("tcDirMenu");
  if(!menu) return;
  var search = $("tcDirSearch");
  if(search && search !== document.activeElement && search.value !== caseDirQuery) search.value = caseDirQuery;
  var newBtn = $("tcDirNewBtn");
  if(newBtn) newBtn.hidden = !isWritable();
  renderDirList();
  renderDirFoot();
}
function renderDirList(){
  var list = $("tcDirList");
  if(!list) return;
  var q = (caseDirQuery || "").trim();
  var html = dirSpecialRowHTML("all", "全部用例", stats.total || 0, false, "不限目录：显示项目内全部用例");
  var nodes = dirVisibleNodes();
  if(!caseModuleNodes.length){
    html += '<p class="tc-side-empty">' + (isWritable() ? "还没有目录节点，点上方「新建」建第一个。" : "该项目还没有目录节点。") + '</p>';
  }else if(!nodes.length){
    html += '<p class="tc-side-empty">没有匹配「' + esc(q) + '」的目录。</p>';
  }else{
    html += nodes.map(function(n){ return dirNodeRowHTML(n); }).join("");
  }
  html += dirSpecialRowHTML("__none", "未归类", dirNoneCount(), true, "没有挂到任何目录节点的用例");
  list.innerHTML = html;
}
function renderDirFoot(){
  var foot = $("tcDirFoot");
  if(!foot) return;
  foot.innerHTML = '<button class="tc-side-switch' + (caseModuleSub ? " on" : "") + '" type="button" id="tcDirSub"'
    + ' role="switch" aria-checked="' + (caseModuleSub ? "true" : "false") + '">'
    + '<span class="sw-box">' + (caseModuleSub ? icon("check", 11) : "") + '</span>显示子目录用例</button>'
    + '<p class="tc-side-note">单归属：一条用例只属一个目录节点；计数为项目内全部用例。目录层级不限，只禁止成环，拖拽节点可改层级。</p>';
}
function dirToggleHTML(id, hasKids, open, name){
  if(!hasKids) return '<span class="tc-dir-toggle ph"></span>';
  return '<button class="tc-dir-toggle" type="button" data-tc-dir-toggle="' + esc(id) + '"'
    + ' aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + (open ? "折叠 " : "展开 ") + esc(name) + '">'
    + icon("chevronRight", 12) + '</button>';
}
/* 层级不限后缩进按 level 算，超过 8 层不再加深，避免把目录名挤没；悬停 title 仍给全路径 */
function dirIndentPx(level){ return Math.min(8, Math.max(0, (level || 1) - 1)) * 14; }
function dirNodeRowHTML(n){
  var on = moduleFilter === n.id;
  var open = dirNodeOpen(n);
  var count = caseModuleSub ? (n.subtreeCount || 0) : (n.caseCount || 0);
  var path = modulePathOf(n.id);
  return '<div class="tc-dir-node lv' + n.level + (on ? " on" : "") + '" style="margin-left:' + dirIndentPx(n.level) + 'px" data-tc-dir="' + esc(n.id) + '"'
    + (isWritable() ? ' draggable="true" data-tc-dir-drag="' + esc(n.id) + '"' : "") + '>'
    + dirToggleHTML(n.id, dirHasKids(n.id), open, n.name)
    + '<button class="tc-dir-pick" type="button" data-tc-dir-pick="' + esc(n.id) + '" aria-pressed="' + (on ? "true" : "false") + '"'
    + ' title="' + esc(path) + ' · ' + count + ' 条' + (caseModuleSub ? "（含子目录）" : "（仅本节点）") + '">'
    + icon("folder", 13) + '<span class="tc-dir-name">' + esc(n.name) + '</span>'
    + '<span class="tc-dir-n">' + count + '</span></button>'
    + (isWritable() ? '<span class="tc-dir-acts">'
      + '<button class="icon-btn sm" type="button" data-tc-dir-add="' + esc(n.id) + '" title="新建子目录" aria-label="在 ' + esc(n.name) + ' 下新建子目录">' + icon("plus", 13) + '</button>'
      + '<button class="icon-btn sm" type="button" data-tc-dir-edit="' + esc(n.id) + '" title="重命名" aria-label="重命名 ' + esc(n.name) + '">' + icon("edit", 13) + '</button>'
      + (canManageProject(caseReqId)
        ? '<button class="icon-btn sm" type="button" data-tc-dir-del="' + esc(n.id) + '" title="删除目录（仅负责人）" aria-label="删除 ' + esc(n.name) + '">' + icon("trash", 13) + '</button>'
        : "")
      + '</span>' : "")
    + '</div>';
}
function dirSpecialRowHTML(id, name, count, droppable, hint){
  var on = moduleFilter === id;
  return '<div class="tc-dir-node lv1 special' + (on ? " on" : "") + '"'
    + (droppable ? ' data-tc-dir="' + esc(id) + '"' : "") + '>'
    + '<span class="tc-dir-toggle ph"></span>'
    + '<button class="tc-dir-pick" type="button" data-tc-dir-pick="' + esc(id) + '" aria-pressed="' + (on ? "true" : "false") + '"'
    + ' title="' + esc(hint) + '">'
    + icon(id === "all" ? "checklist" : "inbox", 13)
    + '<span class="tc-dir-name">' + esc(name) + '</span><span class="tc-dir-n">' + count + '</span></button>'
    + '</div>';
}
function pickDirNode(id){
  moduleFilter = (moduleFilter === id || id === "all") ? "all" : id;
  if(UI.popOpen($("tcDirMenu"))) UI.closeAllPops();
  syncDirBtn();
  loadCases();
}
function createModuleNode(parentId){
  if(dirBusy) return;
  if(!isWritable()){ toast("当前项目只读，无法维护目录", "warn"); return; }
  var parent = parentId ? moduleNodeById(parentId) : null;
  if(parentId && !parent){ toast("父目录不存在，请刷新后重试", "warn"); return; }
  UI.showPrompt({
    title: parent ? "新建子目录" : "新建目录",
    desc: parent ? "父目录：" + modulePathOf(parent.id) + "（新建的是第 " + (parent.level + 1) + " 级）"
      : "顶级目录（第 1 级）；同级不允许重名。",
    label: "目录名称", placeholder: "如：对账导出", maxLength: 50, okText: "创建"
  }).then(function(name){
    if(!name) return;
    dirBusy = true;
    return API.post("/api/test-modules", { reqId: caseReqId, name: name, parentId: parentId || null }).then(function(){
      dirBusy = false;
      toast("目录「" + name + "」已创建", "fs");
      if(parentId) caseDirOpen[parentId] = true;
      afterStructureChange();
    }).catch(function(ex){
      dirBusy = false;
      toast(ex.message || "创建目录失败", "bad");
    });
  });
}
function renameModuleNode(id){
  if(dirBusy) return;
  var n = moduleNodeById(id);
  if(!n){ toast("目录不存在，请刷新后重试", "warn"); return; }
  UI.showPrompt({
    title: "重命名目录", desc: "改名不影响用例归属与编号；同级不允许重名。",
    label: "目录名称", value: n.name, maxLength: 50, okText: "保存"
  }).then(function(name){
    if(!name || name === n.name) return;
    dirBusy = true;
    return API.put("/api/test-modules/" + encodeURIComponent(id), { name: name, parentId: n.parentId || null }).then(function(){
      dirBusy = false;
      toast("目录已改名为「" + name + "」", "fs");
      afterStructureChange();
    }).catch(function(ex){
      dirBusy = false;
      toast(ex.message || "改名失败", "bad");
    });
  });
}
function deleteModuleNode(id){
  if(dirBusy) return;
  if(!canManageProject(caseReqId)){ toast("仅空间主、管理员或项目负责人可删除目录", "warn"); return; }
  var n = moduleNodeById(id);
  if(!n){ toast("目录不存在，请刷新后重试", "warn"); return; }
  var kids = dirHasKids(id), own = n.caseCount || 0;
  /* 服务端同样拒绝，这里先给出可操作的提示，避免用户只看到一句「不能删」 */
  if(kids || own){
    toast("目录「" + n.name + "」下还有 " + (kids ? "子目录" : "") + (kids && own ? " 与 " : "")
      + (own ? own + " 条用例" : "") + "，请先把它们移到别的目录再删", "warn");
    return;
  }
  UI.showConfirm({
    title: "删除目录", okText: "删除目录",
    msg: "删除空目录「<b>" + esc(n.name) + "</b>」？目录下没有用例，不影响用例数据与执行历史。"
  }).then(function(ok){
    if(!ok) return;
    dirBusy = true;
    return API.del("/api/test-modules/" + encodeURIComponent(id)).then(function(){
      dirBusy = false;
      toast("目录「" + n.name + "」已删除", "fs");
      if(moduleFilter === id) moduleFilter = "all";
      delete caseDirOpen[id];
      afterStructureChange();
    }).catch(function(ex){
      dirBusy = false;
      toast(ex.message || "删除目录失败", "bad");
    });
  });
}

/* ---------- 分组面板 ---------- */

function setById(id){
  for(var i = 0; i < caseSets.length; i++) if(caseSets[i].id === id) return caseSets[i];
  return null;
}
function loadCaseSets(force){
  if(!caseReqId || caseScopeAll) return Promise.resolve([]);
  if(!force && caseSetsReq === caseReqId && !caseSetsError) return Promise.resolve(caseSets);
  var reqId = caseReqId, seq = ++caseSetSeq;
  caseSetsLoading = true;
  caseSetsError = "";
  if(caseSide === "set") renderSetPanel();
  loadCaseSetNoneTotal(reqId, seq);
  return API.get("/api/case-sets", { reqId: reqId }).then(function(list){
    if(seq !== caseSetSeq) return caseSets;
    caseSets = list || [];
    caseSetsReq = reqId;
    caseSetsLoading = false;
    if(caseSide === "set") renderSetPanel();
    return caseSets;
  }).catch(function(ex){
    if(seq !== caseSetSeq) return caseSets;
    caseSetsLoading = false;
    caseSetsError = ex.message || "分组加载失败";
    if(caseSide === "set") renderSetPanel();
    return caseSets;
  });
}
/* 「未加入任何分组」的计数：与 setId=__none 筛选同一口径（项目全量、已按可见范围收敛） */
function loadCaseSetNoneTotal(reqId, seq){
  return API.get("/api/test-cases", { reqId: reqId, setId: "__none", limit: 1 }).then(function(r){
    if(seq !== caseSetSeq) return;
    caseSetNoneTotal = (r && r.total) || 0;
    if(caseSide === "set") renderSetPanel();
  }).catch(function(){
    if(seq !== caseSetSeq) return;
    caseSetNoneTotal = 0;
  });
}
function setHasKids(id){
  for(var i = 0; i < caseSets.length; i++) if((caseSets[i].parentId || "") === id) return true;
  return false;
}
function setNodeOpen(s){ return caseSetOpen[s.id] !== false; }
function setAncestorIds(id){
  var out = [], guard = 0, s = setById(id);
  while(s && s.parentId && guard++ < 64){
    out.push(s.parentId);
    s = setById(s.parentId);
  }
  return out;
}
/* 搜索分组时保留命中节点的祖先链，并临时展开，子组命中不会藏在折叠的父组里 */
function setMatchKeep(q){
  if(!q) return null;
  var keep = {};
  caseSets.forEach(function(s){
    if(String(s.name || "").toLowerCase().indexOf(q) < 0) return;
    keep[s.id] = true;
    setAncestorIds(s.id).forEach(function(id){ keep[id] = true; });
  });
  return keep;
}
function bucketSetRows(vis, out, expandAll, keep){
  caseSets.forEach(function(s){
    if(s.parentId || s.visibility !== vis) return;
    if(keep && !keep[s.id]) return;
    out.push({ s: s, level: 1 });
    appendSetKids(s.id, 2, out, expandAll, keep);
  });
}
function appendSetKids(parentId, level, out, expandAll, keep){
  caseSets.forEach(function(s){
    if((s.parentId || "") !== parentId) return;
    if(keep && !keep[s.id]) return;
    out.push({ s: s, level: level });
    if(expandAll || setNodeOpen(s)) appendSetKids(s.id, level + 1, out, expandAll, keep);
  });
}
function setSpecialRowHTML(id, name, iconName, count, hint){
  var on = setFilter === id;
  return '<div class="tc-set-item special' + (on ? " on" : "") + '">'
    + '<span class="tc-dir-toggle ph"></span>'
    + '<button class="tc-set-pick" type="button" data-tc-set-pick="' + esc(id) + '" aria-pressed="' + (on ? "true" : "false") + '"'
    + ' title="' + esc(hint) + '">'
    + '<span class="tc-set-ico">' + icon(iconName, 13) + '</span>'
    + '<span class="tc-set-main"><span class="tc-set-name">' + esc(name) + '</span></span>'
    + (count === undefined ? "" : '<span class="tc-set-n">' + count + '</span>')
    + '</button></div>';
}
function renderSetPanel(){
  var body = $("tcSideBody"), foot = $("tcSideFoot");
  if(!body) return;
  var prev = $("tcSetSearch");
  var focused = !!prev && prev === document.activeElement;
  var caret = focused ? prev.selectionStart : 0;
  var q = (caseSetQuery || "").trim().toLowerCase();
  var keep = setMatchKeep(q);
  var html = '<div class="tc-side-tools">'
    + '<span class="tc-side-title">' + icon("layers", 13) + ' 分组</span>'
    + '<span class="tc-side-count" title="项目内用例总数；分组计数可重叠，不能相加当总数">' + (stats.total || 0) + '</span>'
    + (isWritable() ? '<button class="btn sm ghost" type="button" data-tc-set-new title="新建分组（多归属，删分组不删用例）">' + icon("plus", 13) + ' 新建分组</button>' : "")
    + '</div>'
    + '<label class="tc-dir-search tc-set-search">' + icon("search", 13)
    + '<input type="search" id="tcSetSearch" placeholder="搜索分组…" aria-label="搜索分组" autocomplete="off" value="' + esc(caseSetQuery) + '" /></label>'
    + '<div class="tc-set-list">';
  if(caseSetsLoading){
    html += UI.skeletonRows(3);
  }else if(caseSetsError){
    html += '<p class="tc-side-empty">分组加载失败：' + esc(caseSetsError)
      + ' <button class="btn sm ghost" type="button" data-tc-set-retry>重试</button></p>';
  }else{
    html += setSpecialRowHTML("all", "全部用例", "checklist", stats.total || 0, "不限分组：显示项目内全部用例");
    html += setSpecialRowHTML("__none", "未加入任何分组", "inbox", caseSetNoneTotal, "只看没有加入任何可见分组的用例");
    html += '<div class="tc-set-sep" aria-hidden="true"></div>';
    var any = 0;
    [["team", "团队共享", "进交付说明与发布证据"],
      ["members", "指定成员可见", "不进证据"],
      ["personal", "仅自己可见", "不进证据"]].forEach(function(b){
      var rows = [];
      bucketSetRows(b[0], rows, !!keep, keep);
      any += rows.length;
      html += '<div class="tc-set-label">' + esc(b[1]) + ' · ' + esc(b[2]) + '（' + rows.length + '）</div>';
      html += rows.map(function(r){ return setItemHTML(r.s, r.level); }).join("");
    });
    if(!any){
      html += '<p class="tc-side-empty">' + (q
        ? "没有匹配「" + esc(caseSetQuery.trim()) + "」的分组。"
        : "还没有分组，点上方「新建分组」。") + '</p>';
    }
  }
  html += '</div>';
  body.innerHTML = html;
  if(focused){
    var now = $("tcSetSearch");
    if(now){ now.focus(); try{ now.setSelectionRange(caret, caret); }catch(err){ /* 搜索框不支持光标定位时忽略 */ } }
  }
  if(foot){
    var sel = setFilter !== "all" && setFilter !== "__none" ? setById(setFilter) : null;
    var kids = !!(sel && setHasKids(sel.id));
    foot.innerHTML = (kids
      ? '<button class="tc-side-switch' + (caseSetSub ? " on" : "") + '" type="button" id="tcSetSub"'
        + ' role="switch" aria-checked="' + (caseSetSub ? "true" : "false") + '">'
        + '<span class="sw-box">' + (caseSetSub ? icon("check", 11) : "") + '</span>显示子分组用例</button>'
      : "")
      + '<p class="tc-side-note">多归属：一条用例可进多个分组，分组间计数可重叠、不能相加当总数；<b>删除分组不删用例</b>。分组可嵌套，<b>子组继承父组可见范围</b>，父组计数按子树去重。只有<b>团队共享</b>分组进交付说明与发布证据；转团队需创建人操作。</p>';
  }
  renderSetDetail();
}
function setVisTagHTML(s, full){
  var vis = s.visibility === "members" ? "members" : (s.visibility === "personal" ? "personal" : "team");
  var label = full ? SET_VIS_LABEL[vis] : { team: "团队", members: "指定成员", personal: "仅自己" }[vis];
  return '<span class="tc-vis-tag ' + vis + '">' + label + '</span>';
}
function setItemHTML(s, level){
  var on = setFilter === s.id;
  var dyn = setDynamic(s);
  var kids = setHasKids(s.id);
  var count = kids ? (s.subtreeCount || 0) : (s.caseCount || 0);
  var title = s.name + " · " + count + " 条" + (kids ? "（含子分组，去重）" : "") + "，"
    + (dyn ? "成员由规则自动收录，不能手工增删" : "拖用例到此＝加入分组（原分组保留）");
  return '<div class="tc-set-item lv' + level + (on ? " on" : "") + (dyn ? " is-dyn" : "") + '"'
    + ' style="margin-left:' + dirIndentPx(level) + 'px"'
    + ' data-tc-set="' + esc(s.id) + '" draggable="' + (isWritable() ? "true" : "false") + '" data-tc-set-drag="' + esc(s.id) + '">'
    + (kids
      ? '<button class="tc-dir-toggle" type="button" data-tc-set-toggle="' + esc(s.id) + '"'
        + ' aria-expanded="' + (setNodeOpen(s) ? "true" : "false") + '" aria-label="' + (setNodeOpen(s) ? "折叠 " : "展开 ") + esc(s.name) + '">'
        + icon("chevronRight", 12) + '</button>'
      : '<span class="tc-dir-toggle ph"></span>')
    + '<button class="tc-set-pick" type="button" data-tc-set-pick="' + esc(s.id) + '" aria-pressed="' + (on ? "true" : "false") + '"'
    + ' title="' + esc(title) + '">'
    + '<span class="tc-set-ico">' + icon(dyn ? "refresh" : "layers", 13) + '</span>'
    + '<span class="tc-set-main"><span class="tc-set-name">' + esc(s.name)
    + setVisTagHTML(s) + (dyn ? '<span class="tc-vis-tag dyn">动态</span>' : "") + '</span>'
    + (s.note ? '<span class="tc-set-sub">' + esc(s.note) + '</span>' : "")
    + '</span><span class="tc-set-n">' + count + '</span></button>'
    + (isWritable() && s.editable ? '<span class="tc-set-acts">'
      + '<button class="icon-btn sm" type="button" data-tc-set-add="' + esc(s.id) + '" title="新建子分组" aria-label="在 ' + esc(s.name) + ' 下新建子分组">' + icon("plus", 13) + '</button>'
      + '<button class="icon-btn sm" type="button" data-tc-set-edit="' + esc(s.id) + '" title="编辑分组" aria-label="编辑分组 ' + esc(s.name) + '">' + icon("edit", 13) + '</button>'
      + '<button class="icon-btn sm" type="button" data-tc-set-del="' + esc(s.id) + '" title="删除分组（不删用例）" aria-label="删除分组 ' + esc(s.name) + '">' + icon("trash", 13) + '</button>'
      + '</span>' : "")
    + '</div>';
}
/* 选中分组后在列表上方给出这条分组的口径：可见范围、收录规则、可见名单。
   动态分组的规则按创建人可见范围计算，这里必须写清楚，否则别人看到的条数会以为自己算错了。 */
var setDetailWhoReq = "";
var setDetailWhoNames = {};
function whoNameOf(id){ return setDetailWhoNames[id] || ""; }
function ensureSetDetailWho(s){
  if(!s || s.visibility !== "members" || !rt.currentWs || !caseReqId) return;
  if(setDetailWhoReq === caseReqId) return;
  setDetailWhoReq = caseReqId;
  loadProjectMembers(rt.currentWs.id, caseReqId).then(function(data){
    if(setDetailWhoReq !== caseReqId) return;
    var map = {};
    ((data && data.members) || []).forEach(function(m){
      var o = memberToOption(m);
      if(o.id) map[o.id] = o.name;
    });
    setDetailWhoNames = map;
    renderSetDetail();
  }).catch(function(){ setDetailWhoReq = ""; });
}
function renderSetDetail(){
  var box = $("tcSetDetail");
  if(!box) return;
  var s = setFilter !== "all" && setFilter !== "__none" ? setById(setFilter) : null;
  if(!s || tcMode !== "cases" || caseScopeAll){ box.hidden = true; box.innerHTML = ""; return; }
  var dyn = setDynamic(s);
  var rule = dyn ? setRuleText(s.ruleJson) : "";
  var kids = setHasKids(s.id);
  var total = kids ? (s.subtreeCount || 0) : (s.caseCount || 0);
  var html = '<div class="tc-setd-head">'
    + '<span class="tc-setd-ico">' + icon(dyn ? "refresh" : "layers", 14) + '</span>'
    + '<span class="tc-setd-main"><b>' + esc(s.name) + '</b>' + setVisTagHTML(s, true)
    + (dyn ? '<span class="tc-vis-tag dyn">动态收录</span>' : "")
    + '<span class="tc-setd-n">' + total + ' 条' + (kids ? '（含子分组，去重）' : '') + '</span>'
    + (s.note ? '<span class="tc-setd-note">' + esc(s.note) + '</span>' : "")
    + '</span>'
    + (s.editable ? '<button class="btn sm ghost" type="button" data-tc-set-edit="' + esc(s.id) + '">'
      + icon("edit", 13) + '&nbsp;' + (dyn ? "编辑规则" : "编辑分组") + '</button>' : "")
    + '</div>';
  if(s.visibility === "members"){
    var ids = s.memberIds || [];
    html += '<div class="tc-setd-who"><span class="tc-setd-who-label">' + icon("users", 13) + ' 可见名单（创建人始终可见）</span>'
      + ids.map(function(id){
        var nm = whoNameOf(id);
        return '<span class="who-chip">' + avatarHTML(nm || id) + esc(nm || "成员") + '</span>';
      }).join("")
      + '<span class="tc-setd-who-n">共 ' + (ids.length + 1) + ' 人 · 上限 ' + SET_MAX_MEMBERS + ' 人</span></div>';
    ensureSetDetailWho(s);
  }
  html += '<div class="tc-setd-rules">'
    + (dyn
      ? '<span class="rule-chip">' + icon("filter", 13) + ' 收录规则：' + esc(rule || "未记录") + '</span>'
        + '<span class="rule-chip">' + icon("refresh", 13) + ' 命中即自动收录，不再命中自动移出</span>'
      : '<span class="rule-chip">' + icon("check", 13) + ' 手工挑选：拖入或按筛选加入，成员固定</span>')
    + '</div>';
  if(dyn){
    html += '<p class="tc-setd-foot">' + icon("alert", 13)
      + '<span>动态分组不能手工增删用例；规则按<b>创建人</b>的可见范围计算，上限 ' + SET_MAX_RULE_HITS
      + ' 条。目录被规则引用时不能删除。</span></p>';
  }else if(s.visibility !== "team"){
    html += '<p class="tc-setd-foot">' + icon("alert", 13)
      + '<span>这个分组不进交付说明与发布证据；要写进证据需由创建人转为<b>团队共享</b>。</span></p>';
  }
  box.innerHTML = html;
  box.hidden = false;
}
function pickSetNode(id){
  setFilter = setFilter === id ? "all" : id;
  if(setFilter !== "all" && setFilter !== "__none"){
    setAncestorIds(setFilter).forEach(function(aid){ caseSetOpen[aid] = true; });
  }
  if(caseSide === "set") renderSetPanel();
  loadCases();
}
/* ---------- 分组右键菜单：与文档分类树同款；只读项目只留「只看该分组」 ---------- */
var tcSetCtxEl = null;
var tcSetCtxTarget = "";

function tcSetCtxMenu(){
  if(tcSetCtxEl) return tcSetCtxEl;
  var el = document.createElement("div");
  el.className = "tc-ctx";
  el.id = "tcSetCtxMenu";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", "分组右键菜单");
  document.body.appendChild(el);
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-ctx-act]");
    if(!b) return;
    var act = b.dataset.ctxAct, id = tcSetCtxTarget;
    closeTcSetCtx();
    if(act === "new") openSetDialog(null, id);
    else if(act === "new-top") openSetDialog(null);
    else if(act === "edit") openSetDialog(id);
    else if(act === "del") deleteCaseSet(id);
    else if(act === "pick") pickSetNode(id);
  });
  tcSetCtxEl = el;
  return el;
}
function closeTcSetCtx(){
  if(tcSetCtxEl) tcSetCtxEl.classList.remove("open");
  tcSetCtxTarget = "";
}
function openTcSetCtx(x, y, id){
  var s = id ? setById(id) : null;
  var writable = isWritable();
  var editable = !!(s && writable && s.editable);
  var html = '<div class="ctx-head">' + (s ? "分组：" + esc(s.name) : "分组") + '</div>';
  var any = false;
  if(s){
    html += '<button type="button" data-ctx-act="pick"><span class="ic">' + icon("checklist", 14) + '</span>'
      + (setFilter === s.id ? "取消该分组筛选" : "只看该分组") + '</button>';
    any = true;
    if(editable){
      html += '<button type="button" data-ctx-act="new"><span class="ic">' + icon("plus", 14) + '</span>新建子分组</button>'
        + '<div class="sep"></div>'
        + '<button type="button" data-ctx-act="edit"><span class="ic">' + icon("edit", 14) + '</span>编辑分组…</button>'
        + '<button type="button" data-ctx-act="del" class="danger"><span class="ic">' + icon("trash", 14) + '</span>删除分组</button>';
    }
    if(!editable){
      html += '<div class="ctx-note">' + (writable
        ? (s.visibility === "members" ? "指定成员可见的分组只有创建人可以修改 / 删除。" : "个人分组只有创建人可以修改 / 删除。")
        : "你对该项目只读，只能查看和筛选分组。") + '</div>';
    }
  }else if(writable){
    html += '<button type="button" data-ctx-act="new-top"><span class="ic">' + icon("plus", 14) + '</span>新建分组</button>';
    any = true;
  }
  if(!any) return false;
  var el = tcSetCtxMenu();
  tcSetCtxTarget = s ? s.id : "";
  el.innerHTML = html;
  el.classList.add("open");
  var w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
  el.style.left = Math.max(8, Math.min(x, vw - w - 8)) + "px";
  el.style.top = Math.max(8, Math.min(y, vh - h - 8)) + "px";
  return true;
}
/* ---------- 分组弹框：可见范围（团队 / 指定成员 / 仅自己）× 类型（手工 / 动态） ----------
   规则不新造查询语言：字段与用例库筛选一一对应，命中数直接用同一条查询试算。 */

var SET_MAX_MEMBERS = 50;
var SET_MAX_RULE_HITS = 2000;
var SET_VIS_LABEL = { team: "团队共享", members: "指定成员可见", personal: "仅自己可见" };
var setDialogSnap = null;   /* 编辑时的原分组：收窄可见范围与类型切换都要据此提示 */
var setWhoSel = {};         /* 可见成员名单：账号ID → true */
var setWhoOptions = [];
var setWhoLoading = false;
var setWhoError = "";
var setWhoQuery = "";
var setRuleHit = { n: 0, loading: false, error: "", seq: 0 };
var setRuleTimer = null;

function csRadioValue(name, fallback){
  var v = fallback;
  Array.prototype.forEach.call(document.querySelectorAll('input[name="' + name + '"]'), function(r){ if(r.checked) v = r.value; });
  return v;
}
function csVisValue(){ return csRadioValue("csVis", "team"); }
function csKindValue(){ return csRadioValue("csKind", "manual"); }
function setDynamic(s){ return !!s && s.kind === "dynamic"; }
function whoSelectedIds(){ return Object.keys(setWhoSel).filter(function(k){ return setWhoSel[k]; }); }
function setRuleEmpty(r){
  return !r.status && !r.pri && !r.moduleId && !r.demandId && !r.owner && !r.q && !r.bugOnly && !r.regression;
}
function caseDemandLabel(id){
  if(!id || id === "__none") return "未关联需求";
  var list = demandOptions.reqId === caseReqId ? demandOptions.list : [];
  for(var i = 0; i < list.length; i++){
    if(list[i].id === id) return (list[i].demandNo ? "DM-" + list[i].demandNo + " · " : "") + cut(list[i].title, 24);
  }
  return pbfDemandLabel(id);
}
/* 筛选条件摘要：初始成员、动态分组规则与圈选入计划共用一份口径 */
function filterSummaryText(f){
  var parts = [];
  if(f.moduleId) parts.push("目录：" + (f.moduleId === "__none" ? "未归类" : (modulePathOf(f.moduleId) || f.moduleId)) + (f.moduleSub ? "（含子目录）" : ""));
  if(f.pri) parts.push("优先级：" + (f.pri === "__none" ? "未设置" : f.pri));
  if(f.status) parts.push("结果：" + (f.status === "__untested" ? "未执行" : (STATUS_LABEL[f.status] || f.status)));
  if(f.owner) parts.push("执行人：" + (f.owner === "__none" ? "未指派" : f.owner));
  if(f.demandId) parts.push("需求：" + caseDemandLabel(f.demandId));
  if(f.setId) parts.push("分组：" + (f.setId === "__none" ? "未加入分组" : ((setById(f.setId) || {}).name || "指定分组")));
  if(f.bugOnly) parts.push("只看有缺陷");
  if(f.q) parts.push("关键词：" + f.q + (f.searchWide ? "（含步骤与前置）" : ""));
  if(f.regression) parts.push("回归：最近失败 / 阻塞，或挂着未关闭缺陷");
  return parts.length ? parts.join(" · ") : "当前无筛选条件（等于项目全部用例）";
}
/* 规则 chip：分组面板与证据里都按同一份文案展示，避免两处口径漂移 */
function setRuleText(ruleJson){
  var r = null;
  try{ r = ruleJson ? JSON.parse(ruleJson) : null; }catch(e){ r = null; }
  if(!r) return "";
  return filterSummaryText(r);
}
function csRuleValue(){
  var pick = function(id){ var el = $(id); var v = el ? el.value : "all"; return v === "all" ? null : v; };
  var on = function(id){ var el = $(id); return !!(el && el.checked); };
  var qEl = $("csRuleQ");
  var q = qEl ? qEl.value.trim() : "";
  return {
    status: pick("csRuleStatus"), pri: pick("csRulePri"),
    moduleId: pick("csRuleModule"), moduleSub: on("csRuleSub"),
    demandId: pick("csRuleDemand"), owner: pick("csRuleOwner"),
    bugOnly: on("csRuleBug"), q: q || null, searchWide: on("csRuleWide"), regression: on("csRuleRegression")
  };
}
function csRuleQuery(rule){
  return {
    reqId: caseReqId, status: rule.status, pri: rule.pri,
    moduleId: rule.moduleId, moduleSub: rule.moduleSub ? true : null,
    demandId: rule.demandId, owner: rule.owner, bugOnly: rule.bugOnly ? true : null,
    q: rule.q, searchWide: rule.searchWide ? true : null, regression: rule.regression ? true : null,
    offset: 0, limit: 1
  };
}
function syncRuleHit(){
  var el = $("csRuleHit");
  if(!el) return;
  var empty = setRuleEmpty(csRuleValue());
  var over = setRuleHit.n > SET_MAX_RULE_HITS;
  el.classList.toggle("over", over || !!setRuleHit.error);
  el.classList.toggle("bad", empty);
  var text;
  if(setRuleHit.loading) text = "正在试算命中…";
  else if(setRuleHit.error) text = "命中数试算失败：" + esc(setRuleHit.error) + "（保存时服务端会再校验一次）";
  else text = "当前规则命中 <b>" + setRuleHit.n + "</b> 条"
    + (empty ? ' · <b class="bad">至少要有一个条件</b>，否则等于收录全部用例' : "")
    + (over ? " · 超出上限 " + SET_MAX_RULE_HITS + "，请先收窄条件" : " · 上限 " + SET_MAX_RULE_HITS + " 条");
  el.innerHTML = icon(setRuleHit.error || over || empty ? "alert" : "check", 13) + "<span>" + text + "</span>";
}
function refreshRuleHits(now){
  if(csKindValue() !== "dynamic" || !$("dlgCaseSet").classList.contains("open")) return;
  clearTimeout(setRuleTimer);
  var run = function(){
    var seq = ++setRuleHit.seq;
    setRuleHit.loading = true;
    setRuleHit.error = "";
    syncRuleHit();
    API.get("/api/test-cases", csRuleQuery(csRuleValue())).then(function(page){
      if(seq !== setRuleHit.seq) return;
      setRuleHit.loading = false;
      setRuleHit.n = (page && page.total) || 0;
      syncRuleHit();
    }).catch(function(ex){
      if(seq !== setRuleHit.seq) return;
      setRuleHit.loading = false;
      setRuleHit.error = ex.message || "网络异常";
      syncRuleHit();
    });
  };
  if(now) run();
  else setRuleTimer = setTimeout(run, 320);
}
function renderRuleBuilder(rule){
  var wrap = $("csRuleWrap");
  if(!wrap) return;
  var r = rule || {};
  var cur = function(v){ return v == null || v === "" ? "all" : String(v); };
  var field = function(id, label, opts, value){
    return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '">'
      + opts.map(function(o){
        var meta = o[2] || {};
        return '<option value="' + esc(o[0]) + '"'
          + (meta.level ? ' data-level="' + esc(meta.level) + '"' : "")
          + (meta.path ? ' data-path="' + esc(meta.path) + '"' : "")
          + (cur(value) === String(o[0]) ? " selected" : "") + '>' + esc(o[1]) + '</option>';
      }).join("") + '</select></div>';
  };
  var modOpts = [["all", "全部目录"]];
  (caseModuleNodes || []).forEach(function(n){
    var pad = "";
    for(var i = 1; i < Math.min(n.level, 7); i++) pad += "　";
    var c = Number(caseModuleSub ? n.subtreeCount : n.caseCount) || 0;
    modOpts.push([n.id, pad + n.name + "（" + c + "）", { level: n.level || 1, path: modulePathOf(n.id) }]);
  });
  modOpts.push(["__none", "未归类（" + (Number(caseModuleIdCounts.__none) || 0) + "）"]);
  var demandOpts = [["all", "全部"]];
  if(demandOptions.reqId === caseReqId && !demandOptions.error){
    demandOptions.list.forEach(function(d){
      demandOpts.push([d.id, (d.demandNo ? "DM-" + d.demandNo + " · " : "") + cut(d.title, 28)]);
    });
  }
  demandOpts.push(["__none", "未关联需求"]);
  var ownerOpts = [["all", "全部"], ["__none", "未指派"]].concat((caseOwners || []).map(function(o){ return [o, o]; }));
  var flag = function(id, label, on, title){
    return '<label class="b-check"' + (title ? ' title="' + esc(title) + '"' : "") + '><input type="checkbox" id="' + id + '"'
      + (on ? " checked" : "") + ' /> ' + label + '</label>';
  };
  wrap.innerHTML = '<div class="cs-rule">'
    + '<div class="cs-rule-head">' + icon("filter", 13) + '<b>收录规则</b>'
    + '<span class="cs-rule-sub">与用例库筛选同一套条件，不新造查询语言</span>'
    + '<button class="btn sm" type="button" id="csRuleRegressionBtn" aria-pressed="' + (r.regression ? "true" : "false") + '">'
    + icon("refresh", 13) + ' 一键回归集</button></div>'
    + '<div class="cs-rule-grid">'
    + field("csRuleStatus", "执行结果", [["all", "全部"], ["passed", "通过"], ["failed", "失败"], ["blocked", "阻塞"], ["skipped", "跳过"], ["__untested", "未执行"]], r.status)
    + field("csRulePri", "优先级", [["all", "全部"]].concat(PRIORITIES.map(function(p){ return [p, p + " · " + priName(p)]; })).concat([["__none", "未设置"]]), r.pri)
    + field("csRuleModule", "模块", modOpts, r.moduleId)
    + field("csRuleDemand", "主需求", demandOpts, r.demandId)
    + field("csRuleOwner", "最近执行人", ownerOpts, r.owner)
    + '<div class="field"><label for="csRuleQ">关键词</label>'
    + '<input id="csRuleQ" type="text" maxlength="100" placeholder="≤100 字，留空不限" autocomplete="off" value="' + esc(r.q || "") + '" /></div>'
    + '</div>'
    + '<div class="cs-rule-flags">'
    + flag("csRuleSub", "含子目录", r.moduleSub !== false, "目录条件是否连同子目录用例一起收录")
    + flag("csRuleWide", "关键词含步骤与前置", !!r.searchWide, "默认只搜标题 / 编号 / 模块；开启后才搜前置、测试数据与步骤")
    + flag("csRuleBug", "只看有缺陷", !!r.bugOnly, "关联缺陷仍未完成（未删除、未进入完成列）")
    + flag("csRuleRegression", "回归口径：失败 / 阻塞 或 有未关闭缺陷", !!r.regression, "与其他条件同时生效（AND），不是替换")
    + '</div>'
    + '<p class="cs-rule-hit" id="csRuleHit" role="status"></p>'
    + '<p class="foot-note">规则按<b>创建人</b>的可见范围计算；读取分组时自动补齐 / 摘除成员引用，因此计数、圈选入计划与发布证据与手工分组同口径。动态分组不能手工增删用例。</p>'
    + '</div>';
  $("csRuleDemand").dataset.req = caseReqId || "";
  ["csRuleStatus", "csRulePri", "csRuleModule", "csRuleDemand", "csRuleOwner"].forEach(function(id){
    $(id).addEventListener("change", function(){ refreshRuleHits(); });
  });
  ["csRuleSub", "csRuleWide", "csRuleBug", "csRuleRegression"].forEach(function(id){
    $(id).addEventListener("change", function(){
      syncRuleRegressionBtn();
      refreshRuleHits();
    });
  });
  $("csRuleQ").addEventListener("input", function(){ refreshRuleHits(); });
  $("csRuleRegressionBtn").addEventListener("click", function(){
    var box = $("csRuleRegression");
    box.checked = !box.checked;
    /* 一键回归集＝回归口径单独成立：清掉结果与缺陷条件，避免叠加后命中为空 */
    if(box.checked){
      $("csRuleStatus").value = "all";
      $("csRuleBug").checked = false;
    }
    syncRuleRegressionBtn();
    refreshRuleHits(true);
  });
  syncRuleRegressionBtn();
  syncRuleHit();
  if(demandOptions.reqId !== caseReqId || demandOptions.error){
    loadDemandOptions(caseReqId).then(function(list){
      var sel = $("csRuleDemand");
      if(!sel || sel.dataset.req !== (caseReqId || "") || csKindValue() !== "dynamic") return;
      var value = sel.value;
      var opts = [["all", "全部"]];
      if(list){
        list.forEach(function(d){ opts.push([d.id, (d.demandNo ? "DM-" + d.demandNo + " · " : "") + cut(d.title, 28)]); });
      }
      opts.push(["__none", "未关联需求"]);
      sel.innerHTML = opts.map(function(o){
        return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? " selected" : "") + '>' + esc(o[1]) + '</option>';
      }).join("") + (list ? "" : '<option value="" disabled>需求候选加载失败，关闭后重开重试</option>');
      if(sel.value !== value) sel.value = "all";
    });
  }
}
function syncRuleRegressionBtn(){
  var btn = $("csRuleRegressionBtn"), box = $("csRuleRegression");
  if(!btn || !box) return;
  btn.setAttribute("aria-pressed", box.checked ? "true" : "false");
  btn.classList.toggle("primary", box.checked);
}
/* 可见成员名单：候选取本项目花名册（能看到本项目的人），创建人始终可见不占名额 */
function whoCountText(){
  return "已选 <b>" + whoSelectedIds().length + "</b> / " + SET_MAX_MEMBERS
    + " 人；创建人始终可见，不占名额。名单外成员看不到该分组，也不能按它筛选。";
}
function syncWhoCount(){
  var el = $("csWhoCount");
  if(el) el.innerHTML = whoCountText();
}
function syncWhoRows(){
  var box = $("csWhoList");
  if(!box) return;
  var full = whoSelectedIds().length >= SET_MAX_MEMBERS;
  Array.prototype.forEach.call(box.querySelectorAll("[data-cs-who]"), function(input){
    var on = !!setWhoSel[input.dataset.csWho];
    input.checked = on;
    input.disabled = !on && full;
    var row = input.closest(".cs-who-row");
    if(row){
      row.classList.toggle("on", on);
      row.title = (!on && full ? "已达 " + SET_MAX_MEMBERS + " 人上限；" : "") + (row.dataset.sub || "");
    }
  });
  syncWhoCount();
}
function renderWhoList(){
  var box = $("csWhoList");
  if(!box) return;
  if(setWhoLoading){ box.innerHTML = UI.skeletonRows(3); syncWhoCount(); return; }
  if(setWhoError){
    box.innerHTML = '<p class="tc-side-empty">成员候选加载失败：' + esc(setWhoError)
      + ' <button class="btn sm ghost" type="button" data-cs-who-retry>重试</button></p>';
    syncWhoCount();
    return;
  }
  var q = setWhoQuery.trim().toLowerCase();
  var list = setWhoOptions.filter(function(o){
    if(!q) return true;
    return (o.name + " " + (o.company || "") + " " + (o.role || "") + " " + (o.secondary || []).join(" ")).toLowerCase().indexOf(q) >= 0;
  });
  if(!list.length){
    box.innerHTML = '<p class="tc-side-empty">' + (setWhoOptions.length
      ? "没有匹配「" + esc(setWhoQuery.trim()) + "」的成员"
      : "本项目还没有其他成员；先在成员管理里邀请并授权，再回来指定可见名单") + '</p>';
    syncWhoCount();
    return;
  }
  box.innerHTML = list.map(function(o){
    var sub = optionSubText(o);
    return '<label class="cs-who-row" data-sub="' + esc(sub) + '" title="' + esc(sub) + '">'
      + '<input type="checkbox" data-cs-who="' + esc(o.id) + '" />'
      + avatarHTML(o.name)
      + '<span class="cs-who-name">' + esc(o.name) + '</span>'
      + '<span class="cs-who-role">' + esc(sub) + '</span></label>';
  }).join("");
  syncWhoRows();
}
function loadWhoOptions(){
  if(!rt.currentWs || !caseReqId) return;
  setWhoLoading = true;
  setWhoError = "";
  renderWhoList();
  loadProjectMembers(rt.currentWs.id, caseReqId).then(function(data){
    setWhoLoading = false;
    var me = (rt.currentUser || {}).id;
    setWhoOptions = ((data && data.members) || []).map(memberToOption).filter(function(o){ return o.id && o.id !== me; });
    renderWhoList();
  }).catch(function(ex){
    setWhoLoading = false;
    setWhoError = ex.message || "网络异常";
    renderWhoList();
  });
}
function renderWhoPicker(){
  var wrap = $("csWhoWrap");
  if(!wrap) return;
  wrap.innerHTML = '<label class="cs-who-search">' + icon("search", 13)
    + '<input type="search" id="csWhoSearch" placeholder="搜索成员姓名 / 公司 / 岗位" aria-label="搜索可见成员" autocomplete="off" value="' + esc(setWhoQuery) + '" /></label>'
    + '<div class="cs-who-list" id="csWhoList" role="group" aria-label="可见成员名单"></div>'
    + '<p class="foot-note" id="csWhoCount"></p>';
  $("csWhoSearch").addEventListener("input", function(){ setWhoQuery = this.value; renderWhoList(); });
  $("csWhoList").addEventListener("change", function(e){
    var input = e.target.closest("[data-cs-who]");
    if(!input) return;
    var id = input.dataset.csWho;
    if(input.checked){
      if(whoSelectedIds().length >= SET_MAX_MEMBERS){
        input.checked = false;
        toast("指定成员最多 " + SET_MAX_MEMBERS + " 位，请改用团队共享", "warn");
        return;
      }
      setWhoSel[id] = true;
    }else{
      delete setWhoSel[id];
    }
    /* 只同步勾选态与上限，不整表重渲染：重渲染会把焦点从当前复选框上抢走 */
    syncWhoRows();
  });
  $("csWhoList").addEventListener("click", function(e){
    if(e.target.closest("[data-cs-who-retry]")) loadWhoOptions();
  });
  renderWhoList();
}
function syncSetDialog(){
  var vis = csVisValue(), kind = csKindValue(), s = setDialogSnap;
  $("csWhoWrap").hidden = vis !== "members";
  if(vis === "members" && !setWhoOptions.length && !setWhoLoading && !setWhoError) loadWhoOptions();
  $("csRuleWrap").hidden = kind !== "dynamic";
  var canInit = !editingSetId && !caseScopeAll && caseTotal > 0;
  $("csInitWrap").hidden = kind !== "manual" || !canInit;
  $("csInitHint").textContent = canInit
    ? "范围 = " + filterSummaryText(caseFilterQuery()) + "；含未加载的行，一次最多 2000 条。"
    : "";
  $("csNarrowWarn").hidden = !(s && s.visibility === "team" && vis !== "team");
  var hint = $("csKindHint");
  if(s && setDynamic(s) && kind === "manual"){
    hint.hidden = false;
    hint.textContent = "改为手工挑选后，当前已收录的 " + (s.caseCount || 0) + " 条成员保留，之后不再自动增删。";
  }else if(s && !setDynamic(s) && kind === "dynamic"){
    hint.hidden = false;
    hint.textContent = "改为动态收录后成员由规则重新派生：手工加入但不再命中条件的用例会被移出。";
  }else{
    hint.hidden = true;
  }
  if(kind === "dynamic") refreshRuleHits();
}
function openSetDialog(id, parentId){
  if(!isWritable()){ toast("当前项目只读，无法维护分组", "warn"); return; }
  var s = id ? setById(id) : null;
  if(id && !s){ toast("分组不存在或不可见", "warn"); return; }
  if(s && !s.editable){
    toast(s.visibility === "members" ? "指定成员可见的分组只有创建人可以修改" : "个人分组只有创建人可以修改", "warn");
    return;
  }
  var parent = !s && parentId ? setById(parentId) : null;
  if(!s && parentId && !parent){ toast("父分组不存在，请刷新后重试", "warn"); return; }
  editingSetId = s ? s.id : null;
  setDialogSnap = s || null;
  setDialogParent = parent ? parent.id : "";
  setDialogParentVis = parent ? parent.visibility : "";
  $("caseSetTitle").textContent = s ? "编辑分组 · " + s.name
    : (parent ? "新建子分组 · " + parent.name : "新建分组");
  $("csName").value = s ? s.name : "";
  $("csNote").value = s && s.note ? s.note : "";
  $("fSetName").classList.remove("invalid");
  var vis = s ? s.visibility : (parent ? parent.visibility : "team");
  var me = (rt.currentUser || {}).id;
  /* 收窄团队分组只允许创建人：直接禁用选项并说明原因，而不是等保存报错 */
  var narrowLocked = !!(s && s.visibility === "team" && s.createdByUserId && me && s.createdByUserId !== me);
  Array.prototype.forEach.call(document.querySelectorAll('input[name="csVis"]'), function(r){
    r.checked = r.value === vis;
    r.disabled = !!parent || (narrowLocked && r.value !== "team");
  });
  var ph = $("csParentHint");
  if(ph){
    ph.hidden = !parent;
    ph.textContent = parent
      ? "子分组挂在「" + parent.name + "」下，可见范围与名单随父组继承（" + SET_VIS_LABEL[parent.visibility] + "）；要改范围请改父组。"
      : "";
  }
  var kind = setDynamic(s) ? "dynamic" : "manual";
  Array.prototype.forEach.call(document.querySelectorAll('input[name="csKind"]'), function(r){ r.checked = r.value === kind; });
  setWhoSel = {};
  setWhoQuery = "";
  setWhoOptions = [];
  setWhoError = "";
  setWhoLoading = false;
  if(s && s.memberIds) s.memberIds.forEach(function(uid){ setWhoSel[uid] = true; });
  renderWhoPicker();
  var rule = null;
  if(s && s.ruleJson){
    try{ rule = JSON.parse(s.ruleJson); }
    catch(e){ rule = null; toast("分组规则无法解析，请重新设置收录条件", "warn"); }
  }
  renderRuleBuilder(rule);
  setRuleHit = { n: 0, loading: false, error: "", seq: setRuleHit.seq + 1 };
  $("csInit").checked = false;
  $("csInitN").textContent = caseTotal;
  syncSetDialog();
  UI.openModal($("dlgCaseSet"), "input");
  if(kind === "dynamic") refreshRuleHits(true);
}
function saveCaseSet(){
  if(setSaving) return;
  var name = $("csName").value.trim();
  if(!name){ $("fSetName").classList.add("invalid"); toast("请填写分组名称", "warn"); return; }
  var vis = csVisValue(), kind = csKindValue();
  var wasEdit = editingSetId;
  var body = { name: name, note: $("csNote").value.trim() || null, visibility: vis, kind: kind };
  if(!wasEdit && setDialogParent) body.parentId = setDialogParent;
  if(vis === "members" && !setDialogParent){
    var ids = whoSelectedIds();
    if(!ids.length){ toast("「指定成员可见」至少要选一位成员", "warn"); return; }
    if(ids.length > SET_MAX_MEMBERS){ toast("指定成员最多 " + SET_MAX_MEMBERS + " 位，请改用团队共享", "warn"); return; }
    body.memberIds = ids;
  }
  if(kind === "dynamic"){
    var rule = csRuleValue();
    if(setRuleEmpty(rule)){ toast("动态分组至少要有一个收录条件，否则等于收录全部用例", "warn"); return; }
    if(!setRuleHit.loading && !setRuleHit.error && setRuleHit.n > SET_MAX_RULE_HITS){
      toast("规则命中 " + setRuleHit.n + " 条，超出上限 " + SET_MAX_RULE_HITS + "，请先收窄条件", "warn");
      return;
    }
    body.rule = rule;
  }
  if(!wasEdit) body.reqId = caseReqId;
  var withInit = kind === "manual" && !wasEdit && $("csInit").checked && caseTotal > 0;
  var initFilter = withInit ? caseFilterQuery() : null;
  setSaving = true;
  var parentOpen = !wasEdit && setDialogParent;
  setCaseBusy($("btnSaveCaseSet"), true, "保存中…");
  var call = wasEdit
    ? API.put("/api/case-sets/" + encodeURIComponent(wasEdit), body)
    : API.post("/api/case-sets", body);
  call.then(function(s){
    if(!withInit || !s || !s.id) return { added: 0, id: s && s.id, count: s && s.caseCount };
    return API.post("/api/case-sets/" + encodeURIComponent(s.id) + "/members",
      { allFiltered: true, filter: initFilter, excludeIds: [] }).then(function(r){
      return { added: (r && r.added) || 0, id: s.id };
    }, function(ex){
      return { addError: ex.message || "按筛选加入失败", id: s.id };
    });
  }).then(function(r){
    setSaving = false;
    setCaseBusy($("btnSaveCaseSet"), false);
    UI.closeModal($("dlgCaseSet"));
    var kindText = kind === "dynamic" ? "动态收录" : "手工挑选";
    if(wasEdit){
      toast("分组「" + name + "」已更新（" + SET_VIS_LABEL[vis] + " · " + kindText + "）", "fs");
    }else if(r.addError){
      toast("分组「" + name + "」已创建，但按筛选加入失败：" + r.addError, "warn");
    }else{
      var n = kind === "dynamic" ? (r.count || 0) : (r.added || 0);
      toast("分组「" + name + "」已创建（" + SET_VIS_LABEL[vis] + " · " + kindText + "）"
        + (n ? "，收录 " + n + " 条用例" : ""), "fs");
    }
    afterStructureChange().then(function(){
      if(parentOpen) caseSetOpen[parentOpen] = true;
      renderSetPanel();
      /* 从「加入分组」里顺手新建的分组，建完直接选中，省掉再找一次 */
      if(!wasEdit && r.id && $("dlgSetPick").classList.contains("open")){
        setPickSel = r.id;
        renderSetPickList();
        $("btnSetPickOk").disabled = false;
      }
    });
  }).catch(function(ex){
    setSaving = false;
    setCaseBusy($("btnSaveCaseSet"), false);
    toast(ex.message || "保存分组失败", "bad");
  });
}
function deleteCaseSet(id){
  var s = setById(id);
  if(!s){ toast("分组不存在或不可见", "warn"); return; }
  if(!isWritable()){ toast("当前项目只读，无法维护分组", "warn"); return; }
  if(!s.editable){ toast("只有创建人可以删除这个分组", "warn"); return; }
  var kids = 0;
  caseSets.forEach(function(x){ if((x.parentId || "") === id) kids++; });
  if(kids){
    toast("分组「" + s.name + "」下还有 " + kids + " 个子分组，请先移走或删除子分组", "warn");
    return;
  }
  UI.showConfirm({
    title: "删除分组", okText: "删除分组",
    msg: "删除分组「<b>" + esc(s.name) + "</b>」（" + (s.caseCount || 0) + " 条成员引用）？<b>用例本体保留</b>，只是不再属于这个分组。已加入测试计划的用例不受影响。"
  }).then(function(ok){
    if(!ok) return;
    return API.del("/api/case-sets/" + encodeURIComponent(id)).then(function(){
      toast("分组「" + s.name + "」已删除，用例本体保留", "fs");
      if(setFilter === id) setFilter = "all";
      if(caseSelScope && caseSelScope.dim === "set" && caseSelScope.key === id) resetCaseSel();
      afterStructureChange();
    }).catch(function(ex){ toast(ex.message || "删除分组失败", "bad"); });
  });
}
/* 撤销加入只移出本次真正新增的成员：按筛选加入时范围里可能混着原本就在组内的用例。
   服务端一次最多收 200 个 ID，超出按批移出。 */
function removeSetMemberIds(setId, ids){
  var i = 0, removed = 0;
  function next(){
    if(i >= ids.length) return Promise.resolve(removed);
    var chunk = ids.slice(i, i + 200);
    i += 200;
    return API.post("/api/case-sets/" + encodeURIComponent(setId) + "/members/remove", { ids: chunk }).then(function(r){
      removed += (r && r.removed) || 0;
      return next();
    });
  }
  return next();
}
function joinSet(setId, selection, count){
  var s = setById(setId);
  var label = s ? s.name : setId;
  if(setDynamic(s)){
    toast("「" + label + "」是动态分组，成员由规则自动收录；要手工增删请先在编辑分组里改为手工挑选", "warn");
    return Promise.resolve();
  }
  return API.post("/api/case-sets/" + encodeURIComponent(setId) + "/members", selection).then(function(r){
    var added = (r && r.added) || 0, already = (r && r.already) || 0, matched = (r && r.matched) || count;
    if(!added){
      toast("没有新增：命中的 " + matched + " 条都已在分组「" + label + "」内", "fs");
      return;
    }
    var ids = (r && r.addedIds) || [];
    var msg = "已加入分组「" + label + "」" + added + " 条" + (already ? "（跳过 " + already + " 条已在组内）" : "");
    if(ids.length){
      UI.toastAction(msg, "撤销", function(){
        removeSetMemberIds(setId, ids).then(function(n){
          toast("已撤销：从分组「" + label + "」移出 " + n + " 条（用例本体保留）", "fs");
          afterStructureChange();
        }).catch(function(ex){ toast(ex.message || "撤销失败", "bad"); });
      }, "fs");
    }else{
      toast(msg, "fs");
    }
    afterStructureChange();
  }).catch(function(ex){ toast(ex.message || "加入分组失败", "bad"); });
}
function leaveSet(setId){
  var n = caseSelCount();
  if(!n){ toast("请先勾选用例", "warn"); return; }
  var s = setById(setId);
  var label = s ? s.name : "所选分组";
  if(setDynamic(s)){
    toast("「" + label + "」是动态分组，成员由规则自动收录，不能手工移出；请改规则或改为手工挑选", "warn");
    return;
  }
  UI.showConfirm({
    title: "移出分组", okText: "移出 " + n + " 条",
    msg: "把已选的 <b>" + n + "</b> 条用例从分组「<b>" + esc(label) + "</b>」移出？<b>用例本体保留</b>，只是不再属于这个分组。"
  }).then(function(ok){
    if(!ok) return;
    return API.post("/api/case-sets/" + encodeURIComponent(setId) + "/members/remove", caseSelection()).then(function(r){
      toast("已从分组「" + label + "」移出 " + ((r && r.removed) || 0) + " 条（用例本体保留）", "fs");
      clearCaseSel();
      afterStructureChange();
    }).catch(function(ex){ toast(ex.message || "移出分组失败", "bad"); });
  });
}
/* 批量加入分组：先选目标分组，范围沿用批量条的勾选 / 全选筛选结果 */
function openSetPick(){
  if(!caseHasSel()){ toast("请先勾选用例，或用「全选筛选结果」", "warn"); return; }
  if(!isWritable()){ toast("当前项目只读，无法维护分组", "warn"); return; }
  setPickSel = "";
  $("setPickSub").textContent = "已选 " + caseSelCount() + " 条"
    + (caseSelAll ? "（按筛选条件生效，含未加载的行）" : "") + "；加入是引用不复制用例，已在组内的自动跳过。";
  $("btnSetPickOk").disabled = true;
  $("setPickList").innerHTML = UI.skeletonRows(3);
  UI.openModal($("dlgSetPick"));
  loadCaseSets(true).then(renderSetPickList);
}
function renderSetPickList(){
  var box = $("setPickList");
  if(!box) return;
  if(caseSetsLoading){ box.innerHTML = UI.skeletonRows(3); return; }
  if(caseSetsError){ box.innerHTML = UI.errorState(caseSetsError); return; }
  if(!caseSets.length){
    box.innerHTML = '<p class="tc-side-empty">还没有分组，点下方「新建分组」建第一个。</p>';
    return;
  }
  box.innerHTML = caseSets.map(function(s){
    var dyn = setDynamic(s);
    var on = setPickSel === s.id;
    var sub = dyn ? "动态收录 · 成员由规则派生，不能手工加入"
      : (s.visibility === "members" ? "指定成员可见 · 创建人 + 名单内成员"
        : (s.visibility === "personal" ? "仅自己可见 · 只有自己能看" : "团队共享 · 项目成员可见"));
    return '<button class="set-pick-item' + (on ? " on" : "") + '" type="button" data-set-pick="' + esc(s.id) + '"'
      + (s.editable && !dyn ? "" : " disabled") + ' aria-pressed="' + (on ? "true" : "false") + '">'
      + '<span class="tc-set-ico">' + icon(dyn ? "refresh" : "layers", 13) + '</span>'
      + '<span class="set-pick-main"><b>' + esc(s.name) + '</b>'
      + '<small>' + sub + (s.editable || dyn ? "" : " · 只读") + '</small></span>'
      + '<span class="set-pick-n">' + (s.caseCount || 0) + ' 条</span>'
      + (on ? icon("check", 14) : "")
      + '</button>';
  }).join("");
}
function doSetPick(){
  if(setPickBusy || !setPickSel) return;
  var s = setById(setPickSel);
  if(!s){ toast("分组不存在或不可见", "warn"); return; }
  setPickBusy = true;
  setCaseBusy($("btnSetPickOk"), true, "加入中…");
  joinSet(setPickSel, caseSelection(), caseSelCount()).then(function(){
    setPickBusy = false;
    setCaseBusy($("btnSetPickOk"), false);
    UI.closeModal($("dlgSetPick"));
  }, function(){
    setPickBusy = false;
    setCaseBusy($("btnSetPickOk"), false);
  });
}

/* ---------- 拖拽归类：目录＝移动（单归属），分组＝加入（多归属） ---------- */

function caseDragSelection(c){
  if(caseSelAll) return { selection: caseSelection(), count: caseSelCount(), anchor: c.id };
  if(caseSel[c.id]){
    var ids = caseSelIds();
    if(ids.length > 1) return { selection: { ids: ids }, count: ids.length, anchor: c.id };
  }
  return { selection: { ids: [c.id] }, count: 1, anchor: c.id };
}
/* 拖动中不整表重渲染：重渲染会销毁拖动源节点，浏览器会直接取消这次拖拽 */
function markDraggingRows(on){
  Array.prototype.forEach.call($("tcList").querySelectorAll(".tc-row"), function(row){
    var box = row.querySelector("[data-tc-pick]");
    var anchor = !!caseDrag && row.dataset.tcDrag === caseDrag.anchor;
    row.classList.toggle("is-dragging", !!on && (anchor || !!(box && box.checked)));
  });
}
function clearDropTarget(){
  if(caseDropEl){ caseDropEl.classList.remove("drop-on"); caseDropEl = null; }
}
function setDropTarget(el, label, action){
  if(caseDropEl !== el){
    clearDropTarget();
    caseDropEl = el;
    if(el) el.classList.add("drop-on");
  }
  if(caseDrag){ caseDrag.target = label; caseDrag.action = action; syncDropBanner(); }
}
/* ---------- 目录 / 分组自身的拖拽：中间＝换父级，上下边缘＝同级排序 ---------- */

var structDropEl = null;
var structDropZone = "";
function clearStructDropTarget(){
  if(structDropEl) structDropEl.classList.remove("drop-before", "drop-after", "drop-into");
  structDropEl = null;
  structDropZone = "";
}
function markStructDropTarget(el, zone){
  if(structDropEl !== el){
    clearStructDropTarget();
    structDropEl = el;
  }
  if(structDropZone !== zone){
    if(structDropEl) structDropEl.classList.remove("drop-before", "drop-after", "drop-into");
    structDropZone = zone;
    if(el) el.classList.add("drop-" + zone);
  }
}
function structZoneOf(el, e){
  var r = el.getBoundingClientRect();
  var y = (e.clientY - r.top) / Math.max(1, r.height);
  return y < 0.3 ? "before" : (y > 0.7 ? "after" : "into");
}
function setDescendsFrom(ancId, id){
  var cur = setById(id), guard = 0;
  while(cur && cur.parentId && guard++ < 64){
    if(cur.parentId === ancId) return true;
    cur = setById(cur.parentId);
  }
  return false;
}
function dirDescendsFrom(ancId, id){
  var cur = moduleNodeById(id), guard = 0;
  while(cur && cur.parentId && guard++ < 64){
    if(cur.parentId === ancId) return true;
    cur = moduleNodeById(cur.parentId);
  }
  return false;
}
function dragOverStruct(e, kind){
  var drag = kind === "set" ? caseSetDrag : caseDirDrag;
  var el = e.target && e.target.closest ? e.target.closest(kind === "set" ? "[data-tc-set]" : "[data-tc-dir]") : null;
  var id = el ? (kind === "set" ? el.dataset.tcSet : el.dataset.tcDir) : "";
  var special = kind === "set" ? id === "__none" : (id === "all" || id === "__none");
  var cycle = id ? (kind === "set" ? setDescendsFrom(drag.id, id) : dirDescendsFrom(drag.id, id)) : true;
  if(!el || special || drag.id === id || cycle){
    clearStructDropTarget();
    drag.target = "";
    drag.action = "";
    syncDropBanner();
    return;
  }
  if(kind === "set"){
    var ts = setById(id);
    if(!ts || !ts.editable){ clearStructDropTarget(); drag.target = ""; drag.action = ""; syncDropBanner(); return; }
  }
  var zone = structZoneOf(el, e);
  e.preventDefault();
  try{ e.dataTransfer.dropEffect = "move"; }catch(err){ /* 同用例拖拽 */ }
  markStructDropTarget(el, zone);
  drag.target = kind === "set" ? (setById(id) || {}).name : modulePathOf(id);
  drag.action = zone === "into"
    ? (kind === "set" ? "成为子分组（继承可见范围）：" : "成为子目录：")
    : (zone === "before" ? "排到它前面：" : "排到它后面：");
  syncDropBanner();
}
function dropStruct(e, kind){
  var drag = kind === "set" ? caseSetDrag : caseDirDrag;
  var el = e.target && e.target.closest ? e.target.closest(kind === "set" ? "[data-tc-set]" : "[data-tc-dir]") : null;
  var id = el ? (kind === "set" ? el.dataset.tcSet : el.dataset.tcDir) : "";
  var zone = el ? (structDropEl === el ? structDropZone : structZoneOf(el, e)) : "";
  caseSetDrag = null;
  caseDirDrag = null;
  clearStructDropTarget();
  syncDropBanner();
  if(!drag || !el || !id || !zone || drag.id === id || reorderBusy) return;
  /* 落点没经过 dragover 也会到这里（脚本派发、拖拽中途重渲染）：成环与只读节点必须再挡一次，
     不能只靠 dragover 不标落点来拦 */
  if(kind === "set"){
    var ts = setById(id);
    if(!ts || !ts.editable || setDescendsFrom(drag.id, id)) return;
  }else if(dirDescendsFrom(drag.id, id)){
    return;
  }
  if(kind === "set") applySetDrag(drag, id, zone);
  else applyDirDrag(drag, id, zone);
}
function caseSetBody(s, parentId){
  var body = { name: s.name, note: s.note || null, visibility: s.visibility,
    kind: setDynamic(s) ? "dynamic" : "manual" };
  if(setDynamic(s) && s.ruleJson){
    try{ body.rule = JSON.parse(s.ruleJson); }catch(err){ body.rule = null; }
  }
  if(parentId !== undefined) body.parentId = parentId;
  return body;
}
function applySetDrag(drag, targetId, zone){
  var s = setById(drag.id), target = setById(targetId);
  if(!s || !target) return;
  if(zone === "into"){
    reorderBusy = true;
    API.put("/api/case-sets/" + encodeURIComponent(s.id), caseSetBody(s, target.id)).then(function(){
      reorderBusy = false;
      caseSetOpen[target.id] = true;
      toast("分组「" + s.name + "」已挂到「" + target.name + "」下，可见范围随父组", "fs");
      afterStructureChange();
    }).catch(function(ex){
      reorderBusy = false;
      toast(ex.message || "移动分组失败", "bad");
    });
    return;
  }
  var parentId = target.parentId || "";
  var sib = caseSets.filter(function(x){ return (x.parentId || "") === parentId; });
  var locked = sib.filter(function(x){ return !x.editable; });
  if(locked.length){ toast("同级里有你无权调整的分组，无法手动排序", "warn"); return; }
  var ids = sib.map(function(x){ return x.id; }).filter(function(id){ return id !== s.id; });
  var at = ids.indexOf(target.id);
  if(at < 0) at = ids.length;
  ids.splice(zone === "after" ? at + 1 : at, 0, s.id);
  reorderBusy = true;
  var moveFirst = (s.parentId || "") !== parentId
    ? API.put("/api/case-sets/" + encodeURIComponent(s.id), caseSetBody(s, parentId))
    : Promise.resolve();
  moveFirst.then(function(){
    return API.put("/api/case-sets/order", { reqId: caseReqId, parentId: parentId, ids: ids });
  }).then(function(){
    reorderBusy = false;
    caseSetOpen[parentId] = true;
    toast("分组顺序已更新", "fs");
    afterStructureChange();
  }).catch(function(ex){
    reorderBusy = false;
    toast(ex.message || "调整分组顺序失败", "bad");
  });
}
function applyDirDrag(drag, targetId, zone){
  var n = moduleNodeById(drag.id), target = moduleNodeById(targetId);
  if(!n || !target) return;
  var move = function(parentId){
    return API.put("/api/test-modules/" + encodeURIComponent(n.id), { name: n.name, parentId: parentId });
  };
  if(zone === "into"){
    reorderBusy = true;
    move(target.id).then(function(){
      reorderBusy = false;
      caseDirOpen[target.id] = true;
      toast("目录「" + n.name + "」已挂到「" + target.name + "」下", "fs");
      afterStructureChange();
    }).catch(function(ex){
      reorderBusy = false;
      toast(ex.message || "移动目录失败", "bad");
    });
    return;
  }
  var parentId = target.parentId || "";
  var ids = caseModuleNodes.filter(function(x){ return (x.parentId || "") === parentId; })
    .map(function(x){ return x.id; })
    .filter(function(id){ return id !== n.id; });
  var at = ids.indexOf(target.id);
  if(at < 0) at = ids.length;
  ids.splice(zone === "after" ? at + 1 : at, 0, n.id);
  reorderBusy = true;
  var moveFirst = (n.parentId || "") !== parentId ? move(parentId) : Promise.resolve();
  moveFirst.then(function(){
    return API.put("/api/test-modules/order?reqId=" + encodeURIComponent(caseReqId)
      + "&parentId=" + encodeURIComponent(parentId), { ids: ids });
  }).then(function(){
    reorderBusy = false;
    caseDirOpen[parentId] = true;
    toast("目录顺序已更新", "fs");
    afterStructureChange();
  }).catch(function(ex){
    reorderBusy = false;
    toast(ex.message || "调整目录顺序失败", "bad");
  });
}


function dropTargetOf(el){
  if(!el) return null;
  if(el.dataset.tcDir && el.dataset.tcDir !== "all"){
    var id = el.dataset.tcDir;
    if(id === "__none") return { kind: "module", id: "", label: "未归类", action: "移出目录（变为未归类）" };
    return { kind: "module", id: id, label: modulePathOf(id) || id, action: "移动归属（原目录移出）" };
  }
  if(el.dataset.tcSet && el.dataset.tcSet !== "__none"){
    var s = setById(el.dataset.tcSet);
    /* 动态分组不接受拖入：成员由规则派生，落点直接不成立，避免拖完才报错 */
    if(setDynamic(s)) return null;
    return { kind: "set", id: el.dataset.tcSet, label: s ? s.name : el.dataset.tcSet, action: "加入分组（原分组保留）" };
  }
  if(el.dataset.tcSegDrop){
    var key = el.dataset.tcSegDrop, seg = segmentByKey(key);
    var label = seg ? seg.label : key;
    if(caseGroupBy === "module"){
      return key === "__none"
        ? { kind: "module", id: "", label: "未归类", action: "移出目录（变为未归类）" }
        : { kind: "module", id: key, label: label, action: "移动归属（原目录移出）" };
    }
    if(caseGroupBy === "set") return setDynamic(setById(key)) ? null : { kind: "set", id: key, label: label, action: "加入分组（原分组保留）" };
    if(caseGroupBy === "priority"){
      return key === "__none"
        ? { kind: "priority", id: "", label: "未设置优先级", action: "清空优先级" }
        : { kind: "priority", id: key, label: label, action: "改优先级为 " + key };
    }
  }
  return null;
}
function applyCaseDrop(t, drag){
  if(t.kind === "set"){ joinSet(t.id, drag.selection, drag.count); return; }
  if(t.kind === "priority"){ confirmPriorityDrop(t, drag); return; }
  confirmMoveModule(t.id, t.label, drag);
}
function moveFromLabel(selection){
  if(selection.allFiltered) return "筛选范围内的原目录";
  var ids = selection.ids || [], labels = {}, missing = 0;
  ids.forEach(function(id){
    var c = caseById(id);
    if(!c){ missing++; return; }
    var l = caseModuleLabel(c) || "未归类";
    labels[l] = true;
  });
  if(missing) return "原目录（部分行未加载）";
  var keys = Object.keys(labels);
  if(keys.length === 1) return keys[0];
  return keys.length + " 个目录";
}
function dragPreviewText(selection){
  if(selection.allFiltered) return "按筛选条件生效，含未加载的行";
  var titles = (selection.ids || []).slice(0, 4).map(function(id){
    var c = caseById(id);
    return c ? (caseNoText(c) ? caseNoText(c) + " " : "") + c.title : id;
  });
  var rest = (selection.ids || []).length - titles.length;
  return titles.join("；") + (rest > 0 ? " 等 " + (rest + titles.length) + " 条" : "");
}
function confirmMoveModule(targetId, targetLabel, drag){
  var n = drag.count;
  var to = targetId ? targetLabel : "未归类";
  UI.showConfirm({
    title: "移动 " + n + " 条用例", danger: false, okText: "移动 " + n + " 条",
    msg: '<div class="tc-move-arrow"><span class="from">' + esc(moveFromLabel(drag.selection)) + '</span>'
      + icon("right", 14) + '<span class="to">' + esc(to) + '</span></div>'
      + '<ul class="tc-move-notes">'
      + '<li>' + icon("check", 12) + '<span>用例编号<b>不变</b>，缺陷与评审仍可用旧编号引用</span></li>'
      + '<li>' + icon("check", 12) + '<span>执行流水、失败证据、缺陷回链<b>全部保留</b></span></li>'
      + '<li>' + icon("alert", 12) + '<span>覆盖矩阵与目录计数<b>随之变化</b>；已冻结的发布快照不受影响</span></li>'
      + '<li>' + icon("alert", 12) + '<span>计划按用例引用，移动后<b>计划范围不变</b></span></li>'
      + '</ul>'
      + '<p class="tc-move-preview">' + esc(dragPreviewText(drag.selection)) + '</p>'
  }).then(function(ok){
    if(!ok) return;
    return API.post("/api/test-cases/move-module", { selection: drag.selection, moduleId: targetId || null }).then(function(r){
      var moved = (r && r.moved) || 0, items = (r && r.items) || [];
      if(!moved){ toast("没有变化：这些用例已经在「" + to + "」", "fs"); return; }
      var msg = "已移动 " + moved + " 条到「" + to + "」";
      if(r && r.skipped) msg += "，跳过 " + r.skipped + " 条（已不存在或无权修改）";
      if(items.length){
        UI.toastAction(msg, "撤销", function(){
          API.post("/api/test-cases/restore-module", { items: items }).then(function(rr){
            toast("已撤销移动，恢复 " + ((rr && rr.restored) || 0) + " 条的原目录归属", "fs");
            afterStructureChange();
          }).catch(function(ex){ toast(ex.message || "撤销失败", "bad"); });
        }, "fs");
      }else{
        toast(msg, "fs");
      }
      clearCaseSel();
      afterStructureChange();
    }).catch(function(ex){ toast(ex.message || "移动失败", "bad"); });
  });
}
function confirmPriorityDrop(t, drag){
  var clear = !t.id, n = drag.count;
  UI.showConfirm({
    title: clear ? "清空 " + n + " 条用例的优先级" : "把 " + n + " 条用例改为 " + t.id,
    danger: false, okText: clear ? "清空优先级" : "改为 " + t.id,
    msg: (clear ? "已选用例的优先级将被清空" : "已选用例的优先级统一改为 <b>" + esc(t.id) + "</b>")
      + "，编号与执行历史不变。"
      + '<p class="tc-move-preview">' + esc(dragPreviewText(drag.selection)) + '</p>'
  }).then(function(ok){
    if(!ok) return;
    var body = Object.assign({}, drag.selection);
    body.priorityAction = clear ? "clear" : "set";
    if(!clear) body.priority = t.id;
    return API.put("/api/test-cases/batch", body).then(function(r){
      toast("已更新 " + ((r && r.updated) || 0) + " 条用例的优先级", "fs");
      clearCaseSel();
      loadCases();
    }).catch(function(ex){ toast(ex.message || "改优先级失败", "bad"); });
  });
}

/* ---------- 按筛选圈选入计划：筛选条件即范围 ---------- */

var pbf = {
  byFilter: true, filter: null, excludeIds: [], ids: [], count: 0,
  plans: [], planId: "", loading: false, error: "",
  sum: null, sumLoading: false, sumError: "", sumSeq: 0,
  busy: false, seq: 0, preview: [], previewLoading: false, previewSeq: 0
};
var PBF_STATUS = { draft: "草稿", running: "执行中", done: "已完成" };

function openPlanByFilter(){
  if(!caseReqId || caseScopeAll){ toast("先选择一个项目，再加入测试计划", "warn"); return; }
  if(!canEditReq(caseReqId)){ toast("当前项目只读，无法圈选用例", "warn"); return; }
  var sel = caseHasSel();
  pbf.byFilter = !sel || caseSelAll;
  pbf.filter = pbf.byFilter ? (sel ? caseSelectionFilter() : caseFilterQuery()) : null;
  pbf.excludeIds = sel && caseSelAll ? Object.keys(caseExclude) : [];
  pbf.ids = sel && !caseSelAll ? caseSelIds() : [];
  pbf.count = sel ? caseSelCount() : caseTotal;
  if(!pbf.count){ toast("当前范围没有用例，先放宽筛选或新建用例", "warn"); return; }
  pbf.sum = null;
  pbf.sumError = "";
  pbf.sumLoading = false;
  pbf.plans = [];
  pbf.planId = "";
  pbf.error = "";
  pbf.preview = [];
  pbf.busy = false;
  $("pbfRequired").checked = false;
  $("pbfNewName").value = "";
  $("pbfNewWrap").hidden = true;
  $("pbfDynamic").checked = false;
  $("pbfDynName").value = "";
  renderPbfTags();
  renderPbfPreview();
  renderPbfSum();
  UI.openModal($("dlgPlanByFilter"), "select");
  loadPbfPlans();
}
function pbfDemandLabel(id){
  if(id === "__none") return "未关联需求";
  for(var i = 0; i < cases.length; i++) if(cases[i].demandId === id && cases[i].demandTitle) return cut(cases[i].demandTitle, 24);
  return "指定需求";
}
function renderPbfTags(){
  var box = $("pbfTags");
  if(!box) return;
  var tags = [];
  if(!pbf.byFilter) tags.push("已勾选 " + pbf.count + " 条");
  else if(caseSelAll && caseSelScope) tags.push("全选「" + caseSelScope.label + "」组");
  else if(caseSelAll) tags.push("全选筛选结果");
  else tags.push("当前筛选");
  tags.push(reqNameOf(caseReqId));
  if(pbf.byFilter){
    var f = pbf.filter || {};
    if(f.moduleId) tags.push("目录：" + (f.moduleId === "__none" ? "未归类" : (modulePathOf(f.moduleId) || f.moduleId)) + (f.moduleSub ? "（含子目录）" : ""));
    if(f.pri) tags.push("优先级：" + f.pri);
    if(f.status) tags.push("结果：" + (f.status === "__untested" ? "未执行" : (STATUS_LABEL[f.status] || f.status)));
    if(f.owner) tags.push("执行人：" + f.owner);
    if(f.demandId) tags.push("需求：" + pbfDemandLabel(f.demandId));
    if(f.setId) tags.push("分组：" + (f.setId === "__none" ? "未加入分组" : ((setById(f.setId) || {}).name || "指定分组")));
    if(f.bugOnly) tags.push("仅关联缺陷");
    if(f.q) tags.push("搜索：" + f.q + (f.searchWide ? "（含步骤与前置）" : ""));
  }
  box.innerHTML = tags.map(function(t){ return '<span class="pbf-tag">' + esc(t) + '</span>'; }).join("");
}
function renderPbfPreview(){
  var box = $("pbfPreview"), foot = $("pbfPreviewFoot");
  if(!box) return;
  if(!pbf.byFilter){
    pbf.preview = pbf.ids.slice(0, 8).map(caseById).filter(Boolean);
    paintPbfPreview();
    return;
  }
  pbf.previewLoading = true;
  box.innerHTML = UI.skeletonRows(3);
  /* 预览自己计序号：loadPbfPlans 会推进 pbf.seq，共用一个序号会把预览结果当成过期丢掉 */
  var seq = ++pbf.previewSeq;
  API.get("/api/test-cases", Object.assign({}, pbf.filter, { offset: 0, limit: 8 })).then(function(page){
    if(seq !== pbf.previewSeq) return;
    pbf.previewLoading = false;
    pbf.preview = (page && page.items) || [];
    paintPbfPreview();
  }).catch(function(ex){
    if(seq !== pbf.previewSeq) return;
    pbf.previewLoading = false;
    box.innerHTML = UI.errorState(ex.message || "预览加载失败");
    if(foot) foot.textContent = "";
  });
}
function paintPbfPreview(){
  var box = $("pbfPreview"), foot = $("pbfPreviewFoot");
  if(!box) return;
  box.innerHTML = pbf.preview.length
    ? pbf.preview.map(function(c){
      return '<div class="pbf-row-case">'
        + '<span class="tc-no">' + esc(caseNoText(c)) + '</span>'
        + statusBadgeHTML(c.latestStatus)
        + '<span class="pbf-case-main"><b>' + esc(c.title) + '</b>'
        + '<small>' + esc([caseModuleLabel(c), c.priority || "—", c.demandTitle ? cut(c.demandTitle, 20) : ""].filter(Boolean).join(" · ")) + '</small></span>'
        + '</div>';
    }).join("")
    : '<p class="tc-side-empty">当前范围没有用例。</p>';
  if(foot) foot.textContent = "预览前 " + pbf.preview.length + " 条；实际范围 " + pbf.count + " 条"
    + (pbf.byFilter ? "（含未加载的行）" : "");
}
function loadPbfPlans(){
  var seq = ++pbf.seq;
  pbf.loading = true;
  pbf.error = "";
  renderPbfPlanSelect();
  API.get("/api/test-plans", { reqId: caseReqId, offset: 0, limit: 200 }).then(function(page){
    if(seq !== pbf.seq) return;
    pbf.loading = false;
    /* 已完成的计划是快照口径，服务端拒绝再加用例，这里直接不列 */
    pbf.plans = ((page && page.items) || []).filter(function(p){ return p.status !== "done"; });
    pbf.planId = pbf.plans.length ? pbf.plans[0].id : "__new";
    renderPbfPlanSelect();
    refreshPbfSum();
  }).catch(function(ex){
    if(seq !== pbf.seq) return;
    pbf.loading = false;
    pbf.error = ex.message || "计划加载失败";
    pbf.planId = "__new";
    renderPbfPlanSelect();
    renderPbfSum();
  });
}
function renderPbfPlanSelect(){
  var sel = $("pbfPlan");
  if(!sel) return;
  if(pbf.loading){
    sel.innerHTML = '<option value="">计划加载中…</option>';
    sel.disabled = true;
    syncPbfAddBtn();
    return;
  }
  sel.disabled = false;
  sel.innerHTML = pbf.plans.map(function(p){
    return '<option value="' + esc(p.id) + '">' + esc(p.name + " · " + (PBF_STATUS[p.status] || p.status) + "（" + (p.caseCount || 0) + " 条）") + '</option>';
  }).join("") + '<option value="__new">＋ 新建计划…</option>';
  sel.value = pbf.planId || "__new";
  $("pbfNewWrap").hidden = sel.value !== "__new";
  syncPbfAddBtn();
}
/* 试算：命中 / 已在计划 / 本次新增，确认前先把去重结果摆出来 */
function refreshPbfSum(){
  var sel = $("pbfPlan");
  var planId = sel ? sel.value : "";
  pbf.planId = planId;
  $("pbfNewWrap").hidden = planId !== "__new";
  pbf.sum = null;
  pbf.sumError = "";
  if(!pbf.byFilter || !planId || planId === "__new"){
    pbf.sumLoading = false;
    if(pbf.byFilter) pbf.sum = { matched: pbf.count, already: 0, added: pbf.count };
    renderPbfSum();
    return;
  }
  var seq = ++pbf.sumSeq;
  pbf.sumLoading = true;
  renderPbfSum();
  API.post("/api/test-plans/" + encodeURIComponent(planId) + "/cases/by-filter",
    { filter: pbf.filter, excludeIds: pbf.excludeIds, dryRun: true }).then(function(r){
    if(seq !== pbf.sumSeq) return;
    pbf.sumLoading = false;
    pbf.sum = r || null;
    renderPbfSum();
  }).catch(function(ex){
    if(seq !== pbf.sumSeq) return;
    pbf.sumLoading = false;
    pbf.sumError = ex.message || "试算失败";
    renderPbfSum();
  });
}
function renderPbfSum(){
  var el = $("pbfSum");
  if(!el) return;
  if(pbf.error){
    el.innerHTML = '<span class="pbf-err">' + esc(pbf.error) + '（可改用「＋ 新建计划…」）</span>';
    syncPbfAddBtn();
    return;
  }
  if(!pbf.byFilter){
    el.innerHTML = '<b>' + pbf.count + '</b><span>条已勾选，将加入所选计划（重复的自动跳过）</span>';
    syncPbfAddBtn();
    return;
  }
  if(pbf.sumLoading){
    el.innerHTML = '<span class="pbf-err">正在试算命中与去重…</span>';
    syncPbfAddBtn();
    return;
  }
  if(pbf.sumError){
    el.innerHTML = '<span class="pbf-err">' + esc(pbf.sumError) + '</span>';
    syncPbfAddBtn();
    return;
  }
  var s = pbf.sum || { matched: pbf.count, already: 0, added: pbf.count };
  el.innerHTML = '<b>' + (s.added || 0) + '</b><span>条将加入' + (pbf.planId === "__new" ? "新计划" : "所选计划")
    + '（已去重 ' + (s.already || 0) + ' 条已在计划中）</span>'
    + '<div class="pbf-rows">'
    + '<div class="pbf-row"><span>范围命中</span><span class="n">' + (s.matched || 0) + '</span></div>'
    + '<div class="pbf-row"><span>已在计划中</span><span class="n">-' + (s.already || 0) + '</span></div>'
    + '<div class="pbf-row"><span>本次新增</span><span class="n">' + (s.added || 0) + '</span></div>'
    + '</div>';
  syncPbfAddBtn();
}
function pbfAddCount(){
  if(!pbf.byFilter) return pbf.count;
  return pbf.sum ? (pbf.sum.added || 0) : pbf.count;
}
/* 圈选入计划时顺手把筛选存成动态分组：规则字段与收录口径完全复用，不另造一套条件。
   计划里的用例仍是一次性引用，动态分组只影响下次圈选，两者边界在提示里写明。 */
function pbfRule(){
  if(!pbf.byFilter || !pbf.filter) return null;
  var f = pbf.filter;
  return {
    status: f.status || null, pri: f.pri || null,
    moduleId: f.moduleId || null, moduleSub: !!f.moduleSub,
    demandId: f.demandId || null, owner: f.owner || null,
    bugOnly: !!f.bugOnly, q: f.q || null, searchWide: !!f.searchWide, regression: !!f.regression
  };
}
function syncPbfDyn(){
  var wrap = $("pbfDynWrap"), box = $("pbfDynamic"), nameWrap = $("pbfDynNameWrap"), hint = $("pbfDynHint");
  if(!wrap || !box) return;
  wrap.hidden = false;
  var rule = pbfRule(), block = "";
  if(!rule) block = "勾选模式没有筛选条件可存；要保存动态分组请先设置筛选，或用「全选筛选结果」。";
  else if(pbf.filter.setId) block = "当前范围叠加了「分组」条件，收录规则不能引用其他分组；请先清空分组筛选。";
  else if(pbf.excludeIds.length) block = "已取消勾选 " + pbf.excludeIds.length + " 条；动态分组按规则收录、无法排除个别用例，请改用手工分组。";
  else if(setRuleEmpty(rule)) block = "当前没有筛选条件：动态分组至少要有一个收录条件，否则等于收录全部用例。";
  else if(pbf.count > SET_MAX_RULE_HITS) block = "当前范围 " + pbf.count + " 条，超出动态分组上限 " + SET_MAX_RULE_HITS + " 条，请先收窄筛选。";
  box.disabled = !!block;
  if(block && box.checked) box.checked = false;
  nameWrap.hidden = !box.checked;
  hint.textContent = block ? block
    : (box.checked
      ? "规则 = " + filterSummaryText(rule) + "；可见范围固定为团队共享（进证据）。已加入计划的用例是一次性引用，不随规则变化。"
      : "把当前筛选存成团队共享的动态分组：命中的新用例自动进入，下次发布可直接引用。");
  hint.classList.toggle("cs-warn", !!block);
}
function syncPbfAddBtn(){
  var b = $("btnPbfAdd");
  if(!b) return;
  syncPbfDyn();
  var sel = $("pbfPlan");
  var planId = sel ? sel.value : "";
  var newName = $("pbfNewName").value.trim();
  var n = pbfAddCount();
  var dynName = $("pbfDynamic").checked ? $("pbfDynName").value.trim() : "";
  var block = pbf.busy || pbf.loading || pbf.sumLoading || !!pbf.sumError || !planId
    || (planId === "__new" && !newName)
    || ($("pbfDynamic").checked && !dynName);
  b.disabled = !!block || n <= 0;
  b.textContent = pbf.busy ? "加入中…" : (n > 0 ? "加入 " + n + " 条用例" : "没有可新增的用例");
}
function doPbfAdd(){
  if(pbf.busy) return;
  var planId = $("pbfPlan").value;
  var required = $("pbfRequired").checked;
  var newName = $("pbfNewName").value.trim();
  if(!planId){ toast("先选择目标计划", "warn"); return; }
  if(planId === "__new" && !newName){ toast("请填写新计划名称", "warn"); $("pbfNewName").focus(); return; }
  var dynName = $("pbfDynamic").checked ? $("pbfDynName").value.trim() : "";
  var dynRule = dynName ? pbfRule() : null;
  if($("pbfDynamic").checked && !dynName){ toast("请填写动态分组名称", "warn"); $("pbfDynName").focus(); return; }
  pbf.busy = true;
  syncPbfAddBtn();
  var creating = planId === "__new";
  var create = creating
    ? API.post("/api/test-plans", { reqId: caseReqId, name: newName, status: "draft" })
    : Promise.resolve({ id: planId, name: (pbf.plans.filter(function(p){ return p.id === planId; })[0] || {}).name || "" });
  create.then(function(p){
    var pid = p && p.id ? p.id : planId;
    var call = pbf.byFilter
      ? API.post("/api/test-plans/" + encodeURIComponent(pid) + "/cases/by-filter",
        { filter: pbf.filter, excludeIds: pbf.excludeIds, required: required })
      : API.post("/api/test-plans/" + encodeURIComponent(pid) + "/cases",
        { caseIds: pbf.ids, required: required }).then(function(added){
        var n = added || 0;
        return { matched: pbf.ids.length, already: Math.max(0, pbf.ids.length - n), added: n };
      });
    return call.then(function(r){ return { plan: p, res: r || {}, pid: pid }; });
  }).then(function(out){
    /* 动态分组在计划加入成功之后再建：建组失败不该把已入计划的用例回滚掉 */
    if(!dynRule) return out;
    return API.post("/api/case-sets", { reqId: caseReqId, name: dynName, visibility: "team", kind: "dynamic", rule: dynRule })
      .then(function(s){ out.set = s; return out; }, function(ex){ out.setError = ex.message || "动态分组创建失败"; return out; });
  }).then(function(out){
    pbf.busy = false;
    UI.closeModal($("dlgPlanByFilter"));
    var r = out.res, name = (out.plan && out.plan.name) || newName || "测试计划";
    var msg = (creating ? "已新建计划「" + name + "」并加入 " : "已向计划「" + name + "」加入 ") + (r.added || 0) + " 条用例";
    if(r.already) msg += "（跳过 " + r.already + " 条已在计划中）";
    if(required) msg += "，标记为发布必测";
    if(out.set) msg += "；同时创建团队共享动态分组「" + dynName + "」（收录 " + ((out.set.caseCount || 0)) + " 条）";
    var pid = out.pid, reqId = caseReqId;
    UI.toastAction(msg, "查看计划", function(){ openPlanInProject(reqId, pid); }, "fs");
    if(out.setError) toast("用例已加入计划，但动态分组「" + dynName + "」创建失败：" + out.setError, "warn");
    clearCaseSel();
    if(out.set) afterStructureChange();
    else loadCases();
    if(tcMode === "plans") loadPlans();
  }).catch(function(ex){
    pbf.busy = false;
    syncPbfAddBtn();
    toast(ex.message || "加入计划失败", "bad");
  });
}

/* ---------- 事件 ---------- */

$("tcReq").addEventListener("change", function(){
  var v = $("tcReq").value;
  /* 目录与分组都是项目内结构：切项目后缓存、搜索词与展开态一并作废 */
  caseSetsReq = null;
  caseSets = [];
  caseSetsError = "";
  caseDirQuery = "";
  caseDirOpen = {};
  if(v === CASE_ALL_KEY){
    /* 覆盖矩阵/报告的项目下拉不提供全部，切回时必须仍是具体项目 */
    if(tcMode !== "cases" && tcMode !== "plans"){ syncReqSel(); return; }
    caseScopeAll = true;
    moduleFilter = "all";
    demandFilter = "all";
    setFilter = "all";
    caseGroupBy = "";
  }else{
    caseScopeAll = false;
    caseReqId = v;
    /* 目录节点 / 分组 / 需求都是项目内结构，切项目后条件不能带过去 */
    moduleFilter = "all";
    demandFilter = "all";
    setFilter = "all";
    caseSide = "set";
  }
  caseSetQuery = "";
  caseSetNoneTotal = 0;
  if(UI.popOpen($("tcDirMenu"))) UI.closeAllPops();
  syncModeUI();
  if(tcMode === "coverage") loadCoverage();
  else if(tcMode === "report") loadTestReport();
  else if(tcMode === "plans") loadPlans();
  else loadCases();
});
if($("tcDomain")){
  $("tcDomain").addEventListener("click", function(e){
    var b = e.target.closest("[data-tc-domain]");
    if(!b) return;
    var to = b.dataset.tcDomain;
    if(to === "testcases") return;
    if(to === "projects"){ showView("projects"); return; }
    var reqId = tcDomainScopeId();
    if(to === "project"){
      if(reqId){ rt.managerProjectId = reqId; showView("project"); }
      else showView("projects");
      return;
    }
    if(to === "board" && reqId){
      state.reqs = [reqId];
      showView("board");
      reloadFilteredViews();
      return;
    }
    showView(to);
  });
}
$("tcModeSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-tc-mode]");
  if(!b) return;
  setTcMode(b.dataset.tcMode);
});
["tcPri", "tcOwner"].forEach(function(id){
  $(id).addEventListener("change", function(){
    priFilter = $("tcPri").value;
    ownerFilter = $("tcOwner").value;
    loadCases();
  });
});
$("tcBug").addEventListener("click", function(){
  bugOnly = !bugOnly;
  loadCases();
});
/* 目录是否含子节点由左树底部的开关控制，作用于当前目录 */
if($("tcSearchScope")){
  $("tcSearchScope").addEventListener("change", function(){
    var wide = this.value === "all";
    if(wide === caseSearchWide) return;
    caseSearchWide = wide;
    if(searchText){ loadCases(); return; }
    syncFilterOptions(); syncQueryBar();
    toast(caseSearchWide ? "搜索已包含前置、测试数据与步骤（大字段，较慢）" : "搜索已收敛为标题 / 编号 / 模块", "fs");
  });
}
/* 查询条：排序 / 分组 / 每页 / 全选筛选结果 */
if($("tcSort")) $("tcSort").addEventListener("change", function(){
  caseSort = this.value;
  /* 手动排序是「从上到下的顺序」，切过来默认升序，符合刚拖完的直觉 */
  if(caseSort === "manual" && caseSortDir !== "asc"){ caseSortDir = "asc"; }
  loadCases();
});
if($("tcSortDir")){
  $("tcSortDir").addEventListener("click", function(){
    caseSortDir = caseSortDir === "asc" ? "desc" : "asc";
    loadCases();
  });
}
if($("tcGroupBy")){
  $("tcGroupBy").addEventListener("change", function(){
    caseGroupBy = caseScopeAll ? "" : this.value;
    loadCases();
  });
}
if($("tcPageSize")){
  $("tcPageSize").addEventListener("change", function(){
    casePageSize = Number(this.value) || 100;
    loadCases();
  });
}
if($("tcGrpToggleAll")) $("tcGrpToggleAll").addEventListener("click", function(){ collapseAllSegments(anySegmentExpanded()); });
if($("tcSelFiltered")) $("tcSelFiltered").addEventListener("click", selectAllFiltered);
if($("tcPanelBtn")) $("tcPanelBtn").addEventListener("click", function(){ toggleSidePanel(!caseSide); });
var tcFilterBtn = $("tcFilterBtn"), tcFilterBar = $("tcFilterBar");
if(tcFilterBtn && tcFilterBar){
  tcFilterBtn.addEventListener("click", function(){
    var open = !tcFilterBar.classList.contains("is-open");
    tcFilterBar.classList.toggle("is-open", open);
    tcFilterBtn.setAttribute("aria-expanded", String(open));
  });
}
/* 输入框以 searchText 为准：浏览器回填的值若与应用状态不一致，直接纠正 */
function reconcileTcSearchInput(){
  var el = $("tcSearch");
  if(el && el.value !== searchText && el !== document.activeElement) el.value = searchText;
}
window.addEventListener("pageshow", reconcileTcSearchInput);
window.addEventListener("focus", reconcileTcSearchInput);
[0, 300, 1000, 2000, 4000].forEach(function(ms){ setTimeout(reconcileTcSearchInput, ms); });
var tcSearchWatch = setInterval(reconcileTcSearchInput, 1000);
setTimeout(function(){ clearInterval(tcSearchWatch); }, 30000);
$("tcSearch").addEventListener("input", function(){
  var value = this.value.trim().toLowerCase();
  if(value === searchText) return;
  searchText = value;
  if(caseSearchTimer) clearTimeout(caseSearchTimer);
  caseSearchTimer = setTimeout(function(){
    caseSearchTimer = null;
    loadCases();
  }, 300);
});
$("tcStats").addEventListener("click", function(e){
  var b = e.target.closest("[data-tc-status]");
  if(!b) return;
  statusFilter = b.dataset.tcStatus;
  loadCases();
});
if($("tcClearFilter")){
  $("tcClearFilter").addEventListener("click", function(){
    var had = caseFilterCount();
    if(caseSearchTimer){ clearTimeout(caseSearchTimer); caseSearchTimer = null; }
    searchText = "";
    statusFilter = "all";
    moduleFilter = "all";
    caseModuleSub = false;
    priFilter = "all";
    ownerFilter = "all";
    demandFilter = "all";
    setFilter = "all";
    bugOnly = false;
    caseSearchWide = false;
    if($("tcSearch")) $("tcSearch").value = "";
    syncFilterOptions();
    loadCases();
    if(had) toast(caseScopeAll ? "已清空用例筛选" : "已清空用例筛选，保留当前项目", "fs");
  });
}
/* 缺陷 tab：筛选在前端派生（状态由列与回归结果计算），数据仍走任务列表 */
if($("tcDefReq")){
  $("tcDefReq").addEventListener("change", function(){
    defReqId = $("tcDefReq").value;
    defectShown = DEFECT_PAGE;
    syncTcDomain();
    loadDefects();
  });
}
$("tcDefSearch").addEventListener("input", function(){
  var value = this.value.trim().toLowerCase();
  if(value === defSearch) return;
  defSearch = value;
  defectShown = DEFECT_PAGE;
  if(defSearchTimer) clearTimeout(defSearchTimer);
  defSearchTimer = setTimeout(function(){
    defSearchTimer = null;
    renderDefects();
  }, 300);
});
["tcDefSeverity", "tcDefPriority", "tcDefStatus", "tcDefOwner", "tcDefVersion", "tcDefPub", "tcDefCat", "tcDefTag"].forEach(function(id){
  $(id).addEventListener("change", function(){
    defSeverity = $("tcDefSeverity").value;
    defPriority = $("tcDefPriority").value;
    defStatus = $("tcDefStatus").value;
    defOwner = $("tcDefOwner").value;
    defVersion = $("tcDefVersion").value;
    defPub = $("tcDefPub").value;
    defCat = $("tcDefCat").value;
    defTag = $("tcDefTag").value;
    defectShown = DEFECT_PAGE;
    renderDefects();
  });
});
$("tcDefReset").addEventListener("click", resetDefectFilters);
if($("tcDefViewsBtn") && defViewsMenuEl){
  $("tcDefViewsBtn").addEventListener("click", function(){
    if(UI.popOpen(defViewsMenuEl)){ UI.closeAllPops(); return; }
    renderDefectViewsMenu();
    UI.openPop(defViewsMenuEl, $("tcDefViewsBtn"), { align: "right", width: 260 });
    loadViews().then(renderDefectViewsMenu);
  });
  defViewsMenuEl.addEventListener("click", function(e){
    var ap = e.target.closest("[data-tc-def-view]");
    if(ap){
      for(var i = 0; i < rt.savedViews.length; i++){
        if(String(rt.savedViews[i].id) === String(ap.dataset.tcDefView)){
          applyDefectView(rt.savedViews[i]);
          UI.closeAllPops();
          return;
        }
      }
      return;
    }
    var dl = e.target.closest("[data-tc-def-view-del]");
    if(dl){ deleteDefectView(dl.dataset.tcDefViewDel); return; }
    if(e.target.closest("[data-tc-def-view-save]")){ UI.closeAllPops(); saveDefectView(); }
  });
}
/* 全部项目范围下写操作必须先落到一个具体项目，不能让缺陷静默建到第一个项目 */
function openDefectCreate(){
  var targets = defectCreateTargets();
  if(!targets.length){ toast("当前范围没有可写项目", "warn"); return; }
  if(targets.length === 1){
    openTaskDrawer("backlog", null, { reqId: targets[0], itemType: "bug" });
    return;
  }
  var btn = $("btnDefectNew");
  var el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = '<div class="menu-title">新建缺陷到</div>'
    + targets.map(function(id){
      return '<button class="menu-item" type="button" data-def-target="' + esc(id) + '">'
        + '<span>' + esc(reqNameOf(id)) + '</span></button>';
    }).join("");
  el.addEventListener("click", function(e){
    var b = e.target.closest("[data-def-target]");
    if(!b) return;
    var id = b.getAttribute("data-def-target");
    UI.closeAllPops();
    openTaskDrawer("backlog", null, { reqId: id, itemType: "bug" });
  });
  UI.openPop(el, btn, { align: "right", width: 240, onClose: function(){ el.remove(); } });
}
$("btnDefectNew").addEventListener("click", openDefectCreate);
$("tcDefRows").addEventListener("click", function(e){
  var more = e.target.closest("[data-tc-def-more]");
  if(more){
    defectShown += DEFECT_PAGE;
    renderDefects();
    return;
  }
  var caseChip = e.target.closest("[data-tc-def-case]");
  if(caseChip){
    e.stopPropagation();
    openCaseInProject(caseChip.dataset.tcDefCaseReq, caseChip.dataset.tcDefCase);
    return;
  }
  var row = e.target.closest("[data-tc-defect]");
  if(row) openDefectDrawer(row.dataset.tcDefect);
});
$("tcDefRows").addEventListener("keydown", function(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  if(e.target.closest("[data-tc-def-case]")) return;
  var row = e.target.closest("[data-tc-defect]");
  if(!row) return;
  e.preventDefault();
  openDefectDrawer(row.dataset.tcDefect);
});
/* 工作项抽屉保存后刷新：回归状态、列变化会直接改变缺陷的关闭口径 */
window.addEventListener("ds:task-saved", function(){
  if(document.body.dataset.view === "testcases" && tcMode === "defects") loadDefects();
});
/* 用例 / 计划 / 矩阵 / 报告的关系与分页口径：放在问号弹层里，避免占用工具栏 */
var tcHelpBtn = $("tcHelp"), tcHelpPop = null;
function tcHelpHTML(){
  function row(tag, text){
    return '<div class="type-help-row"><span class="mini-tag">' + tag + '</span>' +
      '<span class="type-help-desc">' + text + '</span></div>';
  }
  return '<div class="menu-title">测试模块使用说明</div>' +
    '<div class="type-help-list">' +
      row("用例", "最小验证单元，挂在项目下；记录步骤与预期，最新一次执行结果（未执行/通过/失败/阻塞）决定统计口径。项目范围可切「全部项目」：按项目分组逐段加载，段内翻页；目录筛选、分组显示与拖拽归类只在单个项目下提供。") +
      row("目录 / 分组", "项目目录是单归属：一个用例只属一个节点（层级不限、只禁止成环），拖到节点＝移动归属，计数不重叠并进覆盖矩阵。分组是多归属：拖到分组＝加入，原分组保留，删分组不删用例；动态分组按规则自动收录（可一键存成回归集），成员不能手工增删。可见范围分团队共享 / 指定成员 / 仅自己可见，只有团队共享分组进交付说明与发布证据。") +
      row("查询", "排序字段与升降序、每页 50/100/200 条、按维度分组显示（段头带计数与结果分布，可折叠、可段内翻页、可整组全选）。统计条上的执行结果计数可直接点按筛选，计数始终是全项目口径、不随当前筛选变化。「全选筛选结果」按条件生效、含未加载的行；明确勾选只覆盖已加载的行。搜索默认只匹配标题 / 编号 / 模块，勾选「含步骤与前置」才搜大字段（较慢）。") +
      row("缺陷", "按缺陷（工作项类型=缺陷）逐行汇总当前项目范围，可切换「全部项目」或单个项目；默认只看未关闭并按严重度排序，跨项目时每行标明所属项目。待修复、修复中、待回归都算未关闭，进入完成列且回归通过才算关闭。") +
      row("测试计划", "从用例库圈选一批组成一轮测试：在计划详情里逐条勾选，或在用例页按筛选整批加入（一次最多 2000 条，已在计划内的自动跳过）。批量记录结果时同时写回用例最近结果并追加执行流水，按版本留痕，完成后锁定为快照。项目范围同样支持全部/单选，全部项目下按项目分组，新建计划需先选一个项目。") +
      row("覆盖矩阵", "按需求统计用例覆盖：哪些需求已有用例、覆盖多少、通过率如何；按项目全量计算，不受用例列表分页影响。只提供单个项目，不汇总跨项目。") +
      row("测试报告", "当前项目的通过率、失败/阻塞清单与覆盖汇总，可导出 CSV。只提供单个项目，不汇总跨项目。") +
    '</div>' +
    '<p class="foot-note tc-help-note">分页与批量口径：单个项目按 offset/limit 加载（每页 50 / 100 / 200 条可选，点「加载更多」继续）；分组显示下按段分页，每段一次取 ' + GROUP_PAGE + ' 条、首屏显示 ' + GROUP_SHOW + ' 条。全部项目按项目分组各自分页，不合并排序。明确勾选最多 200 条；「全选筛选结果」按条件生效、含未加载的行，一次最多 2000 条，其中取消勾选最多 500 条。覆盖矩阵与测试报告按项目全量统计，不受列表分页影响。动态分组一次最多收录 2000 条，指定成员名单最多 50 人（创建人始终可见、不占名额）。</p>';
}
if(tcHelpBtn){
  tcHelpBtn.innerHTML = icon("alertCircle", 13);
  tcHelpBtn.addEventListener("click", function(){
    if(UI.popOpen(tcHelpPop)){ UI.closeAllPops(); return; }
    var el = document.createElement("div");
    el.className = "menu tc-help-pop";
    el.innerHTML = tcHelpHTML();
    tcHelpPop = el;
    UI.openPop(el, tcHelpBtn, { align:"left", width:420, onClose:function(){ el.remove(); tcHelpPop = null; } });
  });
}
var tcViewsBtn = $("tcViewsBtn");
if(tcViewsBtn && tcViewsMenuEl){
  tcViewsBtn.addEventListener("click", function(){
    if(UI.popOpen(tcViewsMenuEl)){ UI.closeAllPops(); return; }
    renderTcViewsMenu();
    UI.openPop(tcViewsMenuEl, tcViewsBtn, { align: "right", width: 260 });
    loadViews().then(renderTcViewsMenu);
  });
  tcViewsMenuEl.addEventListener("click", function(e){
    var ap = e.target.closest("[data-tc-view]");
    if(ap){
      for(var i = 0; i < rt.savedViews.length; i++){
        if(String(rt.savedViews[i].id) === String(ap.dataset.tcView)){
          applyTcView(rt.savedViews[i]);
          UI.closeAllPops();
          return;
        }
      }
      return;
    }
    var dl = e.target.closest("[data-tc-view-del]");
    if(dl){ deleteTcView(dl.dataset.tcViewDel); return; }
    if(e.target.closest("[data-tc-view-save]")){ UI.closeAllPops(); saveTcView(); }
  });
}
$("btnCaseNew").addEventListener("click", openCaseCreate);

/* AI 生成用例：来源选择 → 进度层 → 草稿勾选 */
if($("btnCaseAi")) $("btnCaseAi").addEventListener("click", function(){ openAiCaseSource(false); });
$("aiCaseSourceSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-ai-src]");
  if(!b) return;
  aiCaseSource = b.dataset.aiSrc;
  syncAiCaseSource();
  var sel = aiCaseSource === "doc" ? $("aiCaseDocSel") : $("aiCaseDemandSel");
  if(sel) sel.focus();
});
$("dlgAiCaseSourceX").addEventListener("click", function(){ UI.closeModal($("dlgAiCaseSource")); });
$("btnAiCaseGenerate").addEventListener("click", generateAiCases);
$("dlgAiCaseResultCancel").addEventListener("click", function(){ UI.closeModal($("dlgAiCaseResult")); });
$("dlgAiCaseResultX").addEventListener("click", function(){ UI.closeModal($("dlgAiCaseResult")); });
$("dlgAiCaseResultOk").addEventListener("click", applyAiCases);
$("aiCaseList").addEventListener("change", function(e){
  var cb = e.target;
  if(!cb || cb.type !== "checkbox") return;
  var item = cb.closest(".ai-item");
  if(item) item.classList.toggle("on", cb.checked);
});
UI.setModalCloseGuard($("dlgAiCaseResult"), function(){
  if(aiCaseApplying) return;
  UI.closeModal($("dlgAiCaseResult"));
});

/* 用例导入导出：导出走服务端（Excel 含表头样式），导入读文件后 Excel 以 base64、CSV 以文本提交；
   导入模板放在「导入」菜单里，作为导入的前置动作 */
var tcExportBtn = $("btnCaseCsvOut"), tcExportMenu = $("tcExportMenu");
if(tcExportBtn && tcExportMenu){
  tcExportBtn.addEventListener("click", function(){
    if(UI.popOpen(tcExportMenu)){ UI.closeAllPops(); return; }
    renderExportMenu();
    UI.openPop(tcExportMenu, tcExportBtn, { align: "right", width: 268 });
  });
  tcExportMenu.addEventListener("click", function(e){
    var fb = e.target.closest("[data-tc-export-fmt]");
    if(fb){
      tcExportFmt = fb.dataset.tcExportFmt === "csv" ? "csv" : "xlsx";
      try{ localStorage.setItem(TC_EXPORT_FMT_KEY, tcExportFmt); }catch(err){}
      renderExportMenu();
      return;
    }
    var b = e.target.closest("[data-tc-export]");
    if(!b) return;
    UI.closeAllPops();
    exportCases(b.dataset.tcExport);
  });
}
$("btnCaseCsvIn").addEventListener("click", function(){
  var menu = $("tcImportMenu");
  if(!menu) return;
  if(UI.popOpen(menu)){ UI.closeAllPops(); return; }
  renderImportMenu();
  UI.openPop(menu, this, { align: "right", width: 268 });
});
$("tcImportMenu").addEventListener("click", function(e){
  var tpl = e.target.closest("[data-tc-template]");
  if(tpl){
    UI.closeAllPops();
    var fmt = tpl.dataset.tcTemplate === "csv" ? "csv" : "xlsx";
    downloadCasesFile("/api/test-cases/template." + fmt, {}, "测试用例导入模板." + fmt);
    return;
  }
  if(!e.target.closest("[data-tc-import]")) return;
  UI.closeAllPops();
  $("tcCsvFile").click();
});
$("tcCsvFile").addEventListener("change", function(){
  var f = this.files && this.files[0];
  this.value = "";
  if(f) importCasesFile(f);
});

/* 测试计划：列表 → 详情 → 批量执行 */
$("btnPlanNew").addEventListener("click", openPlanCreate);
if($("tcPlanSearch")){
  $("tcPlanSearch").addEventListener("input", function(){
    var value = this.value.trim().toLowerCase();
    if(value === planSearch) return;
    planSearch = value;
    syncPlanBar();
    if(planSearchTimer) clearTimeout(planSearchTimer);
    planSearchTimer = setTimeout(function(){
      planSearchTimer = null;
      renderPlans();
    }, 300);
  });
}
if($("tcPlanStatus")){
  $("tcPlanStatus").addEventListener("change", function(){
    planStatus = this.value;
    syncPlanBar();
    renderPlans();
  });
}
if($("tcPlanClearFilter")) $("tcPlanClearFilter").addEventListener("click", clearPlanFilters);
$("tcPlans").addEventListener("click", function(e){
  var b;
  if((b = e.target.closest("[data-plan-back]"))){
    planDetailSeq++; planDetail = null; renderPlans(); refreshPlansQuiet(); return;
  }
  if((b = e.target.closest("[data-plan-edit]"))){ openPlanDialog(b.dataset.planEdit); return; }
  if((b = e.target.closest("[data-plan-del]"))){ deletePlan(b.dataset.planDel); return; }
  if((b = e.target.closest("[data-plan-status]"))){ planStatusTo(b.dataset.planStatus); return; }
  if((b = e.target.closest("[data-plan-pick]"))){ openPlanPick(); return; }
  if((b = e.target.closest("[data-plan-pick-status]"))){
    var st = b.dataset.planPickStatus;
    planSel = {};
    (planDetail && planDetail.cases || []).forEach(function(c){
      var r = c.result || "";
      if((st === "none" && !r) || (st === "failed" && r === "failed") || (st === "blocked" && r === "blocked")
        || (st === "skipped" && r === "skipped")){
        planSel[c.caseId] = true;
      }
    });
    syncPlanSelUI();
    return;
  }
  if(e.target.closest("[data-plan-clear]")){ planSel = {}; syncPlanSelUI(); return; }
  if((b = e.target.closest("[data-plan-runs]"))){ doPlanBatchRun(); return; }
  if((b = e.target.closest("[data-plan-csv]"))){ exportPlanCsv(); return; }
  if((b = e.target.closest("[data-pbatch]"))){
    planBatchStatus = b.dataset.pbatch;
    document.querySelectorAll("[data-pbatch]").forEach(function(x){
      x.setAttribute("aria-pressed", x.dataset.pbatch === planBatchStatus ? "true" : "false");
    });
    return;
  }
  if((b = e.target.closest("[data-plan-req]"))){
    togglePlanRequired(b.dataset.planReq, b.dataset.required !== "1");
    return;
  }
  if((b = e.target.closest("[data-plan-rm]"))){
    var planId = planDetail && planDetail.plan.id;
    API.del("/api/test-plans/" + encodeURIComponent(planId) + "/cases/" + encodeURIComponent(b.dataset.planRm))
      .then(function(){ toast("已移出计划（用例本身保留）", "fs"); openPlanDetail(planId); })
      .catch(function(ex){ toast(ex.message || "移出失败", "bad"); });
    return;
  }
  if((b = e.target.closest("[data-plan-open]"))){
    openPlanDetail(b.dataset.planOpen);
  }
});
$("tcPlans").addEventListener("change", function(e){
  if(e.target.closest("[data-plan-select-all]")){
    var allOn = e.target.checked;
    planSel = {};
    if(allOn) (planDetail && planDetail.cases || []).forEach(function(c){ planSel[c.caseId] = true; });
    syncPlanSelUI();
    return;
  }
  var c = e.target.closest("[data-pcase]");
  if(!c) return;
  planSel[c.dataset.pcase] = c.checked;
  if(!c.checked) delete planSel[c.dataset.pcase];
  syncPlanSelUI();
});
$("btnSavePlan").addEventListener("click", savePlan);
$("pName").addEventListener("input", function(){ $("fPlanName").classList.remove("invalid"); });
$("dlgPlanX").addEventListener("click", function(){ UI.closeModal($("dlgPlan")); });
UI.setModalSubmit($("dlgPlan"), function(){ if(!planSaving) savePlan(); });
$("dlgPlanPickX").addEventListener("click", function(){ UI.closeModal($("dlgPlanPick")); });
$("btnDoPlanPick").addEventListener("click", doPlanPick);
$("planPickList").addEventListener("change", function(e){
  var box = e.target.closest("[data-pick-case]");
  if(!box) return;
  if(box.checked) planPickSel[box.dataset.pickCase] = true;
  else delete planPickSel[box.dataset.pickCase];
  syncPickCount();
});
if($("planPickDemand")) $("planPickDemand").addEventListener("change", function(){
  planPickDemand = this.value || "";
  renderPlanPickList();
});
if($("btnPlanPickDemandAll")) $("btnPlanPickDemandAll").addEventListener("click", function(){
  if(!planPickDemand){ toast("先选择一个需求", "warn"); return; }
  planPickVisibleCases().forEach(function(c){ planPickSel[c.id] = true; });
  renderPlanPickList();
});
$("btnPlanPickAll").addEventListener("click", function(){
  var list = planPickVisibleCases();
  var allOn = list.length > 0 && list.every(function(c){ return !!planPickSel[c.id]; });
  list.forEach(function(c){
    if(allOn) delete planPickSel[c.id];
    else planPickSel[c.id] = true;
  });
  renderPlanPickList();
});
UI.setModalSubmit($("dlgPlanPick"), function(){ if(!pickingPlan) doPlanPick(); });
$("tcList").addEventListener("click", function(e){
  var segToggle = e.target.closest("[data-tc-seg-toggle]");
  if(segToggle){ toggleSegment(segToggle.dataset.tcSegToggle); return; }
  var segMore = e.target.closest("[data-tc-seg-more]");
  if(segMore){ moreSegmentRows(segMore.dataset.tcSegMore); return; }
  var segSel = e.target.closest("[data-tc-seg-sel]");
  if(segSel){ selectSegment(segSel.dataset.tcSegSel); return; }
  var segRetry = e.target.closest("[data-tc-seg-retry]");
  if(segRetry){ loadSegmentRows(segRetry.dataset.tcSegRetry, false); return; }
  var segHead = e.target.closest("[data-tc-seg]");
  if(segHead && !e.target.closest("button")){ toggleSegment(segHead.dataset.tcSeg); return; }
  var menuBtn = e.target.closest("[data-tc-menu]");
  if(menuBtn){
    var panel = menuBtn.parentNode.querySelector("[data-tc-menu-panel]");
    var willOpen = !!(panel && panel.hidden);
    closeCaseRowMenus();
    if(willOpen){
      panel.hidden = false;
      menuBtn.setAttribute("aria-expanded", "true");
    }
    return;
  }
  var pick = e.target.closest("[data-tc-pick]");
  if(pick){ toggleCaseSel(pick.dataset.tcPick, pick.checked, pick.dataset.tcPickSeg || null); return; }
  var more = e.target.closest("[data-tc-more]");
  if(more){ loadMoreCases(more.dataset.tcMore || null); return; }
  var runs = e.target.closest("[data-tc-runs]");
  if(runs){ openRunsDialog(runs.dataset.tcRuns); return; }
  var run = e.target.closest("[data-tc-run]");
  if(run){ openRunDialog(run.dataset.tcRun); return; }
  var def = e.target.closest("[data-tc-defect]");
  if(def){ openDefectDialog(def.dataset.tcDefect); return; }
  var bug = e.target.closest("[data-tc-bug]");
  if(bug){
    var cb = caseById(bug.dataset.tcBug);
    if(cb && cb.latestBugTaskId) openTaskById(cb.latestBugTaskId);
    else toast("未找到关联缺陷，可能已被删除", "warn");
    return;
  }
  var edit = e.target.closest("[data-tc-edit]");
  if(edit){ openEditDialog(edit.dataset.tcEdit); return; }
  var del = e.target.closest("[data-tc-del]");
  if(del){ removeCase(del.dataset.tcDel); return; }
  var open = e.target.closest("[data-tc-open]");
  if(open && !e.target.closest(".tc-acts")) openCaseDetail(open.dataset.tcOpen);
});
/* 行内 ⋯ 菜单：一次只开一个，点外部或按 Esc 收起 */
function closeCaseRowMenus(except){
  Array.prototype.forEach.call(document.querySelectorAll("[data-tc-menu-panel]"), function(p){
    if(p === except) return;
    p.hidden = true;
    var b = p.parentNode.querySelector("[data-tc-menu]");
    if(b) b.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", function(e){
  if(e.target.closest("[data-tc-menu]")) return;
  closeCaseRowMenus();
});
document.addEventListener("keydown", function(e){
  if(e.key === "Escape") closeCaseRowMenus();
});
$("tcBulkAll").addEventListener("change", function(){
  var all = caseWritableLoaded();
  if(this.checked){
    if(caseSelAll){ syncBulkBar(); return; }
    var hitCap = all.length > 200;
    caseSel = {};
    (hitCap ? all.slice(0, 200) : all).forEach(function(c){ caseSel[c.id] = true; });
    if(hitCap) toast("单次最多勾选 200 条；要覆盖未加载的行请用「全选筛选结果」", "warn");
  }else{
    resetCaseSel();
  }
  syncBulkBar();
});
$("btnTcBatchClear").addEventListener("click", function(){ clearCaseSel(); render(); });
$("btnTcBatchEdit").addEventListener("click", function(){ openBatchDialog("module"); });
$("btnTcBatchPri").addEventListener("click", function(){ openBatchDialog("pri"); });
$("btnTcBatchDel").addEventListener("click", batchDeleteCases);
$("btnBatchSave").addEventListener("click", saveBatchEdit);
$("dlgCaseBatchX").addEventListener("click", function(){ UI.closeModal($("dlgCaseBatch")); });
UI.setModalCloseGuard($("dlgCaseBatch"), function(){ UI.closeModal($("dlgCaseBatch")); });
UI.setModalSubmit($("dlgCaseBatch"), function(){ saveBatchEdit(); });
$("btnTcBatchSet").addEventListener("click", openSetPick);
$("btnTcBatchUnset").addEventListener("click", function(){ leaveSet(this.dataset.setId); });
$("btnTcBatchPlan").addEventListener("click", openPlanByFilter);
$("btnTcBatchExport").addEventListener("click", function(){ exportCases("ids"); });

/* 分组口径条在列表上方（不在侧栏里），编辑入口单独委托一次 */
if($("tcSetDetail")){
  $("tcSetDetail").addEventListener("click", function(e){
    var b = e.target.closest("[data-tc-set-edit]");
    if(b) openSetDialog(b.dataset.tcSetEdit);
  });
}

/* 左侧分组面板：内容每次重渲染，点击与搜索都走委托，不用重新绑定 */
if($("tcSidePanel")){
  $("tcSidePanel").addEventListener("click", function(e){
    var b;
    if((b = e.target.closest("[data-tc-set-new]"))){ openSetDialog(null); return; }
    if((b = e.target.closest("[data-tc-set-toggle]"))){
      caseSetOpen[b.dataset.tcSetToggle] = !setNodeOpen({ id: b.dataset.tcSetToggle });
      renderSetPanel();
      return;
    }
    if((b = e.target.closest("[data-tc-set-add]"))){ openSetDialog(null, b.dataset.tcSetAdd); return; }
    if((b = e.target.closest("[data-tc-set-pick]"))){ pickSetNode(b.dataset.tcSetPick); return; }
    if((b = e.target.closest("[data-tc-set-edit]"))){ openSetDialog(b.dataset.tcSetEdit); return; }
    if((b = e.target.closest("[data-tc-set-del]"))){ deleteCaseSet(b.dataset.tcSetDel); return; }
    if((b = e.target.closest("[data-tc-set-retry]"))){ loadCaseSets(true); return; }
    if(e.target.closest("#tcSetSub")){ caseSetSub = !caseSetSub; renderSetPanel(); loadCases(); return; }
  });
  $("tcSidePanel").addEventListener("input", function(e){
    if(e.target.id === "tcSetSearch"){ caseSetQuery = e.target.value; renderSetPanel(); }
  });
  /* 右键分组行＝对该分组新建子组 / 编辑 / 删除；右键空白处＝新建顶级分组 */
  $("tcSidePanel").addEventListener("contextmenu", function(e){
    var row = e.target.closest("[data-tc-set]");
    if(row){
      if(openTcSetCtx(e.clientX, e.clientY, row.dataset.tcSet)) e.preventDefault();
      return;
    }
    if(e.target.closest("#tcSideBody") && isWritable()){
      if(openTcSetCtx(e.clientX, e.clientY, "")) e.preventDefault();
    }
  });
  document.addEventListener("click", function(e){
    if(tcSetCtxEl && tcSetCtxEl.classList.contains("open") && !e.target.closest(".tc-ctx")) closeTcSetCtx();
  });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && tcSetCtxEl && tcSetCtxEl.classList.contains("open")) closeTcSetCtx();
  });
  window.addEventListener("scroll", function(){
    if(tcSetCtxEl && tcSetCtxEl.classList.contains("open")) closeTcSetCtx();
  }, true);
}
/* 顶部目录弹层：筛选 + 目录维护。拖目录节点仍可改父级 / 同级排序 */
if($("tcDirBtn") && $("tcDirMenu")){
  var tcDirMenuEl = $("tcDirMenu");
  $("tcDirBtn").addEventListener("click", function(){
    if(UI.popOpen(tcDirMenuEl)){ UI.closeAllPops(); syncDirBtn(); return; }
    caseDirQuery = "";
    renderDirPanel();
    UI.openPop(tcDirMenuEl, $("tcDirBtn"), { align: "left", width: 300, onClose: syncDirBtn });
    syncDirBtn();
  });
  tcDirMenuEl.addEventListener("click", function(e){
    var b;
    if((b = e.target.closest("[data-tc-dir-toggle]"))){
      caseDirOpen[b.dataset.tcDirToggle] = !dirNodeOpen({ id: b.dataset.tcDirToggle });
      renderDirList();
      return;
    }
    if((b = e.target.closest("[data-tc-dir-pick]"))){ pickDirNode(b.dataset.tcDirPick); return; }
    if((b = e.target.closest("[data-tc-dir-new]"))){ createModuleNode(""); return; }
    if((b = e.target.closest("[data-tc-dir-add]"))){ createModuleNode(b.dataset.tcDirAdd); return; }
    if((b = e.target.closest("[data-tc-dir-edit]"))){ renameModuleNode(b.dataset.tcDirEdit); return; }
    if((b = e.target.closest("[data-tc-dir-del]"))){ deleteModuleNode(b.dataset.tcDirDel); return; }
    if(e.target.closest("#tcDirSub")){ caseModuleSub = !caseModuleSub; loadCases(); return; }
  });
  tcDirMenuEl.addEventListener("input", function(e){
    if(e.target.id === "tcDirSearch"){ caseDirQuery = e.target.value; renderDirList(); }
  });
}

/* ---------- 手动排序：拖动用例行改顺序 ----------
   只在「列表口径与排序接口完全一致」时开放：单项目、不分组、无其它筛选、单层目录且已加载完；
   否则服务端校验会因范围不一致拒绝，先在界面上把不可排序的原因说清楚。 */
function manualOrderScope(){
  if(tcMode !== "cases" || caseScopeAll || caseSort !== "manual" || caseGroupBy) return null;
  if(!caseReqId) return null;
  if(statusFilter !== "all" || priFilter !== "all" || ownerFilter !== "all"
      || demandFilter !== "all" || setFilter !== "all" || bugOnly || searchText) return null;
  if(moduleFilter !== "all" && moduleFilter !== "__none" && caseModuleSub) return null;
  if(cases.length < caseTotal) return null;
  return { reqId: caseReqId, moduleId: moduleFilter === "all" ? "" : moduleFilter };
}
function dragOverOrder(e){
  var row = e.target && e.target.closest ? e.target.closest("[data-tc-order-row]") : null;
  if(!row || row.dataset.tcOrderRow === caseOrderDrag.id){
    clearStructDropTarget();
    caseOrderDrag.target = "";
    caseOrderDrag.action = "";
    syncDropBanner();
    return;
  }
  e.preventDefault();
  try{ e.dataTransfer.dropEffect = "move"; }catch(err){ /* 同上 */ }
  var r = row.getBoundingClientRect();
  var zone = (e.clientY - r.top) > r.height / 2 ? "after" : "before";
  var c = caseById(row.dataset.tcOrderRow);
  markStructDropTarget(row, zone);
  caseOrderDrag.target = c ? c.title : "";
  caseOrderDrag.action = zone === "after" ? "排到它后面" : "排到它前面";
  syncDropBanner();
}
function dropOrder(e){
  var drag = caseOrderDrag;
  caseOrderDrag = null;
  var row = e.target && e.target.closest ? e.target.closest("[data-tc-order-row]") : null;
  var zone = row && structDropEl === row ? structDropZone : "";
  clearStructDropTarget();
  syncDropBanner();
  if(!drag || !row || !zone || row.dataset.tcOrderRow === drag.id) return;
  var scope = manualOrderScope();
  if(!scope){ toast("当前筛选下不能手动排序，请清空筛选后再试", "warn"); return; }
  var ids = cases.map(function(c){ return c.id; }).filter(function(id){ return id !== drag.id; });
  var at = ids.indexOf(row.dataset.tcOrderRow);
  if(at < 0) return;
  ids.splice(zone === "after" ? at + 1 : at, 0, drag.id);
  reorderBusy = true;
  API.put("/api/test-cases/order", {
    reqId: scope.reqId, moduleId: scope.moduleId, moduleSub: false, ids: ids
  }).then(function(){
    reorderBusy = false;
    toast("用例顺序已更新", "fs");
    loadCases();
  }).catch(function(ex){
    reorderBusy = false;
    toast(ex.message || "调整顺序失败", "bad");
  });
}

/* 拖拽归类：用例行是拖动源，目录节点 / 分组项 / 分组段头是放置目标。
   语义随目标变化（目录＝移动、分组＝加入、优先级段＝改优先级），放置前一律先确认。 */
document.addEventListener("dragstart", function(e){
  var setEl = e.target && e.target.closest ? e.target.closest("[data-tc-set-drag]") : null;
  if(setEl && isWritable()){
    var s = setById(setEl.dataset.tcSetDrag);
    if(s && s.editable){
      caseSetDrag = { id: s.id, name: s.name, target: "", action: "" };
      try{
        e.dataTransfer.setData("text/plain", "set:" + s.id);
        e.dataTransfer.effectAllowed = "move";
      }catch(err){ /* 同下 */ }
      syncDropBanner();
      return;
    }
  }
  var dirEl = e.target && e.target.closest ? e.target.closest("[data-tc-dir-drag]") : null;
  if(dirEl && isWritable()){
    var n = moduleNodeById(dirEl.dataset.tcDirDrag);
    if(n){
      caseDirDrag = { id: n.id, name: n.name, target: "", action: "" };
      try{
        e.dataTransfer.setData("text/plain", "dir:" + n.id);
        e.dataTransfer.effectAllowed = "move";
      }catch(err){ /* 同上 */ }
      syncDropBanner();
      return;
    }
  }
  var orderRow = e.target && e.target.closest ? e.target.closest("[data-tc-order-row]") : null;
  if(orderRow && manualOrderScope()){
    caseOrderDrag = { id: orderRow.dataset.tcOrderRow, target: "", action: "" };
    try{
      e.dataTransfer.setData("text/plain", orderRow.dataset.tcOrderRow);
      e.dataTransfer.effectAllowed = "move";
    }catch(err){ /* 同下 */ }
    syncDropBanner();
    return;
  }
  var row = e.target && e.target.closest ? e.target.closest("[data-tc-drag]") : null;
  if(!row || tcMode !== "cases" || caseScopeAll) return;
  var c = caseById(row.dataset.tcDrag);
  if(!c || !caseWritable(c)) return;
  var d = caseDragSelection(c);
  caseDrag = { anchor: c.id, selection: d.selection, count: d.count, title: c.title, target: "", action: "" };
  try{
    e.dataTransfer.setData("text/plain", c.id);
    e.dataTransfer.effectAllowed = "copyMove";
  }catch(err){ /* 个别浏览器不允许写 dataTransfer，不影响本次拖拽 */ }
  markDraggingRows(true);
  syncDropBanner();
});
document.addEventListener("dragend", function(){
  if(caseOrderDrag){
    caseOrderDrag = null;
    clearStructDropTarget();
    syncDropBanner();
    return;
  }
  if(caseSetDrag || caseDirDrag){
    caseSetDrag = null;
    caseDirDrag = null;
    clearStructDropTarget();
    syncDropBanner();
    return;
  }
  if(!caseDrag) return;
  caseDrag = null;
  clearDropTarget();
  markDraggingRows(false);
  syncDropBanner();
});
document.addEventListener("dragover", function(e){
  if(caseOrderDrag){ dragOverOrder(e); return; }
  if(caseSetDrag){ dragOverStruct(e, "set"); return; }
  if(caseDirDrag){ dragOverStruct(e, "dir"); return; }
  if(!caseDrag) return;
  var el = e.target && e.target.closest ? e.target.closest("[data-tc-dir],[data-tc-set],[data-tc-seg-drop]") : null;
  var t = dropTargetOf(el);
  if(!t){
    if(caseDropEl){ clearDropTarget(); caseDrag.target = ""; caseDrag.action = ""; syncDropBanner(); }
    return;
  }
  e.preventDefault();
  try{ e.dataTransfer.dropEffect = t.kind === "set" ? "copy" : "move"; }catch(err){ /* 同上 */ }
  setDropTarget(el, t.label, t.action);
});
document.addEventListener("drop", function(e){
  if(caseOrderDrag){
    e.preventDefault();
    dropOrder(e);
    return;
  }
  if(caseSetDrag || caseDirDrag){
    e.preventDefault();
    dropStruct(e, caseSetDrag ? "set" : "dir");
    return;
  }
  if(!caseDrag) return;
  var el = e.target && e.target.closest ? e.target.closest("[data-tc-dir],[data-tc-set],[data-tc-seg-drop]") : null;
  var t = dropTargetOf(el);
  if(!t) return;
  e.preventDefault();
  var drag = caseDrag;
  caseDrag = null;
  clearDropTarget();
  markDraggingRows(false);
  syncDropBanner();
  applyCaseDrop(t, drag);
});

/* 新建 / 编辑分组 */
$("dlgCaseSetX").addEventListener("click", function(){ UI.closeModal($("dlgCaseSet")); });
UI.setModalCloseGuard($("dlgCaseSet"), function(){ UI.closeModal($("dlgCaseSet")); });
UI.setModalSubmit($("dlgCaseSet"), function(){ saveCaseSet(); });
$("btnSaveCaseSet").addEventListener("click", saveCaseSet);
$("csName").addEventListener("input", function(){ if(this.value.trim()) $("fSetName").classList.remove("invalid"); });
Array.prototype.forEach.call(document.querySelectorAll('input[name="csVis"],input[name="csKind"]'), function(r){
  r.addEventListener("change", syncSetDialog);
});

/* 批量加入分组：选一个目标分组 */
$("dlgSetPickX").addEventListener("click", function(){ UI.closeModal($("dlgSetPick")); });
UI.setModalCloseGuard($("dlgSetPick"), function(){ UI.closeModal($("dlgSetPick")); });
UI.setModalSubmit($("dlgSetPick"), function(){ doSetPick(); });
$("setPickList").addEventListener("click", function(e){
  var b = e.target.closest("[data-set-pick]");
  if(!b || b.disabled) return;
  setPickSel = setPickSel === b.dataset.setPick ? "" : b.dataset.setPick;
  renderSetPickList();
  $("btnSetPickOk").disabled = !setPickSel;
});
$("btnSetPickNew").addEventListener("click", function(){ openSetDialog(null); });
$("btnSetPickOk").addEventListener("click", doSetPick);

/* 按筛选圈选入计划 */
$("dlgPlanByFilterX").addEventListener("click", function(){ UI.closeModal($("dlgPlanByFilter")); });
UI.setModalCloseGuard($("dlgPlanByFilter"), function(){ UI.closeModal($("dlgPlanByFilter")); });
UI.setModalSubmit($("dlgPlanByFilter"), function(){ doPbfAdd(); });
$("pbfPlan").addEventListener("change", refreshPbfSum);
$("pbfNewName").addEventListener("input", syncPbfAddBtn);
$("pbfDynamic").addEventListener("change", function(){
  syncPbfAddBtn();
  if(this.checked) setTimeout(function(){ $("pbfDynName").focus(); }, 30);
});
$("pbfDynName").addEventListener("input", syncPbfAddBtn);
$("btnPbfAdd").addEventListener("click", doPbfAdd);
$("btnCaseAddStep").addEventListener("click", function(){
  if(!editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  syncStepsFromDom();
  editingCase.steps.push({ action: "", expected: "" });
  renderStepRows();
  focusStep(editingCase.steps.length - 1);
});
$("tcSteps").addEventListener("click", function(e){
  if(!editingCase) return;
  var add = e.target.closest("[data-step-add]");
  var up = e.target.closest("[data-step-up]");
  var down = e.target.closest("[data-step-down]");
  var del = e.target.closest("[data-step-del]");
  if(!add && !up && !down && !del) return;
  syncStepsFromDom();
  if(add){
    if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
    var at = Number(add.dataset.stepAdd) + 1;
    editingCase.steps.splice(at, 0, { action: "", expected: "" });
    renderStepRows();
    focusStep(at);
    return;
  }
  if(del){
    editingCase.steps.splice(Number(del.dataset.stepDel), 1);
    renderStepRows();
    return;
  }
  var idx = Number(up ? up.dataset.stepUp : down.dataset.stepDown);
  var to = up ? idx - 1 : idx + 1;
  if(to < 0 || to >= editingCase.steps.length) return;
  var moved = editingCase.steps.splice(idx, 1)[0];
  editingCase.steps.splice(to, 0, moved);
  renderStepRows();
  focusStepAct(to, up ? "[data-step-up]" : "[data-step-down]");
});
/* Ctrl/Cmd+Enter 在当前步骤下方插入新行，长步骤输入不受干扰 */
$("tcSteps").addEventListener("keydown", function(e){
  if(e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !editingCase) return;
  if(editingCase.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
  e.preventDefault();
  /* 全局 Ctrl+Enter 是弹窗提交快捷键；插行已消费该按键，不再冒泡触发保存关框 */
  e.stopPropagation();
  syncStepsFromDom();
  var row = e.target.closest(".tc-step-row");
  var idx = row
    ? Array.prototype.indexOf.call($("tcSteps").querySelectorAll(".tc-step-row"), row)
    : editingCase.steps.length - 1;
  editingCase.steps.splice(idx + 1, 0, { action: "", expected: "" });
  renderStepRows();
  focusStep(idx + 1);
});
$("btnSaveCase").addEventListener("click", saveCase);
$("btnSaveCaseAgain").addEventListener("click", saveCaseAgain);
/* 目录下拉里的「＋ 新建目录…」：保留原来自由文本录入的便利，但落到真实节点上 */
$("cModule").addEventListener("change", function(){
  var sel = this;
  if(sel.value !== "__new"){
    caseFormModulePrev = sel.value;
    renderModuleTag();
    return;
  }
  sel.value = caseFormModulePrev;
  if(!caseFormWritable()){ toast("当前项目只读，无法新建目录", "warn"); return; }
  UI.showPrompt({
    title: "新建项目目录",
    desc: "目录是单归属：一个用例只属一个节点，层级不限。新建的是顶级目录，可在左侧目录面板里调整层级。",
    label: "目录名称（≤50 字）", maxLength: 50, okText: "创建"
  }).then(function(name){
    if(!name) return;
    API.post("/api/test-modules", { reqId: caseFormReqId, name: name }).then(function(node){
      toast("目录「" + name + "」已创建", "fs");
      return loadFormModules(caseFormReqId, node && node.id ? node.id : "").then(function(){
        caseFormModulePrev = $("cModule").value;
        renderModuleTag();
        if(caseFormReqId === caseReqId && !caseScopeAll) loadCases();
      });
    }).catch(function(ex){ toast(ex.message || "新建目录失败", "bad"); });
  });
});
$("cTitle").addEventListener("input", function(){
  $("fCaseTitle").classList.remove("invalid");
  syncCaseTitleMeta();
  if(this.value.trim()) showCaseErrors([]);
});
["cPrecondition", "cTestData"].forEach(function(id){
  $(id).addEventListener("input", syncCaseMoreMeta);
});
$("cPriSeg").addEventListener("click", function(e){
  var b = e.target.closest("[data-pri]");
  if(!b || b.disabled || !caseFormWritable()) return;
  $("cPri").value = b.getAttribute("data-pri") || "";
  renderPriSeg();
  var active = $("cPriSeg").querySelector(".on");
  if(active) active.focus();
});
$("cModuleInherit").addEventListener("click", function(){
  if(!caseModuleInherited || !caseFormWritable()) return;
  if(setModuleValue(caseModuleInherited)){
    renderModuleTag();
    return;
  }
  loadFormModules(caseFormReqId, caseModuleInherited).then(renderModuleTag);
});
$("cModuleNew").addEventListener("click", function(){
  if(!caseFormWritable()) return;
  var sel = $("cModule");
  sel.value = "__new";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
$("cDemandClear").addEventListener("click", function(){ chooseDemand(""); });
$("caseErrLinks").addEventListener("click", function(e){
  var b = e.target.closest("[data-case-err]");
  if(!b) return;
  var el = $(b.getAttribute("data-case-err"));
  if(!el) return;
  el.focus();
  if(el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
});
$("cDemandPicker").addEventListener("click", openDemandPicker);
$("cTaskSearch").addEventListener("input", function(){
  caseTaskQuery = this.value.trim();
  renderCaseTaskPicker();
});
$("cTaskList").addEventListener("change", function(e){
  var box = e.target.closest("[data-case-task]");
  if(!box) return;
  toggleCaseTask(box.getAttribute("data-case-task"), box.checked);
});
$("cTaskList").addEventListener("click", function(e){
  if(e.target.closest("[data-task-retry]")) loadCaseTaskOptions();
});
$("dlgCaseX").addEventListener("click", function(){ tryCloseCaseDialog(); });
/* 单行输入 Enter 提交；步骤 textarea 保持换行，CJK 组合输入不触发 */
$("dlgCase").addEventListener("keydown", function(e){
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
  if(!e.target || e.target.tagName !== "INPUT") return;
  if(e.target.type === "checkbox" || e.target.type === "file") return;
  if(e.target.id === "cTaskSearch") return;
  if($("caseEditBody").hidden) return;
  if(!caseFormWritable()) return;
  e.preventDefault();
  if(!caseSaving && !$("btnSaveCase").disabled) saveCase();
});
UI.setModalCloseGuard($("dlgCase"), function(){ tryCloseCaseDialog(); });
$("caseEditBack").addEventListener("click", function(){ tryCloseCaseDialog(); });
UI.setModalSubmit($("dlgCase"), function(){
  if($("caseEditBody").hidden) return;
  if(!caseSaving && !$("btnSaveCase").disabled) saveCase();
});
/* 阅读态 + 编辑态：页签、字段就地改、编辑、执行、关联跳转与标题都在同一个容器里委派 */
$("caseDetailView").addEventListener("click", function(e){
  var hint = e.target.closest("[data-case-hint]");
  if(hint){ e.stopPropagation(); openCaseHint(hint.getAttribute("data-case-hint"), hint); return; }
  var tab = e.target.closest("[data-case-tab]");
  if(tab){ caseDetailTab = tab.dataset.caseTab; caseInlineEdit = null; caseInlineNewStep = null; renderCaseDetail(); return; }
  if(e.target.closest("[data-case-close]")){ tryCloseCaseDialog(); return; }
  if(e.target.closest("[data-case-edit]")){ startCaseDetailEdit(); return; }
  if(e.target.closest("[data-case-edit-cancel]")){ cancelCaseDetailEdit(); return; }
  if(e.target.closest("[data-case-edit-save]")){ saveCaseDetailDraft(); return; }
  if(e.target.closest("[data-case-run]")){ openRunDialog(caseDetailId); return; }
  if(e.target.closest("[data-case-defect]")){ openDefectDialog(caseDetailId); return; }
  if(e.target.closest("[data-case-jump]")){
    var c0 = caseById(caseDetailId);
    if(c0 && c0.demandId) openDemandDetailById(c0.demandId);
    return;
  }
  var bug = e.target.closest("[data-case-bug]");
  if(bug){ openTaskById(bug.dataset.caseBug); return; }
  var task = e.target.closest("[data-case-task]");
  if(task){ openTaskById(task.dataset.caseTask); return; }
  var pri = e.target.closest("[data-case-pri]");
  if(pri && caseDetailDraft){
    caseDetailDraft.priority = pri.getAttribute("data-case-pri") || "";
    pri.parentNode.querySelectorAll("[data-case-pri]").forEach(function(b){
      b.setAttribute("aria-pressed", String(b === pri));
    });
    syncCaseDraftDirty();
    return;
  }
  var actEl = e.target.closest("[data-case-act]");
  if(actEl){
    var act = actEl.getAttribute("data-case-act");
    var anchor = actEl;
    if(act === "edit-demand-clear"){
      if(!caseDetailDraft) return;
      var dtasks = (caseDetailDraft.tasks || []).length;
      function clearDemand(){
        caseDetailDraft.demandId = "";
        caseDetailDraft.demandTitle = "";
        caseDetailDraft.tasks = [];
        syncCaseDraftDirty();
        renderCaseDetail();
      }
      if(dtasks){
        UI.showConfirm({
          title: "取消关联需求",
          msg: "现有 " + dtasks + " 个验证工作项会一并移除；保存后生效。",
          okText: "取消关联",
          cancelText: "保留"
        }).then(function(ok){ if(ok) clearDemand(); });
      }else clearDemand();
      return;
    }
    if(act === "edit-task-remove"){
      if(!caseDetailDraft) return;
      var tid = actEl.getAttribute("data-task-id");
      caseDetailDraft.tasks = (caseDetailDraft.tasks || []).filter(function(t){ return t.taskId !== tid; });
      syncCaseDraftDirty();
      renderCaseDetail();
      return;
    }
    if(act === "priority" || act === "module" || act === "demand" || act === "tasks" || act === "sets"
      || act === "edit-demand"){
      if(act === "edit-demand") act = "demand";
      openCasePick(act, anchor);
      return;
    }
    if(act === "pre" || act === "testData"){ beginCaseBlockEdit(act); return; }
    if(act === "step"){ beginCaseStepEdit(Number(actEl.getAttribute("data-i")), actEl.getAttribute("data-k")); return; }
    if(act === "step-add"){ insertCaseStepRow(null); return; }
    if(act === "step-ins"){ insertCaseStepRow(Number(actEl.getAttribute("data-i"))); return; }
    if(act === "step-up" || act === "step-down" || act === "step-del"){
      var i = Number(actEl.getAttribute("data-i"));
      mutateCaseSteps(function(s){
        var tmp;
        if(act === "step-up" && i > 0){ tmp = s[i - 1]; s[i - 1] = s[i]; s[i] = tmp; }
        if(act === "step-down" && i < s.length - 1){ tmp = s[i + 1]; s[i + 1] = s[i]; s[i] = tmp; }
        if(act === "step-del") s.splice(i, 1);
      }, "步骤已更新");
      return;
    }
    if(act === "d-step-add"){
      if(caseDetailDraft.steps.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
      caseDetailDraft.steps.push({ action: "", expected: "" });
      caseDraftFocusStep = caseDetailDraft.steps.length - 1;
      renderCaseDetail();
      return;
    }
    if(act === "d-step-ins" || act === "d-step-up" || act === "d-step-down" || act === "d-step-del"){
      var di = Number(actEl.getAttribute("data-i")), ds = caseDetailDraft.steps, tmp2;
      if(act === "d-step-ins"){
        if(ds.length >= 30){ toast("步骤最多 30 条", "warn"); return; }
        ds.splice(di + 1, 0, { action: "", expected: "" });
        caseDraftFocusStep = di + 1;
      }
      if(act === "d-step-up" && di > 0){ tmp2 = ds[di - 1]; ds[di - 1] = ds[di]; ds[di] = tmp2; }
      if(act === "d-step-down" && di < ds.length - 1){ tmp2 = ds[di + 1]; ds[di + 1] = ds[di]; ds[di] = tmp2; }
      if(act === "d-step-del") ds.splice(di, 1);
      renderCaseDetail();
      return;
    }
  }
  var title = e.target.closest("[data-case-title-edit]");
  if(title) startCaseTitleEdit(title);
});
$("caseDetailView").addEventListener("input", function(e){
  var t = e.target;
  if(t.id === "caseEditTitle" && caseDetailDraft){
    autoGrowCaseTitle(t);
    caseDetailDraft.title = t.value;
    syncCaseDraftDirty();
    return;
  }
  var dk = t.getAttribute("data-case-draft");
  if(dk && caseDetailDraft){
    caseDetailDraft[dk] = t.value;
    syncCaseDraftDirty();
    return;
  }
  var ds = t.getAttribute("data-case-draft-step");
  if(ds && caseDetailDraft){
    var row = caseDetailDraft.steps[Number(ds)];
    if(row) row[t.getAttribute("data-k")] = t.value;
    syncCaseDraftDirty();
    return;
  }
  if(t.hasAttribute("data-case-block-edit") || t.hasAttribute("data-case-step-edit")){
    if(caseInlineEdit) caseInlineEdit.text = t.value;
  }
});
$("caseDetailView").addEventListener("change", function(e){
  var t = e.target;
  if(t.getAttribute("data-case-draft") === "moduleId" && caseDetailDraft){
    caseDetailDraft.moduleId = t.value;
    caseDetailDraft.module = moduleNameById(caseDetailModules.list, t.value);
    syncCaseDraftDirty();
  }
});
$("caseDetailView").addEventListener("keydown", function(e){
  var t = e.target;
  if(t.id === "caseEditTitle"){
    if(e.key === "Enter"){ e.preventDefault(); t.blur(); }
    return;
  }
  if(t.hasAttribute("data-case-step-edit") || t.hasAttribute("data-case-block-edit")){
    if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); commitCaseInlineEdit(t); }
    else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cancelCaseInlineEdit(); }
    return;
  }
  var ds = t.getAttribute && t.getAttribute("data-case-draft-step");
  if(ds !== null && e.key === "Enter" && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    if(caseDetailDraft){
      var at = Number(ds) + 1;
      caseDetailDraft.steps.splice(at, 0, { action: "", expected: "" });
      caseDraftFocusStep = at;
      renderCaseDetail();
    }
    return;
  }
  var el = t.closest("[data-case-title-edit]");
  if(t.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")){
    var actBtn = t.closest && t.closest('[data-case-act][role="button"]');
    if(actBtn){ e.preventDefault(); actBtn.click(); return; }
  }
  if(!el) return;
  if(el.isContentEditable){
    if(e.key === "Enter"){ e.preventDefault(); el.blur(); }
    else if(e.key === "Escape"){
      e.preventDefault();
      e.stopPropagation();
      el.textContent = el.dataset.original || "";
      el.contentEditable = "false";
      el.blur();
    }
  } else if(e.key === "Enter" || e.key === " "){
    e.preventDefault();
    startCaseTitleEdit(el);
  }
});
$("caseDetailView").addEventListener("focusout", function(e){
  var t = e.target;
  if(t.hasAttribute("data-case-block-edit") || t.hasAttribute("data-case-step-edit")){
    if(caseInlineEdit) commitCaseInlineEdit(t);
    return;
  }
  var el = t.closest("[data-case-title-edit]");
  if(el && el.isContentEditable) commitCaseTitleEdit(el);
});

$("segCaseRun").addEventListener("click", function(e){
  var b = e.target.closest("[data-run-status]");
  if(!b) return;
  runStatus = b.dataset.runStatus;
  syncRunSeg();
});
$("btnDoRun").addEventListener("click", doRun);
$("runContext").addEventListener("click", function(e){
  var bug = e.target.closest("[data-run-bug]");
  if(bug){ openTaskById(bug.dataset.runBug); }
});
$("dlgCaseRunX").addEventListener("click", function(){ tryCloseRunDialog(); });
UI.setModalCloseGuard($("dlgCaseRun"), function(){ tryCloseRunDialog(); });
UI.setModalSubmit($("dlgCaseRun"), function(){ if(!caseRunning) doRun(); });

$("btnDoDefect").addEventListener("click", doDefect);
$("defectSeverity").addEventListener("change", function(){ $("fDefectSeverity").classList.remove("invalid"); });
$("defectCarry").addEventListener("change", syncDefectCarryDim);
$("dlgCaseDefect").addEventListener("click", function(e){
  var open = e.target.closest("[data-att-open]");
  if(open){
    e.preventDefault();
    var att = defectEvidence.filter(function(a){ return a.id === open.dataset.attOpen; })[0];
    if(att) openAttachment(att, { canEdit: false });
    return;
  }
  var dl = e.target.closest("[data-att-download]");
  if(dl){
    e.preventDefault();
    window.open(attUrl(dl.dataset.attDownload), "_blank", "noopener");
  }
});
$("dlgCaseDefectX").addEventListener("click", function(){ tryCloseDefectDialog(); });
UI.setModalCloseGuard($("dlgCaseDefect"), function(){ tryCloseDefectDialog(); });
UI.setModalSubmit($("dlgCaseDefect"), function(){ if(!caseDefecting) doDefect(); });

/* 执行历史与失败证据 */
$("dlgCaseRunsX").addEventListener("click", function(){ closeRunsDialog(); });
UI.setModalCloseGuard($("dlgCaseRuns"), function(){ closeRunsDialog(); });
$("runsList").addEventListener("click", function(e){
  var open = e.target.closest("[data-run-att-open]");
  if(open){
    e.preventDefault();
    var att = findRunAtt(open.dataset.runAttOpen);
    /* 执行证据只读打开，避免从历史记录改写证据原文件 */
    if(att) openAttachment(att, { canEdit: false });
    return;
  }
  var dl = e.target.closest("[data-run-att-download]");
  if(dl){
    e.preventDefault();
    window.open(attUrl(dl.dataset.runAttDownload), "_blank", "noopener");
    return;
  }
  var del = e.target.closest("[data-run-att-del]");
  if(del){
    var caseId = runsCaseId;
    var caseTitle = runsCaseTitle;
    UI.showConfirm({ title: "删除证据", msg: "证据附件删除后不可恢复，确定删除？", okText: "删除证据" }).then(function(ok){
      if(!ok) return;
      del.disabled = true;
      API.del("/api/attachments/" + encodeURIComponent(del.dataset.runAttDel)).then(function(){
        toast("证据已删除", "fs");
        if(caseId) openRunsDialog(caseId, caseTitle);
        loadCases();
      }).catch(function(ex){ del.disabled = false; toast(ex.message || "删除失败", "bad"); });
    });
    return;
  }
  var bug = e.target.closest("[data-run-bug]");
  if(bug){ openTaskById(bug.dataset.runBug); }
});
$("runsList").addEventListener("change", function(e){
  var inp = e.target.closest("[data-run-file]");
  if(!inp || !inp.files || !inp.files.length) return;
  var files = Array.prototype.slice.call(inp.files);
  inp.value = "";
  if(runsCaseId) uploadRunEvidence(runsCaseId, inp.dataset.runFile, files);
});

function loadCoverageTasks(demandId){
  if(!demandId) return;
  covTaskCache[demandId] = null;
  renderCoverage();
  API.get("/api/test-cases/task-coverage", { demandId: demandId }).then(function(rows){
    covTaskCache[demandId] = rows || [];
    if(tcMode === "coverage") renderCoverage();
  }).catch(function(){
    covTaskCache[demandId] = "error";
    if(tcMode === "coverage") renderCoverage();
  });
}
/* 覆盖矩阵 / 报告：需求行、失败行跳转 */
function covRowKeyActivate(e){
  if(e.key !== "Enter" && e.key !== " ") return;
  var row = e.target.closest("[data-cov-demand]");
  if(!row) return;
  e.preventDefault();
  row.click();
}
if($("tcCoverage")){
  $("tcCoverage").addEventListener("click", function(e){
    var toggle = e.target.closest("[data-cov-toggle]");
    if(toggle){
      e.stopPropagation();
      var id = toggle.dataset.covToggle;
      if(covExpanded[id]){ delete covExpanded[id]; renderCoverage(); return; }
      covExpanded[id] = true;
      if(!covTaskCache.hasOwnProperty(id)) loadCoverageTasks(id);
      else renderCoverage();
      return;
    }
    var retry = e.target.closest("[data-cov-retry]");
    if(retry){ e.stopPropagation(); loadCoverageTasks(retry.dataset.covRetry); return; }
    var chip = e.target.closest("[data-cov-case]");
    if(chip){ e.stopPropagation(); openReportCase(chip.dataset.covCase); return; }
    var row = e.target.closest("[data-cov-demand]");
    if(row) openDemandDetailById(row.dataset.covDemand);
  });
  $("tcCoverage").addEventListener("keydown", covRowKeyActivate);
}
/* 测试报告：导出 / 打印 / 跳转 */
if($("tcReport")){
  $("tcReport").addEventListener("click", function(e){
    if(e.target.closest("[data-tc-report-csv]")){ exportTestReport(); return; }
    if(e.target.closest("[data-tc-report-doc]")){ exportTestReportDoc(); return; }
    if(e.target.closest("[data-tc-report-print]")){ printTestReport(); return; }
    if(e.target.closest("[data-rs-drill-export]")){ exportRunDrillCsv(); return; }
    if(e.target.closest("[data-rs-drill-close]")){ closeRunDrill(); return; }
    var drillCase = e.target.closest("[data-rs-drill-case]");
    if(drillCase){ openRunsDialog(drillCase.dataset.rsDrillCase, drillCase.dataset.rsDrillTitle || ""); return; }
    var drillBug = e.target.closest("[data-rs-drill-bug]");
    if(drillBug){ openTaskById(drillBug.dataset.rsDrillBug); return; }
    var drillRow = e.target.closest("[data-rs-drill]");
    if(drillRow){
      openRunDrill(drillRow.dataset.rsDrill, drillRow.dataset.rsKey, drillRow.dataset.rsLabel,
        parseInt(drillRow.dataset.rsTotal, 10) || 0, drillRow);
      return;
    }
    var covRow = e.target.closest("[data-cov-demand]");
    if(covRow){ openDemandDetailById(covRow.dataset.covDemand); return; }
    var caseBtn = e.target.closest("[data-report-case]");
    if(caseBtn){ openReportCase(caseBtn.dataset.reportCase); return; }
    var hit = null;
    var runs = e.target.closest("[data-report-runs]");
    var bug = e.target.closest("[data-report-bug]");
    var id = runs ? runs.dataset.reportRuns : (bug ? bug.dataset.reportBug : "");
    if(id){
      hit = reportCaseById(id);
    }
    if(runs){ openRunsDialog(id, hit ? hit.title : ""); return; }
    if(bug){
      if(hit && hit.latestBugTaskId) openTaskById(hit.latestBugTaskId);
      else toast("未找到关联缺陷，可能已被删除", "warn");
    }
  });
  $("tcReport").addEventListener("keydown", covRowKeyActivate);
  $("tcReport").addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest("[data-rs-drill]");
    if(!row) return;
    e.preventDefault();
    row.click();
  });
}

/* 弹窗开着时切视图：先处理未保存内容，确认后再继续跳转 */
window.addEventListener("ds:before-route", function(e){
  var openId = null;
  ["dlgCase", "dlgCaseRun", "dlgCaseDefect", "dlgCaseRuns"].forEach(function(id){
    var d = $(id);
    if(d && d.classList.contains("open")) openId = id;
  });
  if(!openId) return;
  e.preventDefault();
  var to = e.detail && e.detail.to;
  function after(){
    if(to) window.dispatchEvent(new CustomEvent("ds:route-go", { detail: { view: to } }));
  }
  if(openId === "dlgCase") tryCloseCaseDialog(after);
  else if(openId === "dlgCaseRun") tryCloseRunDialog(after);
  else if(openId === "dlgCaseRuns"){ closeRunsDialog(); after(); }
  else tryCloseDefectDialog(after);
});

/* 从需求详情读数带「测试用例」跳入：定位到该项目的覆盖矩阵，并展开目标需求 */
function openDemandCoverage(reqId, demandId){
  if(!reqId){ toast("该需求未关联项目，无法查看用例覆盖", "warn"); return; }
  caseReqId = reqId;
  caseScopeAll = false;
  covPendingExpand = demandId || null;
  tcMode = "coverage";
  syncReqSel();
  syncModeUI();
  if(document.body.dataset.view === "testcases") loadCoverage();
  else showView("testcases");
}

function openCaseInProject(reqId, id){
  /* 从全局搜索跳进来时，cases 可能还是「全部项目」的分组平铺结果；
     先切回单项目并强制重载，避免弹窗背后的列表与项目下拉对不上 */
  var wasAll = caseScopeAll;
  if(reqId) caseReqId = reqId;
  caseScopeAll = false;
  syncReqSel();
  syncModeUI();
  var hit = wasAll ? null : caseById(id);
  if(hit){ openCaseDetail(id); return Promise.resolve(true); }
  /* 刚切到本视图时首屏加载可能正在进行，会让本次拉取因 seq 变化被丢弃；
     等一拍再补一次，避免「刚跳过来就说用例不存在」 */
  function attempt(tries){
    return loadCases().then(function(){
      if(caseById(id)){ openCaseDetail(id); return true; }
      if(tries <= 0){ toast("用例不存在或无权查看", "warn"); return false; }
      return new Promise(function(r){ setTimeout(r, 150); }).then(function(){ return attempt(tries - 1); });
    });
  }
  return attempt(2);
}

function setTcProject(reqId){
  if(!reqId) return;
  if(reqId !== caseReqId){
    caseSetsReq = null;
    caseSets = [];
    caseSetsError = "";
    caseDirQuery = "";
    caseDirOpen = {};
    moduleFilter = "all";
    demandFilter = "all";
    setFilter = "all";
  }
  caseReqId = reqId;
  caseScopeAll = false;
  if(tcMode === "defects") defReqId = reqId;
  syncReqSel();
  syncModeUI();
  if(document.body.dataset.view === "testcases"){
    if(tcMode === "plans") loadPlans();
    else if(tcMode === "coverage") loadCoverage();
    else if(tcMode === "report") loadTestReport();
    else if(tcMode === "defects") loadDefects();
    else { render(); loadCases(); }
  }
}

/* 交付说明「打开原始记录」跳到指定计划：先记下待打开 id，列表加载完再落详情，避免被 loadPlans 清掉 */
function openPlanInProject(reqId, planId){
  planPendingOpen = planId || null;
  setTcProject(reqId);
  setTcMode("plans");
}

export { currentTcMode, enterTestCasesView, openCaseInProject, openDemandCoverage, openPlanDetail, openPlanInProject, setTcMode, setTcProject };
