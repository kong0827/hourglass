/* Force the picker's loading / error+retry / retained states in the REAL app by intercepting
   the project-roster endpoint at document start. Each scenario runs on a fresh page. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome} from './pp-app-driver.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(root,'tools/e2e/shots');fs.mkdirSync(OUT,{recursive:true});
const BASE='http://localhost:8082/hourglass';
const WS='Smw9zcftmwwnrwuon',PROJ='R4wejtfugwrudffx8x4x9',TASK='Ksxyz0btsl17egy6fspm4';
const ROSTER=`/api/workspaces/${WS}/projects/${PROJ}/members`;
function readCookies(file){const out=[];for(const line of fs.readFileSync(file,'utf8').split('\n')){if(!line||line.startsWith('# ')||line.startsWith('# Netscape'))continue;const ho=line.startsWith('#HttpOnly_');const p=(ho?line.slice(9):line).split('\t');if(p.length<7)continue;out.push({name:p[5],value:p[6],domain:'localhost',path:'/hourglass',httpOnly:ho,secure:false});}return out;}
const cookies=readCookies('/tmp/hg_zhangwei.txt');
const cookieHeader=cookies.map(c=>c.name+'='+c.value).join('; ');
const results=[];function record(n,ok,d){results.push({n,ok,d:d||''});console.log((ok?'PASS':'FAIL')+' · '+n+(d?' · '+d:''));}
// current owner of the test task (to remove it from the roster for the retained scenario)
const taskRes=await fetch(`${BASE}/api/task/${TASK}?workspace=${WS}`,{headers:{cookie:cookieHeader}});
const taskJson=await taskRes.json();
const OWNER=(taskJson.data||{}).ownerUserId||'';
console.log('task owner =',OWNER);

const drv=await launchChrome();
const ev=(S,x)=>drv.evaluate(S,x),wait=(S,x,t)=>drv.waitFor(S,x,t);
const shot=(S,n)=>drv.screenshot(S,path.join(OUT,n+'.png')).catch(e=>console.log('shot fail '+e.message));

async function scenario(name,patchSource,fn){
  const {sessionId:S,targetId}=await drv.newPage();
  await drv.setCookies(S,cookies);
  if(patchSource)await drv.send('Page.addScriptToEvaluateOnNewDocument',{source:patchSource},S);
  try{
    await drv.navigate(S,BASE+'/');
    await wait(S,'!!document.getElementById("sideNav")',15000);
    await ev(S,`location.hash='#/board'`);
    await wait(S,'document.body.dataset.view==="board"',15000);
    // Freeze realtime refresh after boot: SSE flush, onSseChanged and the 30s poll all bail when
    // document.hidden, so cross-page/run events can't re-render the board and close the picker
    // mid-scenario (the read-mode drawer is not a modal, so anyDialogOpen() wouldn't shield it).
    await ev(S,`Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return 'hidden';}});`);
    await fn(S);
  }catch(e){record(name+' · HARNESS EXCEPTION',false,e.message);await shot(S,'96-error-'+name);}
  finally{await drv.send('Target.closeTarget',{targetId});}
}
const openTask=async(S)=>{
  await ev(S,`location.hash='#/board?task='+encodeURIComponent('${TASK}')`);
  await wait(S,'!!document.querySelector("[data-fact-edit=owner]")',15000);
};
const clickOwner=async(S)=>{
  for(let i=0;i<4;i++){
    await ev(S,'document.querySelector("[data-fact-edit=owner]").click()');
    if(await wait(S,'!!document.querySelector(".people-picker")',2500).then(()=>true).catch(()=>false))return true;
    await ev(S,'new Promise(r=>setTimeout(r,350))');
  }
  return false;
};
const stateOf=S=>ev(S,`(function(){var p=document.querySelector('.people-picker');if(!p)return null;return {
  loading:!!p.querySelector('.pp-loading'),skel:p.querySelectorAll('.pp-skel').length,
  error:!!p.querySelector('.pp-error'),errText:(p.querySelector('.pp-error')||{}).textContent||'',retry:!!p.querySelector('[data-retry]'),
  retained:!!p.querySelector('.pp-opt[data-pick="__retained__"]'),retainedDisabled:!!(p.querySelector('.pp-opt[data-pick="__retained__"]')||{}).disabled,
  retainedNote:!!p.querySelector('.pp-retained-note'),
  opts:p.querySelectorAll('.pp-opt[data-pick]').length,count:(p.querySelector('.pp-count')||{}).textContent||''};})()`);

try{
  // ---- 1. loading skeleton, then auto-refresh to real options ----
  // Open the picker first (roster loads), then install a hold wrapper via evaluate and force a
  // fresh fetch through project-roles-changed so the skeleton window is deterministic (boot-time
  // script injection raced). Release the hold to verify the in-place refresh when it settles.
  await scenario('loading',null,async(S)=>{
    await openTask(S);
    const opened=await clickOwner(S);
    record('loading: picker opens',opened);
    await wait(S,'(function(){var p=document.querySelector(".people-picker");return !!p&&p.querySelectorAll(".pp-opt[data-pick]").length>0;})()',15000);
    await ev(S,`(()=>{var of=window.fetch;window.__rosterRelease=false;window.fetch=function(u,o){
      if(String(u).indexOf(${JSON.stringify(ROSTER)})>=0&&!window.__rosterRelease){var self=this,args=arguments;
        return new Promise(function(res){(function poll(){if(window.__rosterRelease){res(of.apply(self,args));}else{setTimeout(poll,40);}})();});}
      return of.apply(this,arguments);};
      window.dispatchEvent(new CustomEvent('ds:project-roles-changed',{detail:{workspaceId:${JSON.stringify(WS)},projectId:${JSON.stringify(PROJ)}}}));})();`);
    await wait(S,'!!document.querySelector(".people-picker .pp-loading")',12000);
    // let the 180ms ds-pop-in entrance fade finish (roster still held) so the shot is opaque
    await ev(S,'new Promise(r=>setTimeout(r,300))');
    const st=await stateOf(S);
    record('loading: skeleton + note shown',!!st&&st.loading&&st.skel>0,JSON.stringify(st&&{loading:st.loading,skel:st.skel,count:st.count}));
    await shot(S,'15-picker-loading');
    // release the held roster; the ensureProjectRoles settled-hook refreshes the picker in place
    await ev(S,'window.__rosterRelease=true');
    await wait(S,'(function(){var p=document.querySelector(".people-picker");return !!p&&p.querySelectorAll(".pp-opt[data-pick]").length>0;})()',15000);
    const after=await stateOf(S);
    record('loading: auto-refreshes to real candidates in place',!!after&&!after.loading&&after.opts>0,JSON.stringify(after&&{opts:after.opts,count:after.count}));
    await shot(S,'16-picker-loading-resolved');
  });

  // ---- 2. error + retry recovery ----
  // Install the rejection via evaluate AFTER the picker is open (boot-time script injection
  // raced intermittently), then force a fresh roster fetch through the app's own
  // project-roles-changed event so ensureProjectRoles(force) hits the wrapper deterministically.
  await scenario('error',null,async(S)=>{
    await openTask(S);
    const opened=await clickOwner(S);
    record('error: picker opens',opened);
    await wait(S,'(function(){var p=document.querySelector(".people-picker");return !!p&&p.querySelectorAll(".pp-opt[data-pick]").length>0;})()',15000);
    await ev(S,`(()=>{var of=window.fetch;window.__origFetch=of;window.fetch=function(u,o){
      if(String(u).indexOf(${JSON.stringify(ROSTER)})>=0){return Promise.reject(new Error('模拟花名册网络故障'));}
      return of.apply(this,arguments);};
      window.dispatchEvent(new CustomEvent('ds:project-roles-changed',{detail:{workspaceId:${JSON.stringify(WS)},projectId:${JSON.stringify(PROJ)}}}));})();`);
    await wait(S,'!!document.querySelector(".people-picker .pp-error")',12000);
    await ev(S,'new Promise(r=>setTimeout(r,300))');
    const st=await stateOf(S);
    record('error: message + retry button shown',!!st&&st.error&&st.retry&&/模拟花名册网络故障/.test(st.errText),JSON.stringify(st&&{error:st.error,retry:st.retry,err:st.errText.slice(0,60)}));
    record('error: no candidate list while failed',!!st&&st.opts===0,'opts='+st.opts);
    await shot(S,'17-picker-error');
    // heal the network then retry in place
    await ev(S,'window.fetch=window.__origFetch');
    await ev(S,'document.querySelector(".people-picker [data-retry]").click()');
    await wait(S,'(function(){var p=document.querySelector(".people-picker");return !!p&&p.querySelectorAll(".pp-opt[data-pick]").length>0;})()',15000);
    const after=await stateOf(S);
    record('error: retry recovers in place (no reopen needed)',!!after&&!after.error&&after.opts>0,JSON.stringify(after&&{opts:after.opts,count:after.count}));
    await shot(S,'18-picker-error-recovered');
  });

  // ---- 3. retained current owner no longer in roster ----
  await scenario('retained',`(()=>{const of=window.fetch;window.fetch=async function(u,o){
    const r=await of.apply(this,arguments);
    if(String(u).indexOf(${JSON.stringify(ROSTER)})>=0){
      try{const j=await r.clone().json();if(j&&j.data&&Array.isArray(j.data.members)){
        j.data.members=j.data.members.filter(m=>m.userId!==${JSON.stringify(OWNER)});
        return new Response(JSON.stringify(j),{status:r.status,headers:{'Content-Type':'application/json'}});}}catch(e){}
    }
    return r;};})();`,async(S)=>{
    await openTask(S);
    await wait(S,'!!document.querySelector("[data-fact-edit=owner]")',12000);
    await ev(S,'new Promise(r=>setTimeout(r,900))');
    const card=await ev(S,`(function(){var b=document.querySelector('[data-fact-edit=owner]');return b?b.textContent.replace(/\\s+/g,' ').trim():null;})()`);
    record('retained: owner card flags unavailable',!!card&&/加载中|不可选/.test(card),JSON.stringify(card));
    const opened=await clickOwner(S);
    record('retained: picker opens',opened);
    await ev(S,'new Promise(r=>setTimeout(r,300))');
    const st=await stateOf(S);
    record('retained: current owner row present + disabled',!!st&&st.retained&&st.retainedDisabled,JSON.stringify(st&&{retained:st.retained,disabled:st.retainedDisabled}));
    record('retained: explanatory note shown',!!st&&st.retainedNote);
    record('retained: other candidates still selectable',!!st&&st.opts>1,'opts='+st.opts);
    await shot(S,'19-picker-retained');
    // clicking the retained row must be a no-op (picker stays open)
    await ev(S,'document.querySelector(".people-picker .pp-opt[data-pick=__retained__]").click()');
    await ev(S,'new Promise(r=>setTimeout(r,250))');
    record('retained: clicking retained row is a no-op',await ev(S,'!!document.querySelector(".people-picker")'));
    // choosing someone else still works
    await ev(S,`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){var v=x.getAttribute('data-pick');return v&&v!=='__retained__'&&!x.disabled;})[0];if(o)o.click();})()`);
    await ev(S,'new Promise(r=>setTimeout(r,500))');
    record('retained: reassigning to a valid member closes picker',await ev(S,'!document.querySelector(".people-picker")'));
  });

  // ---- 4. fixed defect: done-column test cell must NOT open the picker ----
  await scenario('done-test-cell',null,async(S)=>{
    // find a done task that still renders the test card
    const doneId=await ev(S,`(async()=>{const r=await fetch('/hourglass/api/tasks/list?workspaceId=${WS}&reqId=${PROJ}&limit=200',{headers:{'X-XSRF-TOKEN':(document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1]||''}});const j=await r.json();const items=(j.data&&j.data.items)||j.data||[];const t=items.filter(function(x){return x.boardColumn==='done'&&(x.testOwnerUserId||x.testFinishedAt);})[0];return t?t.id:null;})()`);
    record('done-column: found a done task with test history',!!doneId,String(doneId));
    if(doneId){
      await ev(S,`location.hash='#/board?task='+encodeURIComponent('${doneId}')`);
      await wait(S,'!!document.getElementById("readTestCard")',15000);
      await wait(S,'(function(){var b=document.getElementById("btnDrawerEdit");return !!b&&!b.hidden;})()',12000);
      await ev(S,'new Promise(r=>setTimeout(r,600))');
      const cell=await ev(S,`(function(){var c=document.getElementById('readTestCard');var w=document.getElementById('readTestWhoCell');var r=document.getElementById('readTestReassign');return {cardVisible:!!c&&!c.hidden,clickable:!!w&&w.classList.contains('is-clickable'),role:w?w.getAttribute('role'):null,tabIndex:w?w.tabIndex:null,reassignHidden:!!r&&r.hidden};})()`);
      record('done-column: test card visible but cell not clickable',cell.cardVisible&&!cell.clickable&&cell.role===null&&cell.reassignHidden,JSON.stringify(cell));
      await ev(S,'document.getElementById("readTestWhoCell").click()');
      await ev(S,'new Promise(r=>setTimeout(r,400))');
      record('done-column: clicking cell does NOT open picker (fix)',await ev(S,'!document.querySelector(".people-picker")'));
      await shot(S,'20-done-test-cell-readonly');
    }
  });

  const allErrs=[];
  record('states suite completed',true,results.filter(r=>r.ok).length+'/'+results.length);
}catch(e){record('HARNESS EXCEPTION',false,e.message);}
finally{
  console.log('\n==== SUMMARY ====');
  const pass=results.filter(r=>r.ok).length;console.log(pass+'/'+results.length+' passed');
  fs.writeFileSync(path.join(OUT,'states-results.json'),JSON.stringify(results,null,2));
  await drv.close();
  if(pass!==results.length)process.exitCode=1;
}