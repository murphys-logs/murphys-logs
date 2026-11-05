'use strict';

// Phase D browser validation for History (stacked iPhone diary + single-day editor)
// and Review (actionable advice + expandable explanations, trends, charts and comparisons).
// Reuses the shared Firebase-blocked fixture from draft-input.browser.cjs; zero network access.
const assert = require('node:assert/strict');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');

const TODAY = '2026-11-01';
const YESTERDAY = '2026-10-31';

function buildFixtureDays() {
  const days = {
    // Historical cross-year record to verify year-inclusive dates in alerts and All range.
    '2025-12-30': {
      date: '2025-12-30',
      stools: [{ id: 'hist-2025', time: '08:15', bristol: 7, mucus: true, blood: false }],
      weight: 18.55,
      bcs: 5,
      meal: { recipe: 'beef', fedAt: '18:00', darfFed: 145, darfPlanned: 145, bowl: 'cleared', egg: false, broth: false, oilGiven: true, fibreGiven: true },
    },
    // Imported future-date mistake record: hidden in 14/28/56, inspectable in All without mutation.
    '2026-12-15': {
      date: '2026-12-15',
      notes: 'Imported future-date entry kept inspectable',
      stools: [{ id: 'imp-future', time: '09:00', bristol: 4, mucus: false, blood: false }],
    },
  };

  // Previous completed week (Mon 12 Oct – Sun 18 Oct 2026): ~18.60 kg
  for (let d = 12; d <= 18; d++) {
    const iso = `2026-10-${String(d).padStart(2, '0')}`;
    days[iso] = {
      date: iso,
      weight: 18.6,
      bcs: 5.5,
      walkMin: 60,
      walkKm: 4.2,
      activeMin: 80,
      treats: 1,
      stools: [{ id: `w1-${d}`, time: '07:45', bristol: 4, mucus: false, blood: false }],
      meal: { recipe: d % 2 ? 'lamb' : 'beef', fedAt: '18:15', darfFed: 142, darfPlanned: 142, bowl: 'cleared', egg: d === 14, broth: false, oilGiven: true, fibreGiven: true },
    };
  }

  // Latest completed week (Mon 19 Oct – Sun 25 Oct 2026): ~19.10 kg (+2.69% -> triggers ration reduction advice since BCS is 5.5 > hold 5)
  for (let d = 19; d <= 25; d++) {
    const iso = `2026-10-${String(d).padStart(2, '0')}`;
    days[iso] = {
      date: iso,
      weight: 19.1,
      bcs: 5.5,
      walkMin: 55,
      walkKm: 3.9,
      activeMin: 75,
      treats: 2,
      stools: [{ id: `w2-${d}`, time: '08:00', bristol: 4, mucus: false, blood: false }],
      meal: { recipe: d % 2 ? 'fish' : 'turkey', fedAt: '18:20', darfFed: 155, darfPlanned: 155, bowl: 'cleared', egg: false, broth: d === 22, oilGiven: true, fibreGiven: true },
    };
  }

  // Imported historical meal with unknown/omitted supplement flags on 28 Oct -> attributed to 29 Oct
  days['2026-10-28'] = {
    date: '2026-10-28',
    weight: 19.05,
    bcs: 5.5,
    stools: [{ id: 'imp-oct28', time: '07:30', bristol: 4, mucus: false, blood: false }],
    meal: { recipe: 'duck', fedAt: '18:05', darfFed: 120 },
  };

  // Completed day with confirmed meal on 30 Oct -> attributed to 31 Oct
  days['2026-10-29'] = {
    date: '2026-10-29',
    weight: 19.08,
    bcs: 5.5,
    stools: [{ id: 'oct29-1', time: '07:50', bristol: 3, mucus: false, blood: false }],
    meal: { recipe: 'salmon', fedAt: '18:10', darfFed: 138, darfPlanned: 138, bowl: 'left', egg: true, broth: false, oilGiven: false, fibreGiven: true },
  };

  // 30 Oct: partially completed (weight missed, no BCS, unfed planned meal -> 31 Oct shows "Not recorded as fed")
  days['2026-10-30'] = {
    date: '2026-10-30',
    weightMissed: true,
    stools: [
      { id: 'oct30-1', time: '07:20', bristol: 3, mucus: false, blood: false },
      { id: 'oct30-2', time: '15:10', bristol: 6, mucus: true, blood: false },
    ],
    meal: { recipe: 'lamb', darfPlanned: 140 }, // planned only, NOT fed
  };

  // Yesterday (31 Oct): completed with blood + mucus + symptoms + confirmed meal -> triggers Vet alert + feeds Today (1 Nov)
  days[YESTERDAY] = {
    date: YESTERDAY,
    weight: 19.12,
    bcs: 5.5,
    events: ['vomited', 'lethargic'],
    walkMin: 40,
    walkKm: 2.8,
    activeMin: 52,
    treats: 1,
    stools: [
      { id: 'yd-1', time: '07:15', bristol: 4, mucus: false, blood: false },
      { id: 'yd-2', time: '18:40', bristol: 7, mucus: true, blood: true },
    ],
    meal: { recipe: 'beef', fedAt: '18:30', darfFed: 145, darfPlanned: 145, bowl: 'cleared', egg: false, broth: true, oilGiven: true, fibreGiven: true },
  };

  // Today (1 Nov): partially completed initially, planned meal ready
  days[TODAY] = {
    date: TODAY,
    weight: 19.1,
    meal: { recipe: 'fish', darfPlanned: 162, oilGiven: true, fibreGiven: true, egg: false, broth: false },
  };

  return days;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const errors = [], external = [];
  let passed = 0;

  async function openContext({ viewport = { width: 390, height: 844 }, colorScheme = 'light', forcedColors = 'none', seed = null } = {}) {
    const context = await browser.newContext({
      viewport,
      colorScheme,
      forcedColors,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') return route.fulfill({ contentType: 'application/javascript', body: stub });
      return route.fulfill({ status: 404, body: '' });
    });
    if (seed) {
      await context.addInitScript(({ seed, expectedOrigin }) => {
        if (location.origin !== expectedOrigin || localStorage.getItem('phase-d-seeded')) return;
        for (const [k, v] of Object.entries(seed.local || {})) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(seed.session || {})) sessionStorage.setItem(k, v);
        localStorage.setItem('phase-d-seeded', '1');
      }, { seed, expectedOrigin: origin });
    }
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => window.testApp?.S.ready);
    return { context, page };
  }

  async function loadSyntheticDays(page, days, settingsPatch = {}) {
    await page.evaluate(({ days, settingsPatch }) => {
      testApp.S.days = JSON.parse(JSON.stringify(days));
      Object.assign(testApp.S.settings, {
        startDate: '2025-12-20',
        fibreSchedule: [{ from: '2026-10-01', g: 2.5 }, { from: '2026-10-28', g: 5 }],
        ...settingsPatch,
      });
      testApp.S.changes = [{ id: 'chg-1', date: '2026-10-05', deltaG: -5, source: 'rule', reason: 'Prior adjustment' }];
      testApp.render(true);
    }, { days, settingsPatch });
  }

  async function assertNoHorizontalOverflow(page, label) {
    const overflow = await page.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardOverflow: [...document.querySelectorAll('#main .card, #main .diary-card, #main .note')].some(
        el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 || el.getBoundingClientRect().left < -0.5
      ),
    }));
    assert.ok(overflow.docOverflow <= 0, `${label}: document horizontal overflow ${overflow.docOverflow}px`);
    assert.equal(overflow.cardOverflow, false, `${label}: card exceeds viewport width`);
  }

  async function assertTapTargets(page, selector, label) {
    const boxes = await page.locator(selector).evaluateAll(els =>
      els.filter(el => el.offsetParent !== null).map(el => {
        const r = el.getBoundingClientRect();
        return { id: el.id || el.textContent.trim().slice(0, 30), width: r.width, height: r.height };
      })
    );
    assert.ok(boxes.length > 0, `${label}: expected visible controls for ${selector}`);
    for (const b of boxes) {
      assert.ok(b.width >= 43.5 && b.height >= 43.5, `${label}: ${b.id} tap target ${b.width.toFixed(1)}×${b.height.toFixed(1)} < 44×44`);
    }
  }

  try {
    // 1. Empty state across all 4 destinations at 375x667 and 390x844 without writes or overflow
    for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const { context, page } = await openContext({ viewport });
      await page.evaluate(() => { testApp.S.days = {}; testApp.S.changes = []; testApp.render(true); });
      const tabs = await page.locator('#tabbar button[data-tab]').evaluateAll(els => els.map(e => e.dataset.tab));
      assert.deepEqual(tabs, ['today', 'history', 'review', 'settings']);
      await assertTapTargets(page, '#tabbar button[data-tab]', `tabbar ${viewport.width}`);

      for (const tab of ['today', 'history', 'review', 'settings']) {
        await page.locator(`#tabbar [data-tab="${tab}"]`).click();
        await page.waitForFunction(t => testApp.S.tab === t, tab);
        await assertNoHorizontalOverflow(page, `empty ${tab} at ${viewport.width}x${viewport.height}`);
      }
      await page.locator('#tabbar [data-tab="review"]').click();
      await page.locator('#review-trends > summary').click();
      await page.locator('#review-comparisons > summary').click();
      await assertNoHorizontalOverflow(page, `empty expanded review at ${viewport.width}x${viewport.height}`);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'empty browsing creates zero writes');
      await context.close();
    }
    passed++; console.log('PASS empty state across Today / History / Review / Settings fits 390, 375 and 320px with 44px targets and zero writes');

    // 2. History readable iPhone diary: stacked summaries, meal attribution, tomorrow preview, imported future record, editor & return-to-list
    for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      const { context, page } = await openContext({ viewport });
      await loadSyntheticDays(page, buildFixtureDays());

      await page.locator('#tabbar [data-tab="history"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      assert.equal(await page.locator('#tabbar [data-tab="history"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('.log-table').count(), 0, 'wide mobile table is removed');
      await assertNoHorizontalOverflow(page, `History list at ${viewport.width}x${viewport.height}`);
      await assertTapTargets(page, '#main .diary-open[data-act="openday"], #main .date-jump, #main .chips button', `History controls ${viewport.width}`);

      // Verify font size >= 16px on date input
      const listDateFont = await page.locator('#history-list-date').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(listDateFont >= 16, `history-list-date font-size ${listDateFont}px >= 16px`);

      // Completed record (Yesterday, 31 Oct): stools, flags, weight, BCS, observations, and unfed-plan previous meal ("Not recorded as fed")
      const ydCard = page.locator('.diary-card[data-date="2026-10-31"]');
      assert.match(await ydCard.textContent(), /Sat 31 Oct 2026/);
      assert.match(await ydCard.textContent(), /2 stools · Types 4–7/);
      assert.match(await ydCard.textContent(), /Blood · Mucus/);
      assert.match(await ydCard.textContent(), /19\.12 kg/);
      assert.match(await ydCard.textContent(), /19\.12 kg Within range/);
      assert.match(await ydCard.textContent(), /BCS 5\.5/);
      assert.match(await ydCard.textContent(), /Observations: Vomited · Lethargic/);
      // Because 30 Oct's meal was only planned (not fed), 31 Oct must show Not recorded as fed!
      assert.match(await ydCard.textContent(), /Preceding meal \(30 Oct 2026\): Not recorded as fed/);

      // Partially completed record (30 Oct): Missed weight, unrecorded BCS, confirmed preceding meal from 29 Oct
      const oct30Card = page.locator('.diary-card[data-date="2026-10-30"]');
      assert.match(await oct30Card.locator('[data-weight-reading]').textContent(), /Missed/);
      assert.match(await oct30Card.locator('[data-bcs-reading]').textContent(), /Not recorded/);
      assert.match(await oct30Card.textContent(), /Preceding meal · 29 Oct 2026 at 18:10/);
      assert.match(await oct30Card.textContent(), /Salmon · 138 g DARF · Bowl: Left some/);

      // Today (1 Nov) shows Yesterday's (31 Oct) confirmed meal + expandable Meal details + Edit 31 Oct 2026 meal
      const todayCard = page.locator(`.diary-card[data-date="${TODAY}"]`);
      assert.match(await todayCard.textContent(), /Preceding meal · 31 Oct 2026 at 18:30/);
      assert.match(await todayCard.textContent(), /Beef · 145 g DARF · Bowl: Cleared/);
      await todayCard.locator('#meal-detail-2026-11-01 > summary').click();
      await assertNoHorizontalOverflow(page, `History expanded meal detail at ${viewport.width}`);
      await assertTapTargets(page, '#meal-detail-2026-11-01 summary, #meal-detail-2026-11-01 button.link', `Meal detail targets ${viewport.width}`);

      // Edit preceding meal opens 31 Oct directly focused on #meal-section-2026-10-31
      await todayCard.locator('button[data-act="openday"][data-date="2026-10-31"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'day' && testApp.S.cursor === '2026-10-31');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'meal-section-2026-10-31');
      assert.equal(await page.locator('#tabbar [data-tab="history"]').getAttribute('aria-current'), 'true');
      await assertTapTargets(page, '#history-back, #history-previous, #history-next, #history-date', `Day editor nav ${viewport.width}`);

      // Return to list restores focus to #open-day-2026-10-31
      await page.locator('#history-back').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'open-day-2026-10-31');
      assert.equal(await page.locator('#tabbar [data-tab="history"]').getAttribute('aria-current'), 'page');

      // CC-D2: Tapping History in #tabbar from the day editor restores the selected older card and scroll position
      await page.locator('#range-28').click();
      await page.locator('#open-day-2026-10-22').click();
      await page.waitForFunction(() => testApp.S.tab === 'day' && testApp.S.cursor === '2026-10-22');
      await page.locator('#tabbar [data-tab="history"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      const tabReturn = await page.evaluate(() => {
        const el = document.getElementById('open-day-2026-10-22');
        const r = el.getBoundingClientRect();
        return { activeId: document.activeElement?.id, scrollY: window.scrollY, top: r.top, vh: window.innerHeight };
      });
      assert.equal(tabReturn.activeId, 'open-day-2026-10-22', 'tabbar History return focuses selected card');
      assert.ok(tabReturn.scrollY > 500 && tabReturn.top >= -1 && tabReturn.top < tabReturn.vh, `tabbar History return scrolls card into view (scrollY=${tabReturn.scrollY})`);
      await page.locator('#range-14').click();

      // Jump to an older date outside the 14-day list via #history-list-date, then return via BOTH #history-back and #tabbar -> focus lands cleanly on heading
      await page.locator('#history-list-date').fill('2026-10-12');
      await page.waitForFunction(() => testApp.S.tab === 'day' && testApp.S.cursor === '2026-10-12');
      assert.match(await page.locator('#history-date-label').textContent(), /Mon 12 Oct 2026/);
      await page.locator('#history-back').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2', 'falls back to screen heading when cursor card is outside current range');
      await page.locator('#history-list-date').fill('2026-10-12');
      await page.waitForFunction(() => testApp.S.tab === 'day' && testApp.S.cursor === '2026-10-12');
      await page.locator('#tabbar [data-tab="history"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'history-list-heading', 'tabbar History return also falls back to heading when card is outside range');

      // Imported future-date record is hidden in 14 days, inspectable under All (9999)
      assert.equal(await page.locator('#open-day-2026-12-15').count(), 0);
      await page.locator('#range-9999').click();
      assert.equal(await page.locator('#open-day-2026-12-15').count(), 1);
      await page.locator('#open-day-2026-12-15').click();
      assert.equal(await page.locator('#in-notes-2026-12-15').inputValue(), 'Imported future-date entry kept inspectable');
      // Tapping History in the tabbar from single-day editor also returns to the list
      await page.locator('#tabbar [data-tab="history"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'history');
      await page.locator('#range-14').click();

      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'all History reading, filtering and day inspection created zero writes');

      // Now mark Today's meal as fed on Today -> verify tomorrow's preview card on History is non-opening
      await page.locator('#tabbar [data-tab="today"]').click();
      await page.locator(`#meal-fed-action-${TODAY}`).click();
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 1);
      await page.locator('#tabbar [data-tab="history"]').click();
      const tomorrowCard = page.locator('.diary-card[data-date="2026-11-02"]');
      assert.equal(await tomorrowCard.count(), 1);
      assert.match(await tomorrowCard.textContent(), /Tomorrow’s tracking/);
      assert.match(await tomorrowCard.textContent(), /Opens tomorrow/);
      assert.equal(await tomorrowCard.locator('.diary-open[data-act="openday"], [data-act="openday"][data-date="2026-11-02"]').count(), 0, 'tomorrow preview card cannot open a future daily record');
      assert.equal(await tomorrowCard.locator('[data-act="openday"][data-date="2026-11-01"]').count(), 1, 'meal details still link to edit today’s confirmed meal');
      assert.equal(await page.evaluate(() => Object.hasOwn(testApp.S.days, '2026-11-02')), false);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 1, 'viewing tomorrow preview creates no writes');

      await context.close();
    }
    passed++; console.log('PASS History stacked diary, meal attribution, tomorrow preview, imported future records and editor return flow work at 375 and 390px');

    // 3. Review: actionable-first order, year-inclusive dates on all alerts, accessible chart-value tables, read-only disclosures, and preserved actions
    for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      const { context, page } = await openContext({ viewport });
      await loadSyntheticDays(page, buildFixtureDays());

      // Check Today's alert banners include the year and navigate to Review
      const todayAlerts = await page.locator('#main .note').allTextContents();
      assert.ok(todayAlerts.some(t => /31 Oct 2026/.test(t)), 'Today vet alert banner includes year');
      assert.ok(todayAlerts.some(t => /12 Oct 2026 to 25 Oct 2026/.test(t)), 'Today ration alert banner includes window dates with year');
      await page.locator('#main [data-act="go"][data-tab="review"]').first().click();
      await page.waitForFunction(() => testApp.S.tab === 'review');

      await assertNoHorizontalOverflow(page, `Review initial at ${viewport.width}x${viewport.height}`);
      await assertTapTargets(page, '#main [data-act="applyadv"], #main [data-act="refuseadv"], #main [data-act="applyfibre"], #main [data-act="dismissfibre"], #main details > summary', `Review controls ${viewport.width}`);
      assert.equal((await page.locator('#main [data-act="refuseadv"]').textContent()).trim(), 'Keep current ration this week');

      // Verify actionable buttons are above collapsed supporting disclosures
      const applyBox = await page.locator('#main [data-act="applyadv"]').boundingBox();
      const rationDetailsBox = await page.locator('#review-ration-details').boundingBox();
      const trendsBox = await page.locator('#review-trends').boundingBox();
      assert.ok(applyBox.y < rationDetailsBox.y && rationDetailsBox.y < trendsBox.y, 'actionable results precede supporting explanations and trends');

      // Expand every disclosure and chart-value table; verify zero writes and zero horizontal page overflow
      for (const id of [
        'review-ration-details',
        'review-fibre-details',
        'review-weight-condition',
        'review-week-context',
        'review-trends',
        'review-comparisons',
      ]) {
        await page.locator(`#${id} > summary`).click();
        assert.equal(await page.locator(`#${id}`).evaluate(el => el.open), true);
      }
      assert.match(await page.locator('#review-ration-details').textContent(), /Current DARF adjustment/);
      assert.equal((await page.locator('#trend-range-note').textContent()).trim(), 'Applies to History and Review.');
      assert.equal((await page.locator('#comp-range-note').textContent()).trim(), 'Applies to History and Review.');
      for (const tableId of [
        'chart-values-weight',
        'chart-values-weight-weekly-average',
        'chart-values-condition',
        'chart-values-condition-weekly-average',
        'chart-values-stool',
      ]) {
        await page.locator(`#${tableId} > summary`).click();
        assert.equal(await page.locator(`#${tableId} table th[scope="col"]`).count() >= 2, true, `${tableId} has accessible column headers`);
        assert.match(await page.locator(`#${tableId} tbody`).textContent(), /2026/, `${tableId} rows include year`);
      }
      // Switch range in Trends & Comparisons -> disclosures stay open and zero writes are queued
      await page.locator('#range-28').click();
      assert.equal(await page.locator('#review-trends').evaluate(el => el.open), true, 'Trends stays open on range switch');
      await page.locator('#comp-range-9999').click();
      assert.equal(await page.locator('#review-comparisons').evaluate(el => el.open), true, 'Comparisons stays open on range switch');
      await assertNoHorizontalOverflow(page, `Review fully expanded at ${viewport.width}x${viewport.height}`);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'opening Review, charts, tables and disclosures creates zero writes');

      // Verify Apply ration advice and Not now on Pro-Fibre preserve exact calculation/action semantics
      const rationText = await page.locator('#main').textContent();
      const stepMatch = rationText.match(/Reduce DARF by (\d+) g on every recipe/);
      assert.ok(stepMatch, 'Review displays the exact reduction grams');
      const expectedStep = -Number(stepMatch[1]);
      await page.locator('[data-act="applyadv"]').click();
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 1);
      assert.equal(await page.evaluate(() => testApp.S.changes.at(-1).deltaG), expectedStep);

      await page.locator('[data-act="dismissfibre"]').click();
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 1, 'postponing Pro-Fibre advice is device-only and queues no Firestore write');
      assert.match(await page.locator('#main').textContent(), /Advice postponed until 2 Nov 2026/);

      await context.close();
    }
    passed++; console.log('PASS Review prioritizes actionable advice, includes years on all alerts/tables, keeps disclosures read-only and preserves actions');

    // 4. Offline, failed-save diary draft marker, dark theme, forced-colors, 200% text scale, and legacy route draft recovery
    {
      const legacyStatusKey = 'murphy-draft-v2:draft-test:legacy-status-session';
      const legacyStatusDraft = {
        version: 2,
        savedAt: Date.parse('2026-11-01T21:30:00Z'),
        tab: 'status',
        cursor: '2026-10-30',
        viewDate: null,
        expanded: [],
        stool: null,
        stools: [],
        fields: [{ id: 'in-notes-2026-10-30', date: '2026-10-30', key: 'notes', value: 'Unsaved note from pre-Phase-D session' }],
      };
      const { context, page } = await openContext({
        viewport: { width: 375, height: 667 },
        colorScheme: 'dark',
        forcedColors: 'active',
        seed: {
          session: { 'murphy-draft-session': 'legacy-status-session' },
          local: { [legacyStatusKey]: JSON.stringify(legacyStatusDraft) },
        },
      });
      await loadSyntheticDays(page, buildFixtureDays(), { theme: 'dark' });

      // This old v2 draft has no owner-lock evidence, so recovery requires consent.
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1);
      await page.locator('[data-act="recoverdraft"]').click();
      // Legacy 'status' draft normalizes to 'review' without losing cursor or hidden draft link
      assert.equal(await page.evaluate(() => testApp.S.tab), 'review');
      assert.equal(await page.evaluate(() => testApp.S.cursor), '2026-10-30');
      assert.equal(await page.locator('[data-act="resumedraft"][data-date="2026-10-30"]').count(), 1);

      // History diary card shows "Unsaved changes" badge on 2026-10-30
      await page.locator('#tabbar [data-tab="history"]').click();
      await assertNoHorizontalOverflow(page, 'History dark + forced-colors');
      const oct30Btn = page.locator('#open-day-2026-10-30');
      assert.match(await oct30Btn.textContent(), /Unsaved changes/);
      assert.match(await oct30Btn.getAttribute('aria-label'), /has unsaved changes/);

      // Simulate offline + failed local save on 2026-10-30, then return to History list
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      assert.match(await page.locator('#state').textContent(), /Offline/);
      await oct30Btn.click();
      assert.equal(await page.locator('#in-notes-2026-10-30').inputValue(), 'Unsaved note from pre-Phase-D session');
      await page.evaluate(() => {
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v) {
          if (k.startsWith('murphy-outbox')) throw new DOMException('Quota', 'QuotaExceededError');
          return window.__origSetItem.call(this, k, v);
        };
      });
      await page.locator('[data-key="notes"] [data-act="saveinput"]').click();
      assert.equal(await page.locator('#state').textContent(), 'Not saved');
      await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });

      await page.locator('#history-back').click();
      assert.equal(await page.locator('#state').textContent(), 'Not saved', 'failed save remains visible on History list');
      assert.match(await page.locator('#open-day-2026-10-30').textContent(), /Unsaved changes/);

      // Discard hidden drafts from History list -> badge clears immediately!
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-act="discardhiddendrafts"]').click();
      assert.doesNotMatch(await page.locator('#open-day-2026-10-30').textContent(), /Unsaved changes/);

      // Verify 200% text scale at 375px causes zero horizontal overflow on History and Review
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await assertNoHorizontalOverflow(page, 'History at 200% text size');
      await page.locator('#tabbar [data-tab="review"]').click();
      await assertNoHorizontalOverflow(page, 'Review at 200% text size');

      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      await context.close();
    }
    passed++; console.log('PASS offline, failed-save draft badges, legacy route recovery, dark/forced-colors and 200% text scale hold at 375px');

    // 5. Held ration alert, Pro-Fibre vet-review alert, Refuse/Apply fibre actions, and legacy 'day'/'more' route recovery
    {
      const legacyDayKey = 'murphy-draft:draft-test:legacy-v1-day';
      const legacyDayDraft = {
        version: 1,
        savedAt: Date.parse('2026-11-01T21:45:00Z'),
        tab: 'day',
        cursor: '2026-10-29',
        viewDate: '2026-10-29',
        expanded: [],
        stool: null,
        fields: [{ id: 'in-notes-2026-10-29', date: '2026-10-29', key: 'notes', value: 'Legacy v1 day editor note' }],
      };
      const { context, page } = await openContext({
        viewport: { width: 390, height: 844 },
        seed: {
          session: { 'murphy-draft-session': 'legacy-v1-day' },
          local: { [legacyDayKey]: JSON.stringify(legacyDayDraft) },
        },
      });
      assert.equal(await page.locator('[data-act="recoverdraft"]').count(), 1, 'legacy drafts require explicit recovery');
      await page.locator('[data-act="recoverdraft"]').click();
      // Recovered legacy v1 'day' draft opens in the single-day editor with History active.
      assert.equal(await page.evaluate(() => testApp.S.tab), 'day');
      assert.equal(await page.evaluate(() => testApp.S.cursor), '2026-10-29');
      assert.equal(await page.locator('#tabbar [data-tab="history"]').getAttribute('aria-current'), 'true');
      assert.equal(await page.locator('#in-notes-2026-10-29').inputValue(), 'Legacy v1 day editor note');
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();

      // Configure BCS <= 5 (holds ration reduction) and 5 g Pro-Fibre for >14 days with >=4 loose/mucus days (triggers Review with the vet)
      const heldDays = buildFixtureDays();
      for (const iso of Object.keys(heldDays)) {
        if (heldDays[iso].bcs) heldDays[iso].bcs = 4.5;
      }
      for (let d = 26; d <= 31; d++) {
        const iso = `2026-10-${d}`;
        heldDays[iso] = {
          ...(heldDays[iso] || { date: iso }),
          bcs: 4.5,
          stools: [{ id: `vetfib-${d}`, time: '08:00', bristol: 6, mucus: true, blood: false }],
        };
      }
      await loadSyntheticDays(page, heldDays, {
        fibreSchedule: [{ from: '2026-10-01', g: 5 }],
      });
      await page.locator('#tabbar [data-tab="review"]').click();
      const reviewText = await page.locator('#main').textContent();
      assert.match(reviewText, /Ration reduction held/);
      assert.match(reviewText, /Week of 26 Oct 2026 \(12 Oct 2026 to 25 Oct 2026\)/);
      assert.match(reviewText, /Review with the vet/);
      assert.match(reviewText, /1 Nov 2026 · dose since 1 Oct 2026/);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);

      // Verify Diet or routine changed label (CC-D4), then test Keep current ration this week and Apply Pro-Fibre advice
      await loadSyntheticDays(page, buildFixtureDays(), { regimeChanges: ['2026-10-20'] });
      assert.match(await page.locator('#main').textContent(), /Diet or routine changed 20 Oct 2026 · windows 12 Oct 2026 to 25 Oct 2026/);
      await loadSyntheticDays(page, buildFixtureDays(), { regimeChanges: [] });
      await page.locator('[data-act="refuseadv"]').click();
      assert.equal(await page.evaluate(() => testApp.S.changes.at(-1).refused), true);
      assert.equal(await page.evaluate(() => testApp.S.changes.at(-1).deltaG), 0);
      await page.locator('[data-act="applyfibre"]').click();
      assert.equal(await page.evaluate(() => testApp.S.settings.fibreSchedule.at(-1).g), 2.5);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 2);

      await context.close();
    }
    passed++; console.log('PASS held ration alert, Pro-Fibre vet review alert, Keep current ration/Apply fibre actions and legacy v1 day recovery work cleanly');

    // 6. CX-D1, CC-D1 & CC-D3: Recovered earlier-date v2 Today draft keeps actual current advice date, and 10 historical blood dates stay compact on Today while full on Review
    for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 }]) {
      const oct20Key = 'murphy-draft-v2:draft-test:oct20-session';
      const oct20Draft = {
        version: 2,
        savedAt: Date.parse('2026-11-01T21:00:00Z'),
        tab: 'today',
        cursor: null,
        viewDate: '2026-10-20',
        expanded: ['notes-2026-10-20'],
        stool: null,
        stools: [],
        fields: [{ id: 'in-notes-2026-10-20', date: '2026-10-20', key: 'notes', value: 'Unfinished Today note from 20 Oct' }],
      };
      const { context, page } = await openContext({
        viewport,
        seed: {
          session: { 'murphy-draft-session': 'current-nov1-session' },
          local: { [oct20Key]: JSON.stringify(oct20Draft) },
        },
      });

      const cleanDays = {
        // 94 days before 1 Nov 2026 (> vetWindowDays=90 -> Historical on 1 Nov, but within 90 days of 20 Oct)
        '2026-07-30': { date: '2026-07-30', stools: [{ id: 'b-jul30', time: '08:00', bristol: 4, mucus: false, blood: true }] },
        '2026-10-20': { date: '2026-10-20', stools: [{ id: 'clean-20', time: '08:00', bristol: 4, mucus: false, blood: false }] },
      };
      for (let d = 17; d <= 31; d++) {
        const iso = `2026-10-${d}`;
        cleanDays[iso] = { date: iso, stools: [{ id: `clean-${d}`, time: '08:00', bristol: 4, mucus: false, blood: false }] };
      }
      await loadSyntheticDays(page, cleanDays, {
        fibreSchedule: [{ from: '2026-10-16', g: 2.5 }],
      });

      // Trigger the actual v2 draft recovery flow via Restore entries
      await page.locator('#feedback [data-act="recoverdraft"]').click();
      assert.equal(await page.locator('#main .moment').textContent(), 'Unfinished entries');
      assert.equal(await page.locator('#main h2.screen').textContent(), 'Tue 20 Oct');
      assert.equal(await page.locator('#in-notes-2026-10-20').inputValue(), 'Unfinished Today note from 20 Oct');

      const bannerTexts = await page.locator('#main > .note').allTextContents();
      assert.ok(bannerTexts.some(t => /Pro-Fibre · 1 Nov 2026 · dose since 16 Oct 2026/.test(t)), 'Today Pro-Fibre banner uses actual current date (1 Nov 2026)');
      assert.ok(bannerTexts.every(t => !/Pro-Fibre · 20 Oct 2026|\.\s*\(dose since/.test(t)), 'No stale draft date or doubled punctuation on Pro-Fibre banner');
      // CR-02: 30 July is 94 days before the actual date (1 Nov), outside the 90-day vet window,
      // so it stays in Review but no longer raises Today's banner. Classified by the actual date, not 20 Oct.
      assert.ok(bannerTexts.every(t => !/Blood recorded/.test(t)), 'Today vet banner uses the actual current date (1 Nov 2026) and omits historical-only items');
      await assertNoHorizontalOverflow(page, `Recovered Today draft at ${viewport.width}x${viewport.height}`);

      // Cancel the recovered note so we return cleanly to current Today, then verify 10 historical blood dates stay bounded vs 1 date (CC-D1)
      await page.locator('[data-key="notes"] [data-act="cancelinput"]').click();
      await loadSyntheticDays(page, {
        '2026-10-29': { date: '2026-10-29', stools: [{ id: 'blood-single', time: '08:00', bristol: 4, mucus: false, blood: true }] },
      }, { startDate: '2025-11-01', fibreSchedule: [{ from: '2026-10-28', g: 2.5 }] });
      await page.locator('#tabbar [data-tab="today"]').click();
      const singleBannerHeight = (await page.locator('#main > .note.bad').first().boundingBox()).height;

      const bloodDates = ['2025-11-01', '2025-12-01', '2025-12-31', '2026-01-30', '2026-03-01', '2026-03-31', '2026-04-30', '2026-05-30', '2026-06-29', '2026-10-29'];
      const yearDays = {};
      bloodDates.forEach((iso, idx) => {
        yearDays[iso] = { date: iso, stools: [{ id: `blood-${idx}`, time: '08:00', bristol: 4, mucus: false, blood: true }] };
      });
      await loadSyntheticDays(page, yearDays, { startDate: '2025-11-01', fibreSchedule: [{ from: '2026-10-28', g: 2.5 }] });
      await page.locator('#tabbar [data-tab="today"]').click();

      const vetBanner = page.locator('#main > .note.bad').first();
      const vetBannerText = await vetBanner.textContent();
      assert.match(vetBannerText, /Blood recorded \(latest 29 Oct 2026 · 10 dates\)\./);
      assert.doesNotMatch(vetBannerText, /1 Nov 2025/);
      const vetBox = await vetBanner.boundingBox();
      assert.ok(vetBox.height <= singleBannerHeight + 26, `Today vet banner stays bounded (${vetBox.height}px vs 1-date ${singleBannerHeight}px)`);
      await assertNoHorizontalOverflow(page, `Today 10 blood dates at ${viewport.width}x${viewport.height}`);

      // Review still lists all 10 dates in full
      await vetBanner.locator('[data-act="go"][data-tab="review"]').click();
      await page.waitForFunction(() => testApp.S.tab === 'review');
      const reviewVetText = await page.locator('#main .note.bad').first().textContent();
      for (const expected of ['1 Nov 2025', '1 Dec 2025', '31 Dec 2025', '30 Jan 2026', '1 Mar 2026', '31 Mar 2026', '30 Apr 2026', '30 May 2026', '29 June 2026', '29 Oct 2026']) {
        assert.ok(reviewVetText.includes(expected), `Review retains full blood date ${expected}`);
      }
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);
      await context.close();
    }
    passed++; console.log('PASS CX-D1 recovered draft advice date, CC-D1 compact 10-blood-date Today banner and CC-D3 punctuation verified at 375 and 390px');

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
