/* moveDrawerTask 在途守卫：同一任务在请求未回前不得重复提交，成功/失败/取消后必须释放。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/js/core/task-drawer.js"), "utf8");
const from = "/* 状态只有一个入口";
const to = "/* 测试中尚未认领";
const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
assert.ok(start >= 0 && end > start, "moveDrawerTask 源码边界缺失");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

function harness() {
  const requests = [], notices = [], guards = [], decisions = [];
  const context = vm.createContext({
    console,
    rt: { editingId:null, currentWs:{ id:"W1" }, drawerReadOnly:false },
    taskCacheExtra:{},
    iCol:{ value:"backlog" },
    iTitle:{ value:"" },
    API:{ post(url, body) { const d = deferred(); requests.push({ url, body, ...d }); return d.promise; } },
    guard() { const d = deferred(); guards.push(d); return d.promise; },
    serverDecision() { const d = deferred(); decisions.push(d); return d.promise; },
    toast(message) { notices.push(message); },
    window:{ dispatchEvent(){} },
    CustomEvent:class { constructor(type) { this.type = type; } },
    drawerColMeta:col => ({ name:col })
  });
  vm.runInContext(
    "function syncProgByCol(){} function syncHeadAfterMove(){} function syncTestWindow(){} function renderReadView(){}" +
    " function syncDueNote(){} function loadWorkStatus(){} function loadRunningTimer(){} function loadBoard(){} function loadReqs(){}" +
    " function refreshListIfOpen(){} function refreshGanttIfOpen(){} function refreshCalendarIfOpen(){} function refreshTreeIfOpen(){}" +
    " function refreshChainIfOpen(){} function refreshAssociationViews(){} function taskById(){ return null; }",
    context
  );
  vm.runInContext(source.slice(start, end), context, { filename:"task-drawer.js moveDrawerTask" });
  return { context, requests, notices, guards, decisions };
}
function switchTo(h, id, column) {
  h.context.taskCacheExtra[id] = { id, title:id, boardColumn:column, workspaceId:"W1" };
  h.context.rt.editingId = id;
  h.context.iCol.value = column;
}

const tests = [];
tests.push(["请求在途时重复移列只发一次", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 1);
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 1, "在途时不得再次进入校验");
  h.guards[0].resolve({ force:false });
  await flush();
  assert.equal(h.requests.length, 1);
  h.context.moveDrawerTask("review");
  assert.equal(h.requests.length, 1, "请求未回前不得重复提交");
  h.requests[0].resolve({ task:{ id:"T1", boardColumn:"review" }, to:"review" });
  await flush();
  assert.equal(h.context.iCol.value, "review");
  h.context.moveDrawerTask("done");
  assert.equal(h.guards.length, 2, "成功后必须释放守卫");
}]);
tests.push(["服务端失败后释放守卫", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review"); h.guards[0].resolve({ force:false }); await flush();
  h.requests[0].reject({ code:500, message:"服务端错误" }); await flush();
  assert.equal(h.decisions.length, 1);
  h.decisions[0].resolve(null); await flush();
  assert.deepEqual(h.notices, ["服务端错误"]);
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 2, "失败后必须能再次移动");
}]);
tests.push(["412 取消后释放守卫且不提示", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review"); h.guards[0].resolve({ force:false }); await flush();
  h.requests[0].reject({ code:412, message:"需要原因" }); await flush();
  assert.equal(h.decisions.length, 1);
  h.decisions[0].resolve(null); await flush();
  assert.deepEqual(h.notices, []);
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 2, "取消补救后必须能再次移动");
}]);
tests.push(["guard 取消后释放守卫", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review");
  h.guards[0].resolve(null); await flush();
  assert.equal(h.requests.length, 0);
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 2, "校验取消后必须能再次移动");
}]);
tests.push(["补救重试再失败后释放守卫", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review"); h.guards[0].resolve({ force:false }); await flush();
  h.requests[0].reject({ code:500 }); await flush();
  h.decisions[0].resolve({ force:true }); await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].reject({ code:500, message:"强制也失败" }); await flush();
  assert.deepEqual(h.notices, ["强制也失败"]);
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 2, "补救失败后必须能再次移动");
}]);
tests.push(["不同任务的在途移列互不阻塞", async () => {
  const h = harness(); switchTo(h, "T1", "backlog");
  h.context.moveDrawerTask("review");
  switchTo(h, "T2", "backlog");
  h.context.moveDrawerTask("review");
  assert.equal(h.guards.length, 2, "切换任务后另一任务仍应可提交");
  h.guards[0].resolve({ force:false }); h.guards[1].resolve({ force:false });
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].body.column, "review");
  assert.equal(h.requests[1].body.column, "review");
}]);

async function run() {
  for (const [name, test] of tests) {
    try { await test(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
  console.log(`Drawer move guard checks passed (${tests.length} cases; real moveDrawerTask source).`);
}
module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
