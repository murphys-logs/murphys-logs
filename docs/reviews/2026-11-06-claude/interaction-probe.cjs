'use strict';
// Review probe (synthetic, local-only, Chromium emulation): interaction latency with synthetic history (no network, no Firebase).
// Run: node docs/reviews/2026-11-06-claude/interaction-probe.cjs (APP_HTML selects another index.html)
const path = require('node:path');
const { chromium, html, stub, origin } = require(path.join(__dirname, '..', '..', '..', 'tests', 'draft-input.browser.cjs'));

function fixture(count) {
  const days = {}, end = Date.parse('2026-10-31T12:00:00Z');
  for (let i = 0; i < count; i++) {
    const date = new Date(end - i * 86400000).toISOString().slice(0, 10);
    days[date] = { weight: 18.7 + Math.sin(i) / 10, bcs: 5, walkMin: 60, walkKm: 4.2, activeMin: 80, treats: 1,
      notes: 'Synthetic daily notes. No real records.', events: [],
      stools: [0, 1, 2].map(j => ({ id: `synthetic-${i}-${j}`, time: ['07:15', '12:30', '19:00'][j], bristol: 4, mucus: false, blood: false })),
      meal: { recipe: ['lamb', 'fish', 'beef'][i % 3], fedAt: '18:00', darfFed: 140, darfPlanned: 140, bowl: 'cleared', egg: false, broth: false, fibreGiven: true, oilGiven: true } };
  }
  return days;
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const out = [];
  console.log(JSON.stringify({ browser: browser.version(), node: process.version, timing: 'click/input dispatch to the next animation frame plus a task; frame-bound (about 16.7 ms) at best' }));
  for (const count of [31, 365, 1826]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html');
    await page.evaluate(days => { localStorage.setItem('test-day-overrides', JSON.stringify(days)); }, fixture(count));
    const t0 = Date.now();
    await page.reload(); await page.waitForFunction(() => window.testApp?.S.ready && document.querySelector('#main h2.screen'));
    const loadMs = Date.now() - t0;
    // Time from dispatch to the next animation frame after the handler (input-to-next-paint proxy).
    const timeClick = sel => page.evaluate(async sel => {
      const el = document.querySelector(sel); if (!el) return null;
      const s = performance.now(); el.click();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      return +(performance.now() - s).toFixed(1);
    }, sel);
    const timeType = sel => page.evaluate(async sel => {
      const el = document.querySelector(sel); el.closest('details') && (el.closest('details').open = true); el.focus();
      const samples = [];
      for (const ch of 'walk ok') {
        const s = performance.now(); el.value += ch; el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        samples.push(performance.now() - s);
      }
      samples.sort((a, b) => a - b); return +samples[Math.floor(samples.length / 2)].toFixed(1);
    }, sel);
    const r = { count, loadMs };
    // Quick-log saves in one tap: this is the whole save path (local outbox write and render).
    r.quickLogSave = await timeClick('#quick-stool-2026-11-01-4');
    r.typeNoteMedian = await timeType('#in-notes-2026-11-01');
    await page.evaluate(() => { for (const f of document.querySelectorAll('#main [data-dirty]')) f.removeAttribute('data-dirty'); testApp.persistDrafts(); });
    r.tabHistory = await timeClick('#tab-history');
    r.tabReview = await timeClick('#tab-review');
    r.tabSettings = await timeClick('#tab-settings');
    r.tabToday = await timeClick('#tab-today');
    r.errors = errors.length;
    out.push(r); console.log(JSON.stringify(r));
    await context.close();
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
