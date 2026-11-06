'use strict';

// Local-only Review accessibility regressions. Firebase modules are replaced by
// the shared synthetic fixture; backend operations and external URLs are blocked.
// Run with the same PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE options as other suites.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');
const actions = ['applyadv', 'refuseadv', 'applyfibre', 'dismissfibre'];
const resultId = action => action.endsWith('adv') ? 'review-ration-result' : 'review-fibre-result';
const resultName = action => action.endsWith('adv') ? 'This week’s ration result' : 'Pro-Fibre result';

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const errors = [], external = [];
  let passed = 0;
  const pass = name => { passed++; console.log('PASS ' + name); };
  async function open() {
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
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => window.testApp?.S.ready);
    await page.evaluate(() => {
      const days = {};
      for (let day = 19; day <= 31; day++) {
        const date = `2026-10-${day}`;
        days[date] = { date, weight: 18.7, bcs: 5.5,
          stools: [{ id: 'review-' + day, time: '08:00', bristol: day >= 30 ? 6 : 4, mucus: false, blood: false }] };
      }
      testApp.S.days = days;
      testApp.S.settings = { ...testApp.S.settings, startDate: '2026-10-01',
        fibreSchedule: [{ from: '2026-10-01', g: 2.5 }, { from: '2026-10-28', g: 5 }] };
      testApp.S.changes = [];
      testApp.open('review');
    });
    return { context, page };
  }
  try {
    for (const activation of ['keyboard', 'pointer']) for (const action of actions) {
      const { context, page } = await open();
      await page.locator('#review-ration-details > summary').click();
      await page.locator('#review-fibre-details > summary').click();
      const button = page.locator(`[data-act="${action}"]`);
      if (activation === 'keyboard') { await button.focus(); await button.press('Enter'); }
      else await button.click();
      await page.waitForFunction(() => document.querySelector('#feedback').textContent.trim().length > 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), resultId(action), action + ' keeps focus at the updated result');
      assert.equal(await button.count(), 0, 'the completed action disappears');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), action === 'dismissfibre' ? 0 : 1, 'existing save count is unchanged');
      assert.match(await page.locator('#review-data-context').textContent(), /Missing records or changes waiting to sync can change these results/, 'data limits remain visible with pending changes');
      for (const id of ['review-ration-details', 'review-fibre-details'])
        assert.equal(await page.locator('#' + id).getAttribute('open'), '', id + ' remains expanded');
      const result = page.locator('#' + resultId(action));
      assert.equal(await result.getAttribute('tabindex'), '-1');
      assert.equal(await page.getByRole('group', { name: resultName(action), exact: true }).getAttribute('id'), resultId(action), 'the focus destination has an accessible role and name');
      assert.ok((await result.textContent()).trim().length, 'the focus destination contains the current result');
      if (action === 'dismissfibre') assert.match(await result.textContent(), /Advice postponed/);
      if (action.endsWith('adv')) assert.match(await result.textContent(), /No ration change/);
      pass(activation + ': ' + action + ' focuses its updated result and preserves disclosures');
      await context.close();
    }
    for (const action of actions) {
      const { context, page } = await open();
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('murphy-outbox') || key.includes('fibre-snooze')) throw Error('Synthetic storage unavailable');
          return set.call(this, key, value);
        };
      });
      const button = page.locator(`[data-act="${action}"]`);
      const originalButton = await button.elementHandle();
      await button.focus(); await button.press('Enter');
      await page.waitForFunction(() => document.querySelector('#feedback').textContent.trim().length > 0);
      // Failure changes feedback only, so the ordinary render skips identical
      // #main markup. Exercise the surviving-button path across a real replacement.
      await page.evaluate(() => testApp.render(true));
      assert.equal(await originalButton.evaluate(element => element.isConnected), false, 'the original action was replaced, not merely left focused');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.act), action, 'failed action stays focused and available');
      assert.equal(await button.count(), 1);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      pass('storage failure: ' + action + ' remains focused for retry after main replacement');
      await context.close();
    }
    {
      const { context, page } = await open();
      await page.locator('#review-ration-details > summary').focus();
      await page.evaluate(() => { testApp.S.settings = { ...testApp.S.settings, maxCumulativeG: 45 }; testApp.render(); });
      assert.equal(await page.evaluate(() => document.activeElement.parentElement.id), 'review-ration-details', 'unrelated disclosure focus is preserved');
      assert.match(await page.locator('#review-data-context').textContent(), /Based on records available on this device\. Missing records or changes waiting to sync can change these results\./);
      assert.match(await page.locator('#state').textContent(), /Cached/);
      pass('cached Review explains data limits and leaves unrelated disclosure focus intact');
      await context.close();
    }
    {
      const { context, page } = await open();
      await page.evaluate(() => {
        testApp.S.undo = { label: 'Deleted stool', createdAt: Date.now(), fn: () => {} };
        testApp.renderFeedback();
      });
      const dismissBtn = page.locator('#dismiss-undo');
      assert.equal(await dismissBtn.count(), 1, 'dismiss-undo is rendered in feedback');
      await dismissBtn.focus();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dismiss-undo');
      await page.evaluate(() => {
        testApp.renderFeedback();
      });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dismiss-undo', 'focus on dismiss-undo survives feedback re-render');
      pass('feedback focus: #dismiss-undo retains focus across renderFeedback');
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(`${passed}/${passed} scenarios passed; no page errors or external app requests.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
