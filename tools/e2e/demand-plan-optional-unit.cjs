const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'frontend/js/views/demands.js'), 'utf8');
const element = (value = '') => ({ value, disabled:false, innerHTML:'', textContent:'', classList:{remove(){},add(){}}, setAttribute(){}, focus(){} });
const elements = Object.fromEntries(['dpVersion','dpNote','dpPlannedStart','dpPlannedEnd','dpPriority','fDemandPlanVer','btnDoPlan','demandPlanTitle'].map(id => [id, element()]));
const requests = [], notices = [];
let resolveVersions;
const demand = {id:'D1',reqId:'R1',revision:7,status:'pass',priority:'P2',versionId:null};
const context = vm.createContext({
  $:id => elements[id], ...elements,
  findDemand:() => demand, canScheduleDemand:() => true, denySchedule(){},
  planDemandId:null, planDemandRevision:null, planAction:null, versionNames:{}, versions:[],
  listPrefs:{viewMode:() => 'table'}, drawerDemandOpts:{reqId:'R1'},
  API:{get:() => new Promise(resolve => {resolveVersions = resolve;}),post:(url,body) => {requests.push({url,body});return Promise.resolve({});}},
  UI:{openModal(){},closeModal(){}}, toast:message => notices.push(message),
  esc:value => String(value), versionName:id => id, loadDemands(){},
  PRIORITIES:["P0","P1","P2","P3"], priName:code => ({P0:"紧急",P1:"高",P2:"中",P3:"低"}[code] || code)
});
vm.runInContext(source.slice(source.indexOf('function syncPlanPriOptions('), source.indexOf('/* ---------- 详情')), context);
async function flush(){await Promise.resolve();await Promise.resolve();}
(async () => {
  context.openPlanDialog('D1',false);
  assert.equal(elements.dpVersion.disabled,true);
  context.doPlan();
  assert.equal(requests.length,0,'loading cannot submit a spurious empty target');
  resolveVersions([]);await flush();
  assert.equal(elements.dpVersion.disabled,false);
  assert.ok(elements.dpVersion.innerHTML.includes('暂不指定目标版本'));
  elements.dpPlannedStart.value='2026-12-01';elements.dpPlannedEnd.value='2026-12-10';
  context.doPlan();await flush();
  assert.equal(requests[0].url,'/api/demands/D1/plan');
  assert.equal(requests[0].body.versionId,null);
  assert.equal(requests[0].body.plannedStart,'2026-12-01');
  assert.equal(requests[0].body.revision,7);
  assert.ok(notices.some(message => message.includes('暂不指定目标版本')));
  demand.status='plan';demand.versionId='V1';
  context.openPlanDialog('D1',true);
  resolveVersions([{id:'V1',name:'1.0',status:'active'},{id:'V2',name:'2.0',status:'released'}]);await flush();
  assert.ok(!elements.dpVersion.innerHTML.includes('value="V2"'));
  assert.equal(elements.dpVersion.value,'V1');
  elements.dpVersion.value='';context.doPlan();
  assert.equal(requests.length,1,'clearing target still requires replan reason');
  elements.dpNote.value='只确定日期，版本待定';context.doPlan();await flush();
  assert.equal(requests[1].url,'/api/demands/D1/replan');
  assert.equal(requests[1].body.versionId,null);
  assert.equal(requests[1].body.note,'只确定日期，版本待定');
  context.openPlanDialog('D1',true);
  resolveVersions([{id:'V1',name:'1.0',status:'active'}]);await flush();
  elements.dpNote.value='调整日期';elements.dpPlannedStart.value='2026-12-20';elements.dpPlannedEnd.value='2026-12-10';
  context.doPlan();assert.equal(requests.length,2,'reversed dates remain rejected');
  const phase = fs.readFileSync(path.join(root,'frontend/js/views/phase.js'),'utf8');
  context.cache={phase:{firstReleasedAt:null},vstats:{versions:[]},tasks:[{id:'T1',boardColumn:'done',versionIds:['V1']},{id:'T2',boardColumn:'backlog',versionIds:['V1']}]};
  context.taskVersionIds=task => task.versionIds;
  vm.runInContext(phase.slice(phase.indexOf('function preLaunchVersionId('),phase.indexOf('function openDrillModal(')),context);
  assert.deepEqual(Array.from(context.drillRows('version','V1','当前完成工作项'),task => task.id),['T1']);
  console.log('PASS optional demand target, loading, reason/date/revision guards and completed-count drilldown');
})().catch(error => {console.error(error);process.exitCode=1;});
