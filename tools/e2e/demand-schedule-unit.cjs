/* 需求前端聚焦单元测试：无浏览器、无服务端，不代替端到端验收。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/js/views/demands.js"), "utf8")
  .replace(/^import .*;\s*$/gm, "").replace(/^export \{.*\};\s*$/gm, "");
function element(value = "") {
  return { value, disabled:false, textContent:"", innerHTML:"", classList:{ remove() {}, add() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {} };
}
const elements = {};
["dpVersion", "dpNote", "fDemandPlanVer", "btnDoPlan", "dpPlannedStart", "dpPlannedEnd", "dpPriority",
  "dReq", "dTitle", "dDesc", "dAccept", "dSource", "dKind", "dCategory", "dExpect", "dWsjfB", "dWsjfU", "dWsjfR", "dWsjfE",
  "fDemandTitle", "btnSaveDemand", "demandFormTitle"]
  .forEach(id => { elements[id] = element(); });
const requests = [], notices = [];
const context = vm.createContext({
  console, setTimeout, clearTimeout,
  window:{ addEventListener() {}, dispatchEvent() {} }, CustomEvent:function(){},
  $: id => elements[id] || null,
  rt:{ currentWs:{ id:"W1", myRole:"member" }, reqList:[], demandReqId:"R1" },
  canEditReq: () => true,
  API:{
    get: () => Promise.resolve([{ id:"V2", name:"2.0", status:"planning" }]),
    post: (url, body) => { requests.push({ url, body }); return Promise.resolve({}); },
    getAllPages: () => Promise.resolve([])
  },
  UI:{ openModal() {}, closeModal() {}, showPrompt:() => Promise.resolve("调整范围") },
  toast: message => notices.push(message),
  listPrefs:{ viewMode:() => "table" },
  isMobile:() => false,
  priTagHTML: p => p,
  catTag:() => "",
  fmtTs: value => value,
  colName: value => value,
  typeBadgeHTML: value => value,
  fmtMinutesShort: value => String(value),
  esc: value => String(value == null ? "" : value),
  icon:() => "",
  syncAssocViewBtns:() => {},
  PRIORITIES:["P0","P1","P2","P3"], priName:code => ({P0:"紧急",P1:"高",P2:"中",P3:"低"}[code] || code)
});
const formatSource = fs.readFileSync(path.join(root, "frontend/js/lib/format.js"), "utf8");
context.pad2 = value => String(value).padStart(2, "0");
vm.runInContext(formatSource.slice(formatSource.indexOf("function normalizedIds("), formatSource.indexOf("function releaseSnapshotHTML(")), context, { filename:"format.js" });
vm.runInContext(source, context, { filename:"demands.js" });
context.loadDemands = () => {};
function demand(status = "plan") {
  return { id:"D1", reqId:"R1", title:"需求", status, canSchedule:true, revision:7,
    versionId:"V1", priority:"P1", plannedStart:"2026-12-01", plannedEnd:"2026-12-10" };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }

(async () => {
  // 生命周期回归独立于下方业务模型断言，也可直接运行专用文件。
  await require("./task-drawer-lifecycle-unit.cjs")();
  context.demands = [demand()];
  assert.equal(context.canScheduleDemand(context.demands[0]), true);
  assert.equal(context.canScheduleDemand({ reqId:"R1", canSchedule:false }), false);
  assert.equal(context.statusName("canceled"), "已取消");
  assert.ok(context.DEM_PRESETS.some(p => p[0] === "canceled"));
  assert.ok(context.demandMenuItems(context.demands[0]).some(it => it.act === "replan"));
  assert.ok(context.demandMenuItems(context.demands[0]).some(it => it.act === "cancel"));
  assert.ok(!context.demandMenuItems(context.demands[0]).some(it => it.act === "unpass"));
  assert.ok(!context.demandActs({ ...demand("pass"), canSchedule:false }).includes("data-dem-plan"));
  assert.ok(context.demandActs(demand("canceled")).includes("data-dem-restore"));
  assert.ok(context.cardHTML(demand("canceled"), { noDrag:true }).includes("已取消"));
  assert.ok(context.demandCell(context.demands[0], "version").includes("2026-12-01"));

  context.openPlanDialog("D1", true);
  await flush();
  assert.equal(elements.dpPlannedStart.value, "2026-12-01");
  assert.equal(elements.dpPlannedEnd.value, "2026-12-10");
  assert.equal(elements.dpPriority.value, "P1");
  assert.equal(elements.dpNote.required, true);
  elements.dpVersion.value = "V2";
  context.doPlan();
  assert.equal(requests.length, 0, "调期未填原因不得提交");
  elements.dpNote.value = "重排目标";
  elements.dpPlannedStart.value = "2026-12-20";
  elements.dpPlannedEnd.value = "2026-12-10";
  context.doPlan();
  assert.equal(requests.length, 0, "逆序日期不得提交");
  elements.dpPlannedStart.value = "";
  elements.dpPlannedEnd.value = "";
  elements.dpPriority.value = "P0";
  // 对话框打开后列表缓存更新，仍必须提交打开时的 revision，不能静默覆盖并发。
  context.demands[0].revision = 8;
  context.doPlan();
  await flush();
  assert.equal(requests[0].url, "/api/demands/D1/replan");
  assert.equal(requests[0].body.revision, 7);
  assert.equal(requests[0].body.plannedStart, null);
  assert.equal(requests[0].body.plannedEnd, null);
  assert.equal(requests[0].body.priority, "P0");

  await context.cancelDemand("D1");
  await flush();
  assert.equal(requests[1].url, "/api/demands/D1/cancel");
  assert.equal(requests[1].body.note, "调整范围");
  assert.equal(requests[1].body.revision, 8);
  await context.restoreDemand("D1");
  await flush();
  assert.equal(requests[2].url, "/api/demands/D1/restore");

  const taskBox = { innerHTML:"" }, layer = { isConnected:true, querySelector:() => taskBox };
  context.API.getAllPages = () => Promise.resolve([
    { id:"T1", title:"已交付", boardColumn:"done", versionIds:["V1", "V3"], versionNames:["任务版本", "附加版本"], publicationState:"effective", everPublished:true, publishedAt:"2026-11-09T12:00:00Z", publishSource:"record" },
    { id:"T2", title:"未发布", boardColumn:"done", versionIds:["V2"], versionNames:["另一版本"], publicationState:"unpublished", everPublished:false }
  ]);
  context.loadDemandTasks(layer, "D1", "V1");
  await flush();
  assert.ok(taskBox.innerHTML.includes("当前生产全量生效 1 项，部分生效 0 项；曾生产发布 1 项（1/2）"));
  assert.ok(taskBox.innerHTML.includes("任务版本、附加版本"));
  assert.ok(taskBox.innerHTML.includes("未生产发布"));
  assert.ok(taskBox.innerHTML.includes("2026-11-09"));
  assert.ok(taskBox.innerHTML.includes("不等于需求业务验收"));
  assert.ok(taskBox.innerHTML.includes("当前计划版本"));
  assert.ok(!taskBox.innerHTML.includes("任务实际版本"));
  assert.equal(taskBox.innerHTML.split("尚未关联需求目标版本").length - 1, 1);
  context.API.getAllPages = () => Promise.resolve([
    { id:"T3", title:"灰度", boardColumn:"doing", versionIds:["V1"], publicationState:"partial", everPublished:true },
    { id:"T4", title:"回滚", boardColumn:"done", versionIds:["V1"], publicationState:"rolled_back", everPublished:true },
    { id:"T5", title:"未知", boardColumn:"done", versionIds:["V1"], publicationState:"unknown", everPublished:true }
  ]);
  context.loadDemandTasks(layer, "D1", "V1");
  await flush();
  assert.ok(taskBox.innerHTML.includes("当前生产全量生效 0 项，部分生效 1 项；曾生产发布 3 项（0/3）"));
  for (const label of ["生产部分生效", "生产已回滚", "生产覆盖未知"]) assert.ok(taskBox.innerHTML.includes(label));
  context.API.getAllPages = () => Promise.resolve([{ id:"T6", title:"待规划", boardColumn:"backlog", versionIds:[] }]);
  context.loadDemandTasks(layer, "D1", "V1");
  await flush();
  assert.ok(taskBox.innerHTML.includes("尚未关联需求目标版本"));
  context.loadDemandTasks(layer, "D1", null);
  await flush();
  assert.ok(!taskBox.innerHTML.includes("尚未关联需求目标版本"));
  const phaseSource = fs.readFileSync(path.join(root, "frontend/js/views/phase.js"), "utf8");
  vm.runInContext(phaseSource.slice(phaseSource.indexOf("function demandStatusLabel("), phaseSource.indexOf("function openVersionDemandsModal(")), context);
  assert.equal(context.demandStatusLabel("canceled"), "已取消");
  const summarySource = phaseSource.slice(phaseSource.indexOf("function versionDeliverySummary("), phaseSource.indexOf("function versionCardHTML("));
  vm.runInContext(summarySource, context);
  const summary = context.versionDeliverySummary({ id:"V1", status:"released", releaseEvidenceKind:"release_snapshot", publishedTaskCount:8, excludedTaskCount:2, uniqueProductionTaskCount:4, effectiveProductionTaskCount:2 });
  assert.ok(summary.includes("发布处理 8 项次（含测试 / 重部署）"));
  assert.ok(summary.includes("其他处理 2 项次"));
  assert.ok(summary.includes("生产曾交付 4 项 · 当前生效 2 项，不等于待交付数量"));
  assert.ok(summary.includes('data-ver-note="V1"'));
  assert.ok(context.versionDeliverySummary({ status:"released", releaseEvidenceKind:"no_release_record" }).includes("无正式发布记录"));
  assert.ok(context.versionDeliverySummary({ status:"active", releaseEvidenceKind:"planned_scope" }).includes("完成不等于实际发布"));
  const change = context.demandLogChange({ changeData:JSON.stringify({
    before:{ versionName:"1.0", status:"plan" }, after:{ versionName:"2.0", status:"canceled" }
  }) });
  assert.ok(change.includes("1.0 → 2.0"));
  assert.ok(change.includes("已排期 → 已取消"));
  assert.equal(context.demandLogChange({ changeData:"invalid JSON" }), "");
  elements.iDemand = element();
  elements.iDemand.dataset = { demandReq:"R1" };
  elements.iReq = element("R1");
  context.drawerDemandOpts.list = [demand("canceled")];
  context.drawerDemandOpts.total = 1;
  context.fillDrawerDemandSelect("R1", null);
  assert.ok(!elements.iDemand.innerHTML.includes('value="D1"'), "新任务不能选择已取消需求");
  context.fillDrawerDemandSelect("R1", "D1");
  assert.ok(elements.iDemand.innerHTML.includes('value="D1"'), "原任务可保留已有取消需求关联");
  context.drawerDemandOpts = { reqId:null, list:[], total:0, error:null };
  let resolveOptions;
  context.API.get = () => new Promise(resolve => { resolveOptions = resolve; });
  context.rt.taskFormSeq = 1;
  context.ensureDemandOptions("D1", "R1");
  context.rt.taskFormSeq = 2;
  context.ensureDemandOptions("D2", "R1");
  resolveOptions({ items:[demand(), { ...demand(), id:"D2" }], total:2 });
  await flush();
  assert.equal(elements.iDemand.value, "D2", "同项目快速切换必须保留最新抽屉的需求");
  let staleResolve, latestResolve;
  context.API.get = (url, args) => new Promise(resolve => { if(args.reqId === "R2") staleResolve = resolve; else latestResolve = resolve; });
  elements.iReq.value = "R2";
  context.ensureDemandOptions("D3", "R2");
  elements.iReq.value = "R3";
  context.rt.taskFormSeq = 3;
  context.ensureDemandOptions("D4", "R3");
  latestResolve({ items:[{ ...demand(), id:"D4", reqId:"R3" }], total:1 });
  await flush();
  staleResolve({ items:[{ ...demand(), id:"D3", reqId:"R2" }], total:1 });
  await flush();
  assert.equal(elements.iDemand.value, "D4", "旧项目迟到响应不能覆盖新抽屉");

  const drawerSource = fs.readFileSync(path.join(root, "frontend/js/core/task-drawer.js"), "utf8");
  for(const name of ["taskPublication", "taskPublishedBadge", "taskPublicationInfo", "btnTaskPublish", "btnTaskUnpublish", "iVersion"]){ elements[name] = element(); }
  context.iReq = elements.iReq;
  context.iCol = element("done");
  context.sourceRemoveBtn = element();
  context.btnDeleteTask = element();
  context.rt.editingId = "T1";
  context.rt.drawerReadOnly = false;
  vm.runInContext(drawerSource.slice(drawerSource.indexOf("function syncTaskPublication("), drawerSource.indexOf("function loadTaskReleaseRecords(")), context);
  context.iReq.disabled = context.iCol.disabled = false;
  context.btnDeleteTask.hidden = false;
  context.syncTaskPublication({ publishedAt:"2026-11-09", publicationState:"effective", everPublished:true });
  assert.ok(elements.taskPublishedBadge.innerHTML.includes("生产生效"));
  assert.ok(elements.taskPublicationInfo.textContent.includes("执行状态可独立修改"));
  assert.ok(!context.iReq.disabled && !context.iCol.disabled && !context.btnDeleteTask.hidden, "发布事实不锁定工作状态");
  context.syncTaskPublication({ boardColumn:"done", publicationState:"unpublished" });
  assert.equal(elements.taskPublishedBadge.innerHTML, "", "完成不能产生发布徽标");
  context.rt.drawerReadOnly = true;
  context.iReq.disabled = context.iCol.disabled = true;
  context.btnDeleteTask.hidden = true;
  context.syncTaskPublication({ boardColumn:"done", publicationState:"effective" });
  assert.ok(context.iReq.disabled && context.iCol.disabled && context.btnDeleteTask.hidden, "事实渲染不能解除既有只读状态");
  assert.ok(!drawerSource.includes("function publishTask("));
  assert.ok(!drawerSource.includes("function unpublishTask("));
  context.taskCacheExtra = {};
  context.rt.editingId = null;
  elements.iVersion.getAttribute = () => "1";
  vm.runInContext(drawerSource.slice(drawerSource.indexOf("function targetVersionOf("), drawerSource.indexOf("function syncVersionReason(")), context);
  elements.iVersion.options = [{ value:"V1", selected:false }, { value:"V2", selected:false }];
  elements.iVersion.dataset = {};
  assert.equal(context.versionReasonNeeded(demand()), true, "偏离已有需求目标需要原因");
  assert.equal(context.versionReasonNeeded({ ...demand(), versionId:null }), false, "没有需求目标时待规划无需原因");
  elements.iVersion.options[0].selected = true;
  elements.iVersion.options[1].selected = true;
  assert.equal(context.versionReasonNeeded(demand()), false, "多版本包含需求目标不属于偏离");
  elements.iVersion.options[0].selected = false;
  assert.equal(context.versionReasonNeeded(demand()), true);
  assert.equal(context.versionReasonNeeded(demand("canceled")), false);
  // 需求表单：编辑「未指定模块」不能被改成第一个模块；关闭后迟到的保存响应不能关闭/改写新表单。
  context.rt.reqList = [{ id:"R1", name:"项目" }];
  context.rt.categoriesCache = [{ id:"C1", projectId:"R1", name:"模块一" }];
  context.openDemandDialog({ ...demand("review"), categoryId:null });
  assert.equal(elements.dCategory.value, "", "未指定模块的需求编辑时保持未指定");
  context.openDemandDialog({ ...demand("review"), categoryId:"C9" });
  assert.equal(elements.dCategory.value, "C9", "模块缓存过期时保留原模块");
  context.openDemandDialog(null);
  assert.equal(elements.dCategory.value, "C1", "新建需求仍默认第一个模块");
  let saveResolve, closes = 0;
  context.UI.closeModal = () => { closes++; };
  context.API.put = () => new Promise(resolve => { saveResolve = resolve; });
  context.openDemandDialog({ ...demand("review"), categoryId:null });
  elements.dTitle.value = "需求 A";
  context.saveDemand();
  assert.equal(elements.btnSaveDemand.disabled, true);
  context.closeDemandDialog();
  context.openDemandDialog({ ...demand("review"), id:"D2", title:"需求 B", categoryId:null });
  assert.equal(elements.btnSaveDemand.disabled, false, "新表单不能继承上一次保存的禁用态");
  const closesBefore = closes;
  saveResolve({});
  await flush();
  assert.equal(closes, closesBefore, "迟到的保存响应不能关闭新表单");
  assert.equal(elements.dTitle.value, "需求 B");
  assert.equal(context.demandFormDirty(), false);
  elements.dTitle.value = "需求 B 改";
  assert.equal(context.demandFormDirty(), true, "改动后关闭需要确认");
  console.log("Demand frontend focused unit checks passed (permissions, revision, dates, delivery, async selection and publication controls).");
})().catch(error => { console.error(error); process.exitCode = 1; });
