// Publish the shell and worker together, with matching release identifiers.
const VERSION = '3.4.0';
const SCOPE = new URL(self.registration.scope);
const SHELL = new URL('index.html', SCOPE).href;
// Older installs removed every "murphy-*" cache. This prefix also identifies its scope.
const CACHE_PREFIX = 'murphy.logs:' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const MODULES = new Set(['app', 'auth', 'firestore'].map(name => SDK + 'firebase-' + name + '.js'));
const FILES = [SHELL, ...MODULES];
const FETCH_TIMEOUT_MS = 10000;

const isHtml = response => response.ok && /\btext\/html\b/i.test(response.headers.get('content-type') || '');
const isModule = response => response?.ok && /\b(?:java|ecma)script\b/i.test(response.headers.get('content-type') || '');
const openCache = () => caches.open(CACHE_NAME).catch(() => null);
const matchCache = (cache, key) => cache ? cache.match(key).catch(() => undefined) : Promise.resolve(undefined);
async function freshFile(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(new Request(url, {cache:'reload', mode:'cors', signal:controller.signal}));
    if (!response.ok) throw Error('An application file could not be downloaded.');
    // Read the body inside the timeout too: receiving headers alone is not offline readiness.
    await response.clone().arrayBuffer();
    return response;
  } finally { clearTimeout(timer); }
}
async function validShell(response) {
  if (!isHtml(response)) return false;
  const html = await response.clone().text();
  return html.match(/\bconst\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] === VERSION &&
    [...MODULES].every(url => html.includes(url));
}
async function prepareCache() {
  // Validate the complete release before replacing any file in this release's cache.
  // A partially published or unavailable release leaves the active worker intact.
  const shell = await freshFile(SHELL);
  if (!await validShell(shell)) throw Error('The app update is not ready yet. Try again when connected.');
  const cache = await caches.open(CACHE_NAME);
  const modules = await Promise.all([...MODULES].map(async url => {
    // SDK URLs are immutable and unchanged across these application releases.
    const saved = await caches.match(url);
    const response = isModule(saved) ? saved : await freshFile(url);
    if (!isModule(response)) throw Error('An application dependency is unavailable.');
    return [url,response];
  }));
  await Promise.all(modules.map(([url,response]) => cache.put(url,response)));
  await cache.put(SHELL,shell);
}
async function appStatus() {
  const cache = await openCache();
  const files = await Promise.all(FILES.map(url => matchCache(cache,url)));
  const offlineReady = files.slice(1).every(isModule) && !!files[0] && await validShell(files[0]);
  return {type:'MURPHY_STATUS', version:VERSION, offlineReady};
}
async function notifyStatus() {
  const status = await appStatus();
  const clients = await self.clients.matchAll({type:'window'});
  clients.forEach(client => client.postMessage(status));
}

self.addEventListener('install', event => {
  // Deliberately wait for the user's Update app action, or for every old tab to close.
  // The worker never reloads a page or discards an unfinished form.
  event.waitUntil(prepareCache());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys().catch(() => []);
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name).catch(() => false)));
    // Only these scoped application caches are removed. IndexedDB, localStorage,
    // Firebase's record cache, the pending-write outbox and other apps are untouched.
    await self.clients.claim();
    await notifyStatus();
  })());
});
self.addEventListener('message', event => {
  if (!['MURPHY_STATUS','MURPHY_REPAIR','MURPHY_ACTIVATE'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    let error;
    if (event.data.type === 'MURPHY_REPAIR') {
      try { await prepareCache(); } catch (e) { error = e.message; }
    }
    const status = {...await appStatus(), ...(error ? {error} : {})};
    event.ports[0]?.postMessage(status);
    if (event.data.type === 'MURPHY_ACTIVATE' && status.offlineReady) await self.skipWaiting();
  })());
});

function recoveryPage() {
  return new Response(`<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Murphy’s Log · Reconnect</title>
<style>:root{color-scheme:light dark}body{font:1rem/1.6 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:24px}h1{font-size:1.75rem;line-height:1.25}a{display:inline-block;min-height:44px;padding:8px 0;color:inherit;font-weight:600}a:focus-visible{outline:3px solid currentColor;outline-offset:4px}</style>
<h1>Reconnect to open Murphy’s Log</h1><p>The app’s start-up files are unavailable. Retrying does not change your saved records.</p><p>Reconnect, then try again. If this screen remains, close all Murphy’s Log tabs and reopen the app to finish any waiting update.</p><a href="${SHELL.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">Try again</a></html>`,
    {status:503, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
async function shellResponse() {
  const cache = await openCache(), cached = await matchCache(cache,SHELL);
  // Keep this release coherent. A background download never silently replaces
  // the shell; registration.update() discovers a staged, visible worker update.
  if (cached && await validShell(cached)) return cached;
  try {
    const response = await freshFile(SHELL);
    if (await validShell(response)) {
      if (cache) await cache.put(SHELL,response.clone()).catch(() => {});
      return response;
    }
  } catch {}
  return recoveryPage();
}
async function moduleResponse(request) {
  const cache = await openCache(), cached = await matchCache(cache,request.url);
  if (isModule(cached)) return cached;
  try {
    const response = await freshFile(request.url);
    if (!isModule(response)) return Response.error();
    if (cache) await cache.put(request.url,response.clone()).catch(() => {});
    return response;
  } catch { return Response.error(); }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (MODULES.has(url.href)) {
    const loaded = moduleResponse(request);
    event.respondWith(loaded);
    event.waitUntil(loaded.then(notifyStatus));
    return;
  }
  const sameScope = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  const shell = sameScope && (url.pathname === SCOPE.pathname || url.pathname === new URL(SHELL).pathname);
  if (!sameScope || (request.mode !== 'navigate' && !shell)) return;

  const loaded = shellResponse();
  event.respondWith(loaded);
  event.waitUntil(loaded.then(notifyStatus));
});
