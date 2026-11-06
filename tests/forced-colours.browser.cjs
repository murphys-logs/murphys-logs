'use strict';

// Local-only browser regression: status marks drawn only as a fill (the Review
// attention dot, stool band dots, the stool chart's points and the adjustment
// gauge) stay visible when forced colours (Windows High Contrast) replace page
// colours, and keep their normal colours otherwise. Chromium forced-colours
// emulation only; not a Windows High Contrast theme or assistive-technology test.
// Reuses the Firebase-blocked fixture from draft-input.browser.cjs; no network
// access, sign-in or backend writes. Run: node tests/forced-colours.browser.cjs
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE are honoured as in the other suites.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  let passed = 0;
  const errors = [], external = [];
  const pass = name => { passed++; console.log('PASS ' + name); };
  try {
    for (const [forcedColors, colorScheme] of [['active', 'light'], ['active', 'dark'], ['none', 'light'], ['none', 'dark']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        forcedColors, colorScheme, serviceWorkers: 'block' });
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
      // Synthetic Bristol 6 (watch band) through the normal quick-log path; held in the local outbox only.
      await page.locator('#quick-stool-2026-11-01-6').click();
      await page.waitForFunction(() => document.querySelector('#main .stool .dot'));
      // The Review attention mark, as render() shows it when something needs a look.
      await page.evaluate(() => document.querySelector('#tabbar .dotmark').classList.remove('hide'));
      const marks = async selectors => page.evaluate(selectors => Object.fromEntries(selectors.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return [sel, null];
        const c = getComputedStyle(el), r = el.getBoundingClientRect();
        // The colour behind the mark: the nearest ancestor with a non-transparent background.
        // Forced colours report transparency as Canvas with zero alpha, so test the alpha.
        const alpha = v => Number(v.match(/^rgba\([^)]*,\s*([\d.]+)\)$/)?.[1] ?? 1);
        const clear = v => alpha(v) === 0, rgb = v => v.replace(/^rgba?\(([^,]+),([^,]+),([^,)]+).*$/, 'rgb($1,$2,$3)').replace(/\s/g, '');
        let behind = 'rgba(0, 0, 0, 0)';
        for (let p = el.parentElement; p && clear(behind); p = p.parentElement) behind = getComputedStyle(p).backgroundColor;
        return [sel, { bg: rgb(c.backgroundColor), behind: rgb(behind), raw: c.backgroundColor,
          alpha: alpha(c.backgroundColor), opacity: Number(c.opacity), visibility: c.visibility,
          border: c.borderTopStyle === 'none' ? 0 : parseFloat(c.borderTopWidth), size: [r.width, r.height] }];
      })), selectors);
      const visibleMark = (sel, mark) => {
        assert.ok(mark, `${sel} is rendered (${forcedColors}, ${colorScheme})`);
        assert.ok(mark.size[0] > 0 && mark.size[1] > 0, `${sel} has a size`);
        // System Highlight may include alpha (for example 0.8 in Chromium).
        // Reject an invisible fill without overriding the platform's token.
        assert.ok(mark.alpha > 0, `${sel} has a nontransparent fill`);
        assert.equal(mark.opacity, 1, `${sel} is not faded out`);
        assert.equal(mark.visibility, 'visible', `${sel} is visible`);
        assert.notEqual(mark.bg, mark.behind, `${sel} is distinguishable from its background (${forcedColors}, ${colorScheme}): ${mark.bg} on ${mark.behind}`);
      };
      const today = await marks(['#tabbar .dotmark', '#main .stool .dot']);
      await page.evaluate(() => { testApp.S.changes = []; testApp.open('review'); });
      await page.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; });
      const review = await marks(['#main .gauge .fill', '#main .gauge .mid']);
      assert.ok(review['#main .gauge .fill'], 'zero-adjustment gauge is rendered');
      assert.equal(review['#main .gauge .fill'].size[0], 0, 'zero adjustment draws no fill');
      assert.ok(review['#main .gauge .fill'].size[1] > 0, 'zero gauge is expanded, not hidden');
      await page.evaluate(() => { testApp.S.range = 14; testApp.open('history'); });
      const history = await marks(['#main .diary-val .dot']);
      // Data charts live on Review; the stool chart draws one point per stool.
      await page.evaluate(() => testApp.open('review'));
      const chart = await marks(['#main .chart-point.stool-point']);
      const all = { ...today, ...review, ...history, ...chart };
      for (const [sel, mark] of Object.entries(all)) {
        if (sel !== '#main .gauge .fill') visibleMark(sel, mark); // Zero state was asserted above.
      }
      if (forcedColors === 'none') {
        // Normal themes keep the design tokens: the attention dot uses --ink, stool dots their band tone.
        const tokens = await page.evaluate(() => { const c = getComputedStyle(document.documentElement);
          const rgb = v => { const d = document.createElement('i'); d.style.color = v; document.body.append(d); const out = getComputedStyle(d).color; d.remove(); return out; };
          return { ink: rgb(c.getPropertyValue('--ink')), watch: rgb(c.getPropertyValue('--watch')) }; });
        assert.equal(all['#tabbar .dotmark'].raw, tokens.ink, 'attention dot keeps --ink');
        assert.equal(all['#main .stool .dot'].raw, tokens.watch, 'Bristol 6 dot keeps the watch tone');
        assert.equal(all['#main .diary-val .dot'].raw, tokens.watch, 'diary dot keeps the watch tone');
      }
      pass(`status marks are visible with forced colours ${forcedColors} in ${colorScheme} appearance`);
      // Render real signed changes through offsetNow()/viewReview(), rather than
      // injecting a width that could mask a missing or incorrectly directed fill.
      for (const deltaG of [20, -20]) {
        await page.evaluate(deltaG => {
          testApp.S.changes = [{ id: 'forced-colours-adjustment', date: '2026-11-01', deltaG, source: 'manual' }];
          testApp.render(true);
          document.getElementById('review-ration-details').open = true;
        }, deltaG);
        const fill = (await marks(['#main .gauge .fill']))['#main .gauge .fill'];
        visibleMark('#main .gauge .fill', fill);
        const expected = await page.evaluate(() => {
          const reference = document.createElement('i');
          reference.style.cssText = 'forced-color-adjust:none;background:Highlight;color:var(--accent)';
          document.body.append(reference);
          const colors = getComputedStyle(reference);
          const gauge = document.querySelector('#main .gauge').getBoundingClientRect();
          const fill = document.querySelector('#main .gauge .fill').getBoundingClientRect();
          const result = { highlight: colors.backgroundColor, accent: colors.color,
            midpoint: gauge.left + gauge.width / 2, left: fill.left, right: fill.right };
          reference.remove();
          return result;
        });
        assert.equal(fill.raw, forcedColors === 'active' ? expected.highlight : expected.accent,
          'nonzero gauge uses system Highlight in forced colours and --accent otherwise');
        assert.ok(Math.abs((deltaG > 0 ? expected.left : expected.right) - expected.midpoint) <= 1,
          `${deltaG > 0 ? 'positive' : 'negative'} adjustment starts at the gauge midpoint`);
        pass(`${deltaG > 0 ? 'positive' : 'negative'} gauge fill is visible with forced colours ${forcedColors} in ${colorScheme} appearance`);
      }
      await context.close();
    }
    assert.deepEqual(errors, [], 'no page errors');
    assert.deepEqual(external, [], 'no external requests');
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
