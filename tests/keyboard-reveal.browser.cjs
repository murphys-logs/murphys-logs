'use strict';

// Local-only browser regression for typing with the software keyboard open while
// notices are showing (for example "Sync pending" on a walk with no signal).
// The keyboard is modelled by limiting window.visualViewport with offsetTop=0:
// this covers document scrolling, not native visual-viewport panning at page end.
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
  // Sticky with a negative offset scrolls out of the way. Test the effective
  // pin position rather than requiring a particular CSS positioning mechanism.
  const pinned = () => {
    const css = getComputedStyle(document.getElementById('feedback'));
    return css.position === 'sticky' && parseFloat(css.top) >= 0;
  };
  const waitForPinned = page => page.waitForFunction(() => {
    const css = getComputedStyle(document.getElementById('feedback'));
    return css.position === 'sticky' && Math.abs(parseFloat(css.top) - parseFloat(css.getPropertyValue('--headerh'))) < 0.5;
  }, null, { timeout: 2000 });
  const geometry = (page, selector) => page.evaluate(selector => {
    const el = document.querySelector(selector), field = el.getBoundingClientRect();
    const save = el.closest('[data-form]').querySelector('[data-confirm]')?.getBoundingClientRect();
    const feedback = document.getElementById('feedback'), region = feedback.getBoundingClientRect();
    const css = getComputedStyle(feedback);
    const pinned = css.position === 'sticky' && parseFloat(css.top) >= 0;
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
          const feedback = document.getElementById('feedback'), css = getComputedStyle(feedback);
          const pinned = css.position === 'sticky' && parseFloat(css.top) >= 0;
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
        await waitForPinned(page);
        const settled = await page.locator(selector).evaluate(el => ({ top: el.getBoundingClientRect().top,
          position: getComputedStyle(document.getElementById('feedback')).position }));
        assert.equal(settled.position, 'sticky', 'notices pin again after focus leaves the completed entry');
        assert.ok(Math.abs(settled.top - fieldTop) < 0.5, 'repinning after confirmation does not shift the field');
        pass(`${activation} ${action}: one activation completes with two notices at ${width}x${height}/${visible}px keyboard viewport`);
        await context.close();
      }
    }

    // A clean field has no dirty marker to hold notices out of the way. Align the
    // intended action with the returning Dismiss button, then use raw coordinates:
    // both the first and a quick repeated activation must reach the intended action.
    // Held mouse and touch contacts check that repinning waits for release.
    for (const [width, height, visible] of PHONES) for (const reducedMotion of ['no-preference', 'reduce']) {
      for (const activation of ['touch', 'safari-touch', 'mouse-hold', 'touch-boundary']) {
        const { context, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion });
        if (activation === 'safari-touch') await page.evaluate(() => document.addEventListener('mousedown', event => {
          if (!event.target.closest?.('button')) return;
          event.preventDefault(); document.activeElement?.blur?.();
        }, true));
        await page.evaluate(date => testApp.open('day', { date }), YESTERDAY);
        await showNotices(page);
        await openKeyboard(page, visible);
        await page.locator(`#in-activeMin-${YESTERDAY}`).focus();
        const target = await page.evaluate(date => {
          const id = `bcs-${date}-4`, button = document.getElementById(id), box = button.getBoundingClientRect();
          const feedback = document.getElementById('feedback').getBoundingClientRect();
          const dismiss = document.getElementById('dismiss-notice').getBoundingClientRect();
          const header = document.querySelector('.topbar').getBoundingClientRect();
          const y = dismiss.top + dismiss.height / 2 - feedback.top + header.bottom;
          scrollBy(0, box.top + box.height / 2 - y);
          const moved = button.getBoundingClientRect();
          const x = (Math.max(moved.left, dismiss.left) + Math.min(moved.right, dismiss.right)) / 2;
          return { id, x, y, hit: button.contains(document.elementFromPoint(x, y)),
            dirty: document.querySelectorAll('#main [data-dirty]').length,
            focus: document.activeElement.id, headerBottom: header.bottom,
            overlap: Math.min(moved.right, dismiss.right) - Math.max(moved.left, dismiss.left) };
        }, YESTERDAY);
        assert.equal(target.focus, `in-activeMin-${YESTERDAY}`, 'fixture focuses an untyped field');
        assert.equal(target.dirty, 0, 'fixture has no dirty form');
        assert.ok(target.hit && target.overlap > 0, 'fixture action is hittable and overlaps the returning Dismiss button');
        assert.ok(target.y > target.headerBottom && target.y < visible, 'fixture action is inside the modeled keyboard viewport');
        const before = await page.evaluate(() => ({ banner: testApp.S.banner, undo: testApp.S.undo, writes: testApp.queuedWrites().length }));
        const unchangedNotices = async () => {
          assert.deepEqual(await page.evaluate(() => testApp.S.banner), before.banner, 'the notice is not dismissed or retried');
          assert.deepEqual(await page.evaluate(() => testApp.S.undo), before.undo, 'Undo is not activated');
        };
        if (activation === 'mouse-hold') {
          await page.mouse.move(target.x, target.y);
          await page.mouse.down();
          await page.waitForTimeout(850);
          assert.equal(await page.evaluate(pinned), false, 'a held press keeps notices away beyond the release delay');
          assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before.writes, 'holding alone does not activate');
          await page.mouse.up();
        } else await page.touchscreen.tap(target.x, target.y);
        assert.equal(await page.evaluate(date => testApp.S.days[date].bcs, YESTERDAY), 4, 'the first activation reaches BCS 4');
        assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before.writes + 1, 'the first activation queues exactly one change');
        await unchangedNotices();
        let touchSession;
        if (activation === 'touch-boundary') {
          // Start a second contact just before the previous grace period ends;
          // holding across that deadline must not put a notice under the finger.
          touchSession = await context.newCDPSession(page);
          await page.waitForFunction(() => document.getElementById('feedback').getAnimations().some(animation =>
            animation.transitionProperty === 'top' && animation.currentTime > 450 && animation.currentTime < 550));
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y }] });
          await page.waitForTimeout(200);
          assert.equal(await page.evaluate(pinned), false, 'notices remain away while touch contact crosses the prior repin deadline');
        } else await page.waitForTimeout(100);
        assert.ok(await page.evaluate(({ id, x, y }) => document.getElementById(id).contains(document.elementFromPoint(x, y)), target),
          'the same coordinates still reach the intended control during a quick repeat');
        if (touchSession) await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else if (activation === 'mouse-hold') await page.mouse.click(target.x, target.y);
        else await page.touchscreen.tap(target.x, target.y);
        assert.equal(await page.evaluate(date => testApp.S.days[date].bcs ?? null, YESTERDAY), null, 'a repeated activation toggles BCS rather than Dismiss');
        const writes = await page.evaluate(() => testApp.queuedWrites());
        assert.equal(writes.length, before.writes + 2, 'two deliberate activations queue exactly two changes');
        assert.deepEqual(writes.slice(before.writes).map(([, op]) => ({ col: op.col, id: op.id, bcs: op.patch.bcs ?? null, remove: op.remove || [] })),
          [{ col: 'days', id: YESTERDAY, bcs: 4, remove: [] }, { col: 'days', id: YESTERDAY, bcs: null, remove: [['bcs']] }]);
        await unchangedNotices();
        const top = await page.locator(`#${target.id}`).evaluate(el => el.getBoundingClientRect().top);
        await waitForPinned(page);
        const settled = await page.locator(`#${target.id}`).evaluate(el => el.getBoundingClientRect().top);
        assert.ok(Math.abs(settled - top) < 0.5, 'delayed repinning does not shift the intended control');
        const duration = await page.evaluate(() => getComputedStyle(document.getElementById('feedback')).transitionDuration);
        assert.equal(duration, '0s', 'the safety delay never animates the notices');
        assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-notice-press')), false, 'release clears the presentation marker');
        if (touchSession) {
          // A cancelled contact must not leave notices permanently unpinned.
          const cancelTarget = await page.evaluate(id => {
            const button = document.getElementById(id), box = button.getBoundingClientRect();
            scrollBy(0, box.top + box.height / 2 - (innerHeight - 100));
            const moved = button.getBoundingClientRect();
            return { x: moved.left + moved.width / 2, y: moved.top + moved.height / 2,
              hit: button.contains(document.elementFromPoint(moved.left + moved.width / 2, moved.top + moved.height / 2)) };
          }, target.id);
          assert.ok(cancelTarget.hit, 'cancel fixture starts on a visible main control');
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancelTarget.x, y: cancelTarget.y }] });
          assert.equal(await page.evaluate(pinned), false, 'a new contact holds notices away');
          await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
          await waitForPinned(page);
          assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-notice-press')), false, 'cancellation clears the presentation marker');
          assert.equal(await page.evaluate(() => testApp.queuedWrites().length), before.writes + 2, 'cancelled contact creates no extra write');
          await unchangedNotices();
        }
        pass(`clean ${activation}: first and repeated action, then stable repin at ${width}x${height}, reduced motion ${reducedMotion}`);
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
          pinned: (() => { const css = getComputedStyle(document.getElementById('feedback')); return css.position === 'sticky' && parseFloat(css.top) >= 0; })() }), selector);
        const before = (await state(selector)).top;
        await page.evaluate(() => document.activeElement.blur());
        const unsaved = await state(selector);
        assert.equal(unsaved.pinned, false, `${label}: notices stay out of the way while the entry is unsaved`);
        assert.ok(Math.abs(unsaved.top - before) < 0.5, `${label}: no content shift on leaving the field (${before} → ${unsaved.top})`);
        await page.locator(selector).focus();
        await page.locator(selector).press('Escape');
        // Cancelling already updates "Still to log" and the section's "Unsaved changes"
        // marker above the field, so measure only the step that pins the notices again.
        const cancelled = await state(selector);
        await page.evaluate(() => document.activeElement?.blur?.());
        await waitForPinned(page);
        const settled = await state(selector);
        assert.equal(settled.pinned, true, 'notices are pinned again once the entry is cancelled');
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
      await waitForPinned(page);
      assert.equal(await page.evaluate(pinned), true,
        'a native time picker leaves the notices pinned');
      await page.evaluate(() => document.querySelector('[data-act="cancelstool"]').click());
      pass(`time picker focus keeps notices pinned at ${width}x${height}`);

      // An unsaved entry inside a collapsed Today section is out of sight, with no
      // Save/Cancel to reach: the notices are pinned. Reopening it unpins them again.
      const notes = `#in-notes-${TODAY}`;
      const queuedBefore = await page.evaluate(() => testApp.queuedWrites().length);
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = true; }, notes);
      await page.locator(notes).focus();
      await page.locator(notes).pressSequentially('Unsaved note');
      await page.evaluate(() => document.activeElement.blur());
      assert.equal(await page.evaluate(pinned), false, 'a visible unsaved entry keeps notices out of the way');
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = false; }, notes);
      await waitForPinned(page);
      assert.equal(await page.evaluate(pinned), true, 'an unsaved entry in a collapsed section leaves notices pinned');
      await page.evaluate(selector => { document.querySelector(selector).closest('details').open = true; }, notes);
      assert.equal(await page.evaluate(pinned), false, 'reopening the section unpins them again');
      // Escape cancels single-line fields only; Notes is cancelled with its button.
      await page.evaluate(id => document.getElementById(id).click(), `cancel-in-notes-${TODAY}`);
      await page.evaluate(() => document.activeElement?.blur?.());
      await waitForPinned(page);
      assert.equal(await page.evaluate(pinned), true, 'cancelling pins them again');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), queuedBefore, 'cancelling queues no write');
      pass(`collapsed unsaved entry leaves notices pinned at ${width}x${height}`);
      await context.close();
    }

    // A failed local save while notices are out of the way (CC-K2, accepted trade-off):
    // the "Could not save locally" alert sits with the other notices at the top of the
    // page, outside the keyboard viewport. The pinned status reads "Not saved", the
    // alert keeps role="alert" (actual announcement needs VoiceOver testing), and the
    // entry stays open. Save may lose focus while disabled or never take it on Safari;
    // verify the enabled, visible button actually retries after storage recovers.
    for (const activation of ['touch', 'keyboard', 'safari-touch']) {
      const [width, height, visible] = PHONES[0];
      const { context, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true });
      if (activation === 'safari-touch') await page.evaluate(() => document.addEventListener('mousedown', event => {
        if (!event.target.closest?.('button')) return;
        event.preventDefault(); document.activeElement?.blur?.();
      }, true));
      await page.evaluate(date => testApp.open('day', { date }), YESTERDAY);
      await showNotices(page);
      await openKeyboard(page, visible);
      const selector = `#in-walkMin-${YESTERDAY}`, saveId = `save-in-walkMin-${YESTERDAY}`;
      await page.locator(selector).focus();
      await page.locator(selector).pressSequentially('45');
      const before = await page.evaluate(date => ({ day: testApp.S.days[date], writes: testApp.queuedWrites() }), YESTERDAY);
      // Local storage refuses new outbox entries, as when the device is out of space.
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        window.restoreTestStorage = () => { Storage.prototype.setItem = set; };
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('murphy-outbox')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          return set.call(this, key, value);
        };
      });
      const target = await page.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, saveId);
      if (activation === 'keyboard') {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), saveId, 'Tab reaches Save before confirmation');
        await page.keyboard.press('Enter');
      } else await page.touchscreen.tap(target.x, target.y);
      await page.waitForFunction(() => document.getElementById('state').textContent === 'Not saved');
      await page.waitForFunction(id => document.getElementById(id)?.disabled === false, saveId);
      const failed = await page.evaluate(({ selector, saveId, visible }) => {
        const feedback = document.getElementById('feedback'), state = document.getElementById('state').getBoundingClientRect();
        const alert = [...feedback.querySelectorAll('.note')].find(n => /Could not save locally/.test(n.textContent));
        const form = document.querySelector(selector).closest('[data-form]'), button = document.getElementById(saveId);
        const save = button?.getBoundingClientRect(), x = save ? save.left + save.width / 2 : 0, y = save ? save.top + save.height / 2 : 0;
        return { stateVisible: state.top >= 0 && state.bottom <= visible, alertRole: alert?.getAttribute('role'),
          pinned: getComputedStyle(feedback).position === 'sticky' && parseFloat(getComputedStyle(feedback).top) >= 0, dirty: form.hasAttribute('data-dirty'),
          value: document.querySelector(selector).value, saveEnabled: !!button && !button.disabled,
          saveHit: !!button && button.contains(document.elementFromPoint(x, y)), x, y,
          saveVisible: !!save && save.top >= document.querySelector('.topbar').getBoundingClientRect().bottom && save.bottom <= visible };
      }, { selector, saveId, visible });
      assert.ok(failed.stateVisible, 'the pinned status line shows "Not saved" inside the keyboard viewport');
      assert.equal(failed.alertRole, 'alert', 'the failure notice retains alert semantics');
      assert.equal(failed.pinned, false, 'notices stay out of the way while the entry is still unsaved');
      assert.equal(failed.dirty, true, 'the entry stays open');
      assert.equal(failed.value, '45', 'the typed value is kept');
      assert.ok(failed.saveEnabled, 'Save is enabled for a retry');
      assert.ok(failed.saveVisible, 'Save stays visible above the keyboard for a retry');
      assert.ok(failed.saveHit, 'the retry button is not covered');
      assert.deepEqual(await page.evaluate(date => testApp.S.days[date], YESTERDAY), before.day, 'the failed save leaves the saved record unchanged');
      assert.deepEqual(await page.evaluate(() => testApp.queuedWrites()), before.writes, 'the failed save leaves the queue unchanged');
      await page.evaluate(() => window.restoreTestStorage());
      // No locator scrolling or retry: one tap at the visible button must complete.
      await page.touchscreen.tap(failed.x, failed.y);
      await page.waitForFunction(selector => !document.querySelector(selector).closest('[data-form]').hasAttribute('data-dirty'), selector);
      assert.equal(await page.evaluate(date => testApp.S.days[date].walkMin, YESTERDAY), 45, 'one retry saves the retained value');
      const writes = await page.evaluate(() => testApp.queuedWrites());
      assert.equal(writes.length, before.writes.length + 1, 'one retry queues exactly one change');
      const added = writes.filter(([key]) => !before.writes.some(([oldKey]) => oldKey === key));
      assert.equal(added.length, 1, 'the retry adds one distinct operation');
      assert.equal(added[0][1].col, 'days');
      assert.equal(added[0][1].id, YESTERDAY);
      assert.equal(added[0][1].patch.walkMin, 45);
      assert.equal(await page.locator(selector).evaluate(el => el.closest('[data-form]').querySelector('[data-confirm]')), null, 'successful retry closes confirmation');
      pass(`${activation} failed local save keeps "Not saved" pinned and retries exactly once at ${width}x${height}/${visible}px keyboard viewport`);
      await context.close();
    }

    // Desktop (no touch): focusing a field leaves the notices pinned, exactly as before.
    {
      const { context, page } = await open({ viewport: { width: 1440, height: 900 } });
      await showNotices(page);
      await page.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; });
      await page.locator(`#in-notes-${TODAY}`).focus();
      await page.locator(`#in-notes-${TODAY}`).pressSequentially('desktop');
      assert.equal(await page.evaluate(pinned), true,
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
