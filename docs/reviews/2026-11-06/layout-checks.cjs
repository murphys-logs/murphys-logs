'use strict';

// Reproducible, local-only layout audit using the repository's synthetic fixture.
// Run: node docs/reviews/2026-11-06/layout-checks.cjs
// PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE select an existing runtime/browser.
// Optional LAYOUT_SCREENSHOTS is an output directory outside the repository.
// These are CSS viewport and root-font checks, not physical iPhone, Safari,
// Dynamic Type, browser zoom, safe-area or native-keyboard acceptance tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, html, stub, origin } = require('../../../tests/draft-input.browser.cjs');
const sizes = [
  [320, 568, true], [375, 667, true], [390, 844, true], [393, 852, true],
  [440, 956, true], [852, 393, true], [956, 440, true], [1440, 900, false],
];
const adviceActions = ['applyadv', 'refuseadv', 'applyfibre', 'dismissfibre'];
const cases = ['today', 'history', 'review', 'settings'].map(tab => ({ tab, advice: false }))
  .concat({ tab: 'review', advice: true });

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const errors = [], external = [];
  const output = process.env.LAYOUT_SCREENSHOTS && path.resolve(process.env.LAYOUT_SCREENSHOTS);
  if (output) fs.mkdirSync(output, { recursive: true });
  let checks = 0, standardChecks = 0, adviceChecks = 0;
  try {
    for (const [width, height, mobile] of sizes) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
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
        window.layoutBaseline = JSON.stringify({ days: testApp.S.days, settings: testApp.S.settings, changes: testApp.S.changes });
      });
      for (const appearance of ['light', 'dark', 'forced']) {
        await page.emulateMedia({ colorScheme: appearance === 'light' ? 'light' : 'dark', forcedColors: appearance === 'forced' ? 'active' : 'none' });
        for (const fontSize of [16, 32]) for (const { tab, advice } of cases) {
          const label = `${width}x${height}, ${appearance}, ${fontSize}px root font, ${tab}${advice ? ' with advice' : ''}`;
          await page.evaluate(({ tab, fontSize, advice }) => {
            // Retain all original fixture cases and independently add the
            // conditional Review actions. No advice fixture leaks into the next case.
            Object.assign(testApp.S, JSON.parse(window.layoutBaseline));
            if (advice) {
              const days = {};
              for (let day = 19; day <= 31; day++) {
                const date = `2026-10-${day}`;
                days[date] = { date, weight: 18.7, bcs: 5.5,
                  stools: [{ id: 'layout-advice-' + day, time: '08:00', bristol: day >= 30 ? 6 : 4, mucus: false, blood: false }] };
              }
              testApp.S.days = days;
              testApp.S.settings = { ...testApp.S.settings, startDate: '2026-10-01',
                fibreSchedule: [{ from: '2026-10-01', g: 2.5 }, { from: '2026-10-28', g: 5 }] };
              testApp.S.changes = [];
            }
            document.documentElement.style.fontSize = fontSize + 'px';
            testApp.open(tab);
            document.querySelectorAll('details').forEach(element => { element.open = true; });
          }, { tab, fontSize, advice });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const result = await page.evaluate(() => {
            const controls = [...document.querySelectorAll('main button,main input,main select,main textarea,main summary')]
              .filter(element => element.getClientRects().length && !element.disabled);
            const name = element => element.getAttribute('aria-label') ||
              (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim() ||
              [...(element.labels || [])].map(label => label.textContent).join(' ').trim() ||
              (element.matches('button,summary') ? element.textContent.trim() : '');
            return {
              overflow: document.documentElement.scrollWidth - innerWidth,
              small: controls.filter(element => { const r = element.getBoundingClientRect(); return r.width < 43.9 || r.height < 43.9; })
                .map(element => element.id || element.textContent.slice(0, 40)),
              unnamed: controls.filter(element => !name(element)).map(element => element.id || element.tagName),
              tabs: [...document.querySelectorAll('#tabbar button')].map(element => {
                const r = element.getBoundingClientRect();
                return { name: element.textContent.trim(), x: r.x, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
              }),
              selection: document.querySelector('#tabbar [aria-current="page"]')?.dataset.tab,
              adviceActions: controls.filter(element => ['applyadv', 'refuseadv', 'applyfibre', 'dismissfibre'].includes(element.dataset.act)).map(element => element.dataset.act),
            };
          });
          assert.equal(result.overflow, 0, label + ': no page-level horizontal scroll');
          assert.deepEqual(result.small, [], label + ': enabled controls meet 44px target size');
          assert.deepEqual(result.unnamed, [], label + ': controls have labels');
          assert.deepEqual(result.tabs.map(item => item.name.replace(/,\s*needs attention$/, '')),
            ['Today', 'History', 'Review', 'Settings'], label + ': primary navigation labels');
          assert.ok(result.tabs.every(item => item.width >= 44 && item.height >= 44 && item.x >= 0 && item.right <= width && item.top >= 0 && item.bottom <= height), label + ': navigation fits');
          assert.equal(result.selection, tab, label + ': active navigation is identified');
          if (tab === 'review') assert.deepEqual(result.adviceActions, advice ? adviceActions : [], label + ': expected conditional actions are present');
          if (advice) {
            for (const name of ['This week’s ration result', 'Pro-Fibre result'])
              assert.equal(await page.getByRole('group', { name, exact: true }).count(), 1, label + ': result has an accessible role and name');
            adviceChecks++;
          } else standardChecks++;
          checks++;
          if (output && fontSize === 16 && !advice && (
            (width === 390 && tab === 'review' && appearance !== 'dark') ||
            (width === 320 && tab === 'today' && appearance === 'dark') ||
            (width === 1440 && tab === 'settings' && appearance === 'light'))) {
            await page.evaluate(() => scrollTo(0, 0));
            const file = path.join(output, `${width}-${appearance}-${tab}${mobile ? '' : '-desktop'}.png`);
            await page.screenshot({ path: file });
            console.log('SCREENSHOT ' + file);
          }
        }
      }
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(JSON.stringify({ browser: browser.version(), checks, standardChecks, adviceChecks, sizes, rootFontSizes: [16, 32], appearances: ['light', 'dark', 'forced'], errors, external }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
