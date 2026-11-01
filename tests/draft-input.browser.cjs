'use strict';

// Local-only browser regression: PLAYWRIGHT_MODULE may point to an installed
// Playwright package; BROWSER_EXECUTABLE may select a local Chromium browser.
// No dependencies, server, production sign-in or external connections required.
// Run: node tests/draft-input.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original = fs.readFileSync(process.env.APP_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const origin = 'http://127.0.0.1:8876';
const start = Date.parse('2026-11-01T23:59:30Z');
// Replace the classic shell script (the first script block), whatever its tag
// case or end-tag spacing; never the application module.
const shellScript = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/i;
assert.doesNotMatch(original.match(shellScript)[0], /type=["']module["']/i, 'The first script is the classic shell script');
const html = original.replace(shellScript, `<script>
  window.AppShell={state:{},ready(){}};
  const RealDate=Date;window.__now=Number(localStorage.getItem('test-clock'))||${start};
  window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};
  Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}});
</script>`).replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>/gi, '')
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/g, '/firebase-stub.js')
  .replace(/(<script type="module">[\s\S]*?)(<\/script>)/i, (_, body, end) => body + `
    window.testApp={S,persistDrafts,captureDrafts,refreshLocalDay,londonNow,
      queuedWrites,open:tab=>navigateTo(tab),draftKey};
  ` + end);
const stub = `
  const today='2026-11-01',yesterday='2026-10-31';
  export const initializeApp=()=>({}),getAuth=()=>({}),initializeFirestore=()=>({}),
    persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),
    collection=(_db,col)=>({col}),doc=(_db,col,id)=>({col,id});
  export const onAuthStateChanged=(_auth,cb)=>{queueMicrotask(()=>cb({uid:localStorage.getItem('test-user')||'draft-test'}));return()=>{};};
  export const onSnapshot=(ref,_options,cb)=>{
    const data=ref.col==='days'?{[today]:{date:today,weight:18.7,bcs:5},[yesterday]:{date:yesterday,meal:{recipe:'lamb',fedAt:localStorage.getItem('test-planned-meal')?'':'18:00',darfFed:100}}}:{};
    queueMicrotask(()=>cb(ref.id?{exists:()=>false,metadata:{fromCache:true}}:
      {docChanges:()=>Object.entries(data).map(([id,value])=>({type:'added',doc:{id,data:()=>value}})),metadata:{fromCache:true}}));
    return()=>{};
  };
  const forbidden=()=>{throw Error('Unexpected backend operation');};
  export const signInWithEmailAndPassword=forbidden,signOut=forbidden,setDoc=forbidden,
    deleteDoc=forbidden,deleteField=forbidden,runTransaction=forbidden;
`;

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let passed = 0;
  const errors = [], external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if(url.origin !== origin) { external.push(url.href); return route.abort(); }
      if(url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if(url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    async function boot(page) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin+'/index.html');
      await page.waitForFunction(() => window.testApp?.S.ready);
    }
    const page = await context.newPage();
    await boot(page);
    const field = key => page.locator(`[data-form][data-key="${key}"] input,[data-form][data-key="${key}"] textarea`).first();
    const savedDraft = () => page.evaluate(() => JSON.parse(localStorage.getItem(testApp.draftKey())));
    const reload = async () => { await page.reload(); await page.waitForFunction(() => window.testApp?.S.ready); };
    const flush = () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await field('notes').fill('Unfinished notes\nSecond line');
    await field('activeMin').fill('87');
    await flush();
    let draft = await savedDraft();
    assert.equal(draft.fields.length, 2);
    assert.equal(draft.fields.find(f => f.key==='activeMin').date, '2026-10-31');
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
    await reload();
    assert.equal(await field('notes').inputValue(), 'Unfinished notes\nSecond line');
    assert.equal(await field('activeMin').inputValue(), '87');
    assert.equal(await page.locator('[data-dirty]').count(), 2);
    assert.equal(await page.evaluate(() => /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)), false);
    passed++; console.log('PASS pagehide/reload restores notes and yesterday activity without writes or autofocus');

    await page.evaluate(() => { document.querySelector('[data-key="notes"] textarea').focus(); });
    await field('notes').press('Enter');
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
    await field('activeMin').press('Enter');
    assert.equal(await page.evaluate(() => testApp.S.days['2026-10-31'].activeMin), 87);
    assert.equal((await savedDraft()).fields.length, 1);
    await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
    assert.equal(await savedDraft(), null);
    await field('weight').fill('18.75');
    await field('weight').evaluate(input => {
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    });
    assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].weight), 18.75);
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
    assert.equal(await field('weight').getAttribute('enterkeyhint'), 'done');
    passed++; console.log('PASS numeric Enter confirms once locally; notes keep newlines; Save/Cancel clear drafts');

    await field('weight').fill('18.755');
    await field('weight').press('Enter');
    assert.equal(await field('weight').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
    await field('weight').fill('19');
    await field('weight').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
    await page.locator('[data-key="weight"] [data-act="cancelinput"]').click();
    // Native invalid partial numbers must never become a clear operation.
    await field('weight').fill('');await field('weight').press('e');
    assert.equal(await field('weight').evaluate(input => input.validity.badInput), true);
    await field('weight').press('Enter');
    assert.equal(await field('weight').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
    await page.locator('[data-key="weight"] [data-act="cancelinput"]').click();
    passed++; console.log('PASS step validation, IME composition and native incomplete numbers never queue invalid edits');

    await page.locator('[data-act="openstool"]').first().click();
    await page.locator('#st-t').fill('22:17');
    await page.locator('[data-act="stooltype"][data-b="4"]').click();
    await page.locator('[data-act="tog-mucus"]').click();
    await page.locator('.previous-meal summary').first().click();
    await page.locator('#fed-time-2026-10-31').fill('19:45');
    await field('activeMin').fill('95');
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange')); });
    draft = await savedDraft();
    assert.equal(draft.stool.time, '22:17');assert.equal(draft.stool.record.bristol, 4);assert.equal(draft.stool.record.mucus, true);
    await page.evaluate(() => localStorage.setItem('test-clock',String(Date.parse('2026-11-02T00:01:00Z'))));
    await reload();
    assert.equal(await page.locator('#st-t').inputValue(), '22:17');
    assert.equal(await page.locator('#st-date').inputValue(), '2026-11-01');
    assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#fed-time-2026-10-31').inputValue(), '19:45');
    assert.equal(await field('activeMin').inputValue(), '95');
    assert.equal(await field('activeMin').evaluate(input => input.closest('[data-form]').dataset.date), '2026-10-31');
    assert.equal(await page.locator('.moment').textContent(), 'Unfinished entries');
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
    await page.locator('[data-act="jump"][data-k="stool"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.id),'stools-2026-11-01');
    passed++; console.log('PASS hidden/midnight reload preserves complete stool, explicit meal time and original activity date');

    await page.evaluate(() => { testApp.persistDrafts();sessionStorage.removeItem('murphy-draft-session'); });
    await reload();
    assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
    await page.locator('[data-act="recoverdraft"]').click();
    assert.equal(await page.locator('#st-t').inputValue(), '22:17');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key=>key.startsWith('murphy-draft:draft-test:')).length), 1);
    await page.evaluate(() => localStorage.setItem('test-user','other-account'));
    await reload();
    assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 0);
    assert.equal(await page.locator('[data-stool]').count(), 0);
    assert.equal(await field('activeMin').inputValue(), '');
    passed++; console.log('PASS cold-session recovery transfers a durable copy and another account cannot see it');

    await page.evaluate(() => localStorage.setItem('test-user','draft-test'));
    await reload();
    const ownKey=await page.evaluate(() => testApp.draftKey());
    const ownRaw=await page.evaluate(key=>localStorage.getItem(key),ownKey);
    const second=await context.newPage();await boot(second);
    assert.notEqual(await second.evaluate(() => testApp.draftKey()),ownKey);
    await second.locator('[data-key="notes"] textarea').fill('Another tab');
    await second.evaluate(() => testApp.persistDrafts());
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),ownKey),ownRaw);
    await second.close();
    passed++; console.log('PASS separate tabs never overwrite one another during typing');

    // Return to the recovered snapshot, save/cancel every field, then reload.
    for(const key of ['activeMin']) await page.locator(`[data-key="${key}"] [data-act="cancelinput"]`).click();
    await page.locator('[data-act="cancelfeedingtime"]').first().click();
    await page.locator('[data-act="savestool"]').click();
    assert.equal(await savedDraft(),null);
    assert.equal(await page.locator('.moment').textContent(),'Today');
    assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].stools[0].time),'22:17');
    await reload();
    assert.equal(await page.locator('[data-stool]').count(),0);
    passed++; console.log('PASS confirmed stool is saved on its original date and completed drafts never reopen');

    // Settings are not date-keyed records: a midnight restart must still recover
    // their inputs when the form's rendered date advances.
    await page.evaluate(() => testApp.open('more'));
    const target=page.locator('#in-setnum-targetKcal');
    await target.fill('1250');await flush();
    await page.evaluate(() => localStorage.setItem('test-clock',String(Date.parse('2026-11-03T00:01:00Z'))));
    await reload();
    assert.equal(await target.inputValue(),'1250');
    await target.press('Enter');
    assert.equal(await page.evaluate(() => testApp.S.settings.targetKcal),1250);
    assert.equal(await savedDraft(),null);
    passed++; console.log('PASS settings drafts survive a date change and still use existing setting validation');

    await page.evaluate(() => testApp.open('today'));
    await field('notes').fill('Keep this open when storage fails');
    await page.evaluate(() => {
      window.__setItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key.startsWith('murphy-draft:'))throw new DOMException('Quota','QuotaExceededError');return window.__setItem.call(this,key,value);};
      testApp.persistDrafts();
    });
    assert.match(await page.locator('#feedback').textContent(),/Device storage is unavailable/);
    assert.equal(await field('notes').inputValue(),'Keep this open when storage fails');
    await page.evaluate(() => {Storage.prototype.setItem=window.__setItem;testApp.persistDrafts();});
    assert.equal((await savedDraft()).fields[0].value,'Keep this open when storage fails');
    assert.doesNotMatch(await page.locator('#feedback').textContent(),/Device storage is unavailable/);
    await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
    passed++; console.log('PASS unavailable storage keeps input open, explains recovery limits and retries successfully');

    const clock=await page.evaluate(() => {
      const native=Intl.DateTimeFormat.prototype.formatToParts;let calls=0;
      Intl.DateTimeFormat.prototype.formatToParts=function(...args){calls++;return native.apply(this,args);};
      const now=window.__now;testApp.londonNow();calls=0;
      for(let i=0;i<1000;i++)testApp.londonNow();
      const sameMinute=calls;window.__now=now+60000;const next=testApp.londonNow();
      window.__now=now-60000;const previous=testApp.londonNow();
      window.__now=now;Intl.DateTimeFormat.prototype.formatToParts=native;
      return {sameMinute,calls,next:next.time,previous:previous.time};
    });
    assert.equal(clock.sameMinute,0);assert.equal(clock.calls,2);
    assert.notEqual(clock.next,clock.previous);
    passed++;console.log('PASS repeated clock reads format once per minute and handle a backwards clock adjustment');

    // A damaged recovery record must not prevent boot or touch the outbox.
    await page.evaluate(() => localStorage.setItem(testApp.draftKey(),'{broken JSON'));
    await reload();
    assert.equal(await page.locator('[data-stool]').count(),0);
    assert.equal(await page.evaluate(() => testApp.S.ready),true);
    passed++;console.log('PASS corrupted draft storage does not prevent saved records from loading');

    await page.evaluate(() => {
      localStorage.removeItem(testApp.draftKey());
      localStorage.setItem('test-clock',String(Date.parse('2026-11-01T23:59:30Z')));
      localStorage.setItem('test-planned-meal','true');
    });
    await reload();
    await field('notes').fill('Previous day before midnight');await flush();
    await page.evaluate(() => localStorage.setItem('test-clock',String(Date.parse('2026-11-02T00:01:00Z'))));
    await reload();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('[data-act="jump"][data-k="bowl"]').click();
    assert.equal(await page.evaluate(() => testApp.S.cursor),'2026-10-31');
    assert.equal(await page.evaluate(() => testApp.S.tab),'day');
    passed++;console.log('PASS a recovered bowl shortcut keeps its displayed date after draft-discard cleanup');

    await page.locator('#tabbar [data-tab="today"]').click();
    const beforeQuick=await page.evaluate(()=>testApp.queuedWrites().length);
    await page.locator('[data-act="openstool"][data-b="6"]').first().click();
    assert.equal(await page.locator('[data-act="stooltype"][data-b="6"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.act),'stooltype');
    assert.equal(await page.evaluate(()=>testApp.queuedWrites().length),beforeQuick);
    await page.locator('[data-act="cancelstool"]').click();
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.b),'6');
    assert.equal(await savedDraft(),null);
    passed++;console.log('PASS quick logging preselects only the tapped type, requires confirmation and restores focus on Cancel');

    await page.locator('#tabbar [data-tab="day"]').click();
    await page.locator('#history-date').fill('2026-10-30');
    assert.equal(await page.evaluate(()=>testApp.S.cursor),'2026-10-30');
    await page.locator('#history-date').evaluate(input=>{
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'2',bubbles:true}));
      input.value='2026-10-29';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    assert.equal(await page.evaluate(()=>testApp.S.cursor),'2026-10-30');
    await page.locator('#history-date').press('Enter');
    assert.equal(await page.evaluate(()=>testApp.S.cursor),'2026-10-29');
    await field('notes').fill('History draft stays when date change is cancelled');
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('#history-date').fill('2026-10-28');
    assert.equal(await page.evaluate(()=>testApp.S.cursor),'2026-10-29');
    assert.equal(await field('notes').inputValue(),'History draft stays when date change is cancelled');
    assert.equal(await page.locator('#history-date').inputValue(),'2026-10-29');
    assert.equal(await page.evaluate(()=>testApp.queuedWrites().length),beforeQuick);
    await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
    await page.locator('#history-date').fill('2027-01-01');
    assert.equal(await page.locator('#history-date').getAttribute('aria-invalid'),'true');
    assert.equal(await page.evaluate(()=>testApp.S.cursor),'2026-10-29');
    passed++;console.log('PASS History date changes respect typed-entry commit, bounds and cancelled draft navigation');

    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({passed,externalRequests:external,pageErrors:errors}));
    await context.close();
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
