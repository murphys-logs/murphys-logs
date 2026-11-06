'use strict';

// Synthetic history benchmark. Reuses the existing Firebase-blocked fixture;
// never signs in, contacts a backend or reads production records. No assertions
// about iPhone hardware speed: these are observations from the selected browser.
// Run: node docs/reviews/2026-11-06/history-benchmark.cjs
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE work as in tests/*.browser.cjs.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('../../../tests/draft-input.browser.cjs');

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const errors = [], external = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, serviceWorkers: 'block' });
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
    console.log(JSON.stringify({ browser: await browser.version(), node: process.version,
      viewport: '390x844 touch/mobile emulation',
      limits: 'Synthetic SDK, no service worker or network timing; unthrottled local hardware. First render includes derivation where not already cached; warm median is five forced renders.' }));

    for (const count of [31, 365, 1826]) {
      await page.evaluate(count => {
        const days = {}, end = Date.parse('2026-11-01T12:00:00Z');
        for (let i = 0; i < count; i++) {
          const date = new Date(end - i * 86400000).toISOString().slice(0, 10);
          days[date] = { date, weight: 18.7 + Math.sin(i) / 10, bcs: 5,
            walkMin: 60, walkKm: 4.2, activeMin: 80, treats: 1,
            notes: 'Synthetic daily notes. No real records.', events: [],
            stools: [0, 1, 2].map(j => ({ id: `synthetic-${i}-${j}`,
              time: ['07:15', '12:30', '19:00'][j], bristol: 4, mucus: false, blood: false })),
            meal: { recipe: ['lamb', 'fish', 'beef'][i % 3], fedAt: '18:00',
              darfFed: 140, darfPlanned: 140, bowl: 'cleared', egg: i % 7 === 0,
              broth: false, fibreGiven: true, oilGiven: true } };
        }
        const startDate = Object.keys(days).sort()[0];
        testApp.S.days = days;
        testApp.S.settings = { ...testApp.S.settings, startDate,
          fibreSchedule: [{ from: startDate, g: 5 }] };
        testApp.S.changes = [];
        window.benchmarkFixtureBytes = new TextEncoder().encode(JSON.stringify(days)).length;
      }, count);

      for (const [tab, range] of [['today', 14], ['history', 14], ['review', 14], ['history', 9999], ['review', 9999]]) {
        const metrics = await page.evaluate(async ({ tab, range }) => {
          testApp.S.tab = tab; testApp.S.range = range;
          const measures = [];
          for (let i = 0; i < 6; i++) {
            const start = performance.now();
            testApp.render(true);
            const scriptMs = performance.now() - start;
            // Force style/layout so timing does not end at DOM insertion. This
            // includes the small measurement traversal, but does not time paint.
            const nodes = document.querySelectorAll('*').length;
            const height = document.body.offsetHeight;
            measures.push({ scriptMs, throughLayoutMs: performance.now() - start, nodes, height });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }
          const median = key => measures.slice(1).map(m => m[key]).sort((a, b) => a - b)[2];
          return { first: measures[0], warmMedian: { scriptMs: median('scriptMs'),
            throughLayoutMs: median('throughLayoutMs') }, nodes: measures.at(-1).nodes,
            cards: document.querySelectorAll('.diary-card').length,
            fixtureBytes: window.benchmarkFixtureBytes,
            overflow: document.documentElement.scrollWidth - innerWidth };
        }, { tab, range });
        assert.ok(metrics.overflow <= 0, `${count} days / ${tab} / ${range}: no document overflow`);
        console.log(JSON.stringify({ count, tab, range, ...metrics }));
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ errors, external }));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
