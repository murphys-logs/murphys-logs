// Increment this release when publishing a changed application shell.
const VERSION = '3.1.3';
const SCOPE = new URL(self.registration.scope);
const SHELL = new URL('index.html', SCOPE).href;
// Avoid the old "murphy-" prefix: older installs delete all caches using that prefix.
const CACHE_PREFIX = 'murphy.logs:' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const MODULES = new Set(['app', 'auth', 'firestore'].map(name => SDK + 'firebase-' + name + '.js'));
const NAVIGATION_TIMEOUT_MS = 2500;

const isHtml = response => response.ok && /\btext\/html\b/i.test(response.headers.get('content-type') || '');
const openCache = () => caches.open(CACHE_NAME).catch(() => null);
const matchCache = (cache, key) => cache ? cache.match(key).catch(() => undefined) : Promise.resolve(undefined);
const putCache = (cache, key, response) => cache ? cache.put(key, response).catch(() => {}) : Promise.resolve();

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Require a fresh, usable shell. A failed installation leaves the old worker active.
    // Pinned SDK files can be reused from a previous installation if its CDN is unavailable.
    await Promise.all([
      fetch(new Request(SHELL, {cache: 'reload'})).then(response => {
        if (!isHtml(response)) throw Error('Application shell was not available');
        return cache.put(SHELL, response);
      }),
      ...Array.from(MODULES, async url => {
        const cached = await caches.match(url);
        const response = cached?.ok ? cached : await fetch(new Request(url, {mode: 'cors'}));
        if (!response.ok) throw Error('Application dependency was not available');
        await cache.put(url, response);
      })
    ]);
    // The shell remains network-first; this does not reload an open form or touch saved data.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    // Old "murphy-*" caches have no scope identity, so they may belong to another install.
    // Cache Storage is separate from the database and pending-write outbox; neither is changed.
    await self.clients.claim();
  })());
});

async function shellResponse(cachedPromise, network) {
  const cached = await cachedPromise;
  const response = network.then(result => result.ok ? result : (cached || result))
    .catch(() => cached || Response.error());
  if (!cached) return response;
  let timer;
  try {
    return await Promise.race([
      response,
      new Promise(resolve => { timer = setTimeout(() => resolve(cached), NAVIGATION_TIMEOUT_MS); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function moduleResponse(request) {
  const cache = await openCache();
  const cached = await matchCache(cache, request);
  if (cached) return {response: cached};
  try {
    const response = await fetch(request);
    return {response, cache, copy: response.ok ? response.clone() : null};
  } catch {
    return {response: Response.error()};
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (MODULES.has(url.href)) {
    const loaded = moduleResponse(request);
    event.waitUntil(loaded.then(({cache, copy}) => copy && putCache(cache, request, copy)));
    event.respondWith(loaded.then(({response}) => response));
    return;
  }
  const sameScope = url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
  const shell = sameScope && (url.pathname === SCOPE.pathname || url.pathname === new URL(SHELL).pathname);
  if (!sameScope || (request.mode !== 'navigate' && !shell)) return;

  // Fetch and cache lookup start together. Cache failure must not prevent an online load.
  const cache = openCache();
  const network = fetch(request);
  event.waitUntil(Promise.all([cache, network]).then(([storage, response]) => {
    // Only the canonical shell is saved: URL query variants and other routes cannot grow the cache.
    if (shell && isHtml(response)) return putCache(storage, SHELL, response.clone());
  }).catch(() => {}));
  event.respondWith(shellResponse(cache.then(storage => matchCache(storage, SHELL)), network));
});
