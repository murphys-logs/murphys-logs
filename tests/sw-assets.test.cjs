'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const base = 'https://example.invalid/murphy/';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
function harness({cached,failFetch=false,failCache=false,holdWrite=false}={}) {
  const events = {},opened = [],writes = [],requests = [],gate = deferred();
  const cache = {match:async()=>cached,put:async(url,response)=>{
    if(holdWrite)await gate.promise;
    writes.push({url,body:await response.text()});
  }};
  const context = {URL,Response,Request,AbortController,setTimeout,clearTimeout,
    self:{registration:{scope:base},addEventListener:(name,callback)=>{events[name]=callback;}},
    caches:{match:()=>{throw Error('Never read another release cache');},open:async name=>{
      opened.push(name);if(failCache)throw Error('Storage unavailable');return cache;
    }},fetch:async request=>{requests.push(request.url);if(failFetch)throw Error('Offline');return new Response('synthetic asset');}};
  vm.runInNewContext(source,context);
  function dispatch(url,method='GET') {
    let response;const lifetime=[];
    events.fetch({request:new Request(url,{method}),respondWith:value=>{response=value;},waitUntil:value=>{lifetime.push(value);}});
    return {response,lifetime};
  }
  return {dispatch,opened,writes,requests,release:gate.resolve};
}
for(const name of ['manifest.webmanifest','icon-180.png']) {
  test(`worker ${name}: a consumed response still caches and waitUntil retains the write`,async()=>{
    const h=harness({holdWrite:true}),event=h.dispatch(base+name);
    const response=await event.response;
    assert.equal(await response.text(),'synthetic asset');
    assert.equal(event.lifetime.length,1);
    let finished=false;event.lifetime[0].then(()=>{finished=true;});
    await Promise.resolve();assert.equal(finished,false);
    h.release();await event.lifetime[0];
    assert.deepEqual(h.writes,[{url:base+name,body:'synthetic asset'}]);
    assert.equal(h.opened.length,1);
    assert.ok(h.opened[0].startsWith('murphy.logs:'+encodeURIComponent(base)+':'));
  });
  test(`worker ${name}: this release's cached asset works offline without network`,async()=>{
    const h=harness({cached:new Response('cached asset'),failFetch:true}),event=h.dispatch(base+name);
    assert.equal(await (await event.response).text(),'cached asset');
    assert.deepEqual(h.requests,[]);
  });
}
test('worker asset storage failure preserves a successful network response',async()=>{
  const h=harness({failCache:true}),event=h.dispatch(base+'icon-180.png');
  assert.equal(await (await event.response).text(),'synthetic asset');
  await Promise.all(event.lifetime);assert.equal(h.writes.length,0);
});
test('worker missing offline asset returns an error without inventing cached data',async()=>{
  const h=harness({failFetch:true}),event=h.dispatch(base+'manifest.webmanifest');
  assert.equal((await event.response).type,'error');
  await Promise.all(event.lifetime);assert.equal(h.writes.length,0);
});
test('worker asset routing leaves Firebase traffic and non-GET requests untouched',()=>{
  const h=harness();
  for(const url of ['https://firestore.googleapis.com/example','https://identitytoolkit.googleapis.com/example',base+'other.png'])
    assert.equal(h.dispatch(url).response,undefined);
  assert.equal(h.dispatch(base+'icon-180.png','POST').response,undefined);
  assert.deepEqual(h.requests,[]);assert.deepEqual(h.opened,[]);
});
