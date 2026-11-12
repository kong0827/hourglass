/* Targeted manager view tests; native UI and API contracts without extra dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function element(){
  const listeners = {}, nodes = {}, classes = new Set();
  return {innerHTML:'',textContent:'',value:'',checked:false,disabled:false,dataset:{},isConnected:true,
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},
    setAttribute(key,value){this[key]=value;},focus(){},remove(){this.isConnected=false;},
    addEventListener(type,fn){listeners[type]=fn;},fire(type,event){return listeners[type](event);},
    querySelector(selector){return nodes[selector] || (nodes[selector]=element());},
    querySelectorAll(){return [this.querySelector('select'),this.querySelector('[data-copy-overwrite]'),this.querySelector('button[type="submit"]')];},
    matches(){return false;},closest(){return null;}
  };
}
function setup(view){
  const elements = Object.fromEntries(['projectBody','rosterBody','rosterTools','rosterHeader','rosterSummary','workloadBody','reportBody'].map(id=>[id,element()]));
  const requests=[], downloads=[], notices=[], layers=[], events=[], listeners={};
  const document={body:{dataset:{view:'other'},appendChild(layer){layers.push(layer);}},activeElement:{dataset:{}},
    documentElement:{getAttribute:()=>null},getElementById:id=>elements[id],
    querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>element()};
  const API={get(url,params){requests.push({method:'GET',url,params});return Promise.resolve({});},
    put(url,body){requests.push({method:'PUT',url,body});return Promise.resolve({updated:2});},
    post(url,body){requests.push({method:'POST',url,body});return Promise.resolve({copied:2,skipped:1});}};
  const UI={emptyState:()=>'<empty>',errorState:msg=>'<error>'+msg,skeletonCards:()=>'<loading>',skeletonRows:()=>'<loading>',
    showPrompt:()=>Promise.resolve(null),showConfirm:()=>Promise.resolve(true),
    openModal(layer){layer.classList.add('open');},closeModal(layer){layer.classList.remove('open');if(layer.__uiOnClose)layer.__uiOnClose();}};
  const window={addEventListener(name,fn){(listeners[name] ||= []).push(fn);},dispatchEvent(e){events.push(e);(listeners[e.type]||[]).forEach(fn=>fn(e));}};
  const context=vm.createContext({console,document,window,API,UI,$:id=>elements[id],
    rt:{currentWs:{id:'W1'},reqsLoaded:true,managerProjectId:'P1',reqList:[{id:'P1',name:'项目一'},{id:'P2',name:'项目二'},{id:'P3',name:'归档项目',archivedAt:'2026-01-01'},{id:'PX',name:'其他空间',workspaceId:'W2'}]},
    localStorage:{getItem:()=>null,setItem(){}},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    Set,Array,Promise,Date,setTimeout:fn=>{fn();return 1;},clearTimeout(){},
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    toast:msg=>notices.push(msg),companyChipHTML:name=>'<company>'+String(name||'未设公司')+'</company>',
    avatarHTML:()=>'',icon:()=>'',fullscreenButtonHTML:()=>'',loadBarHTML:n=>String(n),
    fmtHours:n=>String(n||0)+'m',fmtDate:v=>v||'—',fmtMinutesShort:n=>n,typeBadgeHTML:()=>'',
    taskStatusName:t=>t.boardColumn,caliberHTML:s=>s,downloadCsv:(name,rows)=>downloads.push({name,rows:plain(rows)}),
    statusBucket:t=>t.boardColumn,dueState:()=>({kind:'normal'}),openTaskTable(){},openTaskById(){},loadCategories(){},
    loadReqs:()=>Promise.resolve(),listPrefs:{viewMode:()=> 'board',load:()=>Promise.resolve(),setViewMode:()=>Promise.resolve()},
    DEFAULT_ROLE_TITLES:['后端开发','产品经理','全栈工程师'],loadMemberLabelOptions:()=>Promise.resolve({roleTitles:['后端开发','测试'],companyNames:['公司甲']})});
  const helpers=read('frontend/js/lib/member-labels.js');
  vm.runInContext(helpers.slice(helpers.indexOf('function uniqueTitles('),helpers.indexOf('export function loadMemberLabelOptions(')).replaceAll('export ',''),context);
  const source=read('frontend/js/views/'+view+'.js').replace(/^import .*;\s*$/gm,'').replace(/^export \{[^\n]+\};\s*$/gm,'');
  vm.runInContext(source,context);
  return {context,elements,requests,downloads,notices,layers,events,listeners,UI,API,source};
}
function seedRoster(h){
  const c=h.context;
  c.rt.managerProjectId='P1';
  c.cache={project:{id:'P1',reqId:'P1',name:'项目一'},members:[],tasks:[]};c.projectWorkspaceId='W1';
  c.rosterCache={key:'W1:P1',data:{canEditRole:true,members:[
    {userId:'U1',displayName:'一',username:'one',companyName:'公司甲',jobTitle:'后端开发',roleTitle:'',effectiveRoleTitle:'后端开发',roleSource:'workspace',secondaryRoleTitles:['测试'],access:'write',source:'空间成员'},
    {userId:'U2',displayName:'二',companyName:'公司乙',jobTitle:'后端开发',roleTitle:'旧自定义',effectiveRoleTitle:'旧自定义',roleSource:'project',secondaryRoleTitles:[],access:'read',source:'项目授权'},
    {userId:'U3',displayName:'三',companyName:null,jobTitle:null,effectiveRoleTitle:null,roleSource:'unset',secondaryRoleTitles:[],access:'write',source:'项目公开'}
  ]},loading:false,error:null,seq:5,options:{roleTitles:['后端开发','测试']}};
}
async function rosterTests(){
  const h=setup('project'),c=h.context;seedRoster(h);
  c.paintRoster();
  assert.match(h.elements.rosterBody.innerHTML,/空间默认 · 后端开发/);
  assert.match(h.elements.rosterBody.innerHTML,/本项目覆盖 · 旧自定义/);
  assert.match(h.elements.rosterBody.innerHTML,/未设职能（空间与项目均未设置）/);
  assert.match(h.elements.rosterBody.innerHTML,/只读/);assert.match(h.elements.rosterBody.innerHTML,/项目授权/);
  assert.match(c.roleOptions('旧自定义'),/旧自定义/);assert.match(c.roleOptions(''),/全栈工程师/);assert.match(c.roleOptions(''),/产品经理/);
  assert.match(c.roleOptions(''),/__custom__/);
  assert.equal(c.matchesMemberLabels({jobTitle:'__unset__',companyName:'__unset__'},{roleTitle:'__label__:__unset__',companyName:'__label__:__unset__'}),true,'literal sentinel labels are selectable');
  assert.equal(c.matchesMemberLabels({jobTitle:'__unset__'},{roleTitle:'__unset__'}),false,'literal label is not an empty value');
  assert.equal(c.matchesMemberLabels(c.rosterCache.data.members[0],{roleTitle:'测试'}),true,'secondary roles match');
  assert.equal(c.matchesMemberLabels(c.rosterCache.data.members[1],{roleTitle:'后端开发'}),false,'overridden default is not a project role');
  c.rosterUi.roleTitle='__unset__';assert.deepEqual(Array.from(c.filteredRoster(),m=>m.userId),['U3']);
  c.rosterUi.roleTitle='测试';c.onChange({target:{closest:sel=>sel==='[data-roster-all]'?{checked:true}:null}});
  assert.deepEqual(Array.from(c.rosterUi.selected),['U1'],'select-all only filtered rows');
  c.rosterUi.roleTitle='';c.rosterUi.selected.add('U2');c.paintRoster();
  let confirmed;
  h.UI.showConfirm=opts=>{confirmed=opts;return Promise.resolve(true);};
  c.saveRosterBatch();assert.match(h.elements.rosterTools.innerHTML,/data-roster-batch[^>]*disabled/);
  await flush();const batch=h.requests.find(r=>r.method==='PUT');
  assert.deepEqual(plain(batch.body),{userIds:['U1','U2'],roleTitle:''});assert.equal(batch.url,'/api/workspaces/W1/projects/P1/member-roles');
  assert.match(confirmed.msg,/只清除本项目主角色覆盖/);assert.match(confirmed.msg,/不修改兼岗/);
  assert.deepEqual(plain(h.events.at(-1).detail),{projectId:'P1',workspaceId:'W1'});
  seedRoster(h);h.UI.showPrompt=()=>Promise.resolve('测试，实施顾问, 测试');
  c.saveRosterSecondary('U1');await flush();
  assert.deepEqual(plain(h.requests.at(-1).body),{roleTitle:'',secondaryRoleTitles:['测试','实施顾问']});
  seedRoster(h);h.UI.showPrompt=()=>Promise.resolve('');c.saveRosterSecondary('U1');await flush();assert.deepEqual(plain(h.requests.at(-1).body.secondaryRoleTitles),[]);
  seedRoster(h);let count=h.requests.length;h.UI.showPrompt=()=>Promise.resolve('a,b,c,d,e,f');c.saveRosterSecondary('U1');await flush();
  assert.equal(h.requests.length,count);assert.match(h.notices.at(-1),/最多 5/);
  seedRoster(h);h.UI.showPrompt=()=>Promise.resolve('批量自定义');c.chooseRosterBatchRole({value:'__custom__'});await flush();assert.equal(c.rosterUi.batchRole,'批量自定义');assert.doesNotMatch(c.roleOptions('__custom__'),/>__custom__</);
  seedRoster(h);h.UI.showPrompt=()=>Promise.resolve('新自定义');c.saveRosterRole({dataset:{rosterRole:'U2'},value:'__custom__'});await flush();assert.equal(h.requests.at(-1).body.roleTitle,'新自定义');
  seedRoster(h);h.UI.showPrompt=()=>Promise.resolve(null);count=h.requests.length;c.saveRosterRole({dataset:{rosterRole:'U1'},value:'__custom__'});await flush();assert.equal(h.requests.length,count);
  seedRoster(h);const failed=deferred();h.API.put=(url,body)=>{h.requests.push({url,body});return failed.promise;};
  c.saveRosterRole({dataset:{rosterRole:'U1'},value:'产品经理'});await flush();
  assert.equal(c.rosterCache.data.members[0].roleTitle,'','no optimistic data mutation');failed.reject(new Error('服务器拒绝'));await flush();
  assert.equal(c.rosterCache.data.members[0].roleTitle,'');assert.equal(c.rosterWrites.size,0);assert.match(h.notices.at(-1),/服务器拒绝/);
  const late=deferred();h.API.put=(url,body)=>{h.requests.push({url,body});return late.promise;};
  c.saveRosterRole({dataset:{rosterRole:'U1'},value:'产品经理'});await flush();c.rt.managerProjectId='P2';
  c.cache={project:{id:'P2'}};c.rosterCache={key:'W1:P2',seq:10,data:{canEditRole:false,members:[]},options:{},loading:false};
  late.resolve({});await flush();assert.equal(c.rosterCache.key,'W1:P2');assert.equal(h.events.at(-1).detail.projectId,'P1');assert.equal(h.requests.at(-1).url,'/api/workspaces/W1/projects/P1/member-roles/U1');
  seedRoster(h);const prompt=deferred();h.UI.showPrompt=()=>prompt.promise;count=h.requests.length;c.saveRosterRole({dataset:{rosterRole:'U1'},value:'__custom__'});
  c.rt.currentWs.id='W2';prompt.resolve('产品经理');await flush();assert.equal(h.requests.length,count,'space switch during prompt prevents writes');
  c.rt.currentWs.id='W1';c.rt.managerProjectId='P1';seedRoster(h);c.rosterCache.data.canEditRole=false;c.paintRoster();
  assert.doesNotMatch(h.elements.rosterBody.innerHTML,/data-roster-(role|secondary|check)=/);assert.doesNotMatch(h.elements.rosterTools.innerHTML,/data-roster-(copy|batch|options)/);
  c.saveRosterSecondary('U1');assert.equal(h.requests.length,count);
  seedRoster(h);const loads=[];h.API.get=()=>{const d=deferred();loads.push(d);return d.promise;};
  c.loadRoster('P1',true);c.rt.managerProjectId='P2';c.loadRoster('P2',true);
  loads[1].resolve({canEditRole:false,members:[{userId:'NEW',displayName:'新项目'}]});await flush();
  loads[0].resolve({canEditRole:true,members:[{userId:'OLD'}]});await flush();assert.equal(c.rosterCache.data.members[0].userId,'NEW');
}
async function copyTests(){
  const h=setup('project'),c=h.context;seedRoster(h);
  c.openRosterCopy();const layer=h.layers.at(-1);
  assert.match(layer.innerHTML,/来源项目/);assert.match(layer.innerHTML,/有效主角色（含空间继承）/);
  assert.doesNotMatch(layer.innerHTML,/其他空间|value="P1"/);assert.doesNotMatch(layer.innerHTML,/data-copy-overwrite[^>]* checked/);
  layer.querySelector('select').value='P2';layer.querySelector('[data-copy-overwrite]').checked=false;
  layer.querySelector('form').fire('submit',{preventDefault(){}});await flush();
  assert.deepEqual(plain(h.requests.at(-1)),{method:'POST',url:'/api/workspaces/W1/projects/P1/member-roles/copy',body:{sourceProjectId:'P2',overwrite:false}});
  assert.match(layer.querySelector('[data-copy-status]').textContent,/复制 2.*跳过 1/);
  seedRoster(h);c.openRosterCopy();const overwrite=h.layers.at(-1);let confirm;
  overwrite.querySelector('select').value='P2';overwrite.querySelector('[data-copy-overwrite]').checked=true;
  h.UI.showConfirm=opts=>{confirm=opts;return Promise.resolve(false);};const count=h.requests.length;
  overwrite.querySelector('form').fire('submit',{preventDefault(){}});await flush();assert.equal(h.requests.length,count);assert.match(confirm.msg,/无法撤销/);
  h.UI.showConfirm=()=>Promise.resolve(true);overwrite.querySelector('form').fire('submit',{preventDefault(){}});await flush();assert.equal(h.requests.at(-1).body.overwrite,true);
  seedRoster(h);c.openRosterCopy();const pending=h.layers.at(-1),d=deferred();pending.querySelector('select').value='P2';h.API.post=()=>d.promise;
  pending.querySelector('form').fire('submit',{preventDefault(){}});await flush();assert.equal(pending.querySelector('button[type="submit"]').disabled,true);
  h.UI.closeModal(pending);d.resolve({copied:1,skipped:0});await flush();assert.equal(c.rosterWrites.size,0,'closing during loading releases locks after completion');
}
async function projectMemberTests(){
  const h=setup('project'),c=h.context;seedRoster(h);
  c.cache.members=[{key:'U1',name:'一',companyName:'公司甲',effectiveRoleTitle:'后端开发',secondaryRoleTitles:['测试'],taskCount:1},
    {key:'U2',name:'二',companyName:'公司乙',effectiveRoleTitle:'产品经理',taskCount:1}];
  c.cache.tasks=[{id:'T1',ownerUserId:'U1',boardColumn:'doing',title:'选中'}, {id:'T2',ownerUserId:'U2',boardColumn:'doing',title:'未选中'},
    {id:'T3',ownerUserId:'U1',boardColumn:'ended',title:'执行结束'}];
  c.memberFilter={companyName:'公司甲',roleTitle:'测试'};assert.deepEqual(Array.from(c.filteredProjectMembers(),m=>m.key),['U1']);
  let drill;c.openTaskTable=(title,rows)=>{drill=plain(rows);};c.onClick({target:{closest:sel=>sel==='[data-member-key]'?{dataset:{memberKey:'U1'}}:null}});
  assert.deepEqual(drill.map(t=>t.id),['T1']);c.exportProjectMembers();assert.match(JSON.stringify(h.downloads.at(-1).rows),/选中/);assert.doesNotMatch(JSON.stringify(h.downloads.at(-1).rows),/未选中|执行结束/);
}
async function managerScopeTests(view){
  const h=setup(view),c=h.context,load=view==='workload'?'loadWorkload':'loadReport';
  const setScope=(req,role,company)=>{if(view==='workload')c.workloadFilter={reqId:req,roleTitle:role,companyName:company};else{c.reqId=req;c.roleTitle=role;c.companyName=company;}};
  const data=scope=>({today:'2026-11-12',weekStart:'2026-11-09',scope,filterOptions:{roleTitles:['测试','__unset__'],companyNames:['公司甲','__unset__']},
    members:[{key:'U1',name:'一',companyName:'公司甲',jobTitle:'后端开发',roleTitles:['测试'],remainingMinutes:60,capacityMinutes:480,weekMinutes:30,dayMinutes:[30,0,0,0,0,0,0],projects:[],tasks:[],weekLogs:[]}],projects:[],burndown:{points:[]},velocity:{weeks:[]},flow:{weeks:[]},delivery:{buckets:[]},defects:{weeks:[]}});
  await c[load]();setScope('P1','旧自定义','公司甲');const calls=[];
  h.API.get=(url,params)=>{const d=deferred();calls.push({url,params,d});return d.promise;};
  const first=c[load]();assert.deepEqual(plain(calls[0].params),{reqId:'P1',roleTitle:'旧自定义',companyName:'公司甲'});
  if(view==='workload')c.exportWorkloadScope();else c.exportCsv();assert.equal(h.downloads.length,0,'loading cannot export stale cache');
  setScope('P2','测试','__unset__');const second=c[load]();calls[1].d.resolve(data({reqId:'P2',roleTitle:'测试',companyName:'__unset__'}));await second;
  calls[0].d.resolve(data({reqId:'P1',roleTitle:'旧自定义',companyName:'公司甲'}));await first;assert.equal(c.cache.scope.reqId,'P2','late request cannot overwrite latest filters');
  const text=view==='workload'?c.workloadScopeText(c.cache):c.reportScopeText(c.cache);assert.match(text,/项目二.*未设公司.*测试/);
  if(view==='workload')c.exportWorkloadScope();else c.exportCsv();assert.match(JSON.stringify(h.downloads.at(-1).rows[0]),/项目二.*未设公司.*测试/);
  assert.equal(calls.length,2,'CSV uses cache, never an unfiltered extra API');
  const late=c[load]();c.rt.currentWs.id='W2';calls[2].d.resolve(data({reqId:'P1'}));await late;assert.equal(c.cache.scope.reqId,'P2','old workspace responses ignored');
  if(view==='workload')c.exportWorkloadScope();else c.exportCsv();assert.equal(h.downloads.length,1,'old workspace data cannot export');
  const newSpace=c[load]();assert.deepEqual(plain(calls[3].params),{reqId:null,roleTitle:null,companyName:null});calls[3].d.resolve(data({}));await newSpace;
  setScope('P1','测试','公司甲');const inaccessible=c[load]();calls[4].d.reject(Object.assign(new Error('hidden'),{code:403}));await flush();
  assert.equal(calls[5].params.reqId,null);calls[5].d.resolve(data({roleTitle:'测试',companyName:'公司甲'}));await inaccessible;
  const error=c[load]();calls[6].d.reject(new Error('offline'));await error;
  const html=h.elements[view+'Body'].innerHTML;assert.match(html,/清除筛选/);assert.match(html,/offline/);assert.match(html,view==='workload'?/data-load-export[^>]*disabled/:/data-report-csv[^>]*disabled/);
  const seq=c.seq;c.window.dispatchEvent(new c.CustomEvent('ds:member-company-changed',{detail:{workspaceId:'other'}}));assert.equal(c.seq,seq,'unrelated workspace events ignored');
  c.window.dispatchEvent(new c.CustomEvent('ds:member-job-title-changed',{detail:{workspaceId:'W2'}}));assert.equal(c.cache,null);assert.equal(c.seq,seq+1);
  c.document.body.dataset.view=view;
  c.window.dispatchEvent(new c.CustomEvent('ds:project-roles-changed',{detail:{workspaceId:'W2',projectId:'P2'}}));
  assert.equal(calls.length,8,'visible workload/report reload after project role events');
  calls[7].d.resolve(data({roleTitle:'测试',companyName:'公司甲'}));await flush();assert.equal(c.cache.scope.roleTitle,'测试');
  if(view==='report'){
    assert.match(h.source,/ctx\.fillText\(reportScopeText\(cache\)/,'PNG identifies exact backend scope');
    assert.match(c.reportLabelOptions(['测试'],'旧自定义','全部角色','未设角色'),/旧自定义/);
  }else assert.match(c.workloadSelectOptions(['测试'],'旧自定义','全部角色','未设角色'),/旧自定义/);
}
(async()=>{
  await rosterTests();await copyTests();await projectMemberTests();await managerScopeTests('workload');await managerScopeTests('report');
  const css=read('frontend/css/manager.css');assert.match(css,/@media\(max-width:760px\)[\s\S]*\.roster-tbl\{display:block;min-width:0/);assert.match(css,/#projectBody \.tbl-wrap,#workloadBody \.tbl-wrap\{overflow-x:auto;/);
  console.log('PASS manager roles: inheritance/secondary/custom/read-only/filter selection/batch/copy/rollback/async scope; workload/report: API filters, CSV/PNG scope, fallback and event invalidation');
})().catch(error=>{console.error(error);process.exitCode=1;});
