'use strict';
// Review probe (synthetic, local-only): conditional states under iPhone descriptors in Chromium emulation
// (not WebKit/Safari). Run: node docs/reviews/2026-11-06-claude/states-probe.cjs
const path = require('node:path');
const { chromium, html, stub, origin } = require(path.join(__dirname, '..', '..', '..', 'tests', 'draft-input.browser.cjs'));
const { devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const configs = [
  ['iPhone 16', devices['iPhone 16']], ['iPhone 17 Pro Max', devices['iPhone 17 Pro Max']],
  ['iPhone 16 landscape', devices['iPhone 16 landscape']],
  ['320', { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['desktop', { viewport: { width: 1440, height: 900 } }],
];

const audit = () => {
  const vw = document.documentElement.clientWidth, small = [], offscreen = [];
  const overflowX = document.scrollingElement.scrollWidth - vw;
  for (const el of document.querySelectorAll('button,input,select,textarea,summary,a[href],[role="button"],[tabindex="0"]')) {
    if (el.closest('.hide,[hidden]') || el.disabled) continue;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0 && !el.classList.contains('date-overlay')) continue;
    const name = (el.id || el.dataset.act || el.tagName) + ':' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30);
    if (r.width < 43.5 || r.height < 43.5) small.push(`${name} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
    if (r.right > vw + 1 || r.left < -1) offscreen.push(name);
  }
  return { overflowX, small, offscreen };
};

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  for (const [label, cfg] of configs) for (const scheme of ['light', 'dark']) for (const root of [16, 32]) {
    if (label === 'desktop' && root === 32 && scheme === 'dark') continue;
    const context = await browser.newContext({ ...cfg, colorScheme: scheme, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.goto(origin + '/index.html'); await page.waitForFunction(() => window.testApp?.S.ready);
    await page.addStyleTag({ content: `html{font-size:${root}px !important}` });
    const results = {};
    // State 1: stacked notices + open stool form on Today.
    await page.evaluate(() => {
      const { S } = testApp;
      S.banner = { kind: 'warn', source: 'sync', retry: true, title: 'Sync pending', text: 'Your confirmed entries are saved on this device and will sync automatically once connected.' };
      window.AppShell.state.updateReady = true; window.AppShell.state.message = 'The update is ready.';
      testApp.render(true);
      document.querySelector('[data-act="openstool"]').click();
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => document.querySelector('[data-act="editstool"]').click());
    await page.waitForTimeout(50);
    results.todayStoolForm = await page.evaluate(audit);
    results.feedbackHeight = await page.evaluate(() => Math.round(document.getElementById('feedback').getBoundingClientRect().height) + '/' + innerHeight);
    // Field error state: invalid walk minutes.
    await page.evaluate(() => { document.querySelector('[data-act="cancelstool"]').click(); });
    await page.evaluate(() => { for (const d of document.querySelectorAll('#main details')) d.open = true; });
    const walk = page.locator('#in-walkMin-2026-11-01');
    await walk.fill('9999'); await walk.press('Enter');
    results.fieldError = await page.evaluate(() => ({ ...(() => { const e = document.querySelector('#main [data-field-error]:not(.hide)'); return { error: e?.textContent, invalid: document.activeElement?.getAttribute('aria-invalid'), focus: document.activeElement?.id }; })() }));
    results.todayErrors = await page.evaluate(audit);
    // Bottom: scroll to end; last control must be above the tab bar.
    const bottom = async () => page.evaluate(async () => {
      scrollTo(0, document.scrollingElement.scrollHeight); await new Promise(r => setTimeout(r, 30));
      const bar = document.getElementById('tabbar').getBoundingClientRect();
      const els = [...document.querySelectorAll('#main button,#main input,#main summary,#main textarea')].filter(e => e.getBoundingClientRect().height);
      const last = els.at(-1).getBoundingClientRect();
      return { lastBottom: Math.round(last.bottom), barTop: Math.round(bar.top), clear: last.bottom <= bar.top };
    });
    results.todayBottom = await bottom();
    // History day editor + Settings fully expanded.
    await page.evaluate(() => { for (const f of document.querySelectorAll('#main [data-dirty]')) f.removeAttribute('data-dirty'); testApp.S.banner = null; testApp.open('day', { date: '2026-10-31' }); });
    results.dayEditor = await page.evaluate(audit); results.dayBottom = await bottom();
    await page.evaluate(() => { testApp.open('settings'); for (const d of document.querySelectorAll('#main details')) d.open = true; });
    results.settings = await page.evaluate(audit); results.settingsBottom = await bottom();
    // Sign-in gate.
    await page.evaluate(() => { document.getElementById('app').classList.add('hide'); const g = document.getElementById('gate'); g.classList.remove('hide'); for (const id of ['gate-form', 'gate-help', 'gate-err', 'boot-retry']) document.getElementById(id).classList.remove('hide'); document.getElementById('gate-err').textContent = 'Incorrect email or password.'; });
    results.gate = await page.evaluate(audit);
    const flat = Object.entries(results).filter(([, v]) => v && (v.overflowX > 0 || v.small?.length || v.offscreen?.length || v.clear === false));
    console.log(JSON.stringify({ label, scheme, root, feedback: results.feedbackHeight, fieldError: results.fieldError, problems: Object.fromEntries(flat), errors }));
    await context.close();
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
