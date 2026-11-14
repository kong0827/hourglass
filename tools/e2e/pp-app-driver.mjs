/* Shared headless-Chrome CDP driver for real-app people-picker verification.
   Launches its own Chrome (remote-debugging-pipe), injects a valid session,
   and exposes evaluate / navigate / waitFor / screenshot / console capture. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

export async function launchChrome(){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hourglass-pp-app-'));
  const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new','--remote-debugging-pipe','--no-first-run','--disable-background-networking',
     '--disable-sync','--disable-extensions','--hide-scrollbars','--force-color-profile=srgb',
     '--user-data-dir='+profile],
    {stdio:['ignore','ignore','pipe','pipe','pipe']});
  let id=0,buffer='',stderr='';const pending=new Map();const events=[];
  chrome.stderr.on('data',s=>{stderr+=s;});
  chrome.on('error',e=>{for(const p of pending.values())p.reject(e);});
  chrome.on('exit',()=>{for(const p of pending.values())p.reject(new Error('Chrome exited: '+stderr));});
  chrome.stdio[4].on('data',chunk=>{
    buffer+=chunk.toString();let at;
    while((at=buffer.indexOf('\0'))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;
      const msg=JSON.parse(line);
      if(msg.id){const p=pending.get(msg.id);if(!p)continue;pending.delete(msg.id);clearTimeout(p.timeout);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}
      else if(msg.method){events.push(msg);}
    }
  });
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const key=++id,timeout=setTimeout(()=>{pending.delete(key);reject(new Error('CDP timeout: '+method));},30000);
    pending.set(key,{resolve,reject,timeout});chrome.stdio[3].write(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });}
  async function newPage(){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    await send('Log.enable',{},sessionId);await send('Network.enable',{},sessionId);
    return {sessionId,targetId};
  }
  async function evaluate(session,expression){
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  async function waitFor(session,expression,timeout=15000,step=120){
    const start=Date.now();
    for(;;){
      let v=false;try{v=await evaluate(session,expression);}catch(e){v=false;}
      if(v)return v;
      if(Date.now()-start>timeout)throw new Error('waitFor timeout: '+expression);
      await new Promise(r=>setTimeout(r,step));
    }
  }
  async function navigate(session,url){
    await send('Page.navigate',{url},session);
    await waitFor(session,'document.readyState==="complete"',15000);
  }
  async function setCookies(session,cookies){
    await send('Network.setCookies',{cookies},session);
  }
  async function metrics(session,width,height,mobile){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:!!mobile},session);
  }
  async function theme(session,dark){
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:dark?'dark':'light'}]},session);
    await evaluate(session,`document.documentElement.setAttribute('data-theme','${dark?'dark':'light'}')`);
  }
  async function screenshot(session,file){
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);
    fs.writeFileSync(file,Buffer.from(data,'base64'));
    return file;
  }
  function consoleErrors(session){
    const out=[];
    for(const e of events){
      if(e.sessionId!==session)continue;
      if(e.method==='Runtime.exceptionThrown'){
        const d=e.params.exceptionDetails;out.push('EXCEPTION: '+(d.exception?.description||d.text));
      }else if(e.method==='Log.entryAdded'&&e.params.entry.level==='error'){
        out.push('LOG.error: '+e.params.entry.text+' @ '+(e.params.entry.url||''));
      }else if(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error'){
        out.push('console.error: '+e.params.args.map(a=>a.value||a.description||'').join(' '));
      }
    }
    return out;
  }
  async function close(){chrome.kill();await new Promise(r=>chrome.once('exit',r));fs.rmSync(profile,{recursive:true,force:true});}
  return {send,newPage,evaluate,waitFor,navigate,setCookies,metrics,theme,screenshot,consoleErrors,close};
}