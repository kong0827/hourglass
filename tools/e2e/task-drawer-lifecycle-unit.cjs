/* 真实函数源 VM 生命周期回归：无浏览器、服务端或数据库，独立于需求/交付业务断言。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const drawerSource = fs.readFileSync(path.join(root, "frontend/js/core/task-drawer.js"), "utf8");
const phaseSource = fs.readFileSync(path.join(root, "frontend/js/views/phase.js"), "utf8");
function slice(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `真实函数源边界缺失：${from}`);
  return source.slice(start, end);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function element(id) {
  const classes = new Set(), attributes = {}, listeners = {};
  let html = "";
  return {
    id, value:"", disabled:false, hidden:false, textContent:"", dataset:{}, options:[],
    get selectedOptions() { return this.options.filter(o => o.selected); },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      this.options = [...value.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(match => ({
        value:(match[1].match(/value="([^"]*)"/) || [])[1] || "",
        textContent:match[2], selected:/\bselected\b/.test(match[1]), disabled:/\bdisabled\b/.test(match[1])
      }));
    },
    classList:{
      add:name => classes.add(name), remove:name => classes.delete(name), contains:name => classes.has(name),
      toggle(name, on) { if (on === undefined) on = !classes.has(name); if (on) classes.add(name); else classes.delete(name); }
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] ?? null; },
    removeAttribute(name) { delete attributes[name]; },
    addEventListener(name, listener) { (listeners[name] ||= []).push(listener); },
    dispatch(name, event) { for (const listener of listeners[name] || []) listener(event); },
    querySelector:() => null, querySelectorAll:() => [], appendChild(option) { this.options.push(option); },
    focus() {}, select() {}, scrollIntoView() {}
  };
}
const refreshNames = ["loadBoard", "loadReqs", "refreshCalendarIfOpen", "refreshListIfOpen", "refreshGanttIfOpen", "refreshAssociationViews"];
function harness() {
  const elements = {}, requests = [], notices = [], prompts = [], decisions = [], guards = [], refreshes = [];
  const $ = id => elements[id] ||= element(id);
  const globals = {
    console, $,
    // 此处不调度焦点计时器；所有受测异步边界均由真实 Promise 驱动。
    setTimeout:() => 0, clearTimeout() {},
    document:{ body:{}, documentElement:{}, activeElement:null, createElement:tag => element(tag) },
    rt:{ taskFormSeq:0, editingId:null, formDirty:false, drawerReadOnly:false, colDefsCache:[], currentWs:{ id:"W1" }, reqList:[] },
    state:{ runningTimer:null }, taskCacheExtra:{}, COLUMNS:[],
    normalizedIds:ids => Array.isArray(ids) ? [...new Set(ids.filter(Boolean))] : [],
    taskVersionIds:task => task.versionIds || [],
    selectedVersionIds:sel => sel.selectedOptions.map(o => o.value),
    sameIds:(left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()),
    canEditTask:task => task.canEdit !== false, canEditReq:id => id !== "READONLY",
    defaultReqId:() => "R1", projCats:() => [], projFirstCat:() => "",
    ownerPick:() => ({ name:"", userId:null }), esc:value => String(value),
    API:{
      get() { throw new Error("未设置需求目标/版本请求"); },
      put(url, body) { const d = deferred(); requests.push({ url, body, ...d }); return d.promise; },
      post(url, body) { return this.put(url, body); }
    },
    UI:{ wireTooltips() {}, showPrompt() { const d = deferred(); prompts.push(d); return d.promise; } },
    guard() { const d = deferred(); guards.push(d); return d.promise; },
    serverDecision() { const d = deferred(); decisions.push(d); return d.promise; },
    toast:message => notices.push(message), taskPublicationHTML:() => "", fmtReleaseTime:value => value,
    TYPE_META:{ task:{ name:"任务", placeholder:"标题" } }, TYPE_ICONS:{ task:"" }
  };
  const domImport = drawerSource.match(/import \{ ([^}]+) \} from "\.\/dom\.js";/);
  assert.ok(domImport, "真实 DOM 导入边界必须存在");
  for (const name of domImport[1].split(", ").filter(name => name !== "$")) globals[name] = $(name);
  for (const name of ["iItemType", "iSeverity", "iEnvironment", "iReproSteps", "iRegression", "taskFormHint", "reqDocPickerBtn", "btnAttach"]) globals[name] = $(name);
  globals.taskDrawer.querySelector = selector => selector === ".drawer" ? $("drawerRoot") : null;
  globals.taskForm.querySelectorAll = selector => selector === "input,select,textarea" ? Object.values(elements).filter(el => /^i[A-Z]/.test(el.id)) : [];
  for (const name of ["closeMention", "syncDateBounds", "renderActualEstimate", "populateColSelect", "populateReqSelect", "populateOwnerSelect", "renderTagChips", "clearDefectFields", "syncDefectFields", "syncTypeButtons", "syncSeverityButtons", "syncTitleCount", "syncDueNote", "syncDrawerSource", "syncAssocViewBtns", "syncProgVal", "syncCatSeg", "syncFormSegs", "syncMoreSummary", "clearPendingCommentFiles", "loadWatchStatus", "loadWorkStatus", "loadAttachments", "loadSubtasks", "loadComments", "loadTimeline", "loadTaskReleaseRecords", "clearWorkTick", "ensureDemand", "ensureFoundVersion", "ensureEpic", "ensureReqDoc", "ensureBranch", "rememberReqId", "syncVersionReason"]) globals[name] = () => {};
  globals.ensureVersion = keep => {
    const sel = $("iVersion");
    sel.options = (Array.isArray(keep) ? keep : []).map(value => ({ value, selected:true }));
    sel.setAttribute("data-ready", "1");
  };
  for (const name of refreshNames) globals[name] = () => refreshes.push(name);
  const context = vm.createContext(globals);
  const sections = [
    slice(drawerSource, "function syncDrawerDirty(", "function focusField("),
    slice(drawerSource, "function loadDemandTarget(", "function versionReasonNeeded("),
    slice(drawerSource, "function syncTaskPublication(", "function loadTaskReleaseRecords("),
    slice(drawerSource, "function openDrawer(", "/**"),
    slice(drawerSource, "function applyDrawerReadOnly(", "/** 只读抽屉"),
    slice(drawerSource, "function openTaskDrawer(", "function syncProgByCol("),
    slice(drawerSource, "function syncProgByCol(", "/* 路由切换前"),
    slice(drawerSource, "function forceCloseTaskDrawer(", "function wireSegKeyboard("),
    slice(drawerSource, "function syncDrawerHead(", "function isoDate("),
    slice(drawerSource, 'taskForm.addEventListener("submit",', '$("btnCloseTask").addEventListener(')
  ];
  vm.runInContext("var origProgress = 0, startedDone = false, commentsCache = []; var demandTargetCache = {}, demandTargetPending = {};", context);
  for (const section of sections) vm.runInContext(section, context, { filename:"task-drawer.js (real source)" });
  function open({ edit = false, demand = false, readOnly = false } = {}) {
    const task = edit ? { id:"T1", reqId:readOnly ? "READONLY" : "R1", title:"原任务", boardColumn:"backlog", versionIds:[], canEdit:!readOnly } : null;
    context.openTaskDrawer("backlog", task, { reqId:readOnly ? "READONLY" : "R1", demandId:demand ? "D1" : null });
    $("iTitle").value = "待保存";
    $("iDemand").setAttribute("data-ready", "1");
  }
  function submit({ continueEdit = false, move = false } = {}) {
    if (move) $("iCol").value = "review";
    context.taskForm.dispatch("submit", { preventDefault() {}, submitter:{ id:continueEdit ? "btnSaveTaskContinue" : "btnSaveTask" } });
  }
  function loading(expected, label) {
    for (const id of ["btnSaveTask", "btnSaveTaskContinue"]) {
      assert.equal($(id).disabled, expected, `${label}: ${id} disabled`);
      assert.equal($(id).classList.contains("loading"), expected, `${label}: ${id} loading`);
    }
    assert.equal($("btnSaveTask").textContent === "保存中…", expected, `${label}: 保存文案`);
  }
  async function reopenSaving() {
    context.forceCloseTaskDrawer();
    loading(false, "关闭立即复位");
    open();
    loading(false, "重开可保存");
    submit();
    await flush();
    assert.equal(requests.length > 0, true, "新抽屉确实提交请求");
    context.rt.formDirty = true;
    loading(true, "新抽屉正在保存");
  }
  return { context, $, requests, notices, prompts, decisions, guards, refreshes, open, submit, loading, reopenSaving };
}
function readonly(h, label) {
  assert.equal(h.context.rt.drawerReadOnly, true, label);
  assert.equal(h.$("drawerRoot").classList.contains("readonly"), true, label);
  for (const id of ["iTitle", "iReq", "iVersion", "iProg", "iComment", "iSubNew"]) assert.equal(h.$(id).disabled, true, `${label}: ${id}`);
  for (const id of ["btnSaveTask", "btnSaveTaskContinue", "btnDeleteTask"]) assert.equal(h.$(id).hidden, true, `${label}: ${id}`);
}
function untouched(h, label) {
  h.loading(true, label);
  assert.equal(h.context.taskDrawer.classList.contains("on"), true, `${label}: 新抽屉保持打开`);
  assert.equal(h.context.rt.formDirty, true, `${label}: 新表单改动保留`);
  assert.equal(h.$("iTitle").value, "待保存", `${label}: 新标题保留`);
  assert.equal(h.notices.length, 0, `${label}: 不显示旧回调提示`);
}
async function pendingStage(stage, result) {
  const h = harness(), pending = deferred();
  h.open({ demand:stage === "target", edit:stage !== "target" });
  if (stage === "target") h.context.API.get = () => pending.promise;
  if (stage === "reason") h.$("iVersion").options = [{ value:"V2", selected:true }];
  h.submit({ move:stage === "guard" });
  await flush();
  const wait = stage === "target" ? pending : stage === "reason" ? h.prompts[0] : h.guards[0];
  assert.ok(wait, `必须真实进入等待 ${stage}`);
  h.loading(true, `等待 ${stage}`);
  assert.equal(h.requests.length, 0);
  await h.reopenSaving();
  if (result === "error") wait.reject(new Error("旧异步异常"));
  else wait.resolve(stage === "target" ? { status:"plan", targetVersionId:"V1" } : result === "cancel" ? null : stage === "reason" ? "旧理由" : { force:true });
  await flush();
  untouched(h, `旧 ${stage}/${result} 不能影响新保存`);
  assert.equal(h.requests.length, 1, "旧校验/理由/guard 不得继续发保存请求");
}
async function staleRequest(result, continueEdit) {
  const h = harness();
  h.open({ edit:continueEdit });
  h.submit({ continueEdit });
  await flush();
  const old = h.requests[0];
  assert.ok(old, "旧请求已发出");
  await h.reopenSaving();
  if (result === "success") old.resolve({ id:"T1", title:"旧响应标题", reqId:"R1" });
  else old.reject({ code:500, message:"旧请求失败" });
  await flush();
  untouched(h, `旧 request/${result}/${continueEdit ? "继续编辑" : "关闭"}`);
  assert.deepEqual(h.refreshes, result === "success" ? refreshNames : [], "旧成功仍刷新全部相关视图，旧失败不刷新");
}
async function retryDecision(code, result, lateError = false) {
  const h = harness();
  h.open({ edit:true });
  h.submit({ move:true });
  await flush();
  h.guards[0].resolve({ force:true });
  await flush();
  const old = h.requests[0];
  assert.ok(old, "经过 guard 已提交旧请求");
  if (!lateError) { old.reject({ code, message:"需要确认" }); await flush(); assert.equal(h.decisions.length, 1); }
  await h.reopenSaving();
  if (lateError) old.reject({ code, message:"迟到的服务端确认" });
  else h.decisions[0].resolve(result === "cancel" ? null : { force:true });
  await flush();
  untouched(h, `旧 ${code} ${lateError ? "异常" : "retry/" + result}`);
  assert.equal(h.requests.length, 2, "旧 retry 不得重新请求");
  assert.equal(h.decisions.length, lateError ? 0 : 1, "迟到异常不得打开旧确认");
}
async function versionRace({ failOld = false, readOnly = false } = {}) {
  const elements = { iReq:element("iReq"), iVersion:element("iVersion") }, pending = [];
  elements.iReq.value = "R1";
  const context = vm.createContext({
    $:id => elements[id], rt:{ taskFormSeq:7, editingId:null, drawerReadOnly:readOnly },
    versionOptionsCache:{}, taskOptionsCache:{}, taskCacheExtra:{},
    API:{ get() { const d = deferred(); pending.push(d); return d.promise; } },
    normalizedIds:ids => ids, versionContentLocked:() => false, esc:String,
    document:{ createElement:tag => element(tag) }
  });
  vm.runInContext(slice(phaseSource, "function fetchVersions(", "/* 「发现版本」"), context, { filename:"phase.js (real source)" });
  context.ensureVersionOptions([]); // 打开时尚未继承需求目标
  context.ensureVersionOptions(["V2"]); // 同一抽屉、同一项目继承了最新目标
  assert.equal(pending.length, 2, "真实发起两个版本请求");
  assert.equal(context.rt.taskFormSeq, 7, "抽屉 seq 不变，必须靠 optionSeq 隔离");
  assert.equal(elements.iVersion.dataset.optionSeq, "2");
  const versions = [{ id:"V1", name:"初始版本" }, { id:"V2", name:"最新继承版本" }];
  pending[1].resolve(versions);
  await flush();
  const latest = elements.iVersion.innerHTML;
  assert.deepEqual(elements.iVersion.selectedOptions.map(o => o.value), ["V2"]);
  assert.equal(elements.iVersion.getAttribute("data-ready"), "1");
  assert.equal(elements.iVersion.disabled, readOnly);
  if (failOld) pending[0].reject(new Error("旧版本加载失败")); else pending[0].resolve(versions);
  await flush();
  assert.equal(elements.iVersion.innerHTML, latest, "逆序旧响应/异常不能覆盖最新继承选项");
  assert.deepEqual(elements.iVersion.selectedOptions.map(o => o.value), ["V2"]);
  assert.equal(elements.iVersion.getAttribute("data-ready"), "1");
  assert.equal(elements.iVersion.disabled, readOnly, "最新只读状态保留");
}
async function run() {
  const tests = [];
  for (const [stage, results] of [["target", ["success", "error"]], ["reason", ["success", "cancel", "error"]], ["guard", ["success", "cancel"]]]) {
    for (const result of results) tests.push([`等待 ${stage}/${result} 后关闭重开`, () => pendingStage(stage, result)]);
  }
  // 不经过 close 直接切换也必须清掉旧 loading。
  tests.push(["直接 open 切换清理 loading", async () => {
    const h = harness(); h.open(); h.submit(); await flush(); h.loading(true, "旧保存中");
    h.open({ edit:true }); h.loading(false, "直接打开新抽屉"); h.submit(); await flush();
    assert.equal(h.requests.length, 2); h.loading(true, "新抽屉可保存");
  }]);
  for (const result of ["success", "error"]) for (const continueEdit of [false, true]) tests.push([`旧请求 ${result}/${continueEdit}`, () => staleRequest(result, continueEdit)]);
  for (const code of [412, 422]) {
    for (const result of ["cancel", "retry"]) tests.push([`旧 ${code} retry/${result}`, () => retryDecision(code, result)]);
    tests.push([`迟到 ${code} 异常`, () => retryDecision(code, "cancel", true)]);
  }
  for (const result of ["success", "error"]) tests.push([`只读新抽屉隔离旧 ${result}`, async () => {
    const h = harness(); h.open(); h.submit(); await flush(); const old = h.requests[0];
    h.context.forceCloseTaskDrawer(); h.open({ readOnly:true }); readonly(h, "只读新开");
    if (result === "success") old.resolve({ title:"旧任务" }); else old.reject({ code:500 });
    await flush(); readonly(h, "旧回调后仍只读"); h.submit(); await flush();
    assert.equal(h.requests.length, 1, "只读表单不得保存");
    h.open(); h.loading(false, "由只读切回可写"); h.submit(); await flush(); assert.equal(h.requests.length, 2);
  }]);
  tests.push(["当前成功继续编辑保留行为", async () => {
    const h = harness(); h.open({ edit:true }); h.context.rt.formDirty = true; h.submit({ continueEdit:true }); await flush();
    h.requests[0].resolve({ id:"T1", title:"已保存标题", reqId:"R1", updatedAt:"new" }); await flush();
    h.loading(false, "当前成功解锁"); assert.equal(h.context.rt.formDirty, false);
    assert.equal(h.context.taskDrawer.classList.contains("on"), true);
    assert.equal(h.context.taskCacheExtra.T1.updatedAt, "new"); assert.equal(h.context.taskDrawerTitle.textContent, "已保存标题");
    assert.deepEqual(h.refreshes, refreshNames);
  }]);
  tests.push(["当前失败/取消允许重试", async () => {
    const h = harness(); h.open({ edit:true }); h.submit({ move:true }); await flush();
    h.guards[0].resolve(null); await flush(); h.loading(false, "当前 guard 取消");
    h.submit(); await flush(); h.guards[1].resolve({ force:true }); await flush();
    h.requests[0].reject({ code:412 }); await flush(); h.decisions[0].resolve(null); await flush(); h.loading(false, "当前 retry 取消");
    h.submit(); await flush(); h.guards[2].resolve({ force:true }); await flush();
    h.requests[1].reject({ code:500, message:"当前失败" }); await flush(); h.loading(false, "当前失败");
    assert.deepEqual(h.notices, ["当前失败"]);
  }]);
  tests.push(["phase 同抽屉同项目逆序继承", () => versionRace()]);
  tests.push(["phase 旧异常不覆盖最新继承", () => versionRace({ failOld:true })]);
  tests.push(["phase 逆序继承保留只读", () => versionRace({ readOnly:true })]);
  for (const [name, test] of tests) {
    try { await test(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
  console.log(`Frontend lifecycle VM checks passed (${tests.length} cases; real task-drawer/phase function source).`);
}
module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
