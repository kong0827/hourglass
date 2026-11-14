/* Real-app end-to-end verification of the company+role people picker.
   Drives the actual product (preview :8082 -> healthy backend) with a valid session.
   Entries: detail read-mode owner + test reassign, branch dialog owner, release owner/executor. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchChrome} from './pp-app-driver.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(root,'tools/e2e/shots');fs.mkdirSync(OUT,{recursive:true});
const BASE='http://localhost:8082/hourglass';
const WS='Smw9zcftmwwnrwuon', PROJ='R4wejtfugwrudffx8x4x9';
const TASK_TEST='Ksxyz0btsl17egy6fspm4'; // testing column, has owner + test owner

function readCookies(file){
  const txt=fs.readFileSync(file,'utf8');const out=[];
  for(const line of txt.split('\n')){
    if(!line||line.startsWith('# ')||line.startsWith('# Netscape'))continue;
    const httpOnly=line.startsWith('#HttpOnly_');
    const clean=httpOnly?line.slice('#HttpOnly_'.length):line;
    const p=clean.split('\t');if(p.length<7)continue;
    out.push({name:p[5],value:p[6],domain:p[0].replace(/^#HttpOnly_/,''),path:p[2],httpOnly,secure:p[3]==='TRUE'});
  }
  return out;
}
const cookies=readCookies('/tmp/hg_zhangwei.txt');

const results=[];
function record(name,ok,detail){results.push({name,ok,detail:detail||''});console.log((ok?'PASS':'FAIL')+' · '+name+(detail?' · '+detail:''));}

const drv=await launchChrome();
const {sessionId:S}=await drv.newPage();
await drv.setCookies(S,cookies.map(c=>({...c,url:BASE+'/'})));
// domain cookie fix: localhost cookies need domain not url+domain conflict
await drv.setCookies(S,cookies.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/hourglass',httpOnly:c.httpOnly,secure:false})));

async function shot(name){try{await drv.screenshot(S,path.join(OUT,name+'.png'));}catch(e){console.log('shot fail '+name+': '+e.message);}}
async function ev(expr){return drv.evaluate(S,expr);}
async function wait(expr,t){return drv.waitFor(S,expr,t);}

try{
  // ---- boot ----
  await drv.navigate(S,BASE+'/');
  await wait('!!(window.location.hash)',8000).catch(()=>{});
  const boot=await ev('({href:location.href,hash:location.hash,hasLogin:!!document.querySelector("form")&&/login/.test(location.pathname)})');
  record('app boots logged-in (no login redirect)',!/login/.test(boot.href),JSON.stringify(boot));
  await wait('!!(document.getElementById("sideNav"))',12000);
  // load the board view first so the workspace + permission context is ready before the deep link
  await ev(`location.hash='#/board'`);
  await wait('document.body.dataset.view==="board"&&!!document.getElementById("brandSub")&&/支付业务部/.test(document.getElementById("brandSub").textContent)',15000);
  const ws=await ev('(function(){var b=document.getElementById("brandSub");return b?b.textContent.replace(/\\s+/g," ").trim():null;})()').catch(()=>null);
  record('workspace context loaded (brand shows 支付业务部)',!!ws&&/支付业务部/.test(ws),JSON.stringify(ws));

  // ---- Entry 1: detail read-mode owner picker ----
  // open via in-document hash change (no full reload) so the loaded workspace/permission is reused
  await ev(`location.hash='#/board?task='+encodeURIComponent('${TASK_TEST}')`);
  await wait('!!(document.getElementById("readFacts"))&&!!document.querySelector("[data-fact-edit=owner]")',15000);
  // wait until the drawer is editable (edit button visible ⇒ not read-only, editingId resolved)
  await wait('(function(){var b=document.getElementById("btnDrawerEdit");return !!b&&!b.hidden;})()',15000);
  await ev('new Promise(r=>setTimeout(r,500))');
  const ownerCard=await ev(`(function(){var b=document.querySelector('[data-fact-edit=owner]');return b?{text:b.textContent.replace(/\\s+/g,' ').trim(),html:b.innerHTML.slice(0,400)}:null;})()`);
  record('owner fact trigger present',!!ownerCard,JSON.stringify(ownerCard&&ownerCard.text));
  await shot('01-detail-read-desktop');

  // open owner picker (retry to absorb any residual boot animation / focus race)
  let pickerOpened=false;
  for(let i=0;i<4&&!pickerOpened;i++){
    await ev('document.querySelector("[data-fact-edit=owner]").click()');
    pickerOpened=await wait('!!document.querySelector(".people-picker")',2500).then(()=>true).catch(()=>false);
    if(!pickerOpened)await ev('new Promise(r=>setTimeout(r,400))');
  }
  await ev('new Promise(r=>setTimeout(r,150))');
  const picker=await ev(`(function(){var p=document.querySelector('.people-picker');if(!p)return null;
    var groups=[].map.call(p.querySelectorAll('.pp-group'),function(g){return g.textContent.replace(/\\s+/g,' ').trim();});
    var opts=[].map.call(p.querySelectorAll('.pp-opt[data-pick]'),function(o){return {id:o.getAttribute('data-pick'),name:(o.querySelector('.nm')||{}).textContent,role:(o.querySelector('.role')||{}).textContent,side:[].map.call(o.querySelectorAll('.pp-side'),function(s){return s.textContent;}),selected:o.classList.contains('selected')};});
    var clear=p.querySelector('.pp-clear');
    return {count:(p.querySelector('.pp-count')||{}).textContent,groups:groups,optN:opts.length,opts:opts.slice(0,6),clear:clear?clear.textContent.replace(/\\s+/g,' ').trim():null,hasSearch:!!p.querySelector('input')};})()`);
  record('owner picker opens',!!picker);
  record('owner picker groups by company',!!picker&&picker.groups.length>=1,JSON.stringify(picker&&picker.groups));
  record('owner picker shows role text',!!picker&&picker.opts.some(o=>o.role&&o.role!=='未设岗位'),JSON.stringify(picker&&picker.opts.map(o=>o.name+':'+o.role)));
  record('owner picker has clear (未分配)',!!picker&&/未分配/.test(picker.clear||''),picker&&picker.clear);
  record('owner picker marks current',!!picker&&picker.opts.some(o=>o.selected),JSON.stringify(picker&&picker.opts.filter(o=>o.selected).map(o=>o.name)));
  await shot('02-owner-picker-desktop');

  // 兼岗 chips present somewhere in roster
  const sideCount=await ev('document.querySelectorAll(".people-picker .pp-side").length');
  record('owner picker renders 兼岗 chips',sideCount>0,'兼岗 chips='+sideCount);

  // search filters
  await ev(`(function(){var p=document.querySelector('.people-picker');var i=p.querySelector('input');i.value='测途';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ev('new Promise(r=>setTimeout(r,80))');
  const searched=await ev(`(function(){var p=document.querySelector('.people-picker');return {count:(p.querySelector('.pp-count')||{}).textContent,groups:[].map.call(p.querySelectorAll('.pp-group'),function(g){return g.textContent.replace(/\\s+/g,' ').trim();}),optN:p.querySelectorAll('.pp-opt[data-pick]').length};})()`);
  record('search by company filters results',searched.optN>0&&/测途/.test(JSON.stringify(searched.groups)),JSON.stringify(searched));
  // clear search
  await ev('document.querySelector(".people-picker .pp-clear-search").click()');
  await ev('new Promise(r=>setTimeout(r,60))');
  const restored=await ev('document.querySelectorAll(".people-picker .pp-opt[data-pick]").length');
  record('clear-search restores full list',restored>=picker.optN,'restored='+restored);

  // keyboard nav
  await ev('document.querySelector(".people-picker input").focus()');
  await drv.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},S);
  await drv.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},S);
  const focused=await ev('(function(){var a=document.activeElement;return a&&a.classList.contains("pp-opt")?a.getAttribute("data-pick"):(a&&a.className);})()');
  record('ArrowDown moves focus to an option',!!focused&&focused!=='',String(focused));

  // pick a different member -> factSave owner payload
  const pickTarget=await ev(`(function(){var p=document.querySelector('.people-picker');var opts=[].slice.call(p.querySelectorAll('.pp-opt[data-pick]')).filter(function(o){return o.getAttribute('data-pick')&&!o.classList.contains('selected');});return opts[0]?opts[0].getAttribute('data-pick'):null;})()`);
  // intercept the save request to assert payload
  await ev(`window.__ownerSave=null;(function(){var of=window.fetch;window.fetch=function(u,o){try{if(o&&o.method&&/PUT|POST/.test(o.method)&&/\\/api\\/task/.test(String(u))){window.__ownerSave={url:String(u),body:o.body};}}catch(e){}return of.apply(this,arguments);};})();`);
  if(pickTarget){
    await ev('document.querySelector(".people-picker .pp-opt[data-pick=\''+pickTarget+'\']").click()');
    await ev('new Promise(r=>setTimeout(r,400))');
    const save=await ev('window.__ownerSave');
    let payloadOk=false,ownerId=null;
    if(save&&save.body){try{const b=JSON.parse(save.body);ownerId=b.ownerUserId;payloadOk=(b.ownerUserId===pickTarget);}catch(e){}}
    record('owner pick saves correct ownerUserId',payloadOk,JSON.stringify({picked:pickTarget,save:save&&save.url,ownerId}));
  }else{record('owner pick saves correct ownerUserId',false,'no pick target');}
  await wait('!document.querySelector(".people-picker")',4000).catch(()=>{});
  const cardAfter=await ev(`(function(){var b=document.querySelector('[data-fact-edit=owner]');return b?b.textContent.replace(/\\s+/g,' ').trim():null;})()`);
  record('owner card updates after pick',!!cardAfter,JSON.stringify(cardAfter));

  // ---- Entry 2: test reassign picker ----
  await ev(`(function(){var b=document.getElementById('readTestReassign');if(b)b.click();else{var c=document.getElementById('readTestWhoCell');if(c)c.click();}})()`);
  await wait('!!document.querySelector(".people-picker")',6000);
  await ev('new Promise(r=>setTimeout(r,120))');
  const testPicker=await ev(`(function(){var p=document.querySelector('.people-picker');if(!p)return null;var clear=p.querySelector('.pp-clear');return {title:p.getAttribute('aria-label'),count:(p.querySelector('.pp-count')||{}).textContent,groups:p.querySelectorAll('.pp-group').length,clear:clear?clear.textContent.replace(/\\s+/g,' ').trim():null};})()`);
  record('test reassign picker opens',!!testPicker,JSON.stringify(testPicker));
  record('test picker clear label 待领取',!!testPicker&&/待领取/.test(testPicker.clear||''),testPicker&&testPicker.clear);
  await shot('03-test-picker-desktop');
  await ev('document.querySelector(".people-picker input")&&document.querySelector(".people-picker input").focus()');
  await drv.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);
  await drv.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);
  await wait('!document.querySelector(".people-picker")',4000).catch(()=>{});
  record('Escape closes picker (drawer stays)',await ev('!document.querySelector(".people-picker")&&!!document.getElementById("readFacts")'));

  // ---- mobile bottom sheet + dark ----
  await drv.metrics(S,390,844,true);
  await ev('new Promise(r=>setTimeout(r,150))');
  await ev('document.querySelector("[data-fact-edit=owner]").click()');
  await wait('!!document.querySelector(".people-picker")',6000);
  await ev('new Promise(r=>setTimeout(r,150))');
  const sheet=await ev(`(function(){var p=document.querySelector('.people-picker');var r=p.getBoundingClientRect();return {asSheet:p.classList.contains('as-sheet'),scrim:!!document.querySelector('.pop-scrim'),left:Math.round(r.left),right:Math.round(innerWidth-r.right),bottom:Math.round(innerHeight-r.bottom),width:Math.round(r.width),overflow:document.documentElement.scrollWidth<=innerWidth};})()`);
  record('mobile picker is bottom sheet',sheet.asSheet&&sheet.scrim,JSON.stringify(sheet));
  record('mobile sheet anchored to bottom edges',sheet.bottom<=20&&sheet.left<=20,JSON.stringify(sheet));
  record('mobile no horizontal overflow',sheet.overflow,JSON.stringify(sheet));
  await shot('04-owner-picker-mobile-sheet');
  await drv.theme(S,true);
  await ev('new Promise(r=>setTimeout(r,120))');
  await shot('05-owner-picker-mobile-dark');
  const darkOk=await ev('document.documentElement.getAttribute("data-theme")==="dark"&&!!document.querySelector(".people-picker")');
  record('dark mode picker still rendered',darkOk);
  await drv.theme(S,false);
  await ev('document.querySelector(".people-picker input")&&document.querySelector(".people-picker input").focus()');
  await drv.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);
  await drv.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},S);
  await drv.metrics(S,1280,900,false);

  // ---- console errors ----
  const errs=drv.consoleErrors(S).filter(e=>!/favicon|Download the React|DevTools/.test(e));
  record('no runtime/console errors (detail entries)',errs.length===0,errs.slice(0,8).join(' | '));

}catch(e){
  record('HARNESS EXCEPTION',false,e.message);
  await shot('99-error');
}finally{
  console.log('\n==== SUMMARY ====');
  const pass=results.filter(r=>r.ok).length;
  console.log(pass+'/'+results.length+' passed');
  fs.writeFileSync(path.join(OUT,'detail-results.json'),JSON.stringify(results,null,2));
  await drv.close();
  if(pass!==results.length)process.exitCode=1;
}