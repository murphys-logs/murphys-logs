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
    // Lets a test deliver a later synced change through the app's own callback.
    if(ref.col==='days')window.__deliverDays=(id,value)=>cb({docChanges:()=>[{type:'modified',doc:{id,data:()=>value}}],metadata:{fromCache:false}});
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
      // CC-01: the deferred Weight missed refresh must keep Today's combined card.
      const { context, page } = await open({ width: 390, height: 844 });
      const card = page.locator(`#weight-${TODAY}`), condition = page.locator(`#condition-${TODAY}`);
      const missed = page.locator(`#weight-missed-${TODAY}`), note = page.locator(`#in-notes-${TODAY}`);
      const assertCard = async () => {
        assert.equal(await card.count(), 1, 'Today keeps its combined weight and condition card');
        assert.equal(await card.locator('h3').textContent(), 'Weigh-in & condition');
        assert.equal(await card.locator(`#condition-${TODAY} [data-act="bcs"]`).count(), 7);
        assert.equal(await card.locator('[data-weight-hint][data-brief]').count(), 1, 'Today keeps its brief hint');
      };
      await page.locator(`#notes-${TODAY} > summary`).click();
      await note.fill('Unfinished CC-01 note');
      const noteNode = await note.elementHandle();
      const storedDrafts = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('murphy-draft-v2:'))
        .flatMap(k => JSON.parse(localStorage.getItem(k)).fields));
      await page.waitForFunction(() => Object.keys(localStorage).filter(k => k.startsWith('murphy-draft-v2:'))
        .some(k => JSON.parse(localStorage.getItem(k)).fields.some(field => field.key === 'notes')));
      const draftsBefore = await storedDrafts();
      assert.equal(draftsBefore.length, 1);
      for (const checked of [true, false]) {
        await missed.click();
        await page.waitForFunction(([date, value]) => testApp.S.days[date].weightMissed === value, [TODAY, checked]);
        await assertCard();
        assert.equal(await missed.getAttribute('aria-checked'), String(checked));
        assert.equal(await page.locator(`#in-weight-${TODAY}`).isDisabled(), checked);
        assert.equal(await page.evaluate(() => document.activeElement.id), `weight-missed-${TODAY}`);
        assert.equal(await noteNode.evaluate(el => el.isConnected), true, 'the unfinished note is not replaced');
        assert.equal(await note.inputValue(), 'Unfinished CC-01 note');
        assert.equal(await page.locator('[data-form][data-key="notes"][data-dirty]').count(), 1);
        assert.deepEqual(await storedDrafts(), draftsBefore, 'Weight missed preserves the persisted note draft');
      }
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await assertCard(); // The on/off sequence returns to unchanged markup when Cancel renders.
      assert.equal(await note.inputValue(), '');
      assert.deepEqual(await storedDrafts(), []);
      assert.equal(await page.locator('[data-form][data-key="notes"][data-dirty]').count(), 0);
      await page.locator(`#todo-${TODAY} [data-act="jump"][data-k="bcs"]`).click();
      assert.equal(await page.evaluate(() => document.activeElement.id), `condition-${TODAY}`);
      assert.equal(await condition.isVisible(), true);
      const writes = await page.evaluate(() => testApp.queuedWrites());
      assert.equal(writes.length, 2, 'only the two Weight missed actions queue writes');
      assert.deepEqual(writes.map(([, write]) => [write.col, write.id, write.patch.weightMissed]),
        [['days', TODAY, true], ['days', TODAY, false]]);
      assert.equal(writes.some(([, write]) => Object.hasOwn(write.patch, 'notes')), false, 'the draft is never saved');
      await context.close();
    }
    passed++; console.log('PASS Weight missed keeps Today condition controls, draft, hint and focus through on, off and Cancel (CC-01)');

    {
      // History can show the same date as Today, but must retain its separate cards.
      const { context, page } = await open({ width: 390, height: 844 });
      await page.locator('#tabbar [data-tab="history"]').click();
      await page.locator(`#open-day-${TODAY}`).click();
      await page.waitForFunction(today => testApp.S.tab === 'day' && testApp.S.cursor === today, TODAY);
      await page.locator(`#in-notes-${TODAY}`).fill('History draft');
      const conditionNode = await page.locator(`#condition-${TODAY}`).elementHandle();
      for (const checked of [true, false]) {
        await page.locator(`#weight-missed-${TODAY}`).click();
        await page.waitForFunction(([date, value]) => testApp.S.days[date].weightMissed === value, [TODAY, checked]);
        const weight = page.locator(`#weight-missed-${TODAY}`).locator('xpath=ancestor::section[1]');
        assert.equal(await weight.locator('h3').textContent(), 'Weight');
        assert.equal(await weight.locator('[data-act="bcs"]').count(), 0);
        assert.equal(await weight.locator('[data-weight-hint]:not([data-brief])').count(), 1);
        assert.equal(await page.locator(`#condition-${TODAY} [data-act="bcs"]`).count(), 7);
        assert.equal(await conditionNode.evaluate(el => el.isConnected), true, 'History condition card is untouched');
        assert.equal(await page.locator(`#in-weight-${TODAY}`).isDisabled(), checked);
        assert.equal(await page.evaluate(() => document.activeElement.id), `weight-missed-${TODAY}`);
        assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'History draft');
      }
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      assert.equal(await page.locator(`#weight-${TODAY}`).count(), 0, 'History does not acquire Today layout');
      assert.equal(await page.locator(`#condition-${TODAY} [data-act="bcs"]`).count(), 7);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);
      await context.close();
    }
    passed++; console.log('PASS Weight missed keeps History separate Weight and Condition cards while a note is unfinished');

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

      const mealReminder = page.locator(`#todo-${TODAY} [data-act="jump"][data-k="meal"]`);
      assert.equal(await mealReminder.textContent(), 'tonight’s meal not fed yet');
      const before = await page.evaluate(() => testApp.queuedWrites().length);
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.fedAt), '17:30');
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.bowl), 'cleared', 'feeding automatically clears an unset bowl');
      assert.equal(await page.locator(`#bowl-${TODAY}-cleared`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before + 1, 'feeding and automatic clearing share one queued write');
      assert.equal(await mealReminder.count(), 0, 'Still to log drops the meal while the note keeps full renders deferred (CX-03)');
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-fed-status-${TODAY}`);
      assert.equal(await page.locator(`#meal-fed-status-${TODAY}`).textContent(), 'Fed at 17:30');
      assert.equal(await page.locator(`#meal-change-${TODAY} > summary`).textContent(), 'Edit meal');
      await page.locator(`#bowl-${TODAY}-cleared`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.bowl ?? null), null, 'tapping the selected bowl clears its selection');
      assert.equal(await page.locator(`#bowl-${TODAY}-cleared`).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before + 2);
      await page.locator(`#bowl-${TODAY}-cleared`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.bowl), 'cleared');
      assert.equal(await page.locator(`#bowl-${TODAY}-cleared`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before + 3);
      if (!await page.locator(`#meal-change-${TODAY}`).evaluate(el => el.open)) await page.locator(`#meal-change-${TODAY} > summary`).click();
      await page.locator(`#meal-unfeed-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.fedAt ?? null), null, 'Undo Fed removes the feeding time');
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.bowl ?? null), null, 'Undo Fed also removes the bowl outcome');
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.recipe), 'fish');
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-fed-action-${TODAY}`);
      assert.equal(await mealReminder.textContent(), 'tonight’s meal not fed yet', 'Undo Fed restores the reminder');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before + 4, 'Fed, two explicit bowl toggles and Undo Fed each queue one write');
      assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Unfinished note', 'the unrelated note is untouched');
      await context.close();
    }
    passed++; console.log('PASS shortcut, summaries, Mark as fed, bowl and Undo Fed work while another entry is unfinished');

    {
      // CX-01 / CC-02: the prominent amount must be what Mark as fed records.
      const { context, page } = await open({ width: 390, height: 844 });
      const hero = () => page.locator(`[data-meal-plan="${TODAY}"] .meal-hero strong`).textContent();
      const fishGrams = Number.parseInt(await hero(), 10);
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      await page.locator(`#meal-change-${TODAY} > summary`).click();
      await page.locator(`#meal-unfeed-${TODAY}`).click();
      const select = page.locator(`#recipe-${TODAY}`);
      await select.focus(); await select.selectOption('lamb');
      await page.waitForFunction(() => testApp.S.days['2026-11-01'].meal.recipe === 'lamb');
      assert.equal(await hero(), `${fishGrams} g`, 'the hero shows the retained amount to record');
      const lambGrams = Number.parseInt(await page.locator('[data-meal-plan] .meal-amounts > div').filter({ hasText: 'DARF planned' }).locator('dd').textContent(), 10);
      assert.notEqual(lambGrams, fishGrams);
      const help = page.locator(`#meal-fed-help-${TODAY}`);
      assert.match(await help.textContent(), new RegExp(`${fishGrams} g DARF actually fed, saved earlier for this meal\\. The plan is ${lambGrams} g\\.`));
      const helpBox = await box(page, `#meal-fed-help-${TODAY}`), planBox = await box(page, `#meal-use-plan-${TODAY}`), fedBox = await box(page, `#meal-fed-action-${TODAY}`);
      assert.ok(helpBox.bottom <= planBox.top && planBox.bottom <= fedBox.top, 'the retained explanation and plan choice come before Mark as fed');
      assert.equal(await page.locator(`#meal-fed-action-${TODAY}`).getAttribute('aria-describedby'), `meal-fed-help-${TODAY}`);
      await page.locator(`#meal-use-plan-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.darfFed ?? null), null);
      assert.equal(await page.evaluate(() => document.activeElement.id), `meal-fed-action-${TODAY}`, 'focus returns to Mark as fed');
      assert.equal(await help.textContent(), 'Records the time now and the amounts above.');
      assert.equal(await hero(), `${lambGrams} g`, 'choosing the plan updates the prominent amount');
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.darfFed), lambGrams, 'the displayed amount is recorded');
      await context.close();
    }
    passed++; console.log('PASS a retained DARF amount is prominent before Mark as fed and the displayed plan can be recorded instead');

    {
      // Synced overrides refresh the amount and explanation together during deferral, including 0 g.
      for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
        for (const amount of [150, 0]) {
          const { context, page } = await open(viewport);
          await page.locator(`#notes-${TODAY} > summary`).click();
          await page.locator(`#in-notes-${TODAY}`).fill('Unfinished retained-amount note');
          const synced = await page.evaluate(([today, amount]) => ({ ...testApp.S.days[today], meal: { ...testApp.S.days[today].meal, darfFed: amount } }), [TODAY, amount]);
          await page.evaluate(([today, value]) => window.__deliverDays(today, value), [TODAY, synced]);
          const hero = page.locator(`[data-meal-plan="${TODAY}"] .meal-hero`);
          assert.equal(await hero.locator('span').textContent(), 'Fish · DARF to record');
          assert.equal(await hero.locator('strong').textContent(), `${amount} g`);
          assert.match(await page.locator(`#meal-fed-help-${TODAY}`).textContent(), new RegExp(`${amount} g DARF actually fed, saved earlier`));
          const heroBox = await box(page, `[data-meal-plan="${TODAY}"] .meal-hero`), helpBox = await box(page, `#meal-fed-help-${TODAY}`);
          const choiceBox = await box(page, `#meal-use-plan-${TODAY}`), fedBox = await box(page, `#meal-fed-action-${TODAY}`);
          assert.ok(heroBox.bottom <= helpBox.top && helpBox.bottom <= choiceBox.top && choiceBox.bottom <= fedBox.top, 'amount, explanation and choice precede confirmation');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
          const tabbar = await page.locator('#tabbar').evaluate(el => el.getBoundingClientRect().height);
          assert.ok(fedBox.bottom - heroBox.top <= viewport.height - tabbar, 'retained amount and confirmation fit together above the tab bar');
          await page.locator(`#meal-fed-action-${TODAY}`).click();
          assert.equal(await page.evaluate(today => testApp.S.days[today].meal.darfFed, TODAY), amount);
          const writes = await page.evaluate(() => testApp.queuedWrites());
          assert.equal(writes.length, 1);
          assert.equal(({ ...synced.meal, ...writes[0][1].patch.meal }).darfFed, amount, 'the queued update preserves the prominent amount');
          assert.equal(writes[0][1].patch.meal.fedAt, '17:30');
          assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Unfinished retained-amount note');
          assert.equal(await page.locator('[data-key="notes"][data-dirty]').count(), 1);
          await context.close();
        }
      }
    }
    passed++; console.log('PASS retained positive and zero DARF amounts stay prominent, fit at narrow widths and match writes during deferred rendering');

    {
      // CX-04: a synced change refreshes Still to log while a note keeps full renders deferred.
      const { context, page } = await open({ width: 390, height: 844 });
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(`#in-notes-${TODAY}`).fill('Unfinished note');
      const shortcut = k => page.locator(`#todo-${TODAY} [data-act="jump"][data-k="${k}"]`);
      const fedToday = await page.evaluate(today => ({ ...testApp.S.days[today], meal: { ...testApp.S.days[today].meal, fedAt: '17:00' } }), TODAY);
      await shortcut('weight').focus();
      await page.evaluate(([id, value]) => window.__deliverDays(id, value), [TODAY, fedToday]);
      assert.equal(await shortcut('meal').count(), 0, 'the synced feeding removes the meal reminder');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.k), 'weight', 'focus stays on the surviving shortcut');
      // When the focused shortcut itself disappears, focus falls back to the card.
      const unfed = await page.evaluate(today => ({ ...testApp.S.days[today], meal: { ...testApp.S.days[today].meal, fedAt: null } }), TODAY);
      await page.evaluate(([id, value]) => window.__deliverDays(id, value), [TODAY, unfed]);
      await shortcut('meal').focus();
      await page.evaluate(([id, value]) => window.__deliverDays(id, value), [TODAY, fedToday]);
      assert.equal(await page.evaluate(() => document.activeElement.id), `todo-${TODAY}`, 'focus falls back to the card');
      assert.equal(await page.locator(`[data-form][data-key="notes"][data-dirty]`).count(), 1);
      assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Unfinished note');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'synced updates queue nothing');
      await context.close();
    }
    passed++; console.log('PASS Still to log keeps focus on a surviving shortcut, or its card, when a synced change refreshes it');

    {
      // Restored drafts reopen their closed section without any help from the test.
      const { context, page } = await open({ width: 390, height: 844 });
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(`#in-notes-${TODAY}`).fill('Draft in a closed section');
      for (const tab of ['review', 'today']) {
        await page.locator(`#tabbar [data-tab="${tab}"]`).click();
        await page.waitForFunction(tab => testApp.S.tab === tab, tab);
      }
      assert.equal(await page.locator(`#notes-${TODAY}`).evaluate(el => el.open), true, 'navigation reopens the section');
      assert.equal(await page.locator(`#in-notes-${TODAY}`).isVisible(), true);
      assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Draft in a closed section');
      assert.equal(await page.locator(`#activity-${TODAY}`).evaluate(el => el.open), false, 'sections without drafts stay closed');
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.reload(); await page.waitForFunction(() => window.testApp?.S.ready);
      // This harness withholds owner locks, so the draft must use explicit recovery.
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      await page.locator('[data-act="recoverdraft"]').click();
      assert.equal(await page.locator(`#notes-${TODAY}`).evaluate(el => el.open), true, 'reload recovery reopens the section');
      assert.equal(await page.locator(`#in-notes-${TODAY}`).isVisible(), true);
      assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Draft in a closed section');
      assert.notEqual(await page.evaluate(() => document.activeElement.id), `in-notes-${TODAY}`, 'recovery does not focus the field');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'restoring is not saving');
      await page.locator(`[data-key="notes"] [data-act="cancelinput"]`).click();

      // A draft typed in History, where nothing is folded, opens Today's closed section.
      await page.locator(`#tabbar [data-tab="history"]`).click();
      await page.locator(`#open-day-${TODAY}`).click();
      await page.waitForFunction(today => testApp.S.tab === 'day' && testApp.S.cursor === today, TODAY);
      await page.locator(`#in-treats-${TODAY}`).fill('3');
      await page.locator(`#tabbar [data-tab="today"]`).click();
      await page.waitForFunction(() => testApp.S.tab === 'today');
      assert.equal(await page.locator(`#treats-${TODAY}`).evaluate(el => el.open), true, 'the draft opens a section never opened on Today');
      assert.equal(await page.locator(`#in-treats-${TODAY}`).isVisible(), true);
      assert.equal(await page.locator(`#in-treats-${TODAY}`).inputValue(), '3');
      assert.equal(await page.locator(`#notes-${TODAY}`).evaluate(el => el.open), false, 'without a draft, Notes is closed again (state is kept only while drafts exist)');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      await context.close();
    }
    passed++; console.log('PASS restored drafts reopen their closed section after navigation, reload and History edits, without focus or writes');

    {
      // A collapsed section must still say it holds an unfinished entry.
      const { context, page } = await open({ width: 390, height: 844 });
      const mark = id => page.locator(`#${id} > summary > .draft-mark`);
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(`#in-notes-${TODAY}`).fill('Unsaved thought');
      await page.locator(`#notes-${TODAY} > summary`).click();
      assert.equal(await page.locator(`#notes-${TODAY}`).evaluate(el => el.open), false);
      assert.equal(await mark(`notes-${TODAY}`).isVisible(), true, 'the closed summary shows the unsaved entry');
      assert.match(await page.locator(`#notes-${TODAY} > summary`).textContent(), /^Notes No notes Unsaved changes$/, 'separated for assistive technology');
      assert.equal(await mark(`treats-${TODAY}`).count(), 0, 'sections without drafts are unmarked');
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator('[data-key="notes"] [data-act="saveinput"]').click();
      assert.equal(await mark(`notes-${TODAY}`).count(), 0, 'saving clears the marker');
      assert.equal(await page.locator('[data-fold-summary="notes"]').textContent(), 'Unsaved thought');

      // Edit meal and its nested supplement corrections, kept across navigation, cleared by Cancel.
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      await page.locator(`#meal-change-${TODAY} > summary`).click();
      await page.locator(`#in-darfFed-${TODAY}`).fill('175');
      await page.locator(`#meal-correction-${TODAY} > summary`).click();
      await page.locator(`#meal-amount-${TODAY}-oilMl`).fill('5');
      await page.locator(`#meal-change-${TODAY} > summary`).click();
      assert.equal(await mark(`meal-change-${TODAY}`).isVisible(), true, 'collapsed Edit meal says it holds an unsaved entry');
      for (const tab of ['review', 'today']) {
        await page.locator(`#tabbar [data-tab="${tab}"]`).click();
        await page.waitForFunction(tab => testApp.S.tab === tab, tab);
      }
      assert.equal(await mark(`meal-change-${TODAY}`).count(), 1, 'restored drafts keep the marker');
      assert.equal(await mark(`meal-correction-${TODAY}`).count(), 1);
      await page.locator(`[data-form][data-key="mealamount"][data-setting="oilMl"] [data-act="cancelinput"]`).click();
      assert.equal(await mark(`meal-correction-${TODAY}`).count(), 0, 'Cancel clears the nested marker');
      assert.equal(await mark(`meal-change-${TODAY}`).count(), 1, 'the grams draft still marks Edit meal');
      await page.locator(`[data-form][data-key="darfFed"] [data-act="cancelinput"]`).click();
      assert.equal(await mark(`meal-change-${TODAY}`).count(), 0);
      await context.close();
    }
    passed++; console.log('PASS a collapsed section says it holds an unsaved entry until that entry is saved or cancelled');

    {
      // CX-05: a feeding-time draft cleared without changing saved markup must clear its marker too.
      const { context, page } = await open({ width: 390, height: 844 });
      const fold = `#meal-${YESTERDAY}`, time = `#fed-time-${YESTERDAY}`;
      const marked = id => page.locator(`${id} > summary > .draft-mark`).count();
      const draftFields = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('murphy-draft-v2:'))
        .flatMap(k => JSON.parse(localStorage.getItem(k)).fields.map(f => f.key)));
      await page.locator(`${fold} > summary`).click();
      // Sole draft, Cancel: rendered markup is unchanged, so render() takes its early return.
      await page.locator(time).fill('19:01');
      assert.equal(await marked(fold), 1);
      await page.locator(`[data-act="cancelfeedingtime"][data-date="${YESTERDAY}"]`).click();
      assert.equal(await page.locator(time).inputValue(), '18:00');
      assert.equal(await marked(fold), 0, 'Cancel clears the marker');
      assert.deepEqual(await draftFields(), [], 'no draft remains');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      // Sole draft, Save after reverting to the original time.
      await page.locator(time).fill('19:01'); await page.locator(time).fill('18:00');
      assert.equal(await marked(fold), 1);
      await page.locator(`[data-act="savefeedingtime"][data-date="${YESTERDAY}"]`).click();
      assert.equal(await page.evaluate(y => testApp.S.days[y].meal.fedAt, YESTERDAY), '18:00');
      assert.equal(await marked(fold), 0, 'Save clears the marker');
      assert.deepEqual(await draftFields(), []);
      // Deferred render: an unrelated note draft keeps its own marker.
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(`#in-notes-${TODAY}`).fill('Unrelated note');
      await page.locator(`#notes-${TODAY} > summary`).click();
      await page.locator(time).fill('19:01');
      await page.locator(`[data-act="cancelfeedingtime"][data-date="${YESTERDAY}"]`).click();
      assert.equal(await marked(fold), 0);
      assert.equal(await marked(`#notes-${TODAY}`), 1, 'the surviving note keeps its marker');
      assert.deepEqual(await draftFields(), ['notes']);
      await context.close();
    }
    passed++; console.log('PASS clearing a feeding-time draft clears its marker through unchanged, full and deferred renders');

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
