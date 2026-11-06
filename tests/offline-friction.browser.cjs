'use strict';

// Local-only browser regression for the 3.10.0 poor-signal and friction fixes
// (CR-01..CR-09, CX-01, AG-14, FR-04 from docs/reviews/2026-11-05). Synthetic data;
// Firebase is a local stub module; every non-local URL is aborted.
// PLAYWRIGHT_MODULE may point to an installed Playwright package; BROWSER_EXECUTABLE
// may select a local Chromium browser. Run: node tests/offline-friction.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original = fs.readFileSync(process.env.APP_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const origin = 'http://127.0.0.1:8878';
const TODAY = '2026-11-05';
const shellScript = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/i;
assert.doesNotMatch(original.match(shellScript)[0], /type=["']module["']/i, 'The first script is the classic shell script');
const expose = (_, body, end) => body + `
  window.testApp={S,queuedWrites,render,renderFeedback,setStatus,subscribe,flushWrites,open:(tab,o)=>navigateTo(tab,o)};
` + end;
const sdk = s => s.replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>/gi, '')
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/g, '/firebase-stub.js')
  .replace(/(<script type="module">[\s\S]*?)(<\/script>)/i, expose);
const clock = `const RealDate=Date;window.__now=Number(localStorage.getItem('test-clock'))||Date.parse('2026-11-05T09:00:00Z');
  window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[window.__now]));}static now(){return window.__now;}};
  if(localStorage.getItem('probe-offline'))Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false});`;
// Held: the sync lock is never granted, so queued work stays local (as in the other suites).
const held = sdk(original.replace(shellScript, `<script>window.AppShell={state:{},ready(){}};${clock}
  Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}});</script>`));
// Native: real Web Locks, so flushing and single-window detection run as on a device.
const native = sdk(original.replace(shellScript, `<script>window.AppShell={state:{},ready(){}};${clock}</script>`));
// Real AppShell bootstrap, for the launch gate.
const realShell = sdk(original);
const stub = `
  const fx=()=>JSON.parse(localStorage.getItem('probe-fixture')||'{}');
  const log=(k,v)=>localStorage.setItem(k,JSON.stringify([...JSON.parse(localStorage.getItem(k)||'[]'),v]));
  export const initializeApp=()=>({}),getAuth=()=>({}),initializeFirestore=()=>({}),
    persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),
    collection=(_db,col)=>({col}),doc=(_db,col,id)=>({col,id}),deleteField=()=>null;
  export const onAuthStateChanged=(_a,cb)=>{const f=fx();setTimeout(()=>cb(f.signedOut?null:{uid:'probe-user',email:'probe@example.invalid'}),f.authDelay||0);return()=>{};};
  export const onSnapshot=(ref,_o,cb)=>{
    const f=fx(),days=ref.col==='days'?f.days||{}:{},metadata={fromCache:f.fromCache!==false};
    queueMicrotask(()=>cb(ref.id?{exists:()=>false,metadata}:
      {docChanges:()=>Object.entries(days).map(([id,v])=>({type:'added',doc:{id,data:()=>v}})),metadata}));
    return()=>{};
  };
  export const setDoc=async(ref,data)=>{const f=fx();if(f.writeDelay)await new Promise(r=>setTimeout(r,f.writeDelay));log('probe-writes',{col:ref.col,id:ref.id,data});};
  export const signOut=async()=>{log('probe-signout',1);};
  const forbidden=()=>{throw Error('Unexpected backend operation');};
  export const signInWithEmailAndPassword=forbidden,deleteDoc=forbidden,runTransaction=forbidden;
`;

// Weight is weighed by difference: Murphy = combined (holding Murphy) − solo.
// The hidden #in-weight-<date> input holds the derived net value the draft stores.
const weighIn = async (page, kg) => {
  await page.locator(`#in-weightsolo-${TODAY}`).fill('70');
  await page.locator(`#in-weightcombined-${TODAY}`).fill((70 + Number(kg)).toFixed(2));
};

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let passed = 0;
  const errors = [], external = [];
  async function context(body = held) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) { external.push(u.href); return route.abort(); }
      if (u.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body });
      if (u.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>setup</title>' });
    });
    return ctx;
  }
  async function open(ctx, setup = {}, { wait = true, session } = {}) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.__dialogs = [];
    page.__answer = true;
    page.on('dialog', d => { page.__dialogs.push(d.message()); page.__answer ? d.accept() : d.dismiss(); });
    if (setup) {
      await page.goto(origin + '/setup');
      await page.evaluate(entries => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, setup);
      if(session)await page.evaluate(value=>sessionStorage.setItem('murphy-draft-session',value),session);
    }
    await page.goto(origin + '/index.html');
    if (wait) await page.waitForFunction(() => window.testApp?.S.ready);
    return page;
  }
  const fixture = f => ({ 'probe-fixture': JSON.stringify(f) });
  const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const state = page => page.locator('#state').textContent();
  const weightDraft=value=>({version:2,ownerLock:true,savedAt:Date.parse(TODAY+'T08:00:00Z'),tab:'today',cursor:null,viewDate:TODAY,expanded:[],stool:null,stools:[],
    fields:[{id:'in-weight-'+TODAY,date:TODAY,key:'weight',value}]});
  try {
    // CR-01: a signed-in launch shows "Opening…", never the sign-in form; signed-out shows the form.
    {
      const ctx = await context(realShell);
      const page = await open(ctx, fixture({ authDelay: 1200, days: {} }), { wait: false });
      await page.waitForFunction(() => document.getElementById('signin').textContent === 'Sign in');
      const during = await page.evaluate(() => ({ opening: !!document.getElementById('gate-opening').offsetParent,
        form: !!document.getElementById('gate-form').offsetParent, password: !!document.getElementById('pw').offsetParent }));
      assert.deepEqual(during, { opening: true, form: false, password: false });
      await page.waitForFunction(() => window.testApp?.S.ready);
      assert.equal(await page.evaluate(() => document.getElementById('gate').classList.contains('hide')), true);
      const out = await open(ctx, fixture({ signedOut: true }), { wait: false });
      await out.waitForFunction(() => !!document.getElementById('pw').offsetParent);
      assert.equal(await out.evaluate(() => !!document.getElementById('gate-opening').offsetParent), false);
      await ctx.close();
      passed++; console.log('PASS CR-01 signed-in launch shows Opening, not the sign-in form; signed-out launch shows the form');
    }

    // CR-02: an old Blood record stays in Review but leaves Today and the Review dot calm.
    {
      const ctx = await context();
      const days = { '2026-03-01': { date: '2026-03-01', stools: [{ id: 's-old', time: '08:00', bristol: 4, blood: true }] } };
      // Six clean days: seven would (correctly) raise Pro-Fibre step-up advice and the dot.
      for (let i = 1; i <= 6; i++) { const d = new Date(Date.parse(TODAY) - i * 864e5).toISOString().slice(0, 10);
        days[d] = { date: d, stools: [{ id: 's' + i, time: '08:00', bristol: 4 }], weight: 19, bcs: 5 }; }
      const page = await open(ctx, fixture({ days }));
      await settle(page);
      assert.equal(await page.locator('#main > .note.bad').count(), 0, 'no red Today banner for a historical-only item');
      assert.equal(await page.evaluate(() => document.querySelector('#tabbar .dotmark').classList.contains('hide')), true);
      await page.locator('#tabbar [data-tab="review"]').click();
      assert.match(await page.locator('#main').textContent(), /Blood recorded\s*Historical · 1 Mar 2026/);
      // A Blood record inside the window still raises the banner.
      await page.evaluate(() => { testApp.S.days = { ...testApp.S.days, '2026-11-03': { date: '2026-11-03', stools: [{ id: 'b-now', time: '08:00', bristol: 4, blood: true }] } }; testApp.open('today'); });
      assert.match(await page.locator('#main > .note.bad').first().textContent(), /Blood recorded/);
      assert.equal(await page.evaluate(() => document.querySelector('#tabbar .dotmark').classList.contains('hide')), false);
      await ctx.close();
      passed++; console.log('PASS CR-02 historical-only vet items stay in Review without a permanent Today banner or Review dot');
    }

    // CR-03: Undo is pinned only briefly; later it is in Settings › Sync & storage and still works.
    {
      const ctx = await context();
      const page = await open(ctx, fixture({ days: { [TODAY]: { date: TODAY, stools: [{ id: 's-today', time: '07:30', bristol: 4 }] } } }));
      await page.locator('[data-act="delstool"]').click();
      await page.waitForSelector('#feedback #undo-removal');
      await page.evaluate(() => localStorage.setItem('test-clock', String(Date.parse('2026-11-08T09:00:00Z'))));
      await page.close();
      const later = await open(ctx, null);
      await settle(later);
      assert.equal(await later.locator('#feedback #undo-removal').count(), 0, 'Undo is no longer pinned three days later');
      await later.locator('#sync-chip').click();
      assert.match(await later.locator('#settings-sync').textContent(), /Recently removed[\s\S]*Stool removed · 5 Nov at 07:30/);
      await later.locator('#settings-sync #undo-removal').click();
      await later.waitForFunction(() => !testApp.S.undo);
      assert.equal(await later.evaluate(() => testApp.S.days['2026-11-05'].stools.length), 1, 'Undo from Settings restores the stool');
      await ctx.close();
      passed++; console.log('PASS CR-03 Undo leaves the pinned area after 15 minutes and remains usable from Settings');
    }

    // CX-01 / CR-04: no "Synced" without server evidence; offline launch says offline.
    {
      const ctx = await context(native);
      const cached = await open(ctx, fixture({ days: {} }));
      await cached.waitForFunction(() => !window.testApp.S.status.startsWith('Connecting'));
      await cached.waitForTimeout(200);
      assert.equal(await state(cached), 'Cached; checking sync', 'an empty outbox with cache-only listeners is not Synced');
      await cached.close();
      const fresh = await open(ctx, fixture({ days: {}, fromCache: false }));
      await fresh.waitForFunction(() => document.getElementById('state').textContent === 'Synced');
      await fresh.close();
      const offline = await open(ctx, { ...fixture({ days: {} }), 'probe-offline': '1' });
      await offline.waitForTimeout(200);
      assert.equal(await state(offline), 'Offline · saved records available');
      await ctx.close();
      passed++; console.log('PASS CX-01/CR-04 Synced needs server-backed snapshots or an acknowledgement; offline launch says Offline');
    }

    // CR-05 / CR-06 / FR-04: count of waiting changes, tappable status, guarded sign-out.
    {
      const ctx = await context();
      const page = await open(ctx, { ...fixture({ days: {} }), 'probe-offline': '1' });
      for (const id of ['vomited', 'lethargic', 'offFood']) {
        await page.evaluate(() => { document.getElementById('events-2026-11-05').open = true; });
        await page.locator(`#event-${TODAY}-${id}`).click();
      }
      assert.equal(await page.locator('#sync-count').textContent(), '3 changes waiting');
      assert.equal(await state(page), 'Offline · saved on this device');
      const size = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('state')).fontSize));
      assert.ok(size >= 14, `status text is at least 14px (${size}px)`);
      const chip = await page.locator('#sync-chip').boundingBox();
      assert.ok(chip.height >= 44, `status chip is a 44px target (${chip.height}px)`);
      await page.locator('#sync-chip').click();
      assert.equal(await page.evaluate(() => testApp.S.tab), 'settings');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-sync');
      const details = await page.locator('#settings-sync').textContent();
      assert.match(details, /3 changes waiting on this device, the oldest saved at 09:00 today/);
      assert.match(details, /Not yet confirmed with the server on this device/);
      assert.match(details, /Storage is (?:protected|not protected)|cannot be checked|could not be checked/);
      page.__answer = false;
      await page.locator('#signout-btn').click();
      assert.equal(page.__dialogs.length, 1);
      assert.match(page.__dialogs[0], /^3 changes saved on this device have not synced yet\. They stay on this device, but you will need signal to sign back in/);
      assert.equal(await page.evaluate(() => localStorage.getItem('probe-signout')), null, 'declining keeps the session');
      page.__answer = true;
      await page.locator('#signout-btn').click();
      await page.waitForFunction(() => localStorage.getItem('probe-signout'));
      await ctx.close();
      // Online with nothing waiting: no extra dialog.
      const quiet = await context();
      const q = await open(quiet, fixture({ days: {} }));
      await q.locator('#tabbar [data-tab="settings"]').click();
      await q.locator('#signout-btn').click();
      await q.waitForFunction(() => localStorage.getItem('probe-signout'));
      assert.equal(q.__dialogs.length, 0);
      await quiet.close();
      passed++; console.log('PASS CR-05/CR-06/FR-04 waiting count, 44px status chip to Sync & storage, storage status and guarded sign-out');
    }

    // CR-07: a typed-but-unsaved weight is listed at once, and restored automatically in a sole window.
    {
      const ctx = await context(native);
      const page = await open(ctx, fixture({ days: {} }));
      await weighIn(page, '19.2');
      await page.waitForSelector(`#todo-${TODAY}-unsaved-in-weight-${TODAY}`);
      assert.equal(await page.locator(`#todo-${TODAY}-unsaved-in-weight-${TODAY}`).textContent(), 'Weight typed, not saved');
      await page.waitForTimeout(400);
      await page.close();
      const next = await open(ctx, null);
      await next.waitForFunction(t => document.getElementById('in-weight-' + t)?.value === '19.2', TODAY);
      const out = await next.evaluate(t => ({ dirty: !!document.querySelector(`[data-key="weight"][data-date="${t}"][data-dirty]`),
        banner: document.getElementById('feedback').textContent, prompt: !!document.querySelector('[data-act="recoverdraft"]'),
        chip: !!document.getElementById(`todo-${t}-unsaved-in-weight-${t}`), queued: testApp.queuedWrites().length }), TODAY);
      assert.deepEqual({ ...out, banner: /Unsaved entries restored/.test(out.banner) }, { dirty: true, banner: true, prompt: false, chip: true, queued: 0 });
      await next.locator(`#todo-${TODAY}-unsaved-in-weight-${TODAY}`).click();
      assert.equal(await next.evaluate(() => document.activeElement.dataset.act), 'saveinput', 'the chip lands on Save');
      await ctx.close();
      // Control: when another window may own the draft (lock unavailable), the prompt remains.
      const shared = await context();
      const a = await open(shared, fixture({ days: {} }));
      await weighIn(a, '19.3');
      await a.waitForTimeout(400);
      await a.close();
      const b = await open(shared, null);
      await settle(b);
      assert.equal(await b.locator('[data-act="recoverdraft"]').count(), 1);
      assert.equal(await b.locator(`#in-weight-${TODAY}`).inputValue(), '');
      await shared.close();
      passed++; console.log('PASS CR-07 unsaved entries are listed in Still to log and auto-restored (still unsaved) in a sole window');
    }

    // CR-08: an unchanged Mark as fed control keeps its node during deferred renders.
    {
      const ctx = await context();
      const page = await open(ctx, fixture({ days: { [TODAY]: { date: TODAY, meal: { recipe: 'lamb' } } } }));
      await weighIn(page, '19.1');
      const out = await page.evaluate(t => {
        const before = document.getElementById('meal-fed-action-' + t), editor = before.closest('[data-meal-editor]');
        testApp.render();
        return { sameNode: before === document.getElementById('meal-fed-action-' + t), sameEditor: editor === document.querySelector(`[data-meal-editor="${t}"]`),
          deferred: !!document.querySelector('#main [data-dirty]') };
      }, TODAY);
      assert.deepEqual(out, { sameNode: true, sameEditor: true, deferred: true });
      await ctx.close();
      passed++; console.log('PASS CR-08 unchanged meal editor and Mark as fed stay connected through deferred renders');
    }

    // CR-09 / R3 / R4 / R7: an unreadable entry no longer hides saved records; later entries wait;
    // the details say sending is held; set aside is collision-free copy-then-remove and stays exportable.
    {
      const ctx = await context(native);
      const at = iso => Date.parse(iso);
      const bad = `murphy-outbox-v2:probe-user:${at('2026-11-05T08:00:00Z')}-same`;
      const legacyBad = `murphy-outbox:probe-user:${at('2026-11-05T08:00:00Z')}-same`;
      const ok = `murphy-outbox-v2:probe-user:${at('2026-11-05T08:30:00Z')}-ok`;
      const page = await open(ctx, { ...fixture({ days: { [TODAY]: { date: TODAY, weight: 19.1, bcs: 5 } } }), [bad]: '{not json', [legacyBad]: 'null',
        [ok]: JSON.stringify({ col: 'days', id: TODAY, patch: { date: TODAY, notes: 'after the bad entry' }, remove: [] }) });
      await page.waitForFunction(() => document.getElementById('state').textContent === 'Sync held · needs attention');
      const out = await page.evaluate(t => ({ weight: document.getElementById('in-weight-' + t).value, notes: testApp.S.days[t].notes,
        writes: localStorage.getItem('probe-writes'), notice: document.getElementById('feedback').textContent, count: document.getElementById('sync-count').textContent }), TODAY);
      assert.equal(out.weight, '19.1', 'saved records stay visible');
      assert.equal(out.notes, 'after the bad entry', 'later work is projected');
      assert.equal(out.writes, null, 'nothing after the unreadable entries is sent');
      assert.match(out.notice, /2 saved changes can’t be read/);
      assert.equal(out.count, '3 changes waiting');
      // R7: details count the held entries in the age and do not promise automatic sending.
      await page.locator('#sync-chip').click();
      const details = await page.locator('#settings-sync').textContent();
      assert.match(details, /3 changes waiting on this device, the oldest saved at 08:00 today\. Sending is held because 2 changes can’t be read/);
      assert.doesNotMatch(details, /sync automatically/);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-outbox-recovery').click()]);
      const recovery = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.deepEqual(recovery.unreadable.map(u => u.raw).sort(), ['{not json', 'null'].sort());
      assert.equal(recovery.pending.length, 1);
      await page.locator('#settings-outbox-set-aside').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('probe-writes') || '[]').length === 1);
      const after = await page.evaluate(([b, l]) => ({ originals: [localStorage.getItem(b), localStorage.getItem(l)],
        quarantine: Object.keys(localStorage).filter(k => k.startsWith('murphy-outbox-quarantine:probe-user:')).map(k => JSON.parse(localStorage.getItem(k))),
        queued: testApp.queuedWrites().length }), [bad, legacyBad]);
      assert.deepEqual(after.originals, [null, null]);
      // R3: equal suffixes under different prefixes keep both payloads, with their full original keys.
      assert.deepEqual(after.quarantine.map(e => [e.key, e.raw]).sort(), [[legacyBad, 'null'], [bad, '{not json']].sort());
      assert.equal(after.queued, 0);
      // R4: the set-aside copies remain visible, exportable and in Full backup.
      await page.evaluate(() => testApp.open('settings', { target: '#settings-sync' }));
      assert.match(await page.locator('#settings-sync').textContent(), /2 unreadable changes are set aside on this device/);
      const [again] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-outbox-recovery').click()]);
      assert.equal(JSON.parse(fs.readFileSync(await again.path(), 'utf8')).setAside.length, 2);
      const [backup] = await Promise.all([page.waitForEvent('download'), page.locator('#export-all').click()]);
      const full = JSON.parse(fs.readFileSync(await backup.path(), 'utf8'));
      assert.deepEqual(full.setAsideOutbox.map(e => e.raw).sort(), ['null', '{not json'].sort());
      assert.equal(full.days[TODAY].notes, 'after the bad entry');
      await ctx.close();
      passed++; console.log('PASS CR-09/R3/R4/R7 unreadable entries are held, explained, set aside without collision and stay in recovery files and Full backup');
    }

    // R2: structurally invalid but parseable operations are isolated too, so later work stays visible.
    {
      const ctx = await context();
      const later = `murphy-outbox-v2:probe-user:${Date.parse('2026-11-05T08:30:00Z')}-ok`;
      const page = await open(ctx, { ...fixture({ days: { [TODAY]: { date: TODAY, stools: [{ id: 's1', time: '07:00', bristol: 4 }] } } }),
        [`murphy-outbox-v2:probe-user:${Date.parse('2026-11-05T08:00:00Z')}-a`]: JSON.stringify({ items: [null] }),
        [`murphy-outbox-v2:probe-user:${Date.parse('2026-11-05T08:10:00Z')}-b`]: JSON.stringify({ col: 'days', id: TODAY, stools: { put: [] } }),
        [later]: JSON.stringify({ col: 'days', id: TODAY, patch: { date: TODAY, notes: 'still visible' }, remove: [] }) });
      await page.waitForFunction(() => testApp.S.ready && document.getElementById('state').textContent === 'Sync held · needs attention');
      const out = await page.evaluate(t => ({ notes: testApp.S.days[t].notes, stools: testApp.S.days[t].stools.length,
        unreadable: document.getElementById('feedback').textContent.includes('2 saved changes can’t be read') }), TODAY);
      assert.deepEqual(out, { notes: 'still visible', stools: 1, unreadable: true });
      await ctx.close();
      passed++; console.log('PASS R2 nested-invalid operations are isolated and later work remains projected');
    }

    // R1: a draft owned by a live window is never auto-restored by another window.
    {
      const ctx = await context(native);
      const a = await open(ctx, fixture({ days: {} }));
      const b = await open(ctx, null);
      await weighIn(b, '19.3');
      await b.waitForTimeout(400);
      const bKey = await b.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('murphy-draft-v2:') && localStorage.getItem(k).includes('19.3')));
      assert.ok(bKey, 'B persisted its draft');
      await a.close();
      const c = await open(ctx, null);
      await settle(c);
      await c.waitForTimeout(300);
      const out = await c.evaluate(([t, k]) => ({ field: document.getElementById('in-weight-' + t).value,
        prompt: !!document.querySelector('[data-act="recoverdraft"]'), bKept: !!localStorage.getItem(k) }), [TODAY, bKey]);
      assert.deepEqual(out, { field: '', prompt: true, bKept: true });
      assert.equal(await b.locator(`#in-weight-${TODAY}`).inputValue(), '19.3', 'B keeps its own draft');
      await ctx.close();
      passed++; console.log('PASS R1 a live window keeps ownership of its draft; another window only offers the prompt');
    }

    // R1: duplicated tabs copy sessionStorage, but must not share a writable draft key.
    {
      const ctx=await context(native),a=await open(ctx,fixture({days:{}}));
      await weighIn(a, '19.3');await a.waitForTimeout(400);
      const owner=await a.evaluate(()=>({session:sessionStorage.getItem('murphy-draft-session'),key:Object.keys(localStorage).find(k=>k.startsWith('murphy-draft-v2:'))}));
      const duplicate=await open(ctx,{}, {session:owner.session});await duplicate.waitForTimeout(300);
      assert.equal(await duplicate.locator(`#in-weight-${TODAY}`).inputValue(),'','a copied session must not activate a live draft');
      assert.equal(await duplicate.locator('[data-act="recoverdraft"]').count(),1,'the duplicate offers explicit recovery');
      await weighIn(duplicate, '19.8');await duplicate.waitForTimeout(400);
      const out=await duplicate.evaluate(key=>({owner:localStorage.getItem(key),drafts:Object.keys(localStorage).filter(k=>k.startsWith('murphy-draft-v2:')).map(k=>localStorage.getItem(k))}),owner.key);
      assert.match(out.owner,/19\.3/);assert.equal(out.drafts.length,2);assert.ok(out.drafts.some(raw=>raw.includes('19.8')));
      assert.equal(await duplicate.evaluate(()=>testApp.queuedWrites().length),0,'both values remain unsaved');
      await ctx.close();passed++;console.log('PASS R1 copied sessionStorage never shares or overwrites a live draft key');
    }

    // R1: another page cannot infer ownership when this live writer failed its claim.
    {
      const ctx=await context(native),owner=await ctx.newPage();
      owner.on('pageerror',e=>errors.push(e.message));
      await owner.addInitScript(()=>{
        const locks=navigator.locks;
        Object.defineProperty(navigator,'locks',{value:{request:(name,...args)=>name.startsWith('murphy-draft-owner:')?Promise.reject(Error('Synthetic owner claim failure')):locks.request(name,...args)}});
      });
      await owner.goto(origin+'/index.html');await owner.waitForFunction(()=>window.testApp?.S.ready);
      await weighIn(owner, '19.7');await owner.waitForTimeout(400);
      const original=await owner.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('murphy-draft-v2:'));return {key,raw:localStorage.getItem(key)};});
      const newcomer=await open(ctx,null);await newcomer.waitForTimeout(150);
      assert.equal(await newcomer.locator(`#in-weight-${TODAY}`).inputValue(),'','a missing owner claim does not prove that writer is closed');
      assert.equal(await newcomer.locator('[data-act="recoverdraft"]').count(),1);
      assert.equal(await newcomer.evaluate(k=>localStorage.getItem(k),original.key),original.raw);
      assert.equal(await owner.locator(`#in-weight-${TODAY}`).inputValue(),'19.7');
      await ctx.close();passed++;console.log('PASS R1 drafts written without a successful owner claim are never auto-moved');
    }

    // R1: old writers have no owner-lock protocol; even a same-session legacy key needs the prompt.
    {
      const ctx=await context(native),key='murphy-draft:probe-user:legacy-live-session';
      const legacy={...weightDraft('19.4'),version:1};delete legacy.stools;
      const raw=JSON.stringify(legacy),page=await open(ctx,{...fixture({days:{}}),[key]:raw},{session:'legacy-live-session'});
      await page.waitForTimeout(150);
      assert.equal(await page.locator(`#in-weight-${TODAY}`).inputValue(),'');
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(),1);
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),raw);
      await page.locator('[data-act="recoverdraft"]').click();
      assert.equal(await page.locator(`#in-weight-${TODAY}`).inputValue(),'19.4');
      assert.equal(await page.locator('[data-key="weight"] [data-act="saveinput"]').count(),1);
      assert.equal(await page.evaluate(()=>testApp.queuedWrites().length),0);
      await ctx.close();passed++;console.log('PASS R1 legacy draft recovery waits for explicit consent and keeps Save');
    }

    // R1: a delayed owner-lock grant must not consume changed, dismissed, or another account's recovery.
    for(const change of ['payload','dismissed','account','unreadable']){
      const ctx=await context(native),session='delayed-'+change,key='murphy-draft-v2:probe-user:'+session,raw=JSON.stringify(weightDraft('19.5'));
      await ctx.addInitScript(target=>{
        const locks=navigator.locks;
        Object.defineProperty(navigator,'locks',{value:{request:(name,...args)=>{
          if(name!=='murphy-draft-owner:'+target)return locks.request(name,...args);
          return new Promise((resolve,reject)=>{window.grantRecovery=()=>locks.request(name,args[0],lock=>{
            window.recoveryLockGranted=true;return args[1](lock);
          }).then(resolve,reject);});
        }}});
      },session);
      const page=await open(ctx,{...fixture({days:{}}),[key]:raw});
      await page.waitForFunction(()=>!!window.grantRecovery);
      let expected=raw;
      if(change==='payload'){
        expected=JSON.stringify(weightDraft('20.1'));
        await page.evaluate(([k,v])=>localStorage.setItem(k,v),[key,expected]);
      }else if(change==='dismissed')await page.locator('[data-act="dismissdraft"]').click();
      else if(change==='unreadable')await page.evaluate(key=>{
        window.recoveryGetItem=Storage.prototype.getItem;
        Storage.prototype.getItem=function(k){if(k===key)throw Error('Synthetic draft read failure');return window.recoveryGetItem.call(this,k);};
      },key);
      else{
        await page.evaluate(()=>{testApp.S.user={uid:'second-user'};testApp.subscribe();});
        await page.waitForFunction(()=>testApp.S.ready);
      }
      await page.evaluate(()=>{window.grantRecovery();});
      await page.waitForFunction(()=>window.recoveryLockGranted);await settle(page);
      if(change==='unreadable')await page.evaluate(()=>{Storage.prototype.getItem=window.recoveryGetItem;});
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),expected);
      assert.equal(await page.locator(`#in-weight-${TODAY}`).inputValue(),'');
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(),['payload','unreadable'].includes(change)?1:0);
      assert.equal(await page.evaluate(()=>testApp.queuedWrites().length),0);
      await ctx.close();passed++;console.log('PASS R1 delayed lock revalidates '+change+' before recovering a draft');
    }

    for(const unavailable of ['unsupported','rejecting','unverified-v2']){
      const ctx=await context(native),key='murphy-draft-v2:probe-user:unowned-'+unavailable,data=weightDraft('19.6');
      if(unavailable==='unverified-v2')delete data.ownerLock;
      const raw=JSON.stringify(data);
      if(unavailable!=='unverified-v2')await ctx.addInitScript(mode=>Object.defineProperty(navigator,'locks',{value:mode==='unsupported'?undefined:{request:()=>Promise.reject(Error('Synthetic rejected lock'))}}),unavailable);
      const page=await open(ctx,{...fixture({days:{}}),[key]:raw});await page.waitForTimeout(150);
      assert.equal(await page.locator(`#in-weight-${TODAY}`).inputValue(),'');
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(),1);
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),raw);
      assert.equal(await page.evaluate(()=>testApp.queuedWrites().length),0);
      await ctx.close();passed++;console.log('PASS R1 '+unavailable+' owner locks preserve the original and offer recovery');
    }

    // R5: the pinned Undo leaves on resume after 15 minutes, without a new render or relaunch.
    {
      const ctx = await context();
      const page = await open(ctx, fixture({ days: { [TODAY]: { date: TODAY, stools: [{ id: 's-today', time: '07:30', bristol: 4 }] } } }));
      await page.locator('[data-act="delstool"]').click();
      await page.waitForSelector('#feedback #undo-removal');
      await page.evaluate(() => { window.__now += 16 * 60000; window.dispatchEvent(new Event('focus')); });
      assert.equal(await page.locator('#feedback #undo-removal').count(), 0);
      assert.ok(await page.evaluate(() => !!testApp.S.undo), 'the durable Undo copy is kept');
      await ctx.close();
      passed++; console.log('PASS R5 pinned Undo expires on resume after 15 minutes and stays recoverable');
    }

    // R6: "last confirmed" belongs to one account.
    {
      const ctx = await context(native);
      const page = await open(ctx, fixture({ days: {}, fromCache: false }));
      await page.waitForFunction(() => testApp.S.lastConfirmed > 0);
      const out = await page.evaluate(async () => {
        localStorage.setItem('probe-fixture', JSON.stringify({ days: {} }));
        testApp.S.user = { uid: 'second-user', email: 'second@example.invalid' };
        testApp.subscribe();
        await new Promise(r => setTimeout(r, 100));
        return { lastConfirmed: testApp.S.lastConfirmed, status: document.getElementById('state').textContent };
      });
      assert.deepEqual(out, { lastConfirmed: null, status: 'Cached; checking sync' });
      await ctx.close();
      passed++; console.log('PASS R6 a second account starts without the first account’s server confirmation');
    }

    // R6: a flush for account A finishing after switching to account B does not mark account B as synced; A -> B -> A recovers A's state.
    {
      const ctx = await context(native);
      const page = await open(ctx, fixture({ days: {}, fromCache: false }));
      await page.waitForFunction(() => testApp.S.lastConfirmed > 0);
      const res = await page.evaluate(async () => {
        // Queue an operation for probe-user and configure setDoc delay
        localStorage.setItem('probe-fixture', JSON.stringify({ writeDelay: 120, days: {} }));
        localStorage.setItem('murphy-outbox-v2:probe-user:1000-w', JSON.stringify({ col: 'days', id: '2026-11-05', patch: { notes: 'hello' } }));
        const flushPromise = window.testApp.flushWrites();

        // Switch to second-user while probe-user's flush is in flight
        await new Promise(r => setTimeout(r, 30));
        testApp.S.user = { uid: 'second-user', email: 'second@example.invalid' };
        testApp.subscribe();

        // Wait for the flush to finish
        await flushPromise;

        const secondUser = {
          status: document.getElementById('state').textContent,
          lastConfirmed: testApp.S.lastConfirmed,
          itemKept: localStorage.getItem('murphy-outbox-v2:probe-user:1000-w')
        };

        // Switch back to probe-user (A -> B -> A)
        localStorage.setItem('probe-fixture', JSON.stringify({ days: {}, fromCache: false }));
        testApp.S.user = { uid: 'probe-user', email: 'probe@example.invalid' };
        testApp.subscribe();
        await new Promise(r => setTimeout(r, 300));

        return {
          secondUser,
          probeUser: {
            status: document.getElementById('state').textContent,
            confirmed: testApp.S.lastConfirmed > 0
          }
        };
      });
      assert.deepEqual(res.secondUser, {
        status: 'Cached; checking sync',
        lastConfirmed: null,
        itemKept: '{"col":"days","id":"2026-11-05","patch":{"notes":"hello"}}'
      });
      assert.equal(res.probeUser.status, 'Synced');
      assert.equal(res.probeUser.confirmed, true);
      await ctx.close();
      passed++; console.log('PASS R6 a flush for account A finishing after switch to B does not mark B synced and A -> B -> A restores A');
    }

    // AG-14: an invalid stool date explains itself beside the form.
    {
      const ctx = await context();
      // Quick ratings save immediately. Exercise validation through the real
      // editor for a saved stool, without creating a new write during setup.
      const stool = { id: 'invalid-date', time: '08:00', bristol: 4, mucus: false, blood: false };
      const page = await open(ctx, fixture({ days: { [TODAY]: { date: TODAY, stools: [stool] } } }));
      const before = await page.evaluate(() => testApp.S.days);
      await page.locator(`[data-act="editstool"][data-id="${stool.id}"]`).click();
      await page.locator('#st-date').evaluate(el => { el.removeAttribute('max'); el.value = '2026-11-09'; });
      await page.locator('[data-act="savestool"]').click();
      assert.equal(await page.locator('#st-error').textContent(), 'Choose a date on or before today.');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'st-date');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      assert.deepEqual(await page.evaluate(() => testApp.S.days), before, 'invalid edits leave every saved record unchanged');
      assert.equal(await page.locator('#st-date').inputValue(), '2026-11-09', 'validation retains the attempted date for correction');
      await ctx.close();
      passed++; console.log('PASS AG-14 a future stool date shows a message and focuses the date');
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
