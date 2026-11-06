'use strict';

// Local-only browser regression for typing with the software keyboard open while
// notices are showing (for example "Sync pending" on a walk with no signal).
// iOS keeps the layout viewport full height behind the keyboard and only shrinks the
// visual viewport, so the keyboard is modelled by limiting window.visualViewport.
// This is Chromium touch emulation of that geometry, not a Safari, physical-keyboard
// or installed Home Screen test.
// Reuses the Firebase-blocked fixture from draft-input.browser.cjs; no network
// access, sign-in or backend writes. Run: node tests/keyboard-reveal.browser.cjs
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE are honoured as in the other suites.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');

const TODAY = '2026-11-01', YESTERDAY = '2026-10-31';
// Layout viewport heights of the iPhone 16 and iPhone 17 Pro Max Safari descriptors,
// and a 320 px-wide phone; visible heights approximate the area above the keyboard.
const PHONES = [[393, 659, 330], [440, 763, 400], [320, 568, 270]];

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let passed = 0;
  const errors = [], external = [], stacks = [], fitted = [];
  const pass = name => { passed++; console.log('PASS ' + name); };
  const open = async (options) => {
    const context = await browser.newContext({ serviceWorkers: 'block', ...options });
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
  };
  // Two ordinary notices: an offline sync banner and a recent removal's Undo.
  const showNotices = page => page.evaluate(() => {
    const { S } = testApp;
    S.banner = { kind: 'warn', source: 'sync', retry: true, title: 'Sync pending',
      text: 'Your confirmed entries are saved on this device and will sync automatically once connected.' };
    S.undo = { kind: 'stool', label: 'Stool at 07:15 removed', createdAt: Date.now(), state: 'removed',
      date: '2026-11-01', record: { id: 'synthetic-undo' } };
    testApp.renderFeedback();
  });
  // The keyboard: the visual viewport shrinks, the layout viewport does not.
  const openKeyboard = (page, visible) => page.evaluate(visible => {
    const real = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
      offsetTop: 0, height: visible, get width() { return real.width; }, addEventListener() {}, removeEventListener() {} } });
  }, visible);
  const geometry = (page, selector) => page.evaluate(selector => {
    const el = document.querySelector(selector), field = el.getBoundingClientRect();
    const save = el.closest('[data-form]').querySelector('[data-confirm]')?.getBoundingClientRect();
    const feedback = document.getElementById('feedback'), region = feedback.getBoundingClientRect();
    // Whatever is pinned over the top of the page: the top bar, and the notices while sticky.
    const pinned = getComputedStyle(feedback).position === 'sticky';
    const cover = Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom, pinned ? region.bottom : 0);
    return { fieldTop: field.top, fieldBottom: field.bottom, cover, pinned, saveBottom: save?.bottom ?? null,
      focus: document.activeElement?.id, noticesHeight: region.height,
      notices: [...feedback.querySelectorAll('.note > b')].map(b => b.textContent),
      scrollY: window.scrollY, maxScrollY: document.scrollingElement.scrollHeight - innerHeight };
  }, selector);

  try {
    for (const [width, height, visible] of PHONES) {
      const { context, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true });
      await showNotices(page);
      const pinnedStack = await page.evaluate(() => document.getElementById('feedback').getBoundingClientRect().bottom);
      await openKeyboard(page, visible);

      for (const [tab, selector, label, text] of [
        ['today', `#in-walkMin-${TODAY}`, 'Today: Minutes walked', '45'],
        ['day', `#in-walkKm-${YESTERDAY}`, 'History: Kilometres', '3.5'],
        ['day', `#in-activeMin-${YESTERDAY}`, 'History: Active minutes', '80'],
      ]) {
        if (tab === 'day') await page.evaluate(date => { testApp.open('day', { date }); }, YESTERDAY);
        await showNotices(page);
        // Focus scrolls the field into view, as the system does when the keyboard opens.
        await page.evaluate(selector => {
          const el = document.querySelector(selector);
          for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
          el.focus();
        }, selector);
        await page.locator(selector).pressSequentially(text);
        const after = await geometry(page, selector);
        // At the end of the page iOS pans the visual viewport instead; that is not modelled here.
        assert.ok(after.scrollY < after.maxScrollY - 1, `fixture check: ${label} has page left to scroll at ${width}px`);
        assert.equal(after.focus, selector.slice(1), `${label} keeps focus while typing at ${width}px`);
        assert.deepEqual(after.notices, ['Sync pending', 'Stool at 07:15 removed'], 'both notices remain in the page');
        // The field being typed in is visible: below what is pinned at the top, above the keyboard.
        assert.ok(after.fieldTop >= after.cover - 0.5,
          `${label} is not under the header or notices at ${width}px (field top ${after.fieldTop.toFixed(0)}, cover ends ${after.cover.toFixed(0)})`);
        assert.ok(after.fieldBottom <= visible + 0.5, `${label} stays above the ${visible}px keyboard viewport at ${width}px`);
        assert.ok(after.saveBottom !== null, `${label} shows its Save row`);
        // Save is revealed above the keyboard whenever field, help text and Save fit together;
        // otherwise the typed field keeps priority and Return saves numeric fields.
        if (after.saveBottom - after.fieldTop + 12 <= visible - after.cover)
          assert.ok(after.saveBottom <= visible + 0.5, `${label} Save clears the keyboard at ${width}px`);
        else fitted.push(`${label} at ${width}px: field kept visible; Save one scroll below`);
        assert.equal(after.pinned, false, `${label}: notices scroll with the page while a field is being typed in`);
        // Ending the edit pins the notices again without moving the page content.
        const before = await page.evaluate(selector => document.querySelector(selector).getBoundingClientRect().top, selector);
        await page.evaluate(() => document.activeElement.blur());
        const settled = await page.evaluate(selector => ({ top: document.querySelector(selector).getBoundingClientRect().top,
          position: getComputedStyle(document.getElementById('feedback')).position }), selector);
        assert.equal(settled.position, 'sticky', 'notices are pinned again once editing ends');
        assert.ok(Math.abs(settled.top - before) < 0.5, `${label}: no content shift when notices are pinned again (${before} → ${settled.top})`);
        await page.locator(selector).focus();
        await page.locator(selector).press('Escape');
        assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'typing alone queues no write');
        pass(`${label}: typed field stays visible (Save revealed where it fits) with two notices and a ${visible}px keyboard viewport at ${width}x${height}`);
        if (tab === 'day') await page.evaluate(() => testApp.open('today'));
      }
      // Recorded for the report: before this fix the pinned stack alone could exceed the visible area.
      stacks.push({ viewport: `${width}x${height}`, keyboardViewport: visible, pinnedHeaderAndNotices: Math.round(pinnedStack) });

      // Choosing a date or time opens a picker, not the keyboard: the notices stay pinned.
      await page.evaluate(() => document.querySelector('[data-act="openstool"]').click());
      await page.evaluate(() => document.querySelector('[data-act="editstool"]').click());
      await page.locator('#st-t').focus();
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('feedback')).position), 'sticky',
        'a native time picker leaves the notices pinned');
      await page.evaluate(() => document.querySelector('[data-act="cancelstool"]').click());
      pass(`time picker focus keeps notices pinned at ${width}x${height}`);
      await context.close();
    }

    // Desktop (no touch): focusing a field leaves the notices pinned, exactly as before.
    {
      const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
      await showNotices(page);
      await page.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; });
      await page.locator(`#in-notes-${TODAY}`).focus();
      await page.locator(`#in-notes-${TODAY}`).pressSequentially('desktop');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('feedback')).position), 'sticky',
        'desktop keeps the notices pinned while typing');
      await page.locator(`#in-notes-${TODAY}`).press('Escape');
      pass('desktop 1440x900: notices stay pinned while typing');
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page errors');
    assert.deepEqual(external, [], 'no external requests');
    console.log(JSON.stringify({ passed, stacks, notEnoughRoomForSave: fitted, externalRequests: external, pageErrors: errors,
      limitations: 'Chromium touch emulation with a simulated visual viewport; not Safari, a physical keyboard, VoiceOver or an installed Home Screen app.' }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
