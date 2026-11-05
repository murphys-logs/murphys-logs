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
  window.testApp={S,queuedWrites,render,renderFeedback,setStatus,open:(tab,o)=>navigateTo(tab,o)};
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
  export const setDoc=async(ref,data)=>{log('probe-writes',{col:ref.col,id:ref.id,data});};
  export const signOut=async()=>{log('probe-signout',1);};
  const forbidden=()=>{throw Error('Unexpected backend operation');};
  export const signInWithEmailAndPassword=forbidden,deleteDoc=forbidden,runTransaction=forbidden;
`;

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
  async function open(ctx, setup = {}, { wait = true } = {}) {
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.__dialogs = [];
    page.__answer = true;
    page.on('dialog', d => { page.__dialogs.push(d.message()); page.__answer ? d.accept() : d.dismiss(); });
    if (setup) {
      await page.goto(origin + '/setup');
      await page.evaluate(entries => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, setup);
    }
    await page.goto(origin + '/index.html');
    if (wait) await page.waitForFunction(() => window.testApp?.S.ready);
    return page;
  }
  const fixture = f => ({ 'probe-fixture': JSON.stringify(f) });
  const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const state = page => page.locator('#state').textContent();
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
      await page.locator(`#in-weight-${TODAY}`).fill('19.2');
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
      await a.locator(`#in-weight-${TODAY}`).fill('19.3');
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
      await page.locator(`#in-weight-${TODAY}`).fill('19.1');
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

    // CR-09: an unreadable entry no longer hides saved records; later entries wait; set aside is copy-then-remove.
    {
      const ctx = await context(native);
      const bad = 'murphy-outbox-v2:probe-user:1000-bad';
      const page = await open(ctx, { ...fixture({ days: { [TODAY]: { date: TODAY, weight: 19.1, bcs: 5 } } }), [bad]: '{not json',
        'murphy-outbox-v2:probe-user:2000-ok': JSON.stringify({ col: 'days', id: TODAY, patch: { date: TODAY, notes: 'after the bad entry' }, remove: [] }) });
      await page.waitForFunction(() => document.getElementById('state').textContent === 'Sync held · needs attention');
      const out = await page.evaluate(t => ({ weight: document.getElementById('in-weight-' + t).value, notes: testApp.S.days[t].notes,
        writes: localStorage.getItem('probe-writes'), notice: document.getElementById('feedback').textContent, count: document.getElementById('sync-count').textContent }), TODAY);
      assert.equal(out.weight, '19.1', 'saved records stay visible');
      assert.equal(out.notes, 'after the bad entry', 'later work is projected');
      assert.equal(out.writes, null, 'nothing after the unreadable entry is sent');
      assert.match(out.notice, /One saved change can’t be read/);
      assert.equal(out.count, '2 changes waiting');
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#outbox-recovery-file').click()]);
      const recovery = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      assert.deepEqual(recovery.unreadable, [{ key: bad, raw: '{not json' }]);
      assert.equal(recovery.pending.length, 1);
      await page.locator('#outbox-set-aside').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('probe-writes') || '[]').length === 1);
      const after = await page.evaluate(k => ({ original: localStorage.getItem(k),
        quarantine: JSON.parse(localStorage.getItem('murphy-outbox-quarantine:probe-user:1000-bad')),
        queued: testApp.queuedWrites().length }), bad);
      assert.equal(after.original, null);
      assert.equal(after.quarantine.raw, '{not json');
      assert.equal(after.queued, 0);
      await ctx.close();
      passed++; console.log('PASS CR-09 unreadable outbox entry is isolated, holds later sync, exports raw and is set aside without loss');
    }

    // AG-14: an invalid stool date explains itself beside the form.
    {
      const ctx = await context();
      const page = await open(ctx, fixture({ days: {} }));
      await page.locator(`#quick-stool-${TODAY}-4`).click();
      await page.locator('#st-date').evaluate(el => { el.removeAttribute('max'); el.value = '2026-11-09'; });
      await page.locator('[data-act="savestool"]').click();
      assert.equal(await page.locator('#st-error').textContent(), 'Choose a date on or before today.');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'st-date');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      await ctx.close();
      passed++; console.log('PASS AG-14 a future stool date shows a message and focuses the date');
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
