'use strict';

// Local-only navigation regression. Reuse the same Firebase-blocked fixture as
// draft-input.browser.cjs; no server, production account or new dependency.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');

const TODAY = '2026-11-01';
const YESTERDAY = '2026-10-31';
const legacyDraft = (value, date = TODAY) => ({
  version: 1, savedAt: Date.parse('2026-11-01T22:00:00Z'), tab: 'today',
  cursor: null, viewDate: date, expanded: [], stool: null,
  fields: [{ id: 'in-notes-' + date, date, key: 'notes', value }]
});

// Today folds optional sections. Before typing or tapping, open any closed section
// around the control by its summary, as a person would; reads pass straight through.
const revealing = (page, locator) => new Proxy(locator, { get(target, prop) {
  if (['fill', 'click', 'press', 'type', 'pressSequentially'].includes(prop)) return async (...args) => {
    for (;;) {
      const id = await target.evaluate(el => { let outer = null; for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) outer = p; return outer?.id || ''; });
      if (!id) break;
      await page.locator(`#${id} > summary`).click();
    }
    return target[prop](...args);
  };
  const value = target[prop];
  return typeof value === 'function' ? value.bind(target) : value;
} });

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const errors = [], external = [], unexpectedDialogs = [];
  let passed = 0;
  try {
    async function scenario(name, run, seed) {
      const dialogExpectations = [];
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block'
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { external.push(url.href); return route.abort(); }
        if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
        return route.fulfill({ status: 404, body: '' });
      });
      if (seed) await context.addInitScript(({ seed, expectedOrigin }) => {
        if (location.origin !== expectedOrigin || localStorage.getItem('navigation-test-seeded')) return;
        for (const [key, value] of Object.entries(seed.local || {})) localStorage.setItem(key, value);
        for (const [key, value] of Object.entries(seed.session || {})) sessionStorage.setItem(key, value);
        localStorage.setItem('navigation-test-seeded', '1');
      }, { seed, expectedOrigin: origin });
      async function boot(page) {
        page.on('pageerror', error => errors.push(name + ': ' + error.message));
        page.on('dialog', dialog => {
          const index = dialogExpectations.findIndex(expected => expected.page === page);
          const expected = index < 0 ? null : dialogExpectations.splice(index, 1)[0];
          if (!expected || !expected.pattern.test(dialog.message())) unexpectedDialogs.push(name + ': ' + dialog.message());
          void (expected?.accept ? dialog.accept() : dialog.dismiss());
        });
        await page.goto(origin + '/index.html');
        await page.waitForFunction(() => window.testApp?.S.ready);
      }
      const page = await context.newPage();
      await boot(page);
      const field = (key, date) => revealing(page, page.locator(`[data-form][data-key="${key}"]${date ? `[data-date="${date}"]` : ''} input,[data-form][data-key="${key}"]${date ? `[data-date="${date}"]` : ''} textarea`).first());
      const tab = async name => {
        await page.locator(`#tabbar [data-tab="${name}"]`).click();
        await page.waitForFunction(name => testApp.S.tab === name, name);
      };
      const day = async date => {
        if (await page.evaluate(() => testApp.S.tab) !== 'day') await tab('day');
        await page.locator('#history-date').fill(date);
        await page.waitForFunction(date => testApp.S.cursor === date, date);
      };
      const reload = async () => { await page.reload(); await page.waitForFunction(() => window.testApp?.S.ready); };
      const flush = () => page.evaluate(() => testApp.persistDrafts());
      const drafts = () => page.evaluate(() => JSON.parse(localStorage.getItem(testApp.draftKey())));
      const queued = () => page.evaluate(() => testApp.queuedWrites().length);
      const expectDialog = (accept, pattern = /discard.*hidden/i, target = page) => dialogExpectations.push({ page: target, accept, pattern });
      try {
        await run({ context, page, boot, field, tab, day, reload, flush, drafts, queued, expectDialog });
        assert.equal(dialogExpectations.length, 0, 'every requested destructive action must display its expected confirmation');
        passed++; console.log('PASS ' + name);
      } finally { await context.close(); }
    }

    await scenario('notes, weight and a stool survive ordinary navigation without writes or discard prompts', async ({ page, field, tab, queued }) => {
      await field('notes').fill('Keep this note\nSecond line');
      await field('weight').fill('18.75');
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="4"]`).click();
      await page.locator('#st-t').fill('22:17');
      await page.locator('[data-act="tog-mucus"]').click();
      await tab('status');
      await tab('day');
      assert.equal(await field('notes').inputValue(), '', 'a Today note must not leak into yesterday');
      await tab('today');
      assert.equal(await field('notes').inputValue(), 'Keep this note\nSecond line');
      assert.equal(await field('weight').inputValue(), '18.75');
      assert.equal(await page.locator('#st-t').inputValue(), '22:17');
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await queued(), 0);
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].weight), 18.7);
      assert.equal(await page.evaluate(() => (testApp.S.days['2026-11-01'].stools || []).length), 0);
    });

    await scenario('different History dates retain independent notes and Save or Cancel removes only its own draft', async ({ page, field, day, flush, drafts, queued }) => {
      await day('2026-10-30'); await field('notes').fill('Friday draft');
      await day('2026-10-29'); await field('notes').fill('Thursday draft');
      await day('2026-10-30');
      assert.equal(await field('notes').inputValue(), 'Friday draft');
      await page.locator('[data-key="notes"] [data-act="saveinput"]').click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-10-30'].notes), 'Friday draft');
      await flush();
      assert.equal((await drafts()).fields.some(f => f.date === '2026-10-30' && f.key === 'notes'), false);
      assert.equal((await drafts()).fields.find(f => f.date === '2026-10-29' && f.key === 'notes').value, 'Thursday draft');
      await day('2026-10-29');
      assert.equal(await field('notes').inputValue(), 'Thursday draft');
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await day('2026-10-30');
      assert.equal(await field('notes').inputValue(), 'Friday draft', 'the confirmed note is retained');
      await day('2026-10-29');
      assert.equal(await field('notes').inputValue(), '');
      assert.equal(await queued(), 1, 'navigation and Cancel never queue a record');
      await flush(); assert.equal(await drafts(), null);
    });

    await scenario('Today and History share the same dated active-minutes draft without stale copies', async ({ page, field, tab, day, flush, drafts, queued }) => {
      await field('activeMin').fill('87');
      assert.equal(await field('activeMin').evaluate(el => el.closest('[data-form]').dataset.date), YESTERDAY);
      await day(YESTERDAY);
      assert.equal(await field('activeMin').inputValue(), '87');
      await field('activeMin').fill('95');
      await tab('today');
      assert.equal(await field('activeMin').inputValue(), '95');
      await page.locator('[data-key="activeMin"] [data-act="saveinput"]').click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-10-31'].activeMin), 95);
      await day(YESTERDAY);
      assert.equal(await field('activeMin').inputValue(), '95');
      assert.equal(await page.locator('[data-key="activeMin"][data-dirty]').count(), 0);
      await flush(); assert.equal(await drafts(), null); assert.equal(await queued(), 1);
    });

    for (const withNote of [false, true]) {
      await scenario(`marking a meal fed restores its hidden amount draft ${withNote ? 'while an unrelated note stays dirty' : 'during an ordinary render'}`, async ({ page, field, tab, day, flush, drafts, queued }) => {
        await day(TODAY);
        await page.locator(`#recipe-${TODAY}`).selectOption('lamb');
        const plannedAmount = await page.evaluate(() => testApp.S.days['2026-11-01'].meal.darfPlanned);
        assert.equal(typeof plannedAmount, 'number');
        const draftAmount = String(plannedAmount + 7);
        await field('darfFed', TODAY).fill(draftAmount);
        if (withNote) await field('notes').fill('Unrelated note stays open');
        await tab('today');
        assert.equal(await page.locator(`[data-form][data-key="darfFed"][data-date="${TODAY}"]`).count(), 0, 'the live unfed meal hides actual grams');
        const beforeFed = await queued();
        await page.locator(`#meal-fed-action-${TODAY}`).click();

        assert.equal(await field('darfFed', TODAY).inputValue(), draftAmount);
        assert.equal(await page.locator(`[data-form][data-key="darfFed"][data-date="${TODAY}"][data-dirty]`).count(), 1);
        assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].meal.darfFed), plannedAmount, 'Fed uses the existing calculated amount; restoring the draft is not confirmation');
        assert.equal(await queued(), beforeFed + 1, 'only the explicit Fed action queues a write');
        if (withNote) {
          assert.equal(await field('notes').inputValue(), 'Unrelated note stays open');
          assert.equal(await page.locator('[data-form][data-key="notes"][data-dirty]').count(), 1);
        }
        // A subsequent safe refresh must not overwrite a newer live edit with
        // the older value still held in the draft ledger.
        await field('darfFed', TODAY).fill(String(plannedAmount + 9));
        await page.evaluate(() => testApp.render());
        assert.equal(await field('darfFed', TODAY).inputValue(), String(plannedAmount + 9));
        await flush();
        assert.equal((await drafts()).fields.find(f => f.date === TODAY && f.key === 'darfFed').value, String(plannedAmount + 9));
        assert.equal(await queued(), beforeFed + 1);
      });
    }

    await scenario('resuming a hidden Settings draft leaves the selected History date unchanged', async ({ page, tab, day, queued }) => {
      const selectedDate = '2026-10-29';
      await day(selectedDate); await tab('more');
      await page.locator('#in-setnum-targetKcal').fill('1250');
      await tab('status');
      await page.locator('[data-act="resumedraft"][data-tab="more"]').click();
      assert.equal(await page.evaluate(() => testApp.S.tab), 'more');
      assert.equal(await page.locator('#in-setnum-targetKcal').inputValue(), '1250');
      assert.equal(await page.locator('#in-setnum-targetKcal').evaluate(el => el.closest('[data-form]').hasAttribute('data-dirty')), true);
      assert.equal(await page.evaluate(() => testApp.S.cursor), selectedDate);
      await tab('day');
      assert.equal(await page.locator('#history-date').inputValue(), selectedDate);
      assert.equal(await queued(), 0);
    });

    await scenario('two stool edits keep their identities, dates and flags and Cancel removes only the chosen edit', async ({ page, tab, queued, flush, drafts }) => {
      await page.evaluate(() => {
        testApp.S.days['2026-11-01'].stools = [
          { id: 'nav-a', time: '07:10', bristol: 3, mucus: false, blood: false },
          { id: 'nav-b', time: '12:20', bristol: 4, mucus: false, blood: false }
        ];
        testApp.render(true);
      });
      const edit = id => page.locator(`[data-act="editstool"][data-id="${id}"]`).click();
      await edit('nav-a'); await page.locator('#st-t').fill('07:45');
      await page.locator('#st-date').fill(YESTERDAY);
      await page.locator('[data-act="tog-blood"]').click();
      await edit('nav-b'); await page.locator('#st-t').fill('12:55');
      await page.locator('[data-act="tog-mucus"]').click();
      await tab('status'); await tab('today');
      await edit('nav-a');
      assert.equal(await page.locator('#st-t').inputValue(), '07:45');
      assert.equal(await page.locator('#st-date').inputValue(), YESTERDAY);
      assert.equal(await page.locator('[data-act="tog-blood"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-act="cancelstool"]').click();
      await edit('nav-b');
      assert.equal(await page.locator('#st-t').inputValue(), '12:55');
      assert.equal(await page.locator('#st-date').inputValue(), TODAY);
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-act="cancelstool"]').click();
      assert.deepEqual(await page.evaluate(() => testApp.S.days['2026-11-01'].stools.map(s => [s.id, s.time, s.mucus, s.blood])), [
        ['nav-a', '07:10', false, false], ['nav-b', '12:20', false, false]
      ]);
      await flush(); assert.equal(await drafts(), null); assert.equal(await queued(), 0);
    });

    await scenario('a new quick-log tap never resumes an older hidden new-stool draft', async ({ page, flush, drafts, queued }) => {
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="4"]`).click();
      await page.locator('[data-act="savestool"]').click();
      const savedId = await page.evaluate(() => testApp.S.days['2026-11-01'].stools[0].id);
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="6"]`).click();
      await page.locator('#st-t').fill('22:16'); await flush();
      const hiddenId = (await drafts()).stool.record.id;
      await page.locator(`[data-act="editstool"][data-date="${TODAY}"][data-id="${savedId}"]`).click();
      await page.locator('[data-act="cancelstool"]').click();
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="1"]`).click();
      assert.equal(await page.locator('[data-act="stooltype"][data-b="1"]').getAttribute('aria-pressed'), 'true');
      await flush();
      assert.notEqual((await drafts()).stool.record.id, hiddenId, 'a new type tap creates a distinct observation');
      await page.locator('[data-act="savestool"]').click();
      assert.deepEqual(await page.evaluate(() => testApp.S.days['2026-11-01'].stools.map(s => s.bristol)), [4, 1]);
      assert.equal(await queued(), 2);
      const retained = (await drafts()).stools.find(s => s.record.id === hiddenId);
      assert.equal(retained.record.bristol, 6); assert.equal(retained.time, '22:16');
      await page.locator(`[data-act="resumedraft"][data-id="${hiddenId}"]`).click();
      assert.equal(await page.locator('[data-act="stooltype"][data-b="6"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#st-t').inputValue(), '22:16');
      assert.equal(await queued(), 2, 'resuming the old draft must not save it');
    });

    await scenario('same-date stool drafts resume the last-used entry and same-minute links distinguish their Bristol types', async ({ page, tab, day, reload, flush, drafts, queued }) => {
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="4"]`).click();
      await page.locator('[data-act="savestool"]').click();
      const savedId = await page.evaluate(() => testApp.S.days['2026-11-01'].stools[0].id);
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="6"]`).click();
      await page.locator('#st-t').fill('22:16'); await flush();
      const olderId = (await drafts()).stool.record.id;
      await page.locator(`[data-act="editstool"][data-date="${TODAY}"][data-id="${savedId}"]`).click();
      await page.locator('[data-act="cancelstool"]').click();
      await page.locator(`[data-act="openstool"][data-date="${TODAY}"][data-b="1"]`).click();
      await page.locator('#st-t').fill('22:16');
      await page.locator('[data-act="tog-mucus"]').click(); await flush();
      const newerId = (await drafts()).stool.record.id;
      assert.notEqual(newerId, olderId);

      await tab('status'); await tab('today');
      assert.equal(await page.locator('[data-act="stooltype"][data-b="1"]').getAttribute('aria-pressed'), 'true', 'returning to Today must retain the just-used draft, not silently select the oldest');
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#st-t').inputValue(), '22:16');
      await day(TODAY);
      assert.equal(await page.locator('[data-act="stooltype"][data-b="1"]').getAttribute('aria-pressed'), 'true', 'the same-day History route must resume the same most recently used draft');

      await tab('status'); await reload();
      assert.equal(await page.evaluate(() => testApp.S.tab), 'status');
      assert.equal((await drafts()).stool, null, 'Status has no active stool but still retains the dated draft ledger');
      await tab('today');
      assert.equal(await page.locator('[data-act="stooltype"][data-b="1"]').getAttribute('aria-pressed'), 'true', 'reopening from Status must preserve the most recently used draft');
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');

      await tab('status'); await page.setViewportSize({ width: 375, height: 667 });
      for (const [id, type] of [[olderId, 6], [newerId, 1]]) {
        const link = page.locator(`[data-act="resumedraft"][data-id="${id}"]`);
        assert.match(await link.textContent(), new RegExp(`Bristol\\s+${type}`));
        assert.match(await link.textContent(), /22:16/);
        assert.equal(await page.getByRole('button', { name: new RegExp(`Bristol\\s+${type}`) }).count(), 1, 'the visible type must also distinguish the accessible button name');
        const bounds = await link.boundingBox();
        assert.ok(bounds && bounds.height >= 44 && bounds.width >= 44, 'each resume action must remain an adequate tap target at 375 px');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

      await page.locator(`[data-act="resumedraft"][data-id="${olderId}"]`).click();
      assert.equal(await page.locator('[data-act="stooltype"][data-b="6"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'false');
      await tab('status'); await tab('today');
      assert.equal(await page.locator('[data-act="stooltype"][data-b="6"]').getAttribute('aria-pressed'), 'true', 'explicitly resuming the older entry makes it the last-used entry');
      await day(TODAY); await flush();
      assert.equal(await page.locator('[data-act="stooltype"][data-b="6"]').getAttribute('aria-pressed'), 'true');
      const retainedNewer = (await drafts()).stools.find(s => s.record.id === newerId);
      assert.equal(retainedNewer.record.bristol, 1); assert.equal(retainedNewer.record.mucus, true); assert.equal(retainedNewer.time, '22:16');
      assert.deepEqual(await page.evaluate(() => testApp.S.days['2026-11-01'].stools.map(s => s.bristol)), [4]);
      assert.equal(await queued(), 1, 'resuming and navigating must not confirm either draft');
    });

    const recoverySourceStools = [
      { id: 'recovery-a', time: '07:10', bristol: 4, mucus: false, blood: false },
      { id: 'recovery-b', time: '08:20', bristol: 3, mucus: false, blood: false }
    ];
    const olderRecoveryKey = 'murphy-draft-v2:draft-test:older-overlapping-session';
    const olderRecovery = { version: 2, savedAt: Date.parse('2026-11-01T21:00:00Z'), tab: 'status', cursor: null, viewDate: null, expanded: [], fields: [], stool: null,
      stools: recoverySourceStools.map((original, i) => ({ date: TODAY, record: { ...original, bristol: i === 0 ? 6 : 1 }, original,
        time: '22:16', selectedDate: TODAY, returnFocus: '#add-stool-' + TODAY })) };
    await scenario('restoring overlapping older drafts retains the current edit and its most-recent position', async ({ page, tab, flush, drafts, queued }) => {
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      await page.evaluate(stools => {
        testApp.S.days['2026-11-01'].stools = stools;
        testApp.render(true);
      }, recoverySourceStools);
      await page.locator(`[data-act="editstool"][data-date="${TODAY}"][data-id="recovery-a"]`).click();
      await page.locator('#st-t').fill('09:42');
      await page.locator('[data-act="tog-mucus"]').click();
      await tab('status');
      await page.locator('[data-act="recoverdraft"]').click(); await flush();
      const merged = (await drafts()).stools;
      const current = merged.find(s => s.record.id === 'recovery-a');
      assert.equal(current.time, '09:42'); assert.equal(current.record.mucus, true); assert.equal(current.record.bristol, 4);
      assert.equal(merged.find(s => s.record.id === 'recovery-b').record.bristol, 1, 'the other recovered entry must remain available');
      assert.equal(merged.at(-1).record.id, 'recovery-a', 'replacing the older duplicate must also retain the current edit’s recency');
      await tab('today');
      assert.equal(await page.locator('#st-t').inputValue(), '09:42');
      assert.equal(await page.locator('[data-act="stooltype"][data-b="4"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-act="resumedraft"][data-id="recovery-b"]').count(), 1);
      assert.deepEqual(await page.evaluate(() => testApp.S.days['2026-11-01'].stools), recoverySourceStools);
      assert.equal(await queued(), 0, 'recovery restores drafts without confirming any record');
    }, { local: { [olderRecoveryKey]: JSON.stringify(olderRecovery) } });

    await scenario('discarding inaccessible supplement and stool drafts requires confirmation and preserves a visible failed note', async ({ page, field, tab, day, flush, drafts, queued, expectDialog }) => {
      await page.locator(`#recipe-${TODAY}`).selectOption('fish');
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      await page.locator(`#meal-correction-${TODAY} > summary`).click();
      await page.locator(`#meal-amount-${TODAY}-oilMl`).fill('5');
      await page.evaluate(() => {
        window.navigationRealSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-outbox')) throw new DOMException('Synthetic local failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await page.locator(`[data-form][data-key="mealamount"][data-setting="oilMl"][data-date="${TODAY}"] [data-act="saveinput"]`).click();
      assert.equal(await page.locator('#state').textContent(), 'Not saved');
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
      // Undo Fed is under Edit meal; it hides the unfinished supplement correction.
      await revealing(page, page.locator(`#meal-unfeed-${TODAY}`)).click();
      await tab('day');
      await page.locator(`[data-act="resumedraft"][data-date="${TODAY}"]`).first().click();
      assert.equal(await page.locator(`#meal-amount-${TODAY}-oilMl`).count(), 0);
      assert.match(await page.locator('#feedback').textContent(), /Supplement corrections are available once this meal is marked Fed\./);

      await field('notes').fill('Visible note must remain after hidden drafts are discarded');
      await page.evaluate(() => {
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-outbox')) throw new DOMException('Synthetic note failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await page.locator('[data-key="notes"] [data-act="saveinput"]').click();
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
      await day(YESTERDAY);
      await page.locator(`[data-act="openstool"][data-date="${YESTERDAY}"][data-b="6"]`).click();
      await page.locator('#st-t').fill('21:06');
      await page.evaluate(() => {
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-outbox')) throw new DOMException('Synthetic stool failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await page.locator('[data-act="savestool"]').click();
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
      await day(TODAY); await flush();
      const before = await drafts(), beforeWrites = await queued();
      assert.equal(before.stools.length, 1); assert.equal(before.fields.length, 2);
      assert.equal(await page.evaluate(() => window.appCanUpdate()), false);
      await page.setViewportSize({ width: 375, height: 667 });
      const discardBounds = await page.locator('[data-act="discardhiddendrafts"]').boundingBox();
      assert.ok(discardBounds && discardBounds.height >= 44, 'hidden-draft discard keeps a 44 px tap target on the smaller iPhone viewport');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'the new hidden-draft controls must not introduce horizontal scrolling');

      expectDialog(false);
      await page.locator('[data-act="discardhiddendrafts"]').click();
      await flush();
      assert.deepEqual((await drafts()).fields, before.fields);
      assert.deepEqual((await drafts()).stools, before.stools);
      assert.equal(await page.locator('#state').textContent(), 'Not saved');

      expectDialog(true);
      await page.locator('[data-act="discardhiddendrafts"]').click();
      await flush();
      assert.equal(await field('notes').inputValue(), 'Visible note must remain after hidden drafts are discarded');
      assert.equal(await page.locator('[data-key="notes"][data-dirty]').count(), 1);
      assert.equal((await drafts()).fields.length, 1);
      assert.equal((await drafts()).fields[0].key, 'notes');
      assert.equal((await drafts()).stools.length, 0);
      assert.equal(await page.locator('#state').textContent(), 'Not saved', 'discarding the failed hidden correction cannot clear the visible failed note');
      assert.equal(await page.evaluate(() => window.appCanUpdate()), false);
      assert.equal(await queued(), beforeWrites, 'discarding drafts changes no recorded data');
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await flush();
      assert.equal(await drafts(), null);
      assert.equal(await page.evaluate(() => window.appCanUpdate()), true);
      assert.equal(await page.locator('#state').textContent(), 'Saved locally; syncing', 'both failed drafts were deliberately cancelled');
      assert.equal(await queued(), beforeWrites);
    });

    const retiredKey = 'murphy-draft-v2:draft-test:retired-field-session';
    const retiredDraft = { version: 2, savedAt: Date.parse('2026-11-01T22:00:00Z'), tab: 'status', cursor: '2026-10-29', viewDate: null, expanded: [], stool: null, stools: [],
      fields: [
        { id: 'in-retired-field-2026-10-29', date: '2026-10-29', key: 'retiredField', value: 'An unavailable old field' },
        { id: 'in-weight-' + TODAY, date: TODAY, key: 'retiredWeightField', value: '99' },
        { id: 'in-notes-' + TODAY, date: TODAY, key: 'retiredNotesField', value: 'An obsolete note field' }
      ] };
    await scenario('unknown recovered fields can be discarded without deleting a current field or its failed-save status', async ({ page, field, flush, drafts, queued, expectDialog }) => {
      await page.locator('[data-act="resumedraft"][data-date="2026-10-29"]').click();
      assert.match(await page.locator('#feedback').textContent(), /This entry is not available on this screen\./);
      await page.locator(`[data-act="resumedraft"][data-date="${TODAY}"]`).click();
      assert.equal(await page.locator('#in-weight-' + TODAY).inputValue(), '18.7', 'an obsolete field key cannot overwrite a current field with the same DOM id');
      assert.equal(await field('notes').inputValue(), '');
      await flush();
      assert.deepEqual((await drafts()).fields.map(f => f.key).sort(), ['retiredField', 'retiredNotesField', 'retiredWeightField'], 'matching a current DOM id must not silently delete an obsolete draft key');
      const underlyingStatus = await page.locator('#state').textContent();
      await field('notes').fill('The current note remains unfinished');
      await page.evaluate(() => {
        window.navigationRealSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-outbox')) throw new DOMException('Synthetic current-note failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await page.locator('[data-key="notes"] [data-act="saveinput"]').click();
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
      assert.equal(await page.evaluate(() => window.appCanUpdate()), false);
      expectDialog(true);
      await page.locator('[data-act="discardhiddendrafts"]').click();
      await flush();
      assert.deepEqual((await drafts()).fields.map(f => f.key), ['notes']);
      assert.equal(await field('notes').inputValue(), 'The current note remains unfinished');
      assert.equal(await page.locator('#state').textContent(), 'Not saved', 'discarding an obsolete alias cannot acknowledge the current field’s failed save');
      assert.equal(await page.evaluate(() => window.appCanUpdate()), false);
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await flush();
      assert.equal(await drafts(), null);
      assert.equal(await page.locator('[data-act="resumedraft"],[data-act="discardhiddendrafts"]').count(), 0);
      assert.equal(await page.evaluate(() => window.appCanUpdate()), true);
      assert.equal(await page.locator('#state').textContent(), underlyingStatus);
      assert.equal(await queued(), 0);
    }, { session: { 'murphy-draft-session': 'retired-field-session' }, local: { [retiredKey]: JSON.stringify(retiredDraft) } });

    await scenario('failed persistence of hidden-draft removal warns that the old copy can return and keeps visible entries', async ({ page, field, day, flush, drafts, reload, queued, expectDialog }) => {
      await day(TODAY); await field('notes').fill('Keep the visible draft through a failed discard write'); await flush();
      const storedBefore = await page.evaluate(() => localStorage.getItem(testApp.draftKey()));
      assert.equal((await drafts()).fields.length, 4);
      await page.evaluate(() => {
        window.navigationRealSetItem = Storage.prototype.setItem;
        window.navigationRealRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-draft')) throw new DOMException('Synthetic discard persistence failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
        Storage.prototype.removeItem = function(key) {
          if (key.startsWith('murphy-draft')) throw new DOMException('Synthetic discard removal failure', 'QuotaExceededError');
          return window.navigationRealRemoveItem.call(this, key);
        };
      });
      expectDialog(true);
      await page.locator('[data-act="discardhiddendrafts"]').click();
      assert.equal(await field('notes').inputValue(), 'Keep the visible draft through a failed discard write');
      assert.equal(await page.locator('[data-act="resumedraft"],[data-act="discardhiddendrafts"]').count(), 0);
      assert.match(await page.locator('#feedback').textContent(), /Draft removal could not be stored/);
      assert.match(await page.locator('#feedback').textContent(), /previous copy may reappear/);
      assert.equal(await page.evaluate(() => localStorage.getItem(testApp.draftKey())), storedBefore, 'failed storage must not be described as durable removal');
      assert.deepEqual(await page.evaluate(() => testApp.captureDrafts().fields.map(f => f.key)), ['notes']);
      assert.equal(await queued(), 0);
      await page.evaluate(() => {
        Storage.prototype.setItem = window.navigationRealSetItem;
        Storage.prototype.removeItem = window.navigationRealRemoveItem;
      });
      await flush(); await reload();
      assert.equal(await field('notes').inputValue(), 'Keep the visible draft through a failed discard write');
      assert.deepEqual((await drafts()).fields.map(f => f.key), ['notes']);
      assert.equal(await queued(), 0);
    }, { session: { 'murphy-draft-session': 'retired-field-session' }, local: { [retiredKey]: JSON.stringify(retiredDraft) } });

    await scenario('disclosures reopen only for actual drafts rather than retaining empty navigation state', async ({ page, tab, flush, drafts, queued }) => {
      const disclosure = page.locator(`#meal-${YESTERDAY}`);
      assert.equal(await disclosure.evaluate(el => el.open), false);
      await disclosure.locator(':scope > summary').click();
      assert.equal(await disclosure.evaluate(el => el.open), true);
      await tab('status'); await tab('today');
      assert.equal(await disclosure.evaluate(el => el.open), false, 'merely reading last night’s meal must not leave a persistent expanded draft view');
      await disclosure.locator(':scope > summary').click();
      await page.locator(`#fed-time-${YESTERDAY}`).fill('19:15');
      await tab('status'); await tab('today');
      assert.equal(await disclosure.evaluate(el => el.open), true, 'the disclosure containing an unfinished entry is restored');
      assert.equal(await page.locator(`#fed-time-${YESTERDAY}`).inputValue(), '19:15');
      await page.locator(`[data-act="cancelfeedingtime"][data-date="${YESTERDAY}"]`).click();
      await tab('status'); await tab('today'); await flush();
      assert.equal(await disclosure.evaluate(el => el.open), false);
      assert.equal(await drafts(), null); assert.equal(await queued(), 0);
    });

    for (const finishOther of ['cancel', 'save']) {
      await scenario(`failed edits with a reused stool ID stay independent across dates until the other edit is ${finishOther === 'save' ? 'saved' : 'cancelled'}`, async ({ page, day, tab, queued, flush, drafts }) => {
        const first = '2026-10-29', second = '2026-10-30', stoolId = 'reused-import-id';
        await page.evaluate(({ first, second, stoolId }) => {
          testApp.S.days[first] = { date: first, stools: [{ id: stoolId, time: '07:10', bristol: 3, mucus: false, blood: false, importedDetail: 'first original' }] };
          testApp.S.days[second] = { date: second, stools: [{ id: stoolId, time: '08:20', bristol: 4, mucus: false, blood: false, importedDetail: 'second original' }] };
          window.navigationRealSetItem = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key.startsWith('murphy-outbox')) throw new DOMException('Synthetic outbox failure', 'QuotaExceededError');
            return window.navigationRealSetItem.call(this, key, value);
          };
          testApp.render(true);
        }, { first, second, stoolId });
        const originals = await page.evaluate(dates => dates.map(date => testApp.S.days[date]), [first, second]);
        const underlyingStatus = await page.locator('#state').textContent();
        const edit = date => page.locator(`[data-act="editstool"][data-date="${date}"][data-id="${stoolId}"]`).click();

        await day(first); await edit(first);
        await page.locator('#st-t').fill('07:45');
        await page.locator('[data-act="tog-mucus"]').click();
        await page.locator('[data-act="savestool"]').click();
        assert.equal(await page.locator('#state').textContent(), 'Not saved');
        await day(second); await edit(second);
        await page.locator('#st-t').fill('08:55');
        await page.locator('[data-act="tog-blood"]').click();
        await page.locator('[data-act="savestool"]').click();
        assert.equal(await page.locator('#state').textContent(), 'Not saved');

        await tab('status'); await day(first);
        assert.equal(await page.locator('#st-t').inputValue(), '07:45');
        assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
        await day(second);
        assert.equal(await page.locator('#st-t').inputValue(), '08:55');
        assert.equal(await page.locator('[data-act="tog-blood"]').getAttribute('aria-pressed'), 'true');
        await flush();
        assert.deepEqual((await drafts()).stools.map(s => [s.date, s.record.id]).sort(), [[first, stoolId], [second, stoolId]]);
        assert.equal(await queued(), 0, 'failed writes and navigation must not queue either edit');
        assert.deepEqual(await page.evaluate(dates => dates.map(date => testApp.S.days[date]), [first, second]), originals);

        await day(first);
        await page.locator('[data-act="cancelstool"]').click();
        assert.equal(await page.locator('#state').textContent(), 'Not saved', 'cancelling one date must retain the other date’s failure');
        await tab('status');
        assert.equal(await page.locator('#state').textContent(), 'Not saved');
        await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
        await day(second);
        assert.equal(await page.locator('#st-t').inputValue(), '08:55');
        assert.equal(await queued(), 0);
        await page.locator(`[data-act="${finishOther === 'save' ? 'savestool' : 'cancelstool'}"]`).click();
        assert.equal(await page.locator('#state').textContent(), finishOther === 'save' ? 'Saved locally; syncing' : underlyingStatus);
        assert.equal(await queued(), finishOther === 'save' ? 1 : 0);
        assert.deepEqual(await page.evaluate(date => testApp.S.days[date], first), originals[0]);
        const other = await page.evaluate(date => testApp.S.days[date].stools[0], second);
        assert.equal(other.time, finishOther === 'save' ? '08:55' : '08:20');
        assert.equal(other.blood, finishOther === 'save');
        assert.equal(other.importedDetail, 'second original');
        await flush(); assert.equal(await drafts(), null);
      });
    }

    await scenario('reload while on Status keeps off-screen dates and exposes a resume route', async ({ page, field, day, tab, reload, queued }) => {
      await day('2026-10-30'); await field('notes').fill('Friday still unfinished');
      await day('2026-10-29'); await field('notes').fill('Thursday still unfinished');
      await tab('status'); await reload();
      assert.equal(await page.evaluate(() => testApp.S.tab), 'status');
      assert.ok(await page.locator('[data-act="resumedraft"]').count() > 0, 'off-screen drafts must remain discoverable');
      await page.locator('[data-act="resumedraft"][data-date="2026-10-30"]').first().click();
      assert.equal(await field('notes').inputValue(), 'Friday still unfinished');
      await day('2026-10-29');
      assert.equal(await field('notes').inputValue(), 'Thursday still unfinished');
      assert.equal(await page.evaluate(() => /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)), false);
      assert.equal(await queued(), 0);
    });

    for (const existing of [false, true]) {
      await scenario(`History follows a ${existing ? 'moved existing' : 'new backdated'} stool without losing destination drafts`, async ({ page, field, day, tab, flush, drafts, queued }) => {
        const destination = '2026-10-30', source = '2026-10-29';
        await day(destination);
        await field('notes').fill('Destination note must stay unfinished');
        await page.locator(`[data-act="openstool"][data-date="${destination}"][data-b="4"]`).click();
        await page.locator('#st-t').fill('08:15');
        await page.locator('[data-act="tog-mucus"]').click();
        await flush();
        const destinationDraftId = (await drafts()).stools.find(s => s.date === destination).record.id;

        await day(source);
        await page.locator(`[data-act="openstool"][data-date="${source}"][data-b="3"]`).click();
        await page.locator('#st-t').fill('10:20');
        if (existing) {
          await page.locator('[data-act="savestool"]').click();
          const savedId = await page.evaluate(date => testApp.S.days[date].stools[0].id, source);
          await page.locator(`[data-act="editstool"][data-date="${source}"][data-id="${savedId}"]`).click();
        }
        await page.locator('#st-date').fill(destination);
        await page.locator('[data-act="savestool"]').click();
        await page.waitForFunction(date => testApp.S.tab === 'day' && testApp.S.cursor === date, destination);

        assert.equal(await field('notes').inputValue(), 'Destination note must stay unfinished');
        assert.equal(await page.locator('#st-t').inputValue(), '08:15', 'the destination stool draft is restored, not the just-saved stool');
        assert.equal(await page.locator('#st-date').inputValue(), destination);
        assert.equal(await page.locator('[data-act="stooltype"][data-b="4"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('[data-act="tog-mucus"]').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await page.evaluate(date => testApp.S.days[date].stools.map(s => [s.time, s.bristol]), destination), [['10:20', 3]]);
        assert.equal(await page.evaluate(date => testApp.S.days[date].notes, destination), undefined);
        assert.equal(await page.evaluate(date => (testApp.S.days[date]?.stools || []).length, source), 0);
        assert.equal(await queued(), existing ? 2 : 1);

        await flush();
        const persisted = await drafts();
        assert.equal(persisted.fields.find(f => f.date === destination && f.key === 'notes').value, 'Destination note must stay unfinished');
        assert.equal(persisted.stools.find(s => s.record.id === destinationDraftId).time, '08:15');
        await tab('status'); await day(destination); await flush();
        assert.equal(await field('notes').inputValue(), 'Destination note must stay unfinished');
        assert.equal(await page.locator('#st-t').inputValue(), '08:15');
        assert.equal((await drafts()).stools.find(s => s.record.id === destinationDraftId).record.mucus, true);
        assert.equal(await queued(), existing ? 2 : 1, 'restoring the destination never confirms its drafts');
      });
    }

    await scenario('an incomplete native number can never become a clearing write after navigation', async ({ page, field, tab, queued }) => {
      await field('weight').fill(''); await field('weight').press('e');
      assert.equal(await field('weight').evaluate(el => el.validity.badInput), true);
      await page.locator('#tabbar [data-tab="status"]').click();
      // A narrow guard for unrepresentable native number text is also safe.
      if (await page.evaluate(() => testApp.S.tab) !== 'today') await tab('today');
      await page.locator('[data-key="weight"] [data-act="saveinput"]').click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].weight), 18.7);
      assert.equal(await queued(), 0);
      assert.equal(await field('weight').getAttribute('aria-invalid'), 'true');
      await field('weight').fill('18.8');
      await page.locator('[data-key="weight"] [data-act="saveinput"]').click();
      assert.equal(await page.evaluate(() => testApp.S.days['2026-11-01'].weight), 18.8);
      assert.equal(await queued(), 1);
    });

    await scenario('draft-storage failure keeps in-memory entries through navigation and recovers when storage returns', async ({ page, field, tab, flush, reload, queued }) => {
      await field('notes').fill('Only in memory while storage fails');
      await page.evaluate(() => {
        window.navigationRealSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-draft')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await flush(); await tab('status'); await tab('day'); await tab('today');
      assert.equal(await field('notes').inputValue(), 'Only in memory while storage fails');
      assert.match(await page.locator('#feedback').textContent(), /storage|only.*(?:app|session|memory)/i);
      assert.equal(await queued(), 0);
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; testApp.persistDrafts(); });
      await reload();
      assert.equal(await field('notes').inputValue(), 'Only in memory while storage fails');
      assert.equal(await queued(), 0);
    });

    await scenario('a hidden memory-only draft blocks an app update until that draft is cancelled', async ({ page, field, tab, flush, queued }) => {
      assert.equal(await page.evaluate(() => window.appCanUpdate()), true);
      await page.evaluate(() => {
        window.navigationRealSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-draft')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await field('notes').fill('An update would lose this memory-only draft');
      await flush(); await tab('status');
      assert.equal(await page.locator('#main [data-dirty],#main [data-stool]').count(), 0, 'the unfinished input is off screen');
      assert.equal(await page.evaluate(() => localStorage.getItem(testApp.draftKey())), null, 'there is no durable recovery copy');
      assert.equal(await page.evaluate(() => window.appCanUpdate()), false, 'hidden draft state must also block reloading into an update');
      await tab('today');
      assert.equal(await field('notes').inputValue(), 'An update would lose this memory-only draft');
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await tab('status');
      assert.equal(await page.evaluate(() => window.appCanUpdate()), true, 'deliberate cancellation releases the update block');
      assert.equal(await queued(), 0);
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
    });

    const oldKey = 'murphy-draft:draft-test:legacy-navigation';
    await scenario('legacy v1 drafts migrate without writes or autofocus and remain usable across views', async ({ page, field, tab, flush, drafts, queued }) => {
      assert.equal(await field('notes').inputValue(), 'A legacy note');
      assert.equal(await page.evaluate(() => /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)), false);
      await tab('status'); await tab('today'); await flush();
      assert.equal(await field('notes').inputValue(), 'A legacy note');
      assert.equal((await drafts()).version, 2);
      assert.match(await page.evaluate(() => testApp.draftKey()), /^murphy-draft-v2:/);
      assert.equal(await queued(), 0);
    }, { session: { 'murphy-draft-session': 'legacy-navigation' }, local: { [oldKey]: JSON.stringify(legacyDraft('A legacy note')) } });

    const coldKey = 'murphy-draft:draft-test:old-cold-session';
    const coldRaw = JSON.stringify(legacyDraft('Recover this old-session note'));
    await scenario('failed recovery transfer leaves the original copy intact even if a current key already exists', async ({ page, field, flush, drafts, queued }) => {
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      await page.evaluate(() => {
        localStorage.setItem(testApp.draftKey(), JSON.stringify({ version: 2, stale: true }));
        window.navigationRealSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('murphy-draft-v2:')) throw new DOMException('Synthetic recovery failure', 'QuotaExceededError');
          return window.navigationRealSetItem.call(this, key, value);
        };
      });
      await page.locator('[data-act="recoverdraft"]').click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), coldKey), coldRaw);
      assert.equal(await field('notes').inputValue(), 'Recover this old-session note');
      assert.equal(await queued(), 0);
      await page.evaluate(() => { Storage.prototype.setItem = window.navigationRealSetItem; });
      await flush();
      assert.equal((await drafts()).fields.find(f => f.key === 'notes').value, 'Recover this old-session note');
    }, { session: { 'murphy-draft-session': 'new-cold-session' }, local: { [coldKey]: coldRaw } });

    await scenario('separate tabs and another account never overwrite or expose one another’s drafts', async ({ context, page, boot, field, flush, queued }) => {
      await field('notes').fill('First tab private draft'); await flush();
      const key = await page.evaluate(() => testApp.draftKey());
      const raw = await page.evaluate(key => localStorage.getItem(key), key);
      const second = await context.newPage(); await boot(second);
      assert.notEqual(await second.evaluate(() => testApp.draftKey()), key);
      await revealing(second, second.locator('[data-key="notes"] textarea')).fill('Second tab draft');
      await second.evaluate(() => testApp.persistDrafts());
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), raw);
      await second.evaluate(() => localStorage.setItem('test-user', 'different-navigation-account'));
      await second.reload(); await second.waitForFunction(() => window.testApp?.S.ready);
      assert.equal(await second.locator('[data-key="notes"] textarea').inputValue(), '');
      assert.equal(await second.locator('[data-act="recoverdraft"],[data-act="resumedraft"]').count(), 0);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), raw);
      assert.equal(await queued(), 0);
      await second.close();
    });

    const previousAccountKey = 'murphy-draft:draft-test:previous-account-session';
    await scenario('same-page account loading hides both old-account recovery and hidden-draft routes', async ({ page, field, day, tab, flush, queued }) => {
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      await day('2026-10-30');
      await field('notes').fill('Only the original account may resume this');
      await tab('status'); await flush();
      assert.equal(await page.locator('[data-act="resumedraft"][data-date="2026-10-30"]').count(), 1);
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      const ownKey = await page.evaluate(() => testApp.draftKey());
      const ownRaw = await page.evaluate(key => localStorage.getItem(key), ownKey);

      await page.evaluate(() => {
        testApp.S.user = { uid: 'new-loading-account' };
        testApp.S.ready = false;
        testApp.render();
      });
      assert.equal(await page.locator('[data-act="recoverdraft"],[data-act="resumedraft"]').count(), 0, 'loading the next account must hide all previous-account draft routes');
      assert.equal(await page.locator('#feedback [data-date]').count(), 0);
      assert.match(await page.locator('#main').textContent(), /Loading saved records/);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), ownKey), ownRaw);

      await page.evaluate(() => { testApp.S.ready = true; testApp.render(); });
      assert.equal(await page.locator('[data-act="recoverdraft"],[data-act="resumedraft"]').count(), 0);
      await day('2026-10-30');
      assert.equal(await field('notes').inputValue(), '');
      assert.equal(await page.locator('[data-dirty]').count(), 0);
      assert.equal(await queued(), 0);

      await page.evaluate(() => { testApp.S.user = { uid: 'draft-test' }; testApp.render(); });
      await page.locator('[data-act="resumedraft"][data-date="2026-10-30"]').click();
      assert.equal(await field('notes').inputValue(), 'Only the original account may resume this');
      assert.equal(await queued(), 0);
    }, { local: { [previousAccountKey]: JSON.stringify(legacyDraft('Another old-session private note', '2026-10-28')) } });

    assert.deepEqual(unexpectedDialogs, [], 'routine navigation must not ask to discard');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors, unexpectedDialogs }));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
