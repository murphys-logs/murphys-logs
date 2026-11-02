'use strict';

// Local-only browser regression for the shortened Today screen.
// PLAYWRIGHT_MODULE may point to an installed Playwright package; BROWSER_EXECUTABLE
// may select a local Chromium browser. Synthetic stubs replace Firebase; no
// dependencies, server, sign-in or external connections are used.
// Run: node tests/today-layout.browser.cjs
// Positions come from desktop Chromium emulation. They are regression guards,
// not evidence of physical iPhone layout, Dynamic Type or VoiceOver behaviour.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const original = fs.readFileSync(process.env.APP_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const origin = 'http://127.0.0.1:8878';
const start = Date.parse('2026-11-01T17:30:00Z');
const TODAY = '2026-11-01', YESTERDAY = '2026-10-31';
const shellScript = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/i;
assert.doesNotMatch(original.match(shellScript)[0], /type=["']module["']/i, 'The first script is the classic shell script');
const html = original.replace(shellScript, `<script>
  window.AppShell={state:{},ready(){}};
  const RealDate=Date;window.__now=${start};
  window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};
  Object.defineProperty(navigator,'locks',{value:{request:()=>new Promise(()=>{})}});
</script>`).replace(/<link rel="(?:preconnect|dns-prefetch)"[^>]*>/gi, '')
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/g, '/firebase-stub.js')
  .replace(/(<script type="module">[\s\S]*?)(<\/script>)/i, (_, body, end) => body + `
    window.testApp={S,queuedWrites};
  ` + end);
// "planned": a stool and tonight's recipe; "unplanned": no meal chosen yet.
const stub = `
  const planned=localStorage.getItem('layout-fixture')!=='unplanned';
  const data={
    '${TODAY}':{date:'${TODAY}',stools:[{id:'layout-a',time:'07:30',bristol:4,mucus:false,blood:false}],...(planned?{meal:{recipe:'fish'}}:{})},
    '${YESTERDAY}':{date:'${YESTERDAY}',activeMin:55,meal:{recipe:'lamb',fedAt:'18:00',darfFed:140,darfPlanned:140,oilMl:4,fibreG:2.5,bowl:'cleared'}}};
  export const initializeApp=()=>({}),getAuth=()=>({}),initializeFirestore=()=>({}),
    persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),
    collection=(_db,col)=>({col}),doc=(_db,col,id)=>({col,id});
  export const onAuthStateChanged=(_auth,cb)=>{queueMicrotask(()=>cb({uid:'layout-test'}));return()=>{};};
  export const onSnapshot=(ref,_options,cb)=>{
    const rows=ref.col==='days'?data:{};
    queueMicrotask(()=>cb(ref.id?{exists:()=>false,metadata:{fromCache:true}}:
      {docChanges:()=>Object.entries(rows).map(([id,value])=>({type:'added',doc:{id,data:()=>value}})),metadata:{fromCache:true}}));
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
  const errors = [], external = [], measured = [];
  async function open(viewport, fixture = 'planned') {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(fixture => localStorage.setItem('layout-fixture', fixture), fixture);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => window.testApp?.S.ready);
    return { context, page };
  }
  const box = (page, selector) => page.locator(selector).first().evaluate(el => {
    const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), height: r.height };
  });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
      const { context, page } = await open(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0, `no sideways scrolling at ${viewport.width}px`);
      const card = await box(page, `#meal-section-${TODAY}`), hero = await box(page, `[data-meal-plan="${TODAY}"] .meal-hero`);
      const amounts = await box(page, `[data-meal-plan="${TODAY}"] .meal-amounts`), fed = await box(page, `#meal-fed-action-${TODAY}`);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      assert.ok(fed.top >= amounts.bottom && fed.top - amounts.bottom <= 24, 'Mark as fed sits directly beneath the amounts');
      const tabbar = await page.locator('#tabbar').evaluate(el => el.getBoundingClientRect().height);
      assert.ok(fed.bottom - hero.top <= viewport.height - tabbar, 'amounts and Mark as fed fit in one screen above the tab bar');
      for (const selector of [`#meal-fed-action-${TODAY}`, `#meal-change-${TODAY} > summary`, `#activity-${TODAY} > summary`, `#notes-${TODAY} > summary`])
        assert.ok((await box(page, selector)).height >= 44, selector + ' keeps a 44px tap target');
      measured.push({ viewport: [viewport.width, viewport.height], mealTop: card.top, markAsFedTop: fed.top, height });
      if (viewport.width === 390) {
        // Same synthetic fixture before this change: meal at 2,031 px, Mark as fed at 2,828 px, page 3,721 px.
        assert.ok(card.top < 1600, `tonight's meal starts higher (${card.top}px)`);
        assert.ok(height < 2600, `Today is shorter (${height}px)`);
      }
      await context.close();
    }
    passed++; console.log('PASS amounts and Mark as fed share one screen without sideways scrolling at 390, 375 and 320px');

    {
      const { context, page } = await open({ width: 390, height: 844 });
      // The Still to log shortcut lands on the card so its amounts show above the button.
      await page.locator(`[data-act="jump"][data-k="meal"][data-date="${TODAY}"]`).click();
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-section-${TODAY}`);
      const visible = await page.evaluate(id => {
        const r = document.getElementById(id).getBoundingClientRect(), tabbar = document.getElementById('tabbar').getBoundingClientRect();
        return r.top >= 0 && r.bottom <= tabbar.top;
      }, `meal-fed-action-${TODAY}`);
      assert.equal(visible, true, 'Mark as fed is visible after the shortcut');

      // An unfinished note defers full renders; summaries and the meal card still update.
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(`#in-notes-${TODAY}`).fill('Unfinished note');
      await page.locator(`#treats-${TODAY} > summary`).click();
      await page.locator(`#in-treats-${TODAY}`).fill('2');
      await page.locator(`[data-form][data-key="treats"] [data-act="saveinput"]`).click();
      assert.equal(await page.locator(`[data-fold-summary="treats"]`).textContent(), 'Dried necks and feet: 2');
      await page.locator(`#events-${TODAY} > summary`).click();
      await page.locator(`#event-${TODAY}-vomited`).click();
      assert.equal(await page.locator(`[data-fold-summary="events"]`).textContent(), 'Vomited');
      assert.equal(await page.locator(`[data-form][data-key="notes"][data-dirty]`).count(), 1);

      const before = await page.evaluate(() => testApp.queuedWrites().length);
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.fedAt), '17:30');
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-fed-status-${TODAY}`);
      assert.equal(await page.locator(`#meal-fed-status-${TODAY}`).textContent(), 'Fed at 17:30');
      assert.equal(await page.locator(`#meal-change-${TODAY} > summary`).textContent(), 'Edit meal');
      await page.locator(`#bowl-${TODAY}-cleared`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.bowl), 'cleared');
      assert.equal(await page.locator(`#bowl-${TODAY}-cleared`).getAttribute('aria-pressed'), 'true');
      if (!await page.locator(`#meal-change-${TODAY}`).evaluate(el => el.open)) await page.locator(`#meal-change-${TODAY} > summary`).click();
      await page.locator(`#meal-unfeed-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.fedAt ?? null), null, 'Undo Fed removes the feeding time');
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.recipe), 'fish');
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-fed-action-${TODAY}`);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before + 3, 'Fed, bowl and Undo Fed each queue one write');
      assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Unfinished note', 'the unrelated note is untouched');
      await context.close();
    }
    passed++; console.log('PASS shortcut, summaries, Mark as fed, bowl and Undo Fed work while another entry is unfinished');

    {
      const { context, page } = await open({ width: 390, height: 844 }, 'unplanned');
      assert.equal(await page.locator(`#meal-change-${TODAY}`).evaluate(el => el.open), true, 'Change meal starts open without a recipe');
      assert.equal(await page.locator(`#meal-fed-action-${TODAY}`).count(), 0);
      const select = await page.$(`#recipe-${TODAY}`);
      await select.focus(); // Tapping a native select focuses it before the picker opens.
      await select.selectOption('lamb');
      await page.waitForFunction(() => testApp.S.days['2026-11-01'].meal?.recipe === 'lamb');
      assert.equal(await select.evaluate(el => el.isConnected && document.activeElement === el), true, 'the focused recipe picker stays connected');
      assert.match(await page.locator(`[data-meal-plan="${TODAY}"] .meal-hero`).textContent(), /^Lamb · DARF Active\d+ g$/);
      assert.equal(await page.locator(`#meal-fed-action-${TODAY}`).count(), 1);
      await context.close();
    }
    passed++; console.log('PASS choosing the first recipe keeps the picker connected and reveals Mark as fed');
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(JSON.stringify({ passed, measured, externalRequests: external, pageErrors: errors }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
