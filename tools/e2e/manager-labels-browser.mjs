/* Render-only manager tests with local Chrome CDP; no server, downloads or dependencies. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const strip=s=>s.replace(/^import .*;\s*$/gm,'').replace(/^export \{[^\n]+\};\s*$/gm,'').replaceAll('export function ','function ').replaceAll('export var ','var ');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hourglass-manager-labels-'));
const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--remote-debugging-pipe','--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--user-data-dir='+profile],
  {stdio:['ignore','ignore','pipe','pipe','pipe']});
let id=0,buffer='',stderr='';const pending=new Map();
chrome.stderr.on('data',s=>{stderr+=s;});
chrome.on('error',e=>{for(const p of pending.values())p.reject(e);});
chrome.on('exit',()=>{for(const p of pending.values())p.reject(new Error('Chrome exited: '+stderr));});
chrome.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();let at;
  while((at=buffer.indexOf('\0'))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;
    const msg=JSON.parse(line),p=pending.get(msg.id);if(!p)continue;pending.delete(msg.id);clearTimeout(p.timeout);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);
  }
});
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
  const key=++id,timeout=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method));},20000);
  pending.set(key,{resolve,reject,timeout});chrome.stdio[3].write(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})})+'\0');
});}
async function evaluate(session,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
const css=['tokens','base','components','layout','manager','mobile'].map(name=>read('frontend/css/'+name+'.css')).join('\n');
const fixture=[
  {userId:'U1',key:'U1',displayName:'陈昊',name:'陈昊',username:'chenhao',companyName:'外部协作公司',jobTitle:'后端开发',roleTitle:'',effectiveRoleTitle:'后端开发',roleSource:'workspace',secondaryRoleTitles:['测试'],roleTitles:['后端开发','测试'],access:'write',source:'空间成员',taskCount:1,remainingMinutes:60,actualWeekMinutes:30,weekMinutes:30,capacityMinutes:480,loadPct:13,dayMinutes:[30,0,0,0,0,0,0],projects:[{reqId:'P1',name:'支付项目',taskCount:1,remainingMinutes:60,effectiveRoleTitle:'后端开发',secondaryRoleTitles:['测试']}],tasks:[],weekLogs:[]},
  {userId:'U2',key:'U2',displayName:'赵磊',name:'赵磊',username:'zhaolei',companyName:'云启实施',jobTitle:'前端开发',roleTitle:'全栈工程师',effectiveRoleTitle:'全栈工程师',roleSource:'project',secondaryRoleTitles:[],roleTitles:['全栈工程师'],access:'read',source:'项目授权',taskCount:1,remainingMinutes:120,weekMinutes:60,capacityMinutes:480,loadPct:25,dayMinutes:[60,0,0,0,0,0,0],projects:[],tasks:[],weekLogs:[]}
];
function harness(view){return `
var rt={currentWs:{id:'W1',type:'shared',myRole:'owner'},reqsLoaded:true,managerProjectId:'P1',reqList:[{id:'P1',name:'统一支付网关'},{id:'P2',name:'其他可见项目'}]};
var $=id=>document.getElementById(id), icon=()=>'', fullscreenButtonHTML=()=>'', avatarHTML=()=>'';
var companyChipHTML=name=>'<span class="tag tag-ghost">'+String(name||'未设公司')+'</span>';
var fmtHours=n=>((Number(n)||0)/60)+'h',fmtDate=v=>v||'—',fmtMinutesShort=fmtHours,typeBadgeHTML=()=>'',loadBarHTML=n=>n+'%',taskStatusName=t=>t.boardColumn;
var caliberHTML=t=>'<details class="manager-caliber"><summary>口径</summary><div>'+t+'</div></details>',downloadCsv=()=>{},openTaskById=()=>{},openTaskTable=()=>{},loadCategories=()=>{},loadReqs=()=>Promise.resolve();
var listPrefs={viewMode:()=> 'board',load:()=>Promise.resolve(),setViewMode:()=>Promise.resolve()},statusBucket=t=>t.boardColumn,dueState=()=>({kind:'normal'});
var members=${JSON.stringify(fixture)},canEdit=true;
var API={get:(url,params)=>{
 if(url.endsWith('/member-label-options'))return Promise.resolve({roleTitles:['全栈工程师','产品经理','后端开发','测试'],companyNames:['云启实施','外部协作公司']});
 if(url.endsWith('/members'))return Promise.resolve({canEditRole:canEdit,members});
 if(url.includes('/manager/projects/'))return Promise.resolve({project:{id:'P1',reqId:'P1',name:'统一支付网关'},members,metrics:{},counts:{},tasks:[],modules:[],epics:[]});
 return Promise.resolve({today:'2026-11-12',weekStart:'2026-11-09',scope:params||{},filterOptions:{roleTitles:['全栈工程师','后端开发','测试'],companyNames:['云启实施','外部协作公司']},projects:[{id:'P1',name:'统一支付网关'}],members,burndown:{points:[]},velocity:{weeks:[]},flow:{weeks:[]},delivery:{buckets:[]},defects:{weeks:[]}});
},put:()=>Promise.resolve({updated:1}),post:()=>Promise.resolve({copied:1,skipped:1})};
${strip(read('frontend/js/core/ui.js'))}
var esc=esc2;
${strip(read('frontend/js/lib/member-labels.js'))}
${strip(read('frontend/js/views/'+view+'.js'))}
`}
async function createPage(view){
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
  const {frameTree}=await send('Page.getFrameTree',{},sessionId);
  await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body data-view="${view}"><main style="padding:16px;min-width:0;width:100%"><div id="${view}Body"></div></main></body></html>`},sessionId);
  await evaluate(sessionId,harness(view));
  await evaluate(sessionId,view==='project'?`projectTab='roles';loadProject();`:`${view==='workload'?'loadWorkload':'loadReport'}();`);
  await evaluate(sessionId,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  return {sessionId,targetId};
}
try{
  for(const view of ['project','workload','report']){
    const {sessionId,targetId}=await createPage(view);
    for(const width of [375,390,844,1280]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:width===844?390:900,deviceScaleFactor:1,mobile:width<760},sessionId);
      for(const dark of [false,true]){
        await evaluate(sessionId,`document.documentElement.setAttribute('data-theme','${dark?'dark':'light'}')`);
        const size=await evaluate(sessionId,'({scroll:document.documentElement.scrollWidth,viewport:innerWidth})');
        assert.ok(size.scroll<=size.viewport,`${view} ${width}px ${dark?'dark':'light'} overflow: ${JSON.stringify(size)}`);
      }
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true},sessionId);
    if(view==='project'){
      const heights=await evaluate(sessionId,"Array.from(document.querySelectorAll('.roster-role,.roster-actions button,.roster-check-label')).map(el=>el.getBoundingClientRect().height)");
      assert.ok(heights.every(h=>h>=44),'mobile roster touch targets are at least 44px');
      assert.equal(await evaluate(sessionId,"!!document.querySelector('[data-roster-options]')"),true,'workspace owner sees dictionary management');
      await evaluate(sessionId,"rt.currentWs.myRole='member';paintRoster()");
      assert.equal(await evaluate(sessionId,"!!document.querySelector('[data-roster-options]')"),false,'project owner without workspace admin does not see dictionary management');
      await evaluate(sessionId,"rt.currentWs.myRole='owner';paintRoster()");
      await evaluate(sessionId,"var f=document.querySelector('[data-roster-filter=roleTitle]');f.value='测试';f.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-roster-all]').click();");
      const selection=await evaluate(sessionId,"({rows:document.querySelectorAll('[data-roster-user]').length,selected:rosterUi.selected.size})");assert.deepEqual(selection,{rows:1,selected:1});
      await evaluate(sessionId,"document.querySelector('[data-roster-copy]').click()");
      assert.equal(await evaluate(sessionId,"!!document.querySelector('.modal-layer.open .roster-copy-sheet')"),true);
      assert.ok(await evaluate(sessionId,"document.documentElement.scrollWidth<=innerWidth"),'copy modal fits 390px');
      await evaluate(sessionId,"document.querySelector('[data-copy-close]').click();document.querySelector('[data-roster-role]').value='__custom__';document.querySelector('[data-roster-role]').dispatchEvent(new Event('change',{bubbles:true}));");
      await evaluate(sessionId,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await evaluate(sessionId,"document.querySelector('.modal-layer.open input')?.getAttribute('maxlength')"),'32');
      await evaluate(sessionId,"document.querySelector('[data-prompt-cancel]').click()");
      await evaluate(sessionId,'Promise.resolve().then(()=>Promise.resolve())');
      assert.equal(await evaluate(sessionId,"document.querySelector('[data-roster-role]').value"),'','cancel restores inherited role');
      await evaluate(sessionId,"canEdit=false;loadRoster('P1',true)");
      assert.equal(await evaluate(sessionId,"document.querySelectorAll('[data-roster-role],[data-roster-secondary],[data-roster-copy],[data-roster-check]').length"),0,'read-only has no write controls');
      await evaluate(sessionId,"document.querySelector('[data-project-tab=roles]').focus()");
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'},sessionId);
      assert.equal(await evaluate(sessionId,'projectTab'),'members','keyboard tab navigation works');
    }else{
      const filters=await evaluate(sessionId,"Array.from(document.querySelectorAll('.manager-label-filters select')).map(el=>el.getBoundingClientRect().height)");assert.ok(filters.every(h=>h>=44));
    }
    await send('Target.closeTarget',{targetId});
  }
  console.log('PASS local Chrome render: project/workload/report at 375/390/844/1280px, light/dark, no page overflow; native roster selection, copy/prompt close, read-only and keyboard tabs');
}finally{
  chrome.kill();await new Promise(resolve=>chrome.once('exit',resolve));fs.rmSync(profile,{recursive:true,force:true});
}
