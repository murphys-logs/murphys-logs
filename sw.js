const VERSION='murphy-3.1.0', SDK='https://www.gstatic.com/firebasejs/12.19.0/';
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(['./','./index.html',
    ...['app','auth','firestore'].map(n=>SDK+'firebase-'+n+'.js')])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('murphy-')&&k!==VERSION)
    .map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const r=e.request, u=new URL(r.url), module=r.url.startsWith(SDK);
  if(r.method!=='GET'||(!module&&u.origin!==self.location.origin)) return;
  e.respondWith(caches.open(VERSION).then(async c=>{
    const cached=await c.match(r);
    if(module&&cached) return cached;
    try{
      const res=await fetch(r);
      if(!res.ok) throw Error('HTTP '+res.status);
      e.waitUntil(c.put(r,res.clone())); return res;
    }catch(error){return cached||(r.mode==='navigate'&&await c.match('./index.html'))||Response.error();}
  }));
});
