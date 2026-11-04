'use strict';

// Phase E browser validation for Settings (Account, Appearance, Feeding plan,
// Backup & export, Advanced) and unified month/format exports.
// Reuses the shared Firebase-blocked fixture from draft-input.browser.cjs; zero network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, html, stub, origin } = require('./draft-input.browser.cjs');

const TODAY = '2026-11-01';
const YESTERDAY = '2026-10-31';

function buildFixtureDays() {
  const days = {
    '2025-12-30': {
      date: '2025-12-30',
      notes: 'dec-2025-historical-note',
      stools: [{ id: 'hist-2025', time: '08:15', bristol: 7, mucus: true, blood: false }],
      weight: 18.55,
      bcs: 5,
      meal: { recipe: 'beef', fedAt: '18:00', darfFed: 145, darfPlanned: 145, bowl: 'cleared', egg: false, broth: false, oilGiven: true, fibreGiven: true },
    },
    '2026-10-28': {
      date: '2026-10-28',
      notes: 'imported-oct28-note',
      weight: 19.05,
      bcs: 5.5,
      stools: [{ id: 'imp-oct28', time: '07:30', bristol: 4, mucus: false, blood: false }],
      meal: { recipe: 'duck', fedAt: '18:05', darfFed: 120 },
    },
    '2026-10-29': {
      date: '2026-10-29',
      weight: 19.08,
      bcs: 5.5,
      stools: [{ id: 'oct29-1', time: '07:50', bristol: 3, mucus: false, blood: false }],
      meal: { recipe: 'salmon', fedAt: '18:10', darfFed: 138, darfPlanned: 138, bowl: 'left' },
    },
    '2026-10-30': {
      date: '2026-10-30',
      weightMissed: true,
      stools: [{ id: 'oct30-1', time: '07:20', bristol: 3, mucus: false, blood: false }],
      meal: { recipe: 'lamb', darfPlanned: 140 },
    },
    [YESTERDAY]: {
      date: YESTERDAY,
      notes: 'oct31-completed-note',
      weight: 19.12,
      bcs: 5.5,
      events: ['vomited'],
      walkMin: 40,
      walkKm: 2.8,
      activeMin: 52,
      treats: 1,
      stools: [
        { id: 'yd-1', time: '07:15', bristol: 4, mucus: false, blood: false },
        { id: 'yd-2', time: '18:40', bristol: 6, mucus: true, blood: false },
      ],
      meal: { recipe: 'beef', fedAt: '18:30', darfFed: 145, darfPlanned: 145, bowl: 'cleared', egg: false, broth: true, oilGiven: true, fibreGiven: true },
    },
    [TODAY]: {
      date: TODAY,
      notes: 'nov1-today-note',
      weight: 19.1,
      meal: { recipe: 'fish', darfPlanned: 162, oilGiven: true, fibreGiven: true, egg: false, broth: false },
    },
  };
  return days;
}

async function readDownloadText(download) {
  const filePath = await download.path();
  assert.ok(filePath, `Expected download path for ${download.suggestedFilename()}`);
  return fs.readFileSync(filePath, 'utf8');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const errors = [], external = [];
  let passed = 0;

  async function openContext({
    viewport = { width: 390, height: 844 },
    colorScheme = 'light',
    forcedColors = 'none',
    seed = null,
    acceptDownloads = true,
  } = {}) {
    const context = await browser.newContext({
      viewport,
      colorScheme,
      forcedColors,
      isMobile: true,
      hasTouch: true,
      acceptDownloads,
      serviceWorkers: 'block',
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/firebase-stub.js') {
        const instrumentedStub = stub.replace(
          'export const onSnapshot=(ref,_options,cb)=>{',
          'export const onSnapshot=(ref,_options,cb)=>{(window.__snapshotListeners||={})[ref.id?ref.col+":"+ref.id:ref.col]=cb;'
        );
        return route.fulfill({ contentType: 'application/javascript', body: instrumentedStub });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    if (seed) {
      await context.addInitScript(({ seed, expectedOrigin }) => {
        if (location.origin !== expectedOrigin || localStorage.getItem('phase-e-seeded')) return;
        for (const [k, v] of Object.entries(seed.local || {})) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(seed.session || {})) sessionStorage.setItem(k, v);
        localStorage.setItem('phase-e-seeded', '1');
      }, { seed, expectedOrigin: origin });
    }
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => window.testApp?.S.ready);
    return { context, page };
  }

  async function loadSyntheticState(page, days, { settingsPatch = {}, changes = [] } = {}) {
    await page.evaluate(({ days, settingsPatch, changes }) => {
      testApp.S.days = JSON.parse(JSON.stringify(days));
      testApp.S.changes = JSON.parse(JSON.stringify(changes));
      const raw = {
        startDate: '2026-09-04',
        oilSchedule: [{ from: '2026-09-04', ml: 8 }, { from: '2026-09-28', ml: 4 }],
        fibreSchedule: [{ from: '2026-09-04', g: 2.5 }, { from: '2026-09-17', g: 5 }],
        regimeChanges: [],
        ...settingsPatch,
      };
      testApp.S.savedSettings = JSON.parse(JSON.stringify(raw));
      testApp.S.rawSettings = JSON.parse(JSON.stringify(raw));
      Object.assign(testApp.S.settings, raw);
      testApp.render(true);
    }, { days, settingsPatch, changes });
  }

  async function assertLayoutAndTargets(page, label) {
    const metrics = await page.evaluate(() => {
      const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const badButtons = [];
      for (const el of document.querySelectorAll('#main button, #main select, #main input:not(.date-overlay), #main summary, #tabbar button')) {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) {
          badButtons.push({
            tag: el.tagName,
            id: el.id,
            text: (el.textContent || '').trim().slice(0, 36),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          });
        }
      }
      const badInputs = [];
      for (const el of document.querySelectorAll('#main input:not([type="file"]):not(.date-overlay), #main select, #main textarea')) {
        if (el.offsetParent === null) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 16) badInputs.push({ id: el.id, px });
      }
      return { overflowX, badButtons, badInputs };
    });
    assert.equal(metrics.overflowX, 0, `${label}: unexpected horizontal overflow (${metrics.overflowX}px)`);
    assert.deepEqual(metrics.badButtons, [], `${label}: controls smaller than 44x44px`);
    assert.deepEqual(metrics.badInputs, [], `${label}: inputs/selects smaller than 16px`);
  }

  try {
    // 1. Five-group Settings layout, 44x44px targets, >=16px inputs, and zero writes across 390x844, 375x667, and 320x568
    {
      const { context, page } = await openContext({ viewport: { width: 390, height: 844 } });
      await loadSyntheticState(page, {}, { settingsPatch: { startDate: TODAY } });
      const beforeWrites = await page.evaluate(() => testApp.queuedWrites().length);

      await page.locator('#tabbar [data-tab="settings"]').click();
      for (const vp of [
        { width: 390, height: 844 },
        { width: 375, height: 667 },
        { width: 320, height: 568 },
      ]) {
        await page.setViewportSize(vp);
        const cardIds = await page.evaluate(() =>
          [...document.querySelectorAll('#main > .card')].map(el => el.id)
        );
        assert.deepEqual(cardIds, [
          'settings-account',
          'settings-appearance',
          'settings-feeding-plan',
          'settings-backup-export',
          'settings-advanced',
        ]);
        assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), false);
        await assertLayoutAndTargets(page, `empty Settings closed ${vp.width}x${vp.height}`);

        // Open schedules and Advanced — verify zero writes and 44x44px / >=16px everywhere:
        await page.locator('#settings-schedules > summary').click();
        await page.locator('#settings-advanced > summary').click();
        assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);
        await assertLayoutAndTargets(page, `empty Settings expanded ${vp.width}x${vp.height}`);

        await page.locator('#settings-schedules > summary').click();
        await page.locator('#settings-advanced > summary').click();
      }
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), beforeWrites);
      await context.close();
      passed++; console.log('PASS Settings 5-group layout fits 390, 375 and 320px (closed & expanded) with 44px targets, >=16px inputs and zero writes');
    }

    // 2. October export on 1 November (both CSV downloads + Markdown + Full JSON backup + JSON import without preview + month rollovers)
    {
      const { context, page } = await openContext({
        viewport: { width: 375, height: 667 },
        seed: { local: { 'test-clock': String(Date.parse('2026-11-01T09:30:00Z')) } },
      });
      await loadSyntheticState(page, buildFixtureDays(), {
        changes: [{ id: 'oct-chg-1', date: '2026-10-20', deltaG: -5, source: 'rule', reason: 'Oct weekly step' }],
      });

      await page.locator('#tabbar [data-tab="settings"]').click();
      await assertLayoutAndTargets(page, 'fixture Settings at 375x667');

      // Check month options on 1 November 2026:
      const monthOptions = await page.locator('#export-month option').evaluateAll(opts =>
        opts.map(o => ({ value: o.value, text: o.textContent }))
      );
      assert.equal(monthOptions[0].value, '2026-11');
      assert.equal(monthOptions[0].text, 'Nov 2026 (this month)');
      assert.equal(monthOptions[1].value, '2026-10');
      assert.equal(monthOptions[1].text, 'Oct 2026 (last month)');
      assert.ok(monthOptions.some(o => o.value === '2025-12' && o.text === 'Dec 2025'));

      // Tag #export-month DOM node to verify it stays connected on change & background render (prevents iOS picker reopen):
      await page.evaluate(() => { document.getElementById('export-month').__sameNode = true; });
      await page.locator('#export-month').focus();
      await page.locator('#export-month').selectOption('2026-10');
      await page.evaluate(() => testApp.render(true));
      assert.equal(await page.evaluate(() => document.getElementById('export-month').__sameNode === true), true);
      assert.match(await page.locator('#export-output-note').textContent(), /Murphy_Log_2026-10\.csv.*Murphy_Log_2026-10_stools\.csv/);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'changing export month creates no writes');

      // Export October CSV on 1 November -> captures BOTH daily CSV and delayed stools CSV downloads!
      const csvDownloads = [];
      const onDownload = d => csvDownloads.push(d);
      page.on('download', onDownload);
      await page.locator('#export-run').click();
      await page.waitForFunction(() => true);
      const deadline = Date.now() + 4000;
      while (csvDownloads.length < 2 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      page.off('download', onDownload);
      assert.equal(csvDownloads.length, 2, 'CSV export triggers both daily and delayed stools CSV files');
      assert.equal(csvDownloads[0].suggestedFilename(), 'Murphy_Log_2026-10.csv');
      assert.equal(csvDownloads[1].suggestedFilename(), 'Murphy_Log_2026-10_stools.csv');

      const dailyCsv = await readDownloadText(csvDownloads[0]);
      const stoolsCsv = await readDownloadText(csvDownloads[1]);
      assert.match(dailyCsv, /2026-10-28,4,1/);
      assert.match(dailyCsv, /oct31-completed-note/);
      assert.doesNotMatch(dailyCsv, /nov1-today-note/);
      assert.doesNotMatch(dailyCsv, /dec-2025-historical-note/);
      assert.match(stoolsCsv, /2026-10-30,07:20,3,Cracked,,,2026-10-29 salmon/);
      assert.match(stoolsCsv, /2026-10-31,18:40,6,Mushy,Y,,(?:\r?\n|$)/);

      // Switch format to Markdown and export October on 1 November:
      await page.locator('#export-fmt-md').click();
      assert.equal(await page.locator('#export-fmt-md').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#export-fmt-csv').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#export-output-note').textContent(), 'Markdown downloads Murphy_Log_2026-10.md.');

      const [mdDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#export-run').click(),
      ]);
      assert.equal(mdDownload.suggestedFilename(), 'Murphy_Log_2026-10.md');
      const mdText = await readDownloadText(mdDownload);
      assert.match(mdText, /# Murphy's Logs: Oct 2026/);
      assert.match(mdText, /oct31-completed-note/);
      assert.match(mdText, /Oct weekly step/);
      assert.doesNotMatch(mdText, /nov1-today-note/);

      // Separate Full backup (JSON) includes all months and the current release:
      const [jsonDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#export-all').click(),
      ]);
      assert.equal(jsonDownload.suggestedFilename(), 'Murphy_Log_backup_2026-11-01.json');
      const backupObj = JSON.parse(await readDownloadText(jsonDownload));
      assert.equal(backupObj.version, '3.9.2');
      assert.ok(backupObj.days['2025-12-30'] && backupObj.days['2026-10-31'] && backupObj.days['2026-11-01']);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'exports write nothing to outbox');

      // Existing JSON import works directly without adding an import preview step, and updates selectable months even when an input is dirty:
      await page.locator('#in-setnum-targetKcal').fill('1260');
      const importPayload = JSON.stringify({
        version: '3.9.0',
        days: {
          '2025-11-15': {
            date: '2025-11-15',
            updatedAt: '2025-11-15T20:00:00.000Z',
            notes: 'imported-nov-2025-record',
            stools: [{ id: 'imp-s-nov25', time: '09:10', bristol: 4, mucus: false, blood: false }],
          },
        },
        changes: [],
        settings: {},
      });
      await page.locator('#backup-file').setInputFiles({
        name: 'import-nov-2025.json',
        mimeType: 'application/json',
        buffer: Buffer.from(importPayload, 'utf8'),
      });
      await page.waitForFunction(() => /Import saved locally/.test(document.querySelector('#feedback')?.textContent || ''));
      assert.equal(await page.locator('#in-setnum-targetKcal').inputValue(), '1260', 'dirty Settings draft stays intact across import');
      const updatedMonths = await page.locator('#export-month option').evaluateAll(opts => opts.map(o => o.value));
      assert.ok(updatedMonths.includes('2025-11'), 'newly imported month is immediately selectable even while a draft is open');
      await page.locator('[data-key="setnum"] [data-act="cancelinput"]').click();

      // Verify midnight month rollover (31 Dec 2026 -> 1 Jan 2027) updates options cleanly:
      await page.evaluate(() => {
        testApp.S.exportMonth = null;
        window.__now = Date.parse('2027-01-01T00:02:00Z');
        testApp.londonNow();
        testApp.render(true);
      });
      const janOptions = await page.locator('#export-month option').evaluateAll(opts =>
        opts.slice(0, 2).map(o => ({ value: o.value, text: o.textContent }))
      );
      assert.deepEqual(janOptions, [
        { value: '2027-01', text: 'Jan 2027 (this month)' },
        { value: '2026-12', text: 'Dec 2026 (last month)' },
      ]);

      await context.close();
      passed++; console.log('PASS October export on 1 November downloads both CSV files and Markdown, keeps Full backup separate, retains direct JSON import and handles year rollovers');
    }

    // 3. Capabilities, confirmations, Undo focus, Advanced drafts, self-tests, erase confirmation & no new sign-out guard
    {
      const { context, page } = await openContext({ viewport: { width: 390, height: 844 } });
      await loadSyntheticState(page, buildFixtureDays(), {
        settingsPatch: { regimeChanges: ['2026-10-15'] },
        changes: [{ id: 'chg-oct-20', date: '2026-10-20', deltaG: -5, source: 'rule', reason: 'Weekly step' }],
      });

      await page.locator('#tabbar [data-tab="settings"]').click();

      // Appearance segmented control:
      await page.locator('#theme-dark').click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
      assert.equal(await page.locator('#theme-dark').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'theme-dark');
      await assertLayoutAndTargets(page, 'dark-mode Settings at 390x844');
      await page.locator('#theme-light').click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');

      // Manual Pro-Fibre ceiling confirmation (> fibreRestG = 5 g):
      const dialogs = [];
      let nextDialogResponse = false;
      let nextPromptText = 'nope';
      page.on('dialog', async dialog => {
        dialogs.push({ type: dialog.type(), message: dialog.message() });
        if (dialog.type() === 'prompt') {
          await dialog.accept(nextPromptText);
        } else if (nextDialogResponse) {
          await dialog.accept();
        } else {
          await dialog.dismiss();
        }
      });

      nextDialogResponse = false;
      await page.locator('#set-fibre-7-5').click();
      assert.equal(dialogs.length, 1);
      assert.match(dialogs[0].message, /above the 5 g ceiling/);
      assert.equal(await page.evaluate(() => testApp.S.settings.fibreSchedule.at(-1).g), 5, 'dismissing confirm leaves Pro-Fibre unchanged');

      nextDialogResponse = true;
      await page.locator('#set-fibre-7-5').click();
      assert.equal(await page.evaluate(() => testApp.S.settings.fibreSchedule.at(-1).g), 7.5);
      assert.match(await page.locator('#settings-feeding-plan').textContent(), /Pro-Fibre today7\.5 g/);

      // Diet or routine changes: add + remove with confirmation + Undo + focus restoration:
      await page.locator('#add-regime').click();
      assert.match(await page.locator('#settings-feeding-plan').textContent(), /1 Nov 2026/);
      dialogs.length = 0;
      nextDialogResponse = false;
      await page.locator('#del-regime-2026-10-15-0').click();
      assert.equal(dialogs.length, 1);
      assert.match(dialogs[0].message, /Remove the diet or routine change on 15 Oct 2026\?/);
      assert.ok(await page.evaluate(() => testApp.S.settings.regimeChanges.includes('2026-10-15')));

      nextDialogResponse = true;
      await page.locator('#del-regime-2026-10-15-0').click();
      assert.equal(await page.evaluate(() => testApp.S.settings.regimeChanges.includes('2026-10-15')), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'undo-removal');
      assert.match(await page.locator('#feedback').textContent(), /Diet or routine change removed · 15 Oct 2026/);
      await page.locator('#undo-removal').click();
      assert.ok(await page.evaluate(() => testApp.S.settings.regimeChanges.includes('2026-10-15')));

      // Advanced: draft marker when collapsed, persistence across navigation & midnight reload, Adjustment log Undo, Run self-tests:
      await page.locator('#settings-advanced > summary').click();
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);

      // Adjustment log remove + confirm + Undo:
      dialogs.length = 0;
      nextDialogResponse = true;
      await page.locator('#del-change-0').click();
      assert.match(dialogs[0].message, /Remove the ration entry on 20 Oct 2026\?/);
      assert.equal(await page.evaluate(() => testApp.S.changes.length), 0);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'undo-removal');
      assert.match(await page.locator('#feedback').textContent(), /Ration adjustment removed · 20 Oct 2026/);
      await page.locator('#undo-removal').click();
      assert.equal(await page.evaluate(() => testApp.S.changes.length), 1);

      // Run self-tests keeps #settings-advanced open and #run-selftest focused:
      await page.locator('#run-selftest').click();
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'run-selftest');
      assert.match(await page.locator('#selftest-out').textContent(), /62 passed, 0 failed/);

      // Advanced numeric draft: collapsing shows Unsaved changes; navigating away & back reopens #settings-advanced automatically:
      const maxStep = page.locator('#in-setnum-maxStepG');
      await maxStep.fill('20');
      await page.locator('#settings-advanced > summary').click();
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), false);
      assert.match(await page.locator('#settings-advanced > summary').textContent(), /Unsaved changes/);

      await page.locator('#tabbar [data-tab="review"]').click();
      assert.match(await page.locator('#feedback').textContent(), /Unfinished entries.*Settings/);
      await page.locator('[data-act="resumedraft"][data-tab="settings"]').click();
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);
      assert.equal(await maxStep.inputValue(), '20');

      // Save Advanced draft:
      await page.locator('[data-setting="maxStepG"] [data-act="saveinput"]').click();
      assert.equal(await page.evaluate(() => testApp.S.settings.maxStepG), 20);
      assert.doesNotMatch(await page.locator('#settings-advanced > summary').textContent(), /Unsaved changes/);

      // Erase all log data requires both confirm() AND typing ERASE in prompt():
      dialogs.length = 0;
      nextDialogResponse = true;
      nextPromptText = 'cancel';
      await page.locator('#erase-log').click();
      assert.equal(dialogs.length, 2);
      assert.equal(dialogs[0].type, 'confirm');
      assert.equal(dialogs[1].type, 'prompt');
      assert.ok(await page.evaluate(() => Object.keys(testApp.S.days).length > 0), 'wrong ERASE prompt leaves days untouched');

      // Sign out has NO new sign-out guard when no input drafts are open (invokes signOut directly, which our stub blocks cleanly):
      dialogs.length = 0;
      const signOutOutcome = await page.evaluate(async () => {
        try {
          document.getElementById('signout-btn').click();
          await new Promise(r => setTimeout(r, 20));
          return 'completed';
        } catch (e) {
          return String(e);
        }
      });
      assert.equal(dialogs.length, 0, 'Sign out must not add a new confirmation guard when no drafts are open');
      assert.ok(signOutOutcome);
      // Clear expected unhandledrejection error from forbidden signOut stub call so pageErrors check stays strict for real bugs:
      const unexpectedErrors = errors.filter(msg => !/Unexpected backend operation/.test(msg));
      errors.length = 0;
      errors.push(...unexpectedErrors);

      await context.close();
      passed++; console.log('PASS Settings preserves theme, Pro-Fibre confirm, diet/adjustment Undo, Advanced drafts, self-tests, double-confirmed Erase and direct Sign out');
    }

    // 4. Offline, failed local save in Advanced, forced-colors, and 200% text scaling at 375x667
    {
      const { context, page } = await openContext({
        viewport: { width: 375, height: 667 },
        colorScheme: 'dark',
        forcedColors: 'active',
      });
      await loadSyntheticState(page, buildFixtureDays());
      await page.locator('#tabbar [data-tab="settings"]').click();
      await page.locator('#settings-advanced > summary').click();

      // Simulate offline event:
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        window.dispatchEvent(new Event('offline'));
      });
      assert.match(await page.locator('#state').textContent(), /Offline/);
      assert.match(await page.locator('#settings-account').textContent(), /App updates & offline access/);

      // Simulate failed local outbox save on Advanced field (#in-setnum-darfMinG):
      await page.locator('#in-setnum-darfMinG').fill('35');
      await page.evaluate(() => {
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k.includes('murphy-outbox')) throw new DOMException('QuotaExceeded', 'QuotaExceededError');
          return window.__origSetItem.call(this, k, v);
        };
      });
      await page.locator('[data-setting="darfMinG"] [data-act="saveinput"]').click();
      assert.equal(await page.locator('#state').textContent(), 'Not saved');
      assert.equal(await page.locator('#in-setnum-darfMinG').inputValue(), '35');

      // 200% root font scaling at 375px with both disclosures open:
      await page.locator('#settings-schedules > summary').click();
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      await assertLayoutAndTargets(page, '200% text scale forced-colors Settings at 375x667');

      await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
      await context.close();
      passed++; console.log('PASS Settings holds under offline, failed-save outbox quota error, forced-colors and 200% text scaling at 375x667');
    }

    // 5. CX-E1 (deferred-render supplement refresh across midnight/resume) & CX-E2 (summary focus preserved on background onSnapshot + Tab)
    {
      const { context, page } = await openContext({
        viewport: { width: 375, height: 667 },
        seed: { local: { 'test-clock': String(Date.parse('2026-11-01T23:55:00Z')) } },
      });
      await loadSyntheticState(page, buildFixtureDays(), {
        settingsPatch: {
          oilSchedule: [{ from: '2026-11-01', ml: 8 }, { from: '2026-11-02', ml: 4 }],
          fibreSchedule: [{ from: '2026-11-01', g: 2.5 }, { from: '2026-11-02', g: 5 }],
          regimeChanges: [],
        },
      });

      await page.locator('#tabbar [data-tab="settings"]').click();
      assert.equal(await page.locator('#settings-oil-today').textContent(), '8 ml');
      assert.equal(await page.locator('#settings-fibre-today').textContent(), '2.5 g');

      // CX-E1: Leave Daily target dirty on 1 Nov, advance across midnight to 2 Nov, and resume via visibilitychange:
      const targetInput = page.locator('#in-setnum-targetKcal');
      await targetInput.fill('1255');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0);

      await page.evaluate(() => {
        window.__now = Date.parse('2026-11-02T00:05:00Z');
        testApp.londonNow();
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await page.locator('#settings-oil-today').textContent(), '4 ml', 'Salmon oil today updates across midnight while draft is open');
      assert.equal(await page.locator('#settings-fibre-today').textContent(), '5 g', 'Pro-Fibre today updates across midnight while draft is open');
      assert.equal(await targetInput.inputValue(), '1255', 'dirty Settings draft stays intact');
      assert.equal(await page.locator('[data-setting="targetKcal"]').evaluate(el => el.hasAttribute('data-dirty')), true);
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'midnight supplement refresh creates zero recorded-data or outbox writes');

      await page.locator('[data-setting="targetKcal"] [data-act="cancelinput"]').click();
      assert.equal(await page.locator('#settings-oil-today').textContent(), '4 ml');
      assert.equal(await page.locator('#settings-fibre-today').textContent(), '5 g');

      // CX-E2: Keyboard-open Advanced, keep focus on #settings-advanced-summary, deliver real stubbed onSnapshot, then press Tab:
      await page.locator('#settings-advanced-summary').scrollIntoViewIfNeeded();
      await page.locator('#settings-advanced-summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-advanced-summary');
      const scrollBeforeAdv = await page.evaluate(() => window.scrollY);
      assert.ok(scrollBeforeAdv > 400, 'scrolled down to Advanced summary');

      await page.evaluate(() => {
        window.__snapshotListeners.changes({
          docChanges: () => [{
            type: 'added',
            doc: { id: 'snap-chg-1', data: () => ({ id: 'snap-chg-1', date: '2026-10-25', deltaG: 5, source: 'manual' }) },
          }],
          metadata: { fromCache: false },
        });
      });
      assert.equal(await page.locator('#settings-advanced').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-advanced-summary', 'Advanced summary retains focus across onSnapshot');
      const scrollAfterAdv = await page.evaluate(() => window.scrollY);
      assert.ok(Math.abs(scrollAfterAdv - scrollBeforeAdv) < 20, `scroll preserved (${scrollBeforeAdv} -> ${scrollAfterAdv})`);

      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'in-setnum-kcalPerGDarf', 'Tab enters first Advanced field instead of jumping to Sign out');

      // CX-E2 on Supplement schedule history (#settings-schedules-summary):
      await page.locator('#settings-schedules-summary').scrollIntoViewIfNeeded();
      await page.locator('#settings-schedules-summary').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#settings-schedules').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-schedules-summary');

      await page.evaluate(() => {
        window.__snapshotListeners.changes({
          docChanges: () => [{
            type: 'added',
            doc: { id: 'snap-chg-2', data: () => ({ id: 'snap-chg-2', date: '2026-10-26', deltaG: -5, source: 'rule' }) },
          }],
          metadata: { fromCache: false },
        });
      });
      assert.equal(await page.locator('#settings-schedules').evaluate(el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-schedules-summary', 'Supplement schedule summary retains focus across onSnapshot');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'add-regime', 'Tab moves to next Feeding plan control instead of jumping to Sign out');
      assert.equal(await page.evaluate(() => testApp.queuedWrites().length), 0, 'CX-E2 check creates zero outbox writes');

      await context.close();
      passed++; console.log('PASS CX-E1 deferred-render current-day supplement refresh and CX-E2 disclosure summary focus across onSnapshot verified at 375x667');
    }

    assert.deepEqual(external, [], `Unexpected external requests: ${external.join(', ')}`);
    assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join('; ')}`);
    console.log(JSON.stringify({ passed, externalRequests: external, pageErrors: errors }));
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
