'use strict';
// Review-only probes for the 2026-11-05 Claude review. Passing assertions confirm
// the CURRENT (defective or friction-causing) behaviour at app 3.9.2; they are
// audit evidence, not regression tests of the desired outcome.
// Synthetic data only. Every non-local URL is aborted; Firebase is replaced by a
// local stub module. No production account, Firebase project or data is touched.
// These probes describe app 3.9.2. 3.10.0 fixes CR-01..CR-03 and CR-05..CR-09, so
// run them against the reviewed baseline (APP_HTML) to see the original behaviour:
//   git show 5590437:index.html > /tmp/murphy-3.9.2.html
//   APP_HTML=/tmp/murphy-3.9.2.html node docs/reviews/2026-11-05/reproduce-friction.cjs
// CR-04's original assertion depended on a permanently withheld Web Lock (Codex review):
// it is kept as a record of the 3.9.2 harness result, not as evidence of a device defect.
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE follow the existing browser suites.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../../..');
const original = fs.readFileSync(process.env.APP_HTML || path.join(root, 'index.html'), 'utf8');
const origin = 'http://127.0.0.1:8877';
const shellScript = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/i;
const expose = (_, body, end) => body + `
  window.testApp={S,queuedWrites,render,renderFeedback,setStatus,open:(tab,o)=>navigateTo(tab,o)};
` + end;
const sdk = s => s.replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>/gi, '')
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/g, '/firebase-stub.js')
  .replace(/(<script type="module">[\s\S]*?)(<\/script>)/i, expose);
// Harness shell (as in tests/*.browser.cjs): fixed clock, sync lock never granted,
// so queued writes stay in the local outbox and no backend call is attempted.
const harness = sdk(original.replace(shellScript, `<script>
  window.AppShell={state:{},ready(){}};
  const RealDate=Date;window.__now=Number(localStorage.getItem('test-clock'))||Date.parse('2026-11-05T09:00:00Z');
  window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[window.__now]));}static now(){return window.__now;}};
  Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}});
  if(localStorage.getItem('probe-offline'))Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false});
</script>`));
// Real AppShell bootstrap kept, for the cold-launch sign-in gate probe.
const realShell = sdk(original.replace('<script>', `<script>
  Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}});
</script><script>`));
const stub = `
  const fx=()=>JSON.parse(localStorage.getItem('probe-fixture')||'{}');
  export const initializeApp=()=>({}),getAuth=()=>({}),initializeFirestore=()=>({}),
    persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),
    collection=(_db,col)=>({col}),doc=(_db,col,id)=>({col,id});
  export const onAuthStateChanged=(_a,cb)=>{setTimeout(()=>cb({uid:'probe-user',email:'probe@example.invalid'}),fx().authDelay||0);return()=>{};};
  export const onSnapshot=(ref,_o,cb)=>{
    const days=ref.col==='days'?fx().days||{}:{};
    queueMicrotask(()=>cb(ref.id?{exists:()=>false,metadata:{fromCache:true}}:
      {docChanges:()=>Object.entries(days).map(([id,v])=>({type:'added',doc:{id,data:()=>v}})),metadata:{fromCache:true}}));
    return()=>{};
  };
  export const signOut=async()=>{localStorage.setItem('probe-signout',String(Number(localStorage.getItem('probe-signout')||0)+1));};
  const forbidden=()=>{throw Error('Unexpected backend operation');};
  export const signInWithEmailAndPassword=forbidden,setDoc=forbidden,deleteDoc=forbidden,deleteField=forbidden,runTransaction=forbidden;
`;
const TODAY = '2026-11-05';
const errors = [], external = [], dialogs = [], results = [];

async function main() {
  const browser = await chromium.launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  async function context(body=harness, viewport={width:390,height:844}) {
    const ctx = await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) { external.push(u.href); return route.abort(); }
      if (u.pathname === '/index.html') return route.fulfill({contentType:'text/html',body});
      if (u.pathname === '/firebase-stub.js') return route.fulfill({contentType:'application/javascript',body:stub});
      // AG-12: stock Chromium aborts navigation to an empty, untyped 404.
      return route.fulfill({status:404,contentType:'text/html',body:'not found'});
    });
    return ctx;
  }
  async function page(ctx, setup, arg) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    if (setup) {
      await p.goto(origin+'/404');
      await p.evaluate(setup, arg);
    }
    await p.goto(origin+'/index.html');
    await p.waitForFunction(() => window.testApp?.S.ready);
    return p;
  }
  const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    // CR-01: the sign-in form is shown, and enabled, to an already signed-in user
    // until Firebase Auth reports the persisted session.
    {
      const ctx = await context(realShell);
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(e.message));
      await p.goto(origin+'/404');
      await p.evaluate(() => localStorage.setItem('probe-fixture', JSON.stringify({authDelay:1500,days:{}})));
      await p.goto(origin+'/index.html');
      await p.waitForFunction(() => document.getElementById('signin').textContent==='Sign in');
      const during = await p.evaluate(() => ({gateVisible:getComputedStyle(document.getElementById('gate')).display!=='none',
        appHidden:document.getElementById('app').classList.contains('hide'),signin:document.getElementById('signin').textContent,
        signinEnabled:!document.getElementById('signin').disabled,passwordVisible:!!document.getElementById('pw').offsetParent}));
      await p.waitForFunction(() => window.testApp?.S.ready);
      const after = await p.evaluate(() => ({gateHidden:document.getElementById('gate').classList.contains('hide')}));
      assert.equal(during.gateVisible, true); assert.equal(during.appHidden, true);
      assert.equal(during.signinEnabled, true); assert.equal(during.passwordVisible, true);
      assert.equal(after.gateHidden, true);
      results.push({id:'CR-01',case:'signed-in cold launch shows an enabled sign-in form first',during,after});
      await ctx.close();
    }

    // CR-02: a historical Blood record keeps a red banner on Today and the Review
    // attention dot on permanently, whatever is logged afterwards.
    {
      const ctx = await context();
      const days = {'2026-03-01':{date:'2026-03-01',stools:[{id:'s-old',time:'08:00',bristol:4,blood:true}]}};
      for (let i=1;i<=7;i++){const d=new Date(Date.parse(TODAY)-i*864e5).toISOString().slice(0,10);
        days[d]={date:d,stools:[{id:'s'+i,time:'08:00',bristol:4}],weight:19,bcs:5};}
      const p = await page(ctx, f => localStorage.setItem('probe-fixture', f), JSON.stringify({days}));
 await settle(p);
      const out = await p.evaluate(() => {
        const note=document.querySelector('#main .note.bad'), todo=document.querySelector('#main [data-todo]');
        return {banner:note?.textContent.trim().slice(0,90),bannerHeight:note?.getBoundingClientRect().height,
          todoTop:todo?.getBoundingClientRect().top,reviewDot:!document.querySelector('#tabbar .dotmark').classList.contains('hide'),
          srAttention:!document.getElementById('review-attention').classList.contains('hide')};
      });
      assert.match(out.banner, /One vet item/); assert.match(out.banner, /Historical/);
      assert.equal(out.reviewDot, true); assert.equal(out.srAttention, true);
      results.push({id:'CR-02',case:'249-day-old blood record still raises the red Today banner and Review dot',out});
      await ctx.close();
    }

    // CR-03: a stool deletion's Undo notice persists across relaunches and days,
    // occupying the sticky region until dismissed.
    {
      const ctx = await context();
      const days = {[TODAY]:{date:TODAY,stools:[{id:'s-today',time:'07:30',bristol:4}]}};
      const p = await page(ctx, f => localStorage.setItem('probe-fixture', f), JSON.stringify({days}));

      await p.locator('[data-act="delstool"]').click();
      await p.waitForSelector('#undo-removal');
      // Relaunch three days later (new tab = new sessionStorage, as a Home Screen cold launch).
      await p.evaluate(() => localStorage.setItem('test-clock', String(Date.parse('2026-11-08T09:00:00Z'))));
      await p.close();
      const q = await page(ctx); await settle(q);
      const out = await q.evaluate(() => ({today:testApp.S.tab,undoShown:!!document.getElementById('undo-removal'),
        label:testApp.S.undo?.label,feedbackHeight:document.getElementById('feedback').getBoundingClientRect().height,
        queued:testApp.queuedWrites().length}));
      assert.equal(out.undoShown, true); assert.match(out.label, /Stool removed · 5 Nov/);
      results.push({id:'CR-03',case:'Undo notice survives relaunch three days later',out});
      await ctx.close();
    }

    // CR-04: offline cold launch with nothing pending reports "Cached; checking sync"
    // indefinitely; the offline wording only appears after an 'offline' event.
    {
      const ctx = await context();
      const p = await page(ctx, () => { localStorage.setItem('probe-offline','1'); localStorage.setItem('probe-fixture','{"days":{}}'); });
      await p.waitForTimeout(500);
      const out = await p.evaluate(() => ({online:navigator.onLine,status:document.getElementById('state').textContent,
        fontSize:getComputedStyle(document.getElementById('state')).fontSize,colour:getComputedStyle(document.getElementById('state')).color}));
      assert.equal(out.online, false); assert.equal(out.status, 'Cached; checking sync');
      results.push({id:'CR-04',case:'offline cold launch status',out});

      // CR-05: three entries pending offline; status gives no count or age and is 12px.
      for (const id of ['vomited','lethargic','offFood']) {
        await p.evaluate(() => { const f=document.getElementById('events-2026-11-05'); if (f) f.open=true; });
        await p.locator(`#event-${TODAY}-${id}`).click();
      }
      const pending = await p.evaluate(() => ({status:document.getElementById('state').textContent,queued:testApp.queuedWrites().length,
        fontSize:getComputedStyle(document.getElementById('state')).fontSize}));
      assert.equal(pending.queued, 3); assert.equal(pending.status, 'Offline · saved on this device');
      assert.equal(pending.fontSize, '12px');
      results.push({id:'CR-05',case:'pending work has no count/age in status',pending});

      // CR-06: Sign out proceeds offline with three unsent entries and no warning.
      await p.locator('#tabbar [data-tab="settings"]').click();
      const before = dialogs.length;
      await p.locator('#signout-btn').click();
      await p.waitForFunction(() => localStorage.getItem('probe-signout')==='1');
      const signout = await p.evaluate(() => ({signOutCalls:Number(localStorage.getItem('probe-signout')),
        outbox:Object.keys(localStorage).filter(k=>k.startsWith('murphy-outbox')).length}));
      assert.equal(dialogs.length, before, 'no confirmation dialog was shown');
      assert.equal(signout.signOutCalls, 1); assert.equal(signout.outbox, 3);
      results.push({id:'CR-06',case:'offline sign-out with pending entries is not guarded',signout});
      await ctx.close();
    }

    // CR-07: an unsaved weight typed before an iOS kill reappears only behind a
    // "Restore entries" tap in the next (new-session) launch; nothing is queued.
    {
      const ctx = await context();
      const p = await page(ctx, () => localStorage.setItem('probe-fixture','{"days":{}}'));
      await p.locator(`#in-weight-${TODAY}`).fill('19.2');
      await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await p.waitForTimeout(400);
      await p.close();
      const q = await page(ctx); await settle(q);
      const out = await q.evaluate(t => ({fieldValue:document.getElementById('in-weight-'+t).value,
        recoveryNotice:/Unfinished entries available/.test(document.getElementById('feedback').textContent),
        todo:document.querySelector('[data-todo]').textContent.includes('no weight'),queued:testApp.queuedWrites().length}), TODAY);
      assert.equal(out.fieldValue, ''); assert.equal(out.recoveryNotice, true); assert.equal(out.queued, 0);
      results.push({id:'CR-07',case:'relaunch hides typed-but-unsaved weight behind a restore prompt',out});
      await ctx.close();
    }

    // CR-08: while any draft is open, every deferred render replaces Today's
    // "Mark as fed" button node, even when its markup is unchanged.
    {
      const ctx = await context();
      const days = {[TODAY]:{date:TODAY,meal:{recipe:'lamb'}}};
      const p = await page(ctx, f => localStorage.setItem('probe-fixture', f), JSON.stringify({days}));

      await p.locator(`#in-weight-${TODAY}`).fill('19.1');
      const out = await p.evaluate(t => {
        const before=document.getElementById('meal-fed-action-'+t), html=before.outerHTML;
        testApp.render(); const after=document.getElementById('meal-fed-action-'+t);
        return {sameNode:before===after,sameMarkup:after.outerHTML===html,renderDeferred:!!document.querySelector('#main [data-dirty]')};
      }, TODAY);
      assert.equal(out.renderDeferred, true); assert.equal(out.sameMarkup, true); assert.equal(out.sameNode, false);
      results.push({id:'CR-08',case:'Mark as fed node replaced on unchanged deferred render',out});
      await ctx.close();
    }

    // CR-09: one unparsable outbox entry stops replay at start-up; saved records
    // are hidden and the screen says "Not saved".
    {
      const ctx = await context();
      const days = {[TODAY]:{date:TODAY,weight:19.1,bcs:5}};
      const p = await page(ctx, f => localStorage.setItem('probe-fixture', f), JSON.stringify({days}));
      await p.evaluate(f => { localStorage.setItem('probe-fixture', f); localStorage.setItem('murphy-outbox-v2:probe-user:1-bad','{not json'); }, JSON.stringify({days}));
      await p.reload(); await p.waitForFunction(() => window.testApp?.S.ready); await settle(p);
      const out = await p.evaluate(t => ({status:document.getElementById('state').textContent,banner:testApp.S.banner?.title,
        projectedDays:Object.keys(testApp.S.days).length,weightShown:document.getElementById('in-weight-'+t)?.value??null}), TODAY);
      assert.equal(out.status, 'Not saved'); assert.equal(out.projectedDays, 0);
      results.push({id:'CR-09',case:'single corrupt outbox entry hides all saved records',out});
      await ctx.close();
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({results,dialogs,errors,external}, null, 2));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
