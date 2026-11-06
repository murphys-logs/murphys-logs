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
    // Focus moves to the confirmation button before its click fires. Repinning
    // notices at that point can cover the same screen coordinates and swallow
    // the click. Use physical coordinates (no locator auto-scrolling/retry), and
    // exercise Tab separately so the focused action must stay above the keyboard.
    for (const [width, height, visible] of PHONES) {
      for (const activation of ['touch', 'mouse', 'keyboard', 'safari-touch']) for (const action of ['save', 'cancel']) {
        const { context, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true });
        // Safari (iOS and macOS) does not focus a button when it is tapped or clicked: the
        // field simply loses focus. Model that here, so the notices cannot rely on the
        // button holding focus to stay out of the way while the tap completes.
        if (activation === 'safari-touch') await page.evaluate(() => document.addEventListener('mousedown', event => {
          if (!event.target.closest?.('button')) return;
          event.preventDefault(); document.activeElement?.blur?.();
        }, true));
        await page.evaluate(date => testApp.open('day', { date }), YESTERDAY);
        await showNotices(page);
        await openKeyboard(page, visible);
        const selector = `#in-walkMin-${YESTERDAY}`, buttonId = `${action}-in-walkMin-${YESTERDAY}`;
        const before = await page.evaluate(date => ({ value: testApp.S.days[date]?.walkMin,
          writes: testApp.queuedWrites().length }), YESTERDAY);
        await page.locator(selector).focus();
        await page.locator(selector).pressSequentially('45');
        if (activation === 'keyboard') {
          await page.keyboard.press('Tab');
          if (action === 'cancel') await page.keyboard.press('Tab');
          assert.equal(await page.evaluate(() => document.activeElement.id), buttonId, 'Tab reaches the intended confirmation button');
        }
        const target = await page.evaluate(id => {
          const button = document.getElementById(id), box = button.getBoundingClientRect();
          const x = box.left + box.width / 2, y = box.top + box.height / 2;
          const feedback = document.getElementById('feedback'), pinned = getComputedStyle(feedback).position === 'sticky';
          const cover = Math.max(document.querySelector('.topbar').getBoundingClientRect().bottom,
            pinned ? feedback.getBoundingClientRect().bottom : 0);
          return { x, y, top: box.top, bottom: box.bottom, cover, pinned,
            hit: button.contains(document.elementFromPoint(x, y)) };
        }, buttonId);
        assert.equal(target.pinned, false, `${activation} ${action}: notices stay out of the way until confirmation completes`);
        assert.ok(target.top >= target.cover - 0.5 && target.bottom <= visible + 0.5,
          `${activation} ${action}: button remains visible above the ${visible}px keyboard viewport at ${width}px`);
        assert.ok(target.hit, `${activation} ${action}: the visible button is not covered`);
        if (activation === 'touch' || activation === 'safari-touch') await page.touchscreen.tap(target.x, target.y);
        else if (activation === 'mouse') await page.mouse.click(target.x, target.y);
        else await page.keyboard.press('Enter');
        await page.waitForFunction(selector => !document.querySelector(selector).closest('[data-form]').querySelector('[data-confirm]'),
          selector, { timeout: 2000 });
        const after = await page.evaluate(date => ({ value: testApp.S.days[date]?.walkMin,
          writes: testApp.queuedWrites().length }), YESTERDAY);
        assert.equal(after.value, action === 'save' ? 45 : before.value, `${activation} ${action}: one activation completes the intended action`);
        assert.equal(after.writes, before.writes + (action === 'save' ? 1 : 0),
          `${activation} ${action}: Save queues exactly one change; Cancel queues none`);
        const fieldTop = await page.locator(selector).evaluate(el => el.getBoundingClientRect().top);
        await page.evaluate(() => document.activeElement.blur());
        const settled = await page.locator(selector).evaluate(el => ({ top: el.getBoundingClientRect().top,
          position: getComputedStyle(document.getElementById('feedback')).position }));
        assert.equal(settled.position, 'sticky', 'notices pin again after focus leaves the completed entry');
        assert.ok(Math.abs(settled.top - fieldTop) < 0.5, 'repinning after confirmation does not shift the field');
        pass(`${activation} ${action}: one activation completes with two notices at ${width}x${height}/${visible}px keyboard viewport`);
        await context.close();
      }
    }

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
        // Leaving the field with the entry still unsaved keeps the notices out of the way
        // (Save/Cancel is still showing); cancelling pins them again. Neither moves the page.
        const state = selector => page.evaluate(selector => ({ top: document.querySelector(selector).getBoundingClientRect().top,
          position: getComputedStyle(document.getElementById('feedback')).position }), selector);
        const before = (await state(selector)).top;
        await page.evaluate(() => document.activeElement.blur());
        const unsaved = await state(selector);
        assert.equal(unsaved.position, 'static', `${label}: notices stay out of the way while the entry is unsaved`);
        assert.ok(Math.abs(unsaved.top - before) < 0.5, `${label}: no content shift on leaving the field (${before} → ${unsaved.top})`);
        await page.locator(selector).focus();
        await page.locator(selector).press('Escape');
        // Cancelling already updates "Still to log" above the field (its "typed, not saved"
        // chip goes), so measure only the step that pins the notices again.
        const cancelled = await state(selector);
        await page.evaluate(() => document.activeElement?.blur?.());
        const settled = await state(selector);
        assert.equal(settled.position, 'sticky', 'notices are pinned again once the entry is cancelled');
        assert.ok(Math.abs(settled.top - cancelled.top) < 0.5, `${label}: no content shift when notices are pinned again (${cancelled.top} → ${settled.top})`);
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

      // An unsaved entry inside a collapsed Today section is out of sight, with no
      // Save/Cancel to reach: the notices are pinned. Reopening it unpins them again.
      const notes = `#in-notes-${TODAY}`, position = () => page.evaluate(() => getComputedStyle(document.getElementById('feedback')).position);
      const queuedBefore = await page.evaluate(() => testApp.queuedWrites().length);
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = true; }, notes);
      await page.locator(notes).focus();
      await page.locator(notes).pressSequentially('Unsaved note');
      await page.evaluate(() => document.activeElement.blur());
      assert.equal(await position(), 'static', 'a visible unsaved entry keeps notices out of the way');
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = false; }, notes);
      assert.equal(await position(), 'sticky', 'an unsaved entry in a collapsed section leaves notices pinned');
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = true; }, notes);
      assert.equal(await position(), 'static', 'reopening the section unpins them again');
      // Escape cancels single-line fields only; Notes is cancelled with its button.
      await page.evaluate(id => document.getElementById(id).click(), `cancel-in-notes-${TODAY}`);
      await page.evaluate(() => document.activeElement?.blur?.());
      assert.equal(await position(), 'sticky', 'cancelling pins them again');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), queuedBefore, 'cancelling queues no write');
      pass(`collapsed unsaved entry leaves notices pinned at ${width}x${height}`);
      await context.close();
    }

    // A failed local save while notices are out of the way (CC-K2, accepted trade-off):
    // the "Could not save locally" alert sits with the other notices at the top of the
    // page, outside the keyboard viewport, but the failure is never silent. The pinned
    // status reads "Not saved", the alert keeps role="alert", the entry and its value stay
    // open with Save still focused and visible, and nothing is queued.
    {
      const [width, height, visible] = PHONES[0];
      const { context, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true });
      await page.evaluate(date => testApp.open('day', { date }), YESTERDAY);
      await showNotices(page);
      await openKeyboard(page, visible);
      const selector = `#in-walkMin-${YESTERDAY}`, saveId = `save-in-walkMin-${YESTERDAY}`;
      await page.locator(selector).focus();
      await page.locator(selector).pressSequentially('45');
      const queuedBefore = await page.evaluate(() => testApp.queuedWrites().length);
      // Local storage refuses new outbox entries, as when the device is out of space.
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('murphy-outbox')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      });
      const target = await page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, saveId);
      await page.touchscreen.tap(target.x, target.y);
      await page.waitForFunction(() => document.getElementById('state').textContent === 'Not saved');
      const failed = await page.evaluate(({ selector, saveId, visible }) => {
        const feedback = document.getElementById('feedback'), state = document.getElementById('state').getBoundingClientRect();
        const alert = [...feedback.querySelectorAll('.note')].find(n => /Could not save locally/.test(n.textContent));
        const form = document.querySelector(selector).closest('[data-form]'), save = document.getElementById(saveId)?.getBoundingClientRect();
        return { stateVisible: state.top >= 0 && state.bottom <= visible, alertRole: alert?.getAttribute('role'),
          position: getComputedStyle(feedback).position, dirty: form.hasAttribute('data-dirty'),
          value: document.querySelector(selector).value, focus: document.activeElement?.id,
          saveVisible: !!save && save.top >= document.querySelector('.topbar').getBoundingClientRect().bottom && save.bottom <= visible };
      }, { selector, saveId, visible });
      assert.ok(failed.stateVisible, 'the pinned status line shows "Not saved" inside the keyboard viewport');
      assert.equal(failed.alertRole, 'alert', 'the failure notice is still present and announced');
      assert.equal(failed.position, 'static', 'notices stay out of the way while the entry is still unsaved');
      assert.equal(failed.dirty, true, 'the entry stays open');
      assert.equal(failed.value, '45', 'the typed value is kept');
      assert.equal(failed.focus, saveId, 'Save keeps focus for a retry');
      assert.ok(failed.saveVisible, 'Save stays visible above the keyboard for a retry');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), queuedBefore, 'nothing is queued by the failed save');
      pass(`failed local save keeps "Not saved" pinned, the entry open and Save reachable at ${width}x${height}/${visible}px keyboard viewport`);
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
