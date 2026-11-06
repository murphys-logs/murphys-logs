'use strict';

// Actual browser Service Worker/Cache API regression on an isolated localhost
// origin. Only the test transport changes: the HTML and worker's pinned CDN
// module URLs point at three local synthetic SDK modules. Auth and previously
// available records are synthetic; this does NOT exercise Firebase persistence,
// real network transactions, Safari, or an installed iPhone Home Screen app.
// No production requests/accounts/data. The runtime files are never rewritten.
// PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE select an existing local installation.
// Run: node tests/offline-launch.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const original = fs.readFileSync(process.env.APP_HTML || path.join(root, 'index.html'), 'utf8');
const worker = fs.readFileSync(process.env.APP_SW || path.join(root, 'sw.js'), 'utf8');
const TODAY = '2026-11-06';
const YESTERDAY = '2026-11-05';
const fixtureKey = 'offline-launch-fixture';
const writeKey = 'offline-launch-writes';
const sdkPattern = /https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\//g;
const originalSdk = original.match(sdkPattern)?.[0];
assert.ok(originalSdk && worker.includes(originalSdk), 'HTML and worker use the same pinned SDK transport');

const bootstrap = `<script>
  const NativeDate=Date, now=NativeDate.parse('${TODAY}T12:00:00Z');
  window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
</script>`;
const authStub = `
  export const getAuth=()=>({});
  export const onAuthStateChanged=(_auth,cb)=>{queueMicrotask(()=>cb({uid:'offline-launch-user',email:'synthetic@example.invalid'}));return()=>{};};
  export const signInWithEmailAndPassword=()=>{throw Error('No real sign-in is permitted');};
  export const signOut=()=>{throw Error('No sign-out is expected');};
`;
const firestoreStub = `
  const fixture=()=>JSON.parse(localStorage.getItem('${fixtureKey}'));
  const listeners=new Map();
  window.offlineTransport={delayNext:false,inFlight:false,rejectInFlight:null};
  export const initializeFirestore=()=>({}),persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({});
  export const collection=(_db,col)=>({col}),doc=(_db,col,id)=>({col,id});
  export const deleteField=()=>{throw Error('Deletion is outside this fixture');};
  const snapshot=(ref)=>{
    const f=fixture(),metadata={fromCache:!navigator.onLine};
    return ref.id?{exists:()=>true,data:()=>f.settings||{},metadata}:
      {docChanges:()=>Object.entries(f[ref.col]||{}).map(([id,data])=>({type:'added',doc:{id,data:()=>data}})),metadata};
  };
  const emit=()=>{for(const {ref,cb} of listeners.values())cb(snapshot(ref));};
  export const onSnapshot=(ref,_options,cb)=>{listeners.set(ref.col,{ref,cb});queueMicrotask(()=>cb(snapshot(ref)));return()=>listeners.delete(ref.col);};
  window.addEventListener('online',emit);
  export const setDoc=async(ref,patch)=>{
    const transport=window.offlineTransport;
    if(transport.delayNext){
      transport.delayNext=false;transport.inFlight=true;
      await new Promise((_resolve,reject)=>{transport.rejectInFlight=()=>{transport.inFlight=false;reject(Object.assign(Error('Synthetic connection interrupted during send'),{code:'unavailable'}));};});
    }
    if(!navigator.onLine)throw Object.assign(Error('Synthetic offline send'),{code:'unavailable'});
    if(ref.col!=='days'||Object.keys(patch).some(k=>!['date','updatedAt','notes'].includes(k)))throw Error('Unexpected synthetic write');
    const f=fixture();f.days[ref.id]={...f.days[ref.id],...patch};localStorage.setItem('${fixtureKey}',JSON.stringify(f));
    const writes=JSON.parse(localStorage.getItem('${writeKey}')||'[]');writes.push({id:ref.id,patch});localStorage.setItem('${writeKey}',JSON.stringify(writes));
    emit();
  };
  export const deleteDoc=()=>{throw Error('Deletion is outside this fixture');};
  export const runTransaction=()=>{throw Error('Transactions are outside this fixture');};
`;

async function main() {
  const external=[], errors=[], served=[];
  let origin, html, sw, browser, ctx;
  const server=http.createServer((req,res)=>{
    served.push(req.url);
    const send=(body,type='text/html')=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
    if(req.url==='/index.html'||req.url==='/')return send(html);
    if(req.url==='/sw.js')return send(sw,'application/javascript');
    if(req.url==='/test-sdk/firebase-app.js')return send('export const initializeApp=()=>({});','application/javascript');
    if(req.url==='/test-sdk/firebase-auth.js')return send(authStub,'application/javascript');
    if(req.url==='/test-sdk/firebase-firestore.js')return send(firestoreStub,'application/javascript');
    if(req.url==='/manifest.webmanifest')return send(fs.readFileSync(path.join(root,'manifest.webmanifest')),'application/manifest+json');
    if(req.url==='/icon-180.png')return send(fs.readFileSync(path.join(root,'icon-180.png')),'image/png');
    if(req.url==='/setup')return send('<!doctype html><title>Synthetic setup</title>');
    res.writeHead(404);res.end();
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    origin=`http://127.0.0.1:${server.address().port}`;
    const localSdk=origin+'/test-sdk/';
    html=original.replace(sdkPattern,localSdk).replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>/gi,'')
      .replace('<script type="module">',bootstrap+'<script type="module">')
      .replace(/(<script type="module">[\s\S]*?)(<\/script>)/,(_,body,end)=>body+'\nwindow.offlineProbe={S,queuedWrites};\n'+end);
    sw=worker.replaceAll(originalSdk,localSdk);
    assert.ok(!html.includes('https://www.gstatic.com')&&!sw.includes('https://www.gstatic.com'),'No live SDK URLs remain in test transport');
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/London',serviceWorkers:'allow'});
    await ctx.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(/^https?:$/.test(url.protocol)&&url.origin!==origin){external.push(url.href);return route.abort();}
      return route.continue();
    });
    ctx.on('request',req=>{const url=new URL(req.url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin)external.push(url.href);});
    ctx.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
    const ready=page=>page.waitForFunction(()=>window.offlineProbe?.S.ready&&document.querySelector('#app:not(.hide)'));
    const open=async()=>{const page=await ctx.newPage();await page.goto(origin+'/index.html');await ready(page);return page;};
    const queue=page=>page.evaluate(()=>offlineProbe.queuedWrites().map(([key,op])=>({key,op})));
    const reveal=async(page,locator)=>{
      for(;;){const id=await locator.evaluate(el=>{let outer;for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)outer=p;return outer?.id;});
        if(!id)break;await page.locator('#'+id+' > summary').click();}
    };
    const notes=async(page,text)=>{
      await page.locator('#tabbar [data-tab="today"]').click();
      const input=page.locator('#in-notes-'+TODAY);await reveal(page,input);await input.fill(text);
      await input.locator('..').locator('[data-act="saveinput"]').click();
    };
    let page=await ctx.newPage();await page.goto(origin+'/setup');
    await page.evaluate(([key,f])=>localStorage.setItem(key,JSON.stringify(f)),[fixtureKey,{settings:{},changes:{},days:{
      [TODAY]:{date:TODAY,weight:19,bcs:5,notes:'Available before going offline',stools:[{id:'synthetic-stool',time:'08:15',bristol:4,mucus:false,blood:false}]},
      [YESTERDAY]:{date:YESTERDAY,weight:18.95,bcs:5,notes:'Previously available history',meal:{recipe:'lamb',fedAt:'18:30',darfFed:55,bowl:'cleared'}}
    }}]);
    await page.goto(origin+'/index.html');await ready(page);
    await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.AppShell?.state.offlineReady===true);
    assert.ok(served.includes('/sw.js')&&served.includes('/test-sdk/firebase-firestore.js'),'Actual server supplied the worker and dependency');
    console.log('PASS online initial load installs the actual worker and confirms complete offline app files');

    await ctx.setOffline(true);await page.reload();await ready(page);
    await page.waitForFunction(()=>window.AppShell.state.offlineReady===true);
    assert.equal(await page.evaluate(()=>offlineProbe.S.days['2026-11-05'].notes),'Previously available history');
    for(const tab of ['history','review','settings','today']){
      await page.locator(`#tabbar [data-tab="${tab}"]`).click();
      assert.equal(await page.evaluate(()=>offlineProbe.S.tab),tab);
      assert.ok((await page.locator('#main').textContent()).trim().length>50,tab+' renders offline');
    }
    console.log('PASS offline reload and all four destinations retain previously available synthetic records');

    await notes(page,'Saved offline before reconnect');
    assert.match(await page.locator('#state').textContent(),/Offline.*saved on this device/);
    const pending=await queue(page);assert.equal(pending.length,1);assert.equal(pending[0].op.patch.notes,'Saved offline before reconnect');
    const draft=page.locator('#in-walkMin-'+TODAY);await reveal(page,draft);await draft.fill('22');
    await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('murphy-draft-v2:')&&localStorage.getItem(k).includes('"value":"22"')));
    await page.close();page=await open();
    assert.deepEqual(await queue(page),pending,'Close/reopen keeps the exact pending operation, without another save');
    assert.equal(await page.evaluate(()=>offlineProbe.S.days['2026-11-06'].notes),'Saved offline before reconnect');
    await page.waitForFunction(()=>document.querySelector('#in-walkMin-2026-11-06')?.value==='22');
    console.log('PASS offline page close/reopen preserves a locally saved note, exact pending operation and unsaved draft');

    await ctx.setOffline(false);
    await page.waitForFunction(()=>offlineProbe.queuedWrites().length===0&&offlineProbe.S.status==='Synced');
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).length,writeKey),1,'One synthetic acknowledgement, no duplicate send');
    assert.equal(await page.locator('#in-walkMin-'+TODAY).inputValue(),'22','Reconnect does not erase entered text');
    // The saved note must also survive losing connectivity after acknowledgement.
    await ctx.setOffline(true);await page.reload();await ready(page);
    assert.equal(await page.evaluate(()=>offlineProbe.S.days['2026-11-06'].notes),'Saved offline before reconnect');
    assert.equal((await queue(page)).length,0);
    console.log('PASS reconnect acknowledges once, keeps the unfinished draft, and a later offline reload retains the saved note');

    await ctx.setOffline(false);
    await page.evaluate(()=>{offlineTransport.delayNext=true;});
    await notes(page,'Entered before connection failed during send');
    await page.waitForFunction(()=>offlineTransport.inFlight);
    await ctx.setOffline(true);await page.evaluate(()=>offlineTransport.rejectInFlight());
    await page.waitForFunction(()=>offlineProbe.S.status.includes('Offline'));
    const interrupted=await queue(page);assert.equal(interrupted.length,1);
    await page.close();page=await open();
    assert.deepEqual(await queue(page),interrupted,'Rejected in-flight synthetic send remains durable across offline reopening');
    assert.equal(await page.evaluate(()=>offlineProbe.S.days['2026-11-06'].notes),'Entered before connection failed during send');
    await ctx.setOffline(false);
    await page.waitForFunction(()=>offlineProbe.queuedWrites().length===0&&offlineProbe.S.status==='Synced');
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).length,writeKey),2,'Only one acknowledgement for each note');
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).days['2026-11-06'].notes,fixtureKey),'Entered before connection failed during send');
    console.log('PASS synthetic in-flight rejection survives offline reopening and reconnects without a duplicate acknowledgement');

    // Partially published update: a new worker expects a release whose shell is
    // unavailable. The browser must reject that install and retain the old app.
    // Record the acknowledged worker version, not the earlier data-ready state.
    await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.AppShell.state.offlineReady===true&&window.AppShell.state.activeVersion);
    const activeVersion=await page.evaluate(()=>window.AppShell.state.activeVersion);
    const beforeCaches=await page.evaluate(()=>caches.keys());
    sw=sw.replace(/const VERSION = '[^']+';/,`const VERSION = '${activeVersion}-unpublished';`);
    const updateState=await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.getRegistration();
      let timer;
      const result=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Expected the partial update to finish installing')),10000);
        reg.addEventListener('updatefound',()=>{
          const next=reg.installing;
          next.addEventListener('statechange',()=>{if(['installed','redundant'].includes(next.state))resolve(next.state);});
        },{once:true});
      });
      try{await reg.update();return await result;}finally{clearTimeout(timer);}
    });
    assert.equal(updateState,'redundant','Mismatched new release is not activated');
    assert.deepEqual(await page.evaluate(()=>caches.keys()),beforeCaches,'Failed install retains current release cache');
    await ctx.setOffline(true);await page.close();page=await open();
    await page.waitForFunction(()=>window.AppShell.state.offlineReady===true);
    assert.equal(await page.evaluate(()=>window.AppShell.state.activeVersion),activeVersion);
    assert.equal(await page.evaluate(()=>offlineProbe.S.days['2026-11-06'].notes),'Entered before connection failed during send');
    assert.equal((await queue(page)).length,0);
    console.log('PASS an incomplete release fails installation; the existing cached app and records still reopen offline');

    assert.deepEqual(external,[],'No external requests');assert.deepEqual(errors,[],'No page errors');
    console.log(JSON.stringify({browser:browser.version(),viewport:'390x844 touch emulation',scenarios:6,pageErrors:errors.length,externalRequests:external.length,
      limitations:'Local SDK/auth/record adapters and rewritten CDN transport; real browser SW/cache/lifecycle. Not real Firebase, Safari, browser-process restart or installed Home Screen validation.'}));
  } finally {
    if(ctx)await ctx.close();if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
