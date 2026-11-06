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
    self:{clients:{matchAll:async()=>[]},registration:{scope:base},addEventListener:(name,callback)=>{events[name]=callback;}},
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
const SDK_URLS = [
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
];
const makeShell = version => `<!doctype html><html><head>
${SDK_URLS.map(u => `<script type="module" src="${u}"></script>`).join('\n')}
<script>const APP_VERSION = "${version}";</script>
</head><body>Murphy Logs</body></html>`;

test('worker rejects outdated release shell from older cache to trigger installed-client upgrade', async () => {
  const h = harness({ cached: new Response(makeShell('3.9.1'), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  }), failFetch: true });
  const event = h.dispatch(base + 'index.html');
  const response = await event.response;
  assert.equal(response.status, 503, 'Outdated 3.9.1 shell rejected with 503 recovery page');
  await Promise.all(event.lifetime);
});

test('installed-client upgrade stages 3.12.2 cache, serves new shell, and purges 3.12.0 on activation', async () => {
  const events = {}, cacheStorage = new Map();
  const cachePrefix = 'murphy.logs:' + encodeURIComponent(base) + ':';
  const oldCacheName = cachePrefix + '3.12.0';
  const newCacheName = cachePrefix + '3.12.2';

  const makeCache = () => {
    const entries = new Map();
    return {
      match: async key => {
        const url = typeof key === 'string' ? key : key.url;
        const hit = entries.get(url);
        return hit ? hit.clone() : undefined;
      },
      put: async (key, res) => {
        const url = typeof key === 'string' ? key : key.url;
        entries.set(url, res.clone());
      }
    };
  };

  const cachesMock = {
    open: async name => {
      if (!cacheStorage.has(name)) cacheStorage.set(name, makeCache());
      return cacheStorage.get(name);
    },
    match: async key => {
      const url = typeof key === 'string' ? key : key.url;
      for (const cache of cacheStorage.values()) {
        const hit = await cache.match(url);
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => [...cacheStorage.keys()],
    delete: async name => cacheStorage.delete(name)
  };

  const clientMessages = [];
  const context = {
    URL, Response, Request, AbortController, setTimeout, clearTimeout,
    self: {
      registration: { scope: base },
      clients: {
        matchAll: async () => [{ postMessage: m => clientMessages.push(m) }],
        claim: async () => {}
      },
      skipWaiting: async () => {},
      addEventListener: (name, cb) => { events[name] = cb; }
    },
    caches: cachesMock,
    fetch: async req => {
      const url = typeof req === 'string' ? req : req.url;
      if (url === base + 'index.html') {
        return new Response(makeShell('3.12.2'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (SDK_URLS.includes(url)) {
        return new Response('/* synthetic SDK module */', { headers: { 'content-type': 'application/javascript' } });
      }
      return new Response('synthetic asset', { headers: { 'content-type': 'text/plain' } });
    }
  };

  vm.runInNewContext(source, context);

  // Pre-existing installed 3.12.0 cache
  const oldCache = await cachesMock.open(oldCacheName);
  await oldCache.put(base + 'index.html', new Response(makeShell('3.12.0'), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  for (const url of SDK_URLS) {
    await oldCache.put(url, new Response('/* 3.12.0 sdk */', { headers: { 'content-type': 'application/javascript' } }));
  }
  await oldCache.put(base + 'manifest.webmanifest', new Response('{}', { headers: { 'content-type': 'application/manifest+json' } }));
  await oldCache.put(base + 'icon-180.png', new Response('png', { headers: { 'content-type': 'image/png' } }));

  // Stage 3.12.2 release via install event
  let installWait;
  events.install({ waitUntil: p => { installWait = p; } });
  await installWait;

  // Verify staging preserves old cache and creates new release cache
  const stagedKeys = await cachesMock.keys();
  assert.ok(stagedKeys.includes(oldCacheName), 'Old cache preserved while staging');
  assert.ok(stagedKeys.includes(newCacheName), 'New 3.12.2 cache staged');

  // Verify fetch serves 3.12.2 shell
  let serveResp;
  events.fetch({
    request: new Request(base + 'index.html', { method: 'GET' }),
    respondWith: val => { serveResp = val; },
    waitUntil: () => {}
  });
  const served = await serveResp;
  assert.equal(served.status, 200);
  assert.match(await served.text(), /APP_VERSION = "3\.12\.2"/);

  // Activate 3.12.2 release
  let activateWait;
  events.activate({ waitUntil: p => { activateWait = p; } });
  await activateWait;

  // Verify old cache removed and new cache retained
  const activeKeys = await cachesMock.keys();
  assert.ok(!activeKeys.includes(oldCacheName), 'Old cache removed on activation');
  assert.ok(activeKeys.includes(newCacheName), 'New cache retained');
  assert.ok(clientMessages.some(m => m.type === 'MURPHY_STATUS' && m.version === '3.12.2' && m.offlineReady === true));
});
