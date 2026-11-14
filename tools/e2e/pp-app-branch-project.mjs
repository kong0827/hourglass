/* Positive proof: branch owner picker shows real primary role + 兼岗 when a project is in context
   (creating a branch from within a task drawer on a project that has project_member_role data). */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome} from './pp-app-driver.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(root,'tools/e2e/shots');fs.mkdirSync(OUT,{recursive:true});
const BASE='http://localhost:8082/hourglass';
const TASK='Ksxyz0btsl17egy6fspm4'; // belongs to project 统一支付网关 (has project roles)
function readCookies(file){const out=[];for(const line of fs.readFileSync(file,'utf8').split('\n')){if(!line||line.startsWith('# ')||line.startsWith('# Netscape'))continue;const ho=line.startsWith('#HttpOnly_');const p=(ho?line.slice(9):line).split('\t');if(p.length<7)continue;out.push({name:p[5],value:p[6],domain:'localhost',path:'/hourglass',httpOnly:ho,secure:false});}return out;}
const results=[];function record(n,ok,d){results.push({n,ok,d:d||''});console.log((ok?'PASS':'FAIL')+' · '+n+(d?' · '+d:''));}
const drv=await launchChrome();const {sessionId:S}=await drv.newPage();
await drv.setCookies(S,readCookies('/tmp/hg_zhangwei.txt'));
const ev=x=>drv.evaluate(S,x),wait=(x,t)=>drv.waitFor(S,x,t);
const shot=n=>drv.screenshot(S,path.join(OUT,n+'.png')).catch(e=>console.log('shot fail '+e.message));
try{
  await drv.navigate(S,BASE+'/');await wait('!!document.getElementById("sideNav")',12000);
  await drv.navigate(S,BASE+'/#/board?task='+TASK);
  await wait('!!document.getElementById("readFacts")',15000);
  // enter edit mode so the 关联 tab + in-task branch creation are available
  await ev('(function(){var b=document.getElementById("btnDrawerEdit");if(b&&!b.hidden)b.click();})()');
  await ev('new Promise(r=>setTimeout(r,400))');
  // switch to 关联 tab
  await ev('(function(){var t=document.querySelector("[data-drawer-tab=rel]");if(t)t.click();})()');
  await ev('new Promise(r=>setTimeout(r,400))');
  const hasNew=await ev('!!document.getElementById("iBranchNew")');
  record('in-task 新建分支 entry present',hasNew);
  if(hasNew){
    await ev('document.getElementById("iBranchNew").click()');
    await wait('!!document.getElementById("dlgBranch")&&document.getElementById("dlgBranch").classList.contains("open")',8000);
    await wait('!!document.getElementById("brOwnerBtn")',6000);
    // wait for project roster to settle (roles loaded)
    await ev('new Promise(r=>setTimeout(r,900))');
    const proj=await ev('(document.getElementById("brReq")||{}).value');
    record('branch dialog prefilled with task project',!!proj,'brReq='+proj);
    await ev('document.getElementById("brOwnerBtn").click()');
    await wait('!!document.querySelector(".people-picker")',6000);
    await ev('new Promise(r=>setTimeout(r,300))');
    const info=await ev(`(function(){var p=document.querySelector('.people-picker');if(!p)return null;
      var opts=[].map.call(p.querySelectorAll('.pp-opt[data-pick]'),function(o){return {name:(o.querySelector('.nm')||{}).textContent,role:(o.querySelector('.role')||{}).textContent,side:[].map.call(o.querySelectorAll('.pp-side'),function(s){return s.textContent;})};});
      return {count:(p.querySelector('.pp-count')||{}).textContent,groups:[].map.call(p.querySelectorAll('.pp-group'),function(g){return g.textContent.replace(/\\s+/g,' ').trim();}),opts:opts,sideTotal:p.querySelectorAll('.pp-side').length};})()`);
    record('branch picker (project ctx) groups by company',!!info&&info.groups.length>=1,JSON.stringify(info&&info.groups));
    const realRoles=info&&info.opts.filter(o=>o.role&&o.role!=='未设岗位');
    record('branch picker (project ctx) shows REAL primary roles',!!realRoles&&realRoles.length>0,JSON.stringify(realRoles&&realRoles.map(o=>o.name+':'+o.role)));
    record('branch picker (project ctx) shows 兼岗 chips',!!info&&info.sideTotal>0,'兼岗='+info.sideTotal+' '+JSON.stringify(info&&info.opts.filter(o=>o.side.length).map(o=>o.name+'→'+o.side.join(','))));
    await shot('14-branch-owner-picker-project-roles');
  }
  const errs=drv.consoleErrors(S).filter(e=>!/favicon|DevTools/.test(e));
  record('no runtime/console errors (in-task branch)',errs.length===0,errs.slice(0,6).join(' | '));
}catch(e){record('HARNESS EXCEPTION',false,e.message);await shot('97-error-branch-project');}
finally{console.log('\n==== SUMMARY ====');const pass=results.filter(r=>r.ok).length;console.log(pass+'/'+results.length+' passed');fs.writeFileSync(path.join(OUT,'branch-project-results.json'),JSON.stringify(results,null,2));await drv.close();if(pass!==results.length)process.exitCode=1;}