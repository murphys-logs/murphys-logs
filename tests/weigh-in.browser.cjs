'use strict';

// Local-only browser regression for the weigh-in-by-difference entry:
// Murphy's weight = combined (person holding Murphy) − person alone.
// Reuses the Firebase-blocked fixture from draft-input.browser.cjs; zero network
// access, sign-in or backend writes. Run: node tests/weigh-in.browser.cjs
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE are honoured as in the other suites.
const assert = require('node:assert/strict');
const { chromium, html: fixtureHtml, stub, origin } = require('./draft-input.browser.cjs');

const TODAY = '2026-11-01', YESTERDAY = '2026-10-31';
// Record every call into the unchanged save handler, exactly as it receives it.
const spy = 'function saveDay(iso,patch){(window.__saveDayCalls??=[]).push(JSON.parse(JSON.stringify([iso,patch])));';
assert.equal(fixtureHtml.split('function saveDay(iso,patch){').length, 2, 'saveDay is defined once');
const html = fixtureHtml.replace('function saveDay(iso,patch){', spy);

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let passed = 0;
  const errors = [], external = [], dialogs = [];
  const pass = name => { passed++; console.log('PASS ' + name); };
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    const ready = () => page.waitForFunction(() => window.testApp?.S.ready);
    await page.goto(origin + '/index.html'); await ready();

    const solo = (iso = TODAY) => page.locator(`#in-weightsolo-${iso}`);
    const combined = (iso = TODAY) => page.locator(`#in-weightcombined-${iso}`);
    const net = (iso = TODAY) => page.locator(`#in-weight-${iso}`);
    const result = (iso = TODAY) => page.locator(`#weigh-result-${iso}`);
    const form = (iso = TODAY) => `[data-form][data-key="weight"][data-date="${iso}"]`;
    const save = (iso = TODAY) => page.locator(`${form(iso)} [data-act="saveinput"]`);
    const cancel = (iso = TODAY) => page.locator(`${form(iso)} [data-act="cancelinput"]`);
    const error = (iso = TODAY) => page.locator(`#in-weight-${iso}-error`);
    const calls = () => page.evaluate(() => window.__saveDayCalls || []);
    const resetCalls = () => page.evaluate(() => { window.__saveDayCalls = []; });

    // 1. Layout and iOS ergonomics
    assert.equal(await net().isHidden(), true, 'the saved net value is not a typed field');
    assert.equal(await net().inputValue(), '18.7');
    for (const input of [solo(), combined()]) {
      assert.equal(await input.isVisible(), true);
      assert.equal(await input.getAttribute('inputmode'), 'decimal');
      assert.equal(await input.getAttribute('step'), '0.01');
      assert.equal(await input.inputValue(), '');
      const box = await input.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44, `44px target: ${JSON.stringify(box)}`);
      assert.ok(parseFloat(await input.evaluate(el => getComputedStyle(el).fontSize)) >= 16, 'no iOS focus zoom');
    }
    assert.equal(await solo().getAttribute('enterkeyhint'), 'next');
    assert.equal(await combined().getAttribute('enterkeyhint'), 'done');
    assert.equal(await page.locator(`label[for="in-weightsolo-${TODAY}"]`).textContent(), 'Your weight (solo), kg');
    assert.equal(await page.locator(`label[for="in-weightcombined-${TODAY}"]`).textContent(), 'Combined weight (holding Murphy), kg');
    assert.equal(await result().textContent(), 'Saved 18.70 kg · weigh again to replace it.');
    for (const width of [390, 375, 320]) {
      await page.setViewportSize({ width, height: 700 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no sideways scroll at ${width}px`);
      const [a, b] = [await solo().boundingBox(), await combined().boundingBox()];
      assert.ok(a.x + a.width <= width && b.x + b.width <= width, `inputs fit at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    pass('two decimal-keypad readings replace the single field: >=16px text, 44px targets, fits 390/375/320px');

    // 2. Live preview with floating-point-safe subtraction
    await solo().fill('83.85');
    assert.equal(await result().getAttribute('data-state'), 'idle', 'one reading is not an error');
    assert.equal(await save().count(), 1, 'typing opens Save / Cancel');
    assert.equal(await save().getAttribute('aria-label'), 'Save Murphy’s weight');
    await combined().fill('102.4');
    assert.equal(await result().textContent(), 'Murphy’s weight: 18.55 kg');
    assert.equal(await result().getAttribute('data-state'), 'ready');
    assert.equal(await net().inputValue(), '18.55', 'never 18.55000000000001');
    pass('live preview shows Murphy’s weight 18.55 kg for 102.4 − 83.85 before saving');

    // 3. Inverted and equal readings: gentle live hint, then blocked on Save
    await resetCalls();
    for (const value of ['80', '83.85']) {
      await combined().fill(value);
      assert.equal(await result().getAttribute('data-state'), 'invalid');
      assert.equal(await result().textContent(), 'The combined weight must be more than your weight alone.');
      assert.equal(await combined().getAttribute('aria-invalid'), null, 'no red error state while still typing');
      assert.equal(await net().inputValue(), '');
      await save().click();
      assert.equal(await combined().getAttribute('aria-invalid'), 'true');
      assert.equal(await error().textContent(), 'The combined weight must be more than your weight alone.');
      assert.equal(await error().isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), `in-weightcombined-${TODAY}`);
      assert.equal(await result().isVisible(), false, 'the message is shown once, as the field error');
    }
    // 4. Incomplete, invalid and out-of-range readings are blocked too
    await combined().fill('');
    await save().click();
    assert.equal(await error().textContent(), 'Enter the combined weight holding Murphy.');
    await solo().fill(''); await combined().fill('102.4');
    await save().click();
    assert.equal(await error().textContent(), 'Enter your weight on the scales alone.');
    assert.equal(await solo().getAttribute('aria-invalid'), 'true');
    await solo().fill('0');
    await save().click();
    assert.equal(await error().textContent(), 'Your weight must be a number above zero.');
    await solo().fill('-3');
    await save().click();
    assert.equal(await error().textContent(), 'Your weight must be a number above zero.');
    await solo().fill('83.85'); await combined().fill('88.85');
    await save().click();
    assert.match(await error().textContent(), /^That makes Murphy 5\.00 kg, outside 10–30 kg/);
    await combined().fill('102.405');
    await save().click();
    assert.equal(await error().textContent(), 'The combined weight: use up to two decimal places.');
    await combined().fill(''); await combined().press('e');
    assert.equal(await combined().evaluate(el => el.validity.badInput), true);
    await save().click();
    assert.equal(await error().textContent(), 'Finish entering the combined weight holding Murphy, or clear it.');
    assert.deepEqual(await calls(), [], 'nothing reached the save handler');
    assert.equal(await page.evaluate(t => testApp.S.days[t].weight, TODAY), 18.7);
    assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
    // Typing again clears the error.
    await combined().fill('102.4');
    assert.equal(await error().isVisible(), false);
    assert.equal(await combined().getAttribute('aria-invalid'), null);
    assert.equal(await result().isVisible(), true, 'the live preview returns once typing resumes');
    // Extra digits and absurd magnitudes are refused before any subtraction (Codex).
    for (const [soloText, combinedText, message] of [
      ['83.850000001', '102.4', 'Your weight: use up to two decimal places.'],
      ['1e-9', '102.4', 'Your weight: enter plain kilograms, like 83.85.'],
      ['100000000000000000', '100000000000000009', 'Your weight must be at most 500 kg.'],
    ]) {
      await solo().fill(soloText); await combined().fill(combinedText);
      if (soloText === '83.850000001') assert.equal(await solo().evaluate(el => el.validity.stepMismatch), true, 'agrees with the native step check');
      await save().click();
      assert.equal(await error().textContent(), message, soloText);
      assert.equal(await net().inputValue(), '', 'no net figure is derived');
    }
    assert.deepEqual(await calls(), [], 'nothing reached the save handler');
    // Correcting the other reading clears both readings' error state (Codex).
    await solo().fill('83.85'); await combined().fill('80');
    await save().click();
    assert.equal(await combined().getAttribute('aria-invalid'), 'true');
    await solo().fill('60');
    assert.equal(await combined().getAttribute('aria-invalid'), null, 'the corrected pair leaves no stale invalid state');
    assert.equal(await solo().getAttribute('aria-invalid'), null);
    assert.equal(await error().isVisible(), false);
    assert.equal(await result().textContent(), 'Murphy’s weight: 20.00 kg');
    await solo().fill('83.85'); await combined().fill('102.4');
    pass('Save is blocked for combined <= solo, empty, zero, negative, unfinished, >2 dp, exponent and over-cap readings; fixing either reading clears both errors');

    // 5. Cancel resets the temporary readings and the net value
    await cancel().click();
    assert.equal(await solo().inputValue(), ''); assert.equal(await combined().inputValue(), '');
    assert.equal(await net().inputValue(), '18.7');
    assert.equal(await save().count(), 0);
    assert.equal(await result().textContent(), 'Saved 18.70 kg · weigh again to replace it.');
    assert.deepEqual(await calls(), []);
    pass('Cancel clears both readings and keeps the saved 18.7 kg');

    // 6. Save hands the unchanged handler only Murphy's single net figure
    const before = await page.evaluate(() => testApp.queuedWrites().length);
    await solo().fill('83.85');
    await solo().press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), `in-weightcombined-${TODAY}`, 'Return on solo moves on to combined');
    assert.equal(await error().isVisible(), false, 'without an error');
    await combined().fill('102.4');
    await combined().press('Enter');
    await page.waitForFunction(t => testApp.S.days[t].weight === 18.55, TODAY);
    assert.deepEqual(await calls(), [[TODAY, { weight: 18.55, weightMissed: false, weightBeforeMissed: null }]],
      'the save handler receives the same patch shape as before, with the rounded net weight only');
    const day = await page.evaluate(t => testApp.S.days[t], TODAY);
    assert.equal(day.weight, 18.55);
    for (const key of Object.keys(day)) assert.doesNotMatch(key, /solo|combined|person|owner|human/i, `no extra field ${key}`);
    const queued = await page.evaluate(() => testApp.queuedWrites());
    assert.equal(queued.length, before + 1);
    const op = queued.at(-1)[1]; // [outbox key, op]
    // Identical to the outbox op the former single field queued for 18.55 kg (checked against main).
    assert.deepEqual(Object.keys(op).sort(), ['col', 'id', 'patch', 'remove']);
    assert.equal(op.col, 'days'); assert.equal(op.id, TODAY);
    assert.deepEqual({ ...op.patch, updatedAt: '<ts>' }, { weight: 18.55, weightMissed: false, date: TODAY, updatedAt: '<ts>' });
    assert.deepEqual(op.remove, [['weightBeforeMissed']]);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => !k.startsWith('test-')).map(k => localStorage.getItem(k)).join('\n'));
    assert.doesNotMatch(stored, /83\.85|102\.4/, 'the two readings are never stored, queued or drafted after saving');
    assert.equal(await solo().inputValue(), ''); assert.equal(await combined().inputValue(), '');
    assert.equal(await net().inputValue(), '18.55');
    assert.equal(await save().count(), 0);
    assert.equal(await result().textContent(), 'Saved 18.55 kg · weigh again to replace it.');
    assert.match(await page.locator(`[data-weight-hint][data-date="${TODAY}"]`).textContent(), /Saved weight 18\.55 kg/);
    pass('saving queues {weight: 18.55, weightMissed: false, weightBeforeMissed: null} and resets both readings');

    // 7. Readings stay in page memory only: never in device storage, even when a draft rewrite fails
    const storage = () => page.evaluate(() => Object.keys(localStorage).filter(k => !k.startsWith('test-')).map(k => k + '=' + localStorage.getItem(k)).join('\n'));
    const noReadings = async label => { const all = await storage(); assert.doesNotMatch(all, /70\.13|89\.03/, label); };
    if (!await page.locator(`#notes-${TODAY}`).evaluate(el => el.open)) await page.locator(`#notes-${TODAY} > summary`).click();
    await page.locator(`#in-notes-${TODAY}`).fill('Unrelated note kept open');
    await solo().fill('70.13'); await combined().fill('89.03');
    assert.equal(await result().textContent(), 'Murphy’s weight: 18.90 kg');
    await page.evaluate(() => testApp.open('review')); await page.evaluate(() => testApp.open('today'));
    assert.equal(await solo().inputValue(), '70.13', 'in-app navigation keeps the readings in memory');
    assert.equal(await combined().inputValue(), '89.03');
    assert.equal(await result().textContent(), 'Murphy’s weight: 18.90 kg');
    await page.evaluate(() => testApp.persistDrafts());
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem(testApp.draftKey())));
    assert.deepEqual(draft.fields.find(f => f.key === 'weight'), { id: `in-weight-${TODAY}`, date: TODAY, key: 'weight', value: '18.9' },
      'the stored draft holds only the net weight, exactly as the single field did');
    await noReadings('readings are never written to device storage');
    // A reload restores the net figure as unsaved; both readings must be weighed again.
    await page.reload(); await ready();
    await page.waitForFunction(t => document.getElementById('in-weight-' + t)?.value === '18.9', TODAY);
    assert.equal(await solo().inputValue(), ''); assert.equal(await combined().inputValue(), '');
    assert.equal(await result().textContent(), 'Unsaved 18.90 kg from an earlier entry. Enter both readings to save it.');
    assert.equal(await page.locator(`#todo-${TODAY}-unsaved-in-weight-${TODAY}`).textContent(), 'Weight typed, not saved');
    assert.equal(await page.locator(`#in-notes-${TODAY}`).inputValue(), 'Unrelated note kept open');
    await resetCalls();
    await save().click();
    assert.equal(await error().textContent(), 'Enter your weight on the scales alone.');
    assert.deepEqual(await calls(), []);
    // Codex's quota case: the draft rewrite after Save fails, with the note draft still open.
    await solo().fill('70.13'); await combined().fill('89.03');
    await page.evaluate(() => {
      window.weighRealSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('murphy-draft')) throw new DOMException('Synthetic quota', 'QuotaExceededError');
        return window.weighRealSetItem.call(this, key, value);
      };
    });
    await page.evaluate(() => testApp.persistDrafts());
    await save().click();
    await page.waitForFunction(t => testApp.S.days[t].weight === 18.9, TODAY);
    assert.deepEqual(await calls(), [[TODAY, { weight: 18.9, weightMissed: false, weightBeforeMissed: null }]]);
    await noReadings('a failed draft rewrite after Save leaves no reading behind');
    await solo().fill('70.13'); await combined().fill('89.04');
    await page.evaluate(() => testApp.persistDrafts());
    await cancel().click();
    await noReadings('a failed draft rewrite after Cancel leaves no reading behind');
    await page.evaluate(() => { Storage.prototype.setItem = window.weighRealSetItem; });
    await page.locator(`[data-form][data-key="notes"] [data-act="cancelinput"]`).click();
    await page.evaluate(() => testApp.persistDrafts());
    await noReadings('nothing after recovery either');
    pass('readings stay in memory: never in device storage, even after a failed draft rewrite; a reload keeps only the unsaved net figure');

    // 8. History editor: same flow; edits replace the saved net weight only
    await page.evaluate(d => testApp.open('day', { date: d }), YESTERDAY);
    await page.waitForSelector(`#in-weightsolo-${YESTERDAY}`);
    assert.equal(await result(YESTERDAY).textContent(), 'Before feeding: weigh alone, then holding Murphy.');
    await resetCalls();
    await solo(YESTERDAY).fill('64.07'); await combined(YESTERDAY).fill('83.03');
    assert.equal(await result(YESTERDAY).textContent(), 'Murphy’s weight: 18.96 kg');
    await save(YESTERDAY).click();
    await page.waitForFunction(d => testApp.S.days[d]?.weight === 18.96, YESTERDAY);
    assert.deepEqual(await calls(), [[YESTERDAY, { weight: 18.96, weightMissed: false, weightBeforeMissed: null }]]);
    assert.equal(await solo(YESTERDAY).inputValue(), '');
    assert.equal(await result(YESTERDAY).textContent(), 'Saved 18.96 kg · weigh again to replace it.');
    // Weight missed locks both readings and keeps the record shape unchanged.
    await page.locator(`#weight-missed-${YESTERDAY}`).click();
    await page.waitForFunction(d => testApp.S.days[d]?.weightMissed === true, YESTERDAY);
    assert.equal(await solo(YESTERDAY).isDisabled(), true);
    assert.equal(await combined(YESTERDAY).isDisabled(), true);
    assert.equal(await net(YESTERDAY).isDisabled(), true);
    assert.deepEqual(await page.evaluate(d => testApp.S.days[d].weightBeforeMissed, YESTERDAY), { kg: 18.96 });
    pass('History edits use the same two readings and replace only the saved net weight; Weight missed locks both');

    // 9. A recovered older draft: unrounded net, stored readings and an unfinished flag, on a day
    //    another device has since marked Weight missed, with an unrelated note draft open.
    {
      const recoveryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const recovery = { version: 2, savedAt: Date.parse('2026-11-01T20:00:00Z'), tab: 'today', cursor: null, viewDate: TODAY, expanded: [], stool: null, stools: [],
        fields: [
          { id: `in-weight-${TODAY}`, date: TODAY, key: 'weight', value: '18.55000000000001', solo: '83.85', combined: '102.4', incomplete: true },
          { id: `in-notes-${TODAY}`, date: TODAY, key: 'notes', value: 'Note from the same session' },
        ] };
      await recoveryContext.addInitScript(({ expectedOrigin, recovery, today }) => {
        if (location.origin !== expectedOrigin || localStorage.getItem('weigh-recovery-seeded')) return;
        localStorage.setItem('test-day-overrides', JSON.stringify({ [today]: { weightMissed: true, weightBeforeMissed: { kg: 18.7 } } }));
        localStorage.setItem('murphy-draft-v2:draft-test:older-weigh-session', JSON.stringify(recovery));
        localStorage.setItem('weigh-recovery-seeded', '1');
      }, { expectedOrigin: origin, recovery, today: TODAY });
      await recoveryContext.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { external.push(url.href); return route.abort(); }
        if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
        return route.fulfill({ status: 404, body: '' });
      });
      const r = await recoveryContext.newPage();
      r.on('pageerror', error => errors.push(error.message));
      r.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
      await r.goto(origin + '/index.html'); await r.waitForFunction(() => window.testApp?.S.ready);
      assert.equal(await r.locator(`#in-weightsolo-${TODAY}`).isDisabled(), true, 'Weight missed locks the readings');
      await r.locator('[data-act="recoverdraft"]').click();
      const rSolo = r.locator(`#in-weightsolo-${TODAY}`), rCombined = r.locator(`#in-weightcombined-${TODAY}`), rNet = r.locator(`#in-weight-${TODAY}`);
      // Stored readings are ignored; the unrounded net value is shown and kept at 2 dp.
      assert.equal(await rSolo.inputValue(), ''); assert.equal(await rCombined.inputValue(), '');
      assert.equal(await rNet.inputValue(), '18.55');
      assert.equal(await r.locator(`#weigh-result-${TODAY}`).textContent(), 'Unsaved 18.55 kg from an earlier entry. Enter both readings to save it.');
      assert.equal(await rSolo.isDisabled(), false, 'a recovered weight stays editable');
      // The unfinished flag survives until a reading is typed again.
      await r.evaluate(t => { document.getElementById('in-weightsolo-' + t).value = '83.85'; document.getElementById('in-weightcombined-' + t).value = '102.4'; }, TODAY);
      await r.locator(`[data-form][data-key="weight"] [data-act="saveinput"]`).click();
      assert.equal(await r.locator(`#in-weight-${TODAY}-error`).textContent(), 'This number was unfinished. Enter it again, or cancel the entry.');
      assert.equal(await r.evaluate(t => testApp.S.days[t].weightMissed, TODAY), true, 'nothing was saved');
      assert.equal(await r.evaluate(() => testApp.queuedWrites().length), 0);
      // Cancel with the note draft still open (full render deferred): Weight missed applies again.
      await r.locator(`[data-form][data-key="weight"] [data-act="cancelinput"]`).click();
      for (const el of [rSolo, rCombined, rNet]) assert.equal(await el.isDisabled(), true, 'readings are locked again after Cancel');
      assert.equal(await r.locator(`#weight-missed-${TODAY}`).getAttribute('aria-checked'), 'true');
      assert.equal(await r.evaluate(() => document.activeElement.id), `weight-missed-${TODAY}`);
      assert.match(await rSolo.getAttribute('aria-describedby'), new RegExp(`^weight-missed-${TODAY}-help `));
      assert.equal(await r.locator(`#in-notes-${TODAY}`).inputValue(), 'Note from the same session', 'the note draft is untouched');
      assert.equal(await r.locator('[data-form][data-key="notes"][data-dirty]').count(), 1);
      assert.doesNotMatch(await r.evaluate(() => Object.values(localStorage).join('\n')), /"solo"|"combined"/, 'the rewritten draft drops the stored readings');
      await recoveryContext.close();
    }
    pass('recovered drafts ignore stored readings, round the net figure, honour the unfinished flag, and Cancel re-applies Weight missed');

    assert.deepEqual(dialogs, [], 'no confirm dialogs: readings stayed within 5% of the mean');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
