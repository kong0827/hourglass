/* Real-app verification: branch dialog owner picker + release plan owner/executor picker. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome} from './pp-app-driver.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(root,'tools/e2e/shots');fs.mkdirSync(OUT,{recursive:true});
const BASE='http://localhost:8082/hourglass';
const PROJ='R4wejtfugwrudffx8x4x9';

function readCookies(file){
  const txt=fs.readFileSync(file,'utf8');const out=[];
  for(const line of txt.split('\n')){
    if(!line||line.startsWith('# ')||line.startsWith('# Netscape'))continue;
    const httpOnly=line.startsWith('#HttpOnly_');const clean=httpOnly?line.slice(9):line;
    const p=clean.split('\t');if(p.length<7)continue;
    out.push({name:p[5],value:p[6],domain:'localhost',path:'/hourglass',httpOnly,secure:false});
  }
  return out;
}
const cookies=readCookies('/tmp/hg_zhangwei.txt');
const results=[];
function record(name,ok,detail){results.push({name,ok,detail:detail||''});console.log((ok?'PASS':'FAIL')+' · '+name+(detail?' · '+detail:''));}

const drv=await launchChrome();
const {sessionId:S}=await drv.newPage();
await drv.setCookies(S,cookies);
async function shot(n){try{await drv.screenshot(S,path.join(OUT,n+'.png'));}catch(e){console.log('shot fail '+n+': '+e.message);}}
async function ev(x){return drv.evaluate(S,x);}
async function wait(x,t){return drv.waitFor(S,x,t);}
async function esc(){await drv.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);await drv.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);}
const pickerInfo=`(function(){var p=document.querySelector('.people-picker');if(!p)return null;
  var groups=[].map.call(p.querySelectorAll('.pp-group'),function(g){return g.textContent.replace(/\\s+/g,' ').trim();});
  var opts=[].map.call(p.querySelectorAll('.pp-opt[data-pick]'),function(o){return {id:o.getAttribute('data-pick'),name:(o.querySelector('.nm')||{}).textContent,role:(o.querySelector('.role')||{}).textContent,side:o.querySelectorAll('.pp-side').length,selected:o.classList.contains('selected')};});
  var clear=p.querySelector('.pp-clear');
  return {title:p.getAttribute('aria-label'),count:(p.querySelector('.pp-count')||{}).textContent,groups:groups,optN:opts.length,opts:opts.slice(0,4),clear:clear?clear.textContent.replace(/\\s+/g,' ').trim():null,sideTotal:p.querySelectorAll('.pp-side').length};})()`;

try{
  await drv.navigate(S,BASE+'/');
  await wait('!!document.getElementById("sideNav")',12000);

  // ===== Entry 3: branch dialog owner =====
  await drv.navigate(S,BASE+'/#/branches');
  await wait('!!document.getElementById("branchGroups")',15000);
  await ev('new Promise(r=>setTimeout(r,600))');
  // open new branch dialog (button may be hidden when empty -> fall back to editing first branch)
  const opened=await ev(`(function(){var b=document.getElementById('branchNew');if(b&&!b.hidden){b.click();return 'new';}var e=document.querySelector('[data-br-edit]');if(e){e.click();return 'edit';}return null;})()`);
  record('branch dialog trigger found',!!opened,String(opened));
  await wait('!!document.getElementById("dlgBranch")&&document.getElementById("dlgBranch").classList.contains("open")',8000);
  await wait('!!document.getElementById("brOwnerBtn")',6000);
  await ev('new Promise(r=>setTimeout(r,300))');
  const brField=await ev(`(function(){var b=document.getElementById('brOwnerBtn');return {html:b.innerHTML.slice(0,200),text:b.textContent.replace(/\\s+/g,' ').trim(),hiddenOwner:(document.getElementById('brOwner')||{}).value,hiddenName:(document.getElementById('brOwnerName')||{}).value};})()`);
  record('branch owner field rendered',!!brField&&/people-field|pf-/.test(brField.html),JSON.stringify(brField&&brField.text));
  await shot('06-branch-dialog-desktop');
  await ev('document.getElementById("brOwnerBtn").click()');
  await wait('!!document.querySelector(".people-picker")',6000);
  await ev('new Promise(r=>setTimeout(r,150))');
  const brPicker=await ev(pickerInfo);
  record('branch owner picker opens',!!brPicker,JSON.stringify(brPicker&&{title:brPicker.title,count:brPicker.count}));
  record('branch picker groups by company',!!brPicker&&brPicker.groups.length>=1,JSON.stringify(brPicker&&brPicker.groups));
  record('branch picker renders role column (no project ⇒ 空间默认未设岗位)',!!brPicker&&brPicker.opts.length>0&&brPicker.opts.every(o=>typeof o.role==='string'&&o.role.length>0),'roles='+JSON.stringify(brPicker&&brPicker.opts.map(o=>o.role)));
  record('branch picker clear 未指派',!!brPicker&&/未指派/.test(brPicker.clear||''),brPicker&&brPicker.clear);
  await shot('07-branch-owner-picker-desktop');
  // pick a member -> hidden inputs set
  const brPick=await ev(`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){return x.getAttribute('data-pick');})[0];return o?{id:o.getAttribute('data-pick'),name:(o.querySelector('.nm')||{}).textContent}:null;})()`);
  if(brPick){
    await ev('document.querySelector(".people-picker .pp-opt[data-pick=\''+brPick.id+'\']").click()');
    await ev('new Promise(r=>setTimeout(r,200))');
    const after=await ev(`({owner:(document.getElementById('brOwner')||{}).value,name:(document.getElementById('brOwnerName')||{}).value,btn:document.getElementById('brOwnerBtn').textContent.replace(/\\s+/g,' ').trim()})`);
    record('branch pick sets hidden owner id+name',after.owner===brPick.id&&after.name===brPick.name,JSON.stringify({picked:brPick,after}));
  }else record('branch pick sets hidden owner id+name',false,'no target');
  await wait('!document.querySelector(".people-picker")',4000).catch(()=>{});
  // mobile sheet for branch
  await drv.metrics(S,390,844,true);await ev('new Promise(r=>setTimeout(r,150))');
  await ev('document.getElementById("brOwnerBtn").click()');
  await wait('!!document.querySelector(".people-picker")',6000);await ev('new Promise(r=>setTimeout(r,150))');
  const brSheet=await ev(`(function(){var p=document.querySelector('.people-picker');var r=p.getBoundingClientRect();return {asSheet:p.classList.contains('as-sheet'),scrim:!!document.querySelector('.pop-scrim'),overflow:document.documentElement.scrollWidth<=innerWidth,bottom:Math.round(innerHeight-r.bottom)};})()`);
  record('branch picker mobile bottom sheet',brSheet.asSheet&&brSheet.scrim&&brSheet.overflow,JSON.stringify(brSheet));
  await shot('08-branch-owner-picker-mobile');
  await esc();await drv.metrics(S,1280,900,false);
  await ev('(function(){var c=document.getElementById("dlgBranchCancel");if(c)c.click();})()');
  await ev('new Promise(r=>setTimeout(r,200))');

  // ===== Entry 4: release plan owner + executor =====
  await drv.navigate(S,BASE+'/#/phase');
  await wait('!!document.getElementById("phaseReq")',15000);
  await wait('document.getElementById("phaseReq").options.length>0',12000);
  // select the project
  const setProj=await ev(`(function(){var s=document.getElementById('phaseReq');var has=[].some.call(s.options,function(o){return o.value==='${PROJ}';});if(has){s.value='${PROJ}';s.dispatchEvent(new Event('change',{bubbles:true}));return true;}return false;})()`);
  record('release: project selectable in phase view',setProj);
  await ev('new Promise(r=>setTimeout(r,900))');
  await wait('!!document.getElementById("btnReleasePlan")',8000);
  await ev('document.getElementById("btnReleasePlan").click()');
  // either version picker or direct form
  await wait('!!document.querySelector("[data-pick-version]")||!!document.querySelector("[data-plan-owner-btn]")',12000);
  if(await ev('!!document.querySelector("[data-pick-version]")')){
    await ev('document.querySelector("[data-pick-version]").click()');
  }
  await wait('!!document.querySelector("[data-plan-owner-btn]")',12000);
  await ev('new Promise(r=>setTimeout(r,400))');
  const planField=await ev(`(function(){var b=document.querySelector('[data-plan-owner-btn]');var h=document.querySelector('[data-plan-owner]');return {text:b.textContent.replace(/\\s+/g,' ').trim(),val:h?h.value:null,html:b.innerHTML.slice(0,160)};})()`);
  record('release plan owner field rendered',!!planField&&/pf-|people-field/.test(planField.html),JSON.stringify(planField&&planField.text));
  await shot('09-release-plan-form-desktop');
  await ev('document.querySelector("[data-plan-owner-btn]").click()');
  await wait('!!document.querySelector(".people-picker")',6000);await ev('new Promise(r=>setTimeout(r,150))');
  const planPicker=await ev(pickerInfo);
  record('release plan owner picker opens',!!planPicker&&planPicker.title==='计划负责人',JSON.stringify(planPicker&&{title:planPicker.title,count:planPicker.count,groups:planPicker.groups}));
  record('release plan picker clear 未指派',!!planPicker&&/未指派/.test(planPicker.clear||''),planPicker&&planPicker.clear);
  record('release plan picker renders role column (空间默认职能；本演示 jobTitle 为空⇒未设岗位)',!!planPicker&&planPicker.opts.length>0&&planPicker.opts.every(o=>typeof o.role==='string'&&o.role.length>0),'roles='+JSON.stringify(planPicker&&planPicker.opts.map(o=>o.role))+' 兼='+planPicker.sideTotal);
  await shot('10-release-plan-owner-picker-desktop');
  // intercept change event on hidden input
  await ev(`window.__planChange=0;(function(){var h=document.querySelector('[data-plan-owner]');h.addEventListener('change',function(){window.__planChange++;});})();`);
  const planPick=await ev(`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){return x.getAttribute('data-pick')&&!x.classList.contains('selected');})[0];return o?{id:o.getAttribute('data-pick'),name:(o.querySelector('.nm')||{}).textContent}:null;})()`);
  if(planPick){
    await ev(`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){return x.getAttribute('data-pick')&&!x.classList.contains('selected');})[0];if(o)o.click();})()`);
    await ev('new Promise(r=>setTimeout(r,200))');
    const after=await ev(`({val:(document.querySelector('[data-plan-owner]')||{}).value,changes:window.__planChange,btn:document.querySelector('[data-plan-owner-btn]').textContent.replace(/\\s+/g,' ').trim()})`);
    record('release plan pick sets hidden value + dispatches change',after.val===planPick.id&&after.changes>=1,JSON.stringify({picked:planPick,after}));
  }else record('release plan pick sets hidden value + dispatches change',false,'no target');
  await wait('!document.querySelector(".people-picker")',4000).catch(()=>{});

  // executor: switch to actual tab
  const hasActual=await ev('!!document.querySelector("[data-release-tab=actual]")');
  if(hasActual){
    await ev('document.querySelector("[data-release-tab=actual]").click()');
    await ev('new Promise(r=>setTimeout(r,300))');
    await wait('!!document.querySelector("[data-release-executorUserId-btn]")',8000);
    const execDisabled=await ev('document.querySelector("[data-release-executorUserId-btn]").disabled');
    await shot('11-release-actual-form-desktop');
    if(!execDisabled){
      await ev('document.querySelector("[data-release-executorUserId-btn]").click()');
      await wait('!!document.querySelector(".people-picker")',6000);await ev('new Promise(r=>setTimeout(r,150))');
      const execPicker=await ev(pickerInfo);
      record('release executor picker opens',!!execPicker&&execPicker.title==='实际执行人',JSON.stringify(execPicker&&{title:execPicker.title,count:execPicker.count}));
      record('release executor picker has NO clear (must be member)',!!execPicker&&!execPicker.clear,'clear='+JSON.stringify(execPicker&&execPicker.clear));
      await shot('12-release-executor-picker-desktop');
      await ev(`window.__execChange=0;(function(){var h=document.querySelector('[data-release-executorUserId]');h.addEventListener('change',function(){window.__execChange++;});})();`);
      const execPick=await ev(`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){return x.getAttribute('data-pick');})[0];return o?{id:o.getAttribute('data-pick'),name:(o.querySelector('.nm')||{}).textContent}:null;})()`);
      if(execPick){
        await ev(`(function(){var p=document.querySelector('.people-picker');var o=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(x){return x.getAttribute('data-pick');})[0];if(o)o.click();})()`);
        await ev('new Promise(r=>setTimeout(r,200))');
        const after=await ev(`({val:(document.querySelector('[data-release-executorUserId]')||{}).value,changes:window.__execChange})`);
        record('release executor pick sets hidden value + change',after.val===execPick.id&&after.changes>=1,JSON.stringify({picked:execPick,after}));
      }else record('release executor pick sets hidden value + change',false,'no target');
      await wait('!document.querySelector(".people-picker")',4000).catch(()=>{});
    }else{record('release executor picker opens',false,'executor disabled (no publish permission / no plan)');}
  }else{record('release executor picker opens',false,'no actual tab (may not have publish permission)');}

  // mobile release picker
  await drv.metrics(S,390,844,true);await ev('new Promise(r=>setTimeout(r,150))');
  const planBtnMobile=await ev('!!document.querySelector("[data-plan-owner-btn]")');
  if(planBtnMobile){
    await ev('document.querySelector("[data-release-tab=plan]")&&document.querySelector("[data-release-tab=plan]").click()');
    await ev('new Promise(r=>setTimeout(r,200))');
    await ev('document.querySelector("[data-plan-owner-btn]").click()');
    await wait('!!document.querySelector(".people-picker")',6000);await ev('new Promise(r=>setTimeout(r,150))');
    const relSheet=await ev(`(function(){var p=document.querySelector('.people-picker');var r=p.getBoundingClientRect();return {asSheet:p.classList.contains('as-sheet'),scrim:!!document.querySelector('.pop-scrim'),overflow:document.documentElement.scrollWidth<=innerWidth};})()`);
    record('release picker mobile bottom sheet',relSheet.asSheet&&relSheet.scrim&&relSheet.overflow,JSON.stringify(relSheet));
    await shot('13-release-plan-owner-picker-mobile');
    await esc();
  }
  await drv.metrics(S,1280,900,false);

  const errs=drv.consoleErrors(S).filter(e=>!/favicon|DevTools/.test(e));
  record('no runtime/console errors (branch+release)',errs.length===0,errs.slice(0,10).join(' | '));
}catch(e){
  record('HARNESS EXCEPTION',false,e.message);await shot('98-error-branch-release');
}finally{
  console.log('\n==== SUMMARY ====');
  const pass=results.filter(r=>r.ok).length;console.log(pass+'/'+results.length+' passed');
  fs.writeFileSync(path.join(OUT,'branch-release-results.json'),JSON.stringify(results,null,2));
  await drv.close();
  if(pass!==results.length)process.exitCode=1;
}