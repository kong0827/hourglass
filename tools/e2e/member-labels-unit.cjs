/* 真实模块源回归：职能继承、候选权限口径、异步隔离与跨项目批量候选。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function section(src, start, end){ const a=src.indexOf(start), b=src.indexOf(end,a+start.length); assert(a>=0&&b>a); return src.slice(a,b); }
function deferred(){ let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
async function flush(){ for(let i=0;i<16;i++) await Promise.resolve(); }
function harness(){
  const listeners={}, calls=[], hint={hidden:true,innerHTML:''};
  let html='';
  const owner={tagName:'SELECT',options:[],selectedIndex:-1,disabled:false,parentNode:{appendChild(){}},get innerHTML(){return html;},set innerHTML(value){
    html=value;
    this.options=[...value.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(m=>({value:(m[1].match(/value="([^"]*)"/)||[])[1]||'',dataset:{name:(m[1].match(/data-name="([^"]*)"/)||[])[1]||''},textContent:m[2],selected:/\bselected\b/.test(m[1]),disabled:/\bdisabled\b/.test(m[1])}));
    this.selectedIndex=this.options.findIndex(o=>o.selected); if(this.selectedIndex<0)this.selectedIndex=this.options.findIndex(o=>!o.disabled);
  }};
  const rt={currentWs:{id:'W1',type:'shared'},currentUser:{id:'U1',displayName:'我'},wsMembersCache:[{userId:'U1',displayName:'我',role:'owner',jobTitle:'项目经理'},{userId:'U2',displayName:'陈昊',role:'member',companyName:'乙方',jobTitle:'后端开发'},{userId:'U3',displayName:'无权限',role:'member'},{userId:'U4',displayName:'查看者',role:'viewer'}],listCache:{},drawerReadOnly:false};
  const context=vm.createContext({console,Promise,rt,iOwner:owner,iReq:{value:'P1'},$:()=>hint,document:{createElement:()=>({setAttribute(){},addEventListener(){}})},esc:v=>String(v),window:{addEventListener(name,fn){(listeners[name]||=[]).push(fn);}},API:{get(url){const d=deferred();calls.push({url,...d});return d.promise;}}});
  vm.runInContext(read('frontend/js/lib/company.js').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
  vm.runInContext(read('frontend/js/lib/member-labels.js').replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
  vm.runInContext(section(read('frontend/js/core/task-drawer.js'),'/* 项目候选以服务端花名册为准','function syncFormSegs('),context);
  return {context,rt,owner,calls,emit(name,detail){for(const fn of listeners[name]||[])fn({detail});}};
}
function plain(value){return JSON.parse(JSON.stringify(value));}
(async()=>{
  let n=0; const ok=()=>n++;
  const h=harness(), c=h.context;
  assert.equal(c.effectiveMemberRole({jobTitle:'后端开发'}),'后端开发');
  assert.equal(c.effectiveMemberRole({roleTitle:'全栈工程师',jobTitle:'前端开发'}),'全栈工程师');
  assert.deepEqual(plain(c.memberRoleTitles({jobTitle:'全栈工程师',secondaryRoleTitles:['测试','测试','全栈工程师']})),['全栈工程师','测试']); ok();
  assert.equal(c.ownerOptions().length,0,'花名册未加载不得开放空间全部成员');
  c.populateOwnerSelect('陈昊','U2'); assert(h.owner.disabled); assert.equal(c.ownerPick().userId,'U2','异步加载保留账号ID');
  assert.equal(h.calls.length,1); ok();
  h.calls[0].resolve({members:[{userId:'U2',displayName:'陈昊',companyName:'乙方',jobTitle:'后端开发',secondaryRoleTitles:['测试'],access:'write'}]}); await flush();
  assert(!h.owner.disabled, JSON.stringify({html:h.owner.innerHTML, cache:c.peekProjectMembers('W1','P1'), error:c.projectRoleErrors, loading:c.projectRoleLoading, ws:h.rt.currentWs, pid:c.currentProjectId(), calls:h.calls.map(x=>x.url)})); assert.deepEqual(plain(c.ownerOptions().map(x=>x.id)),['U2']);
  assert(h.owner.innerHTML.includes('陈昊 · 后端开发 / 测试 · 乙方')); assert(!h.owner.innerHTML.includes('无权限')); ok();
  c.populateOwnerSelect('历史负责人','U3'); assert.equal(c.ownerPick().userId,'U3');
  assert(h.owner.options.find(o=>o.value==='U3').disabled,'历史非候选只能保留，不可重新选择'); ok();
  c.iReq.value='P2'; c.refreshOwnerSelect(); const p2=h.calls[1]; assert(h.owner.disabled);
  c.iReq.value='P3'; c.refreshOwnerSelect(); const p3=h.calls[2];
  p2.resolve({members:[{userId:'U2',displayName:'错误项目',roleTitle:'错误'}]}); await flush();
  assert(!h.owner.innerHTML.includes('错误项目')); assert(h.owner.disabled); ok();
  p3.resolve({members:[{userId:'U1',displayName:'我',companyName:'甲方',effectiveRoleTitle:'项目经理'}]}); await flush();
  assert(!h.owner.innerHTML.includes('错误项目')); assert(h.owner.innerHTML.includes('甲方')); ok();
  c.iReq.value='P4'; c.populateOwnerSelect('陈昊','U2'); h.calls[3].reject(new Error('断网')); await flush();
  assert(h.owner.disabled); assert.equal(c.ownerOptions().length,0,'失败关闭候选'); assert.equal(c.ownerPick().userId,'U2'); ok();
  c.ensureProjectRoles('P4',true); h.calls[4].resolve({members:[{userId:'U2',displayName:'陈昊',jobTitle:'后端开发'}]}); await flush(); assert(!h.owner.disabled); ok();
  h.emit('ds:member-job-title-changed',{workspaceId:'W1'}); assert(h.owner.disabled); const latest=h.calls[h.calls.length-1]; latest.resolve({members:[{userId:'U2',displayName:'陈昊',jobTitle:'全栈工程师'}]}); await flush(); assert(h.owner.innerHTML.includes('全栈工程师')); ok();
  h.emit('ds:member-job-title-changed',{workspaceId:'W2'}); assert(!h.owner.disabled,'其他空间事件不干扰当前选择'); ok();
  const r=harness(); const a=r.context.loadProjectMembers('W1','P1');
  r.emit('ds:project-roles-changed',{workspaceId:'W1',projectId:'P1'}); const b=r.context.loadProjectMembers('W1','P1');
  r.calls[1].resolve({members:[{userId:'new'}]}); await b; r.calls[0].resolve({members:[{userId:'old'}]}); await a;
  assert.equal(r.context.peekProjectMembers('W1','P1').members[0].userId,'new','失效前旧响应不得覆盖新缓存'); ok();
  const l=harness(); l.context.iReq.value=''; l.rt.listCache={T1:{reqId:'P1'},T2:{reqId:'P2'}};
  vm.runInContext(section(read('frontend/js/views/list.js'),'function bulkOwnerCandidates(','function openBulkMenu('),l.context);
  const candidates=l.context.bulkOwnerCandidates(['T1','T2'],'W1');
  l.calls[0].resolve({members:[{userId:'U1',displayName:'我',roleTitle:'项目经理'},{userId:'U2',displayName:'陈昊',roleTitle:'后端开发'}]});
  l.calls[1].resolve({members:[{userId:'U2',displayName:'陈昊',roleTitle:'全栈工程师',companyName:'乙方'}]});
  const options=plain(await candidates); assert.deepEqual(options.map(x=>x.id),['U2']); assert.equal(options[0].role,'后端开发 / 全栈工程师'); ok();
  const s=harness(); s.context.iReq.value=''; assert(!plain(s.context.ownerOptions('')).some(x=>x.id==='U4'),'无项目也排除查看者'); ok();
  s.rt.currentWs={id:'PRIVATE',type:'personal'}; assert.deepEqual(plain(s.context.ownerOptions().map(x=>x.id)),['U1']); ok();
  console.log(`member-labels-unit: ${n} cases passed`);
})().catch(ex=>{console.error(ex);process.exit(1);});
