'use strict';

// Run with: node --test tests/ui-ergonomics.test.cjs
// Exercises the actual application module's views and event handlers for the
// one-handed logging flows. Local stubs only: no browser, packages, network,
// Firebase account, sign-in or remote reads/writes. Nothing here is synced:
// S.ready stays false, so confirmed entries remain in the local outbox.
// Layout, native pickers and the iOS keyboard still need a device check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const htmlPath = process.env.APP_HTML ? path.resolve(process.env.APP_HTML) : path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const moduleMatch = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, 'Application module is present');
const importNames = [];
const moduleSource = moduleMatch[1].replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*/gm, (_, names) => {
  importNames.push(...names.split(',').map(name => name.trim()));
  return '';
});
assert.doesNotMatch(moduleSource, /^\s*import\s/m, 'Every SDK import needs an explicit stub');

const TODAY = '2026-10-28', YESTERDAY = '2026-10-27';
const fedMeal = { recipe: 'lamb', fedAt: '18:30', darfFed: 140, darfPlanned: 140 };
const stool = { id: 's1', time: '07:30', bristol: 4, mucus: false, blood: false };

function makeHarness({ days = {}, dirty = false, now = TODAY + 'T10:00:00Z', source = moduleSource, onLine = true, firebaseOverrides = {} } = {}) {
  const storage = new Map(), listeners = new Map(), windowListeners = new Map(), intervals = [], nodes = new Map(), confirms = [], timers = [];
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      selector, id: selector.startsWith('#') ? selector.slice(1) : '', value: '', dataset: {}, innerHTML: '', textContent: '',
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, matches: () => false, closest: () => null, contains: () => false,
      reportValidity: () => true, focus() { document.activeElement = this; }, scrollIntoView() {},
      getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }), querySelector: () => null, querySelectorAll: () => [],
    });
    return nodes.get(selector);
  };
  // Only a draft marker is ever absent unless the test asks for one.
  const document = {
    querySelector: selector => /\[data-dirty\]|\[data-stool\]/.test(selector) ? (dirty ? element('draft') : null) : element(selector),
    querySelectorAll: () => [], getElementById: id => element('#' + id), documentElement: element('html'), activeElement: null,
    hidden: false,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
  };
  const fixed = Date.parse(now);
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
  const forbidden = name => () => { throw Error('Unexpected ' + name + ' in a local UI test'); };
  const firebase = Object.fromEntries(importNames.map(name => [name, name === 'onAuthStateChanged' ? () => () => {} : forbidden('Firebase call: ' + name)]));
  Object.assign(firebase, { initializeApp: () => ({}), getAuth: () => ({}), initializeFirestore: () => ({}),
    persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}) });
  Object.assign(firebase, firebaseOverrides);
  const nav = { onLine };
  const context = vm.createContext({
    ...firebase, document, console, URL, Date: ClockDate, crypto: { randomUUID }, CSS: { escape: value => value },
    navigator: nav, localStorage: {
      get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
    },
    window: {
      addEventListener(name, callback) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(callback); },
      AppShell: { ready() {} }
    },
    ResizeObserver: class { observe() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setInterval(callback, ms) { intervals.push({ callback, ms }); }, setTimeout(callback) { timers.push(callback); }, clearTimeout() {}, fetch: forbidden('network'), prompt: forbidden('prompt'),
    confirm: message => { confirms.push(message); return true; },
  });
  vm.runInContext(source + `
    globalThis.renders = [];
    render = (...args) => { globalThis.renders.push(args); };
    const realRenderFeedback = renderFeedback;
    renderFeedback = () => {};
    globalThis.testDownloads = [];
    download = (...args) => globalThis.testDownloads.push(args);
    globalThis.api = { S, setStatus, storeError, bindSaveError, clearSaveError, resetSaveFeedback, feedback: realRenderFeedback, stoolsCard, todoCard, viewToday, viewDay, viewHistory, viewReview, viewSettings, navigateTo, normalizeTab, navDestination, formatAlertDates, formatVetAlertHeadline, rationAlertDateText, weeklyAdvice, insights, todayMealCard, foldSummary, WEIGHT_TARGET_TEXT, WEIGHT_RANGE_TEXT,
      exportMonthCsv, exportMonthMd, exportAll, previousMonth, exportMonthOptions, selectedExportMonth, exportOutputNote, refreshSettingsReadOnly, APP_VERSION, downloads: globalThis.testDownloads,
      weightAssessment, weightNumber, weightDeviation, weightOverview, fiveEntryWeightMean, weightMeanContent, weightHintContent, netWeightKg, weighInCheck, weighInField, WEIGH_IN_RANGE, lineChart, toDay, toIso, computeDarfAdjustment,
      setDraftToday: value => { draftToday = value; },
      draft: () => stoolDraft, setDraft: (draft, original = null) => { stoolDraft = draft; stoolOriginal = original; }, write, flushWrites, queuedWrites, saveDay, resyncIfPending, onResumeOrReconnect,
      pendingFlush: () => flushTask };
  `, context, { filename: htmlPath, timeout: 5000 });
  const { api } = context;
  api.S.user = { uid: 'ui-test-only', email: 'test.invalid' };
  api.S.days = JSON.parse(JSON.stringify(days));
  const dispatch = async (name, event) => { for (const callback of listeners.get(name) || []) await callback(event); };
  const click = (act, data = {}, id = '') => {
    const target = { id, dataset: { act, ...data }, disabled: false, querySelector: () => null, removeAttribute() {}, closest: selector => selector === '#feedback' ? null : target,
      focus() { document.activeElement = this; } };
    return dispatch('click', { target }).then(() => target);
  };
  return { api, storage, confirms, element, document, click, dispatch, timers, intervals, listeners, windowListeners, context };
}

test('dismissing a failed local save cannot clear its error or claim success', async () => {
  const h=makeHarness({dirty:true});
  h.api.storeError(Error('Storage unavailable'),'days:'+TODAY+':weight');
  h.api.bindSaveError('form:in-weight-'+TODAY,'days:'+TODAY+':weight');
  await h.click('dismiss-banner');
  assert.equal(h.api.S.localSaveError,'form:in-weight-'+TODAY);
  assert.equal(h.api.S.status,'Not saved');
  assert.equal(h.element('#state').className,'state bad');
  assert.equal(h.api.S.banner,null);
  assert.equal(h.storage.size,0,'dismissal creates no confirmed write');
});

test('dismissal acknowledges only instant-action failures and restores unscoped error status', async () => {
  for(const [status,cls] of [['Synced',''],['Saved locally; retry sync','warn']]){
    const h=makeHarness();h.api.setStatus(status,cls);
    h.api.storeError(Error('Storage unavailable'),'days:'+TODAY+':weightMissed');
    await h.click('dismiss-banner');
    assert.equal(h.api.S.localSaveError,null);
    assert.equal(h.api.S.status,status);
    h.api.storeError(Error('Unscoped validation failure'));
    await h.click('dismiss-banner');
    assert.equal(h.api.S.status,status);
    h.api.feedback();
    if(status.includes('retry sync'))assert.match(h.element('#feedback').innerHTML,/data-act="retrysync"/);
  }
  const h=makeHarness();h.api.setStatus('Synced');
  h.api.storeError(Error('Full'),'days:'+TODAY+':notes');
  h.api.bindSaveError('form:notes','days:'+TODAY+':notes');
  h.api.storeError(Error('Full'),'days:'+TODAY+':bcs');
  await h.click('dismiss-banner');
  assert.equal(h.api.S.localSaveError,'form:notes');
  assert.equal(h.api.S.status,'Not saved');
  h.api.clearSaveError('form:notes');
  assert.equal(h.api.S.status,'Synced');
});

test('dismissing sync details preserves pending status and a usable Retry action', async () => {
  const h=makeHarness();
  h.api.S.banner={source:'sync',kind:'warn',retry:true,title:'Sync pending',text:'Detailed failure'};
  h.api.setStatus('Saved locally; retry sync','warn');
  await h.click('dismiss-banner');
  h.api.feedback();
  assert.equal(h.api.S.status,'Saved locally; retry sync');
  assert.equal(h.element('#state').className,'state warn');
  assert.match(h.element('#feedback').innerHTML,/data-act="retrysync"/);
  assert.doesNotMatch(h.element('#feedback').innerHTML,/Detailed failure|dismiss-banner/);
});

test('dismissing ordinary notices preserves actual synced, connecting and offline status', async () => {
  for(const status of ['Synced','Connecting','Not connected','Offline · entries saved on this device']){
    const h=makeHarness();
    h.api.setStatus(status);
    h.api.S.banner={kind:'plain',title:'Notice',text:'Explanation'};
    await h.click('dismiss-banner');
    assert.equal(h.api.S.status,status);
    assert.equal(h.api.S.banner,null);
  }
});

test('independent failures keep Not saved until each entry is resolved, then restore the real base status', () => {
  for(const [status,cls] of [['Synced',''],['Saved locally; retry sync','warn'],['Offline · entries saved on this device','warn']]){
    const h=makeHarness();
    h.api.setStatus(status,cls);
    h.api.storeError(Error('Full'),'days:'+TODAY+':weight');
    h.api.bindSaveError('form:weight','days:'+TODAY+':weight');
    h.api.storeError(Error('Full'),'days:'+TODAY+':notes');
    h.api.bindSaveError('form:notes','days:'+TODAY+':notes');
    h.api.clearSaveError('form:notes');
    assert.equal(h.api.S.status,'Not saved');
    assert.equal(h.api.S.localSaveError,'form:weight');
    h.api.clearSaveError('form:weight');
    assert.equal(h.api.S.status,status);
    assert.equal(h.element('#state').className,'state '+cls);
    h.api.feedback();
    if(status.includes('retry sync'))assert.match(h.element('#feedback').innerHTML,/data-act="retrysync"/);
    assert.equal(h.storage.size,0,'feedback recovery never writes a record');
  }
});

test('two stool failures sharing an operation scope remain separate after binding to their entries', () => {
  const h=makeHarness(),scope='days:'+TODAY+'::stools';
  h.api.setStatus('Synced');
  h.api.storeError(Error('Full'),scope);h.api.bindSaveError('stool:first',scope);
  h.api.storeError(Error('Full'),scope);h.api.bindSaveError('stool:second',scope);
  h.api.clearSaveError('stool:second');assert.equal(h.api.S.status,'Not saved');
  h.api.clearSaveError('stool:first');assert.equal(h.api.S.status,'Synced');
  h.api.storeError(Error('Full'),scope);h.api.resetSaveFeedback();
  h.api.setStatus('Cached; checking sync');
  assert.equal(h.api.S.localSaveError,null);
  assert.equal(h.api.S.status,'Cached; checking sync','new account state cannot inherit prior failures');
});

test('stool rows expose Edit and Delete inline and keep the Undo focus target', () => {
  const h = makeHarness({ days: { [YESTERDAY]: { stools: [stool] } } });
  const card = h.api.stoolsCard(YESTERDAY);
  assert.match(card, new RegExp(`<button[^>]*id="stool-actions-${YESTERDAY}-s1"[^>]*data-act="editstool"`));
  assert.match(card, /data-act="delstool" data-date="2026-10-27" data-id="s1" aria-label="Delete stool at 07:30"/);
  assert.doesNotMatch(card, /<details id="stool-/, 'Edit and Delete are no longer behind an Actions disclosure');
});

test('a quick-log row starts an entry from each Bristol type and remains the Undo fallback target', () => {
  const h = makeHarness();
  const card = h.api.stoolsCard(TODAY);
  assert.match(card, new RegExp(`role="group" id="add-stool-${TODAY}" tabindex="-1"`));
  const types = [...card.matchAll(/data-act="openstool" data-date="2026-10-28" data-b="(\d)"/g)].map(match => Number(match[1]));
  assert.deepEqual(types, [1, 2, 3, 4, 5, 6, 7]);
});

test('tapping a quick-log type immediately saves the entry without requiring a separate save tap', async () => {
  const h = makeHarness();
  await h.click('openstool', { date: TODAY, b: '4' }, `quick-stool-${TODAY}-4`);
  const stools = h.api.S.days[TODAY]?.stools || [];
  assert.equal(stools.length, 1, 'stool entry was immediately saved');
  assert.equal(stools[0].bristol, 4);
  assert.equal(stools[0].time, '10:00', 'time defaults to now (London)');
  assert.equal(h.api.S.adding, null, 'no open draft remains');
  assert.match(h.api.viewToday(), /data-act="editstool"/, 'saved stool provides inline Edit');
  assert.match(h.api.viewToday(), /data-act="delstool"/, 'saved stool provides inline Delete');
  assert.deepEqual(h.confirms, []);
});

test('the entry form leads with the type, then flags, then time and date side by side', () => {
  const h = makeHarness();
  h.api.S.adding = TODAY;
  h.api.setDraft({ id: 's-new', time: '09:00', bristol: 4, mucus: false, blood: false });
  const card = h.api.stoolsCard(TODAY);
  assert.match(card, /data-stool data-date=/, 'draft protection markers are unchanged');
  const at = text => card.indexOf(text);
  assert.ok(at('data-act="stooltype"') < at('data-act="tog-mucus"'));
  assert.ok(at('data-act="tog-mucus"') < at('id="st-t"'));
  assert.ok(at('class="stool-when"') < at('id="st-t"') && at('id="st-t"') < at('id="st-date"'));
});

test("yesterday's bowl takes one tap on Today only when that meal was fed", () => {
  const prompt = /data-act="bowl" data-k="cleared" data-date="2026-10-27"/;
  const fed = makeHarness({ days: { [YESTERDAY]: { meal: fedMeal } } }).api.todoCard(TODAY);
  assert.match(fed, prompt);
  assert.doesNotMatch(fed, /data-act="jump" data-k="bowl"/, 'the prompt replaces the History link');
  const planned = makeHarness({ days: { [YESTERDAY]: { meal: { recipe: 'lamb' } } } }).api.todoCard(TODAY);
  assert.doesNotMatch(planned, prompt, 'a planned-only meal records its feeding time in History first');
  assert.match(planned, /data-act="jump" data-k="bowl"/);
  const done = makeHarness({ days: { [YESTERDAY]: { meal: { ...fedMeal, bowl: 'left' } } } }).api.todoCard(TODAY);
  assert.doesNotMatch(done, /data-act="bowl"|data-k="bowl"/);
});

test('the bowl prompt saves its result against yesterday through the durable outbox', async () => {
  const h = makeHarness({ days: { [YESTERDAY]: { meal: fedMeal } } });
  await h.click('bowl', { date: YESTERDAY, k: 'cleared' }, `bowl-prompt-${YESTERDAY}-cleared`);
  assert.equal(h.api.S.days[YESTERDAY].meal.bowl, 'cleared');
  assert.equal(h.api.S.days[YESTERDAY].meal.fedAt, '18:30', 'the fed snapshot is unchanged');
  const queued = [...h.storage.entries()].filter(([key]) => key.startsWith('murphy-outbox-v2:ui-test-only:'));
  assert.equal(queued.length, 1);
  assert.deepEqual(JSON.parse(queued[0][1]).patch.meal, { bowl: 'cleared' });
});

test('in-page and History shortcuts do not ask to discard drafts', async () => {
  const h = makeHarness({ dirty: true });
  await h.click('jump', { k: 'weight' });
  await h.click('jump', { k: 'stool' });
  assert.deepEqual(h.confirms, []);
  await h.click('jump', { k: 'bowl' });
  assert.equal(h.confirms.length, 0);
});

test('to-log shortcuts act on their own card date, including a recovered earlier day', async () => {
  const h = makeHarness();
  const card = h.api.todoCard(YESTERDAY);
  assert.match(card, /data-act="jump" data-k="weight" data-date="2026-10-27"/);
  await h.click('jump', { k: 'weight', date: YESTERDAY });
  assert.equal(h.document.activeElement.selector, '#in-weightsolo-2026-10-27', 'not the current London date');
});

for (const tab of ['today', 'day']) {
  test(`a stool saved to another date from ${tab === 'today' ? 'Today stays on Today and offers that date' : 'History follows the record'}`, async () => {
    const h = makeHarness({ days: { [TODAY]: {}, [YESTERDAY]: { stools: [stool] } } });
    h.api.S.tab = tab; h.api.S.cursor = TODAY; h.api.S.adding = TODAY;
    h.api.setDraft({ id: 's-new', time: '23:55', bristol: 5, mucus: false, blood: false });
    h.element('#st-t').value = '23:55';
    h.element('#st-date').value = YESTERDAY;
    await h.click('savestool');
    assert.deepEqual(h.api.S.days[YESTERDAY].stools.map(s => s.id), ['s1', 's-new']);
    assert.equal(h.api.S.tab, tab);
    if (tab === 'today') {
      assert.equal(h.api.S.banner.view, YESTERDAY);
      assert.match(h.api.S.banner.title, /Stool saved for Tue 27 Oct/);
    } else {
      assert.equal(h.api.S.cursor, YESTERDAY);
      assert.equal(h.api.S.banner, null);
    }
  });
}

test('saving without a type explains it beside the type buttons', async () => {
  const h = makeHarness();
  h.api.S.adding = TODAY;
  h.api.setDraft({ id: 's-new', time: '09:00', mucus: false, blood: false });
  await h.click('savestool');
  assert.equal(h.element('#st-error').textContent, 'Choose a Bristol type first.');
  assert.equal(h.api.S.status, 'Connecting', 'the top status line is not used for form validation');
});

test('Today leads with logging and folds the read-only assessment', () => {
  const h = makeHarness({ days: { [YESTERDAY]: { weight: 18.6, bcs: 5, meal: fedMeal } } });
  const page = h.api.viewToday();
  const todo = page.indexOf(`id="todo-${TODAY}"`), fold = page.indexOf(`<details class="card weight-condition" id="assessment-${TODAY}"`);
  assert.ok(todo > 0 && todo < fold && fold < page.indexOf(`data-stool-log="${TODAY}"`));
  assert.match(page, new RegExp(`data-weight-strip data-date="${TODAY}">18\\.60 kg · Within range · yesterday<br>BCS 5\\.0 · yesterday`));
  assert.match(page, new RegExp(`data-weight-summary="body" data-date="${TODAY}"`), 'the full assessment is one tap away');
});

// The meal card is the slice of Today between its section and the first optional fold.
const mealCardOf = page => page.slice(page.indexOf(`id="meal-section-${TODAY}"`), page.indexOf(`id="activity-${TODAY}"`));

test('Today orders logging, weigh-in with condition, tonight’s meal, then closed optional sections', () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish' } }, [YESTERDAY]: { meal: fedMeal } } });
  const page = h.api.viewToday();
  const order = [`id="todo-${TODAY}"`, `id="assessment-${TODAY}"`, `data-stool-log="${TODAY}"`, `id="in-weight-${TODAY}"`,
    `id="condition-${TODAY}"`, `id="meal-section-${TODAY}"`, `id="activity-${TODAY}"`, `id="treats-${TODAY}"`, `id="events-${TODAY}"`, `id="notes-${TODAY}"`];
  const at = order.map(text => page.indexOf(text));
  assert.ok(at.every(i => i > 0), 'every Today section is present');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections appear in the documented order');
  for (const kind of ['activity', 'treats', 'events', 'notes'])
    assert.match(page, new RegExp(`<details class="card today-fold" id="${kind}-${TODAY}"><summary`), `${kind} starts closed`);
  assert.match(page, /data-act="event" data-id="vomited"/, 'observations stay one tap from their summary');
  assert.match(page, new RegExp(`data-form data-date="${YESTERDAY}" data-key="activeMin"`), 'Tractive minutes remain saved against yesterday');
});

test('a planned meal shows its amounts directly above Mark as fed; switches wait under Change meal', () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish' } } } });
  const card = mealCardOf(h.api.viewToday());
  const at = text => card.indexOf(text);
  assert.ok(at('Fish · DARF Active') > 0 && at('Fish · DARF Active') < at('Bella &amp; Duke'));
  assert.ok(at('Bella &amp; Duke') < at('Salmon oil') && at('Salmon oil') < at('Pro-Fibre'));
  assert.ok(at('Pro-Fibre') < at(`id="meal-fed-action-${TODAY}"`), 'amounts precede the button');
  assert.match(card, />Mark as fed<\/button>/);
  assert.ok(at(`id="meal-fed-action-${TODAY}"`) < at(`id="meal-change-${TODAY}"`));
  assert.ok(at(`id="meal-change-${TODAY}"`) < at(`id="recipe-${TODAY}"`) && at(`id="recipe-${TODAY}"`) < at('data-act="extra"'),
    'recipe and ingredient switches are inside Change meal');
  assert.match(card, new RegExp(`<details class="meal-disclosure meal-change" id="meal-change-${TODAY}" ><summary>Change meal</summary>`), 'closed once a recipe is chosen');
  assert.doesNotMatch(card, /data-act="bowl"|data-act="unfeed"|data-key="darfFed"/, 'bowl and corrections wait until fed');
});

test('without a recipe, Change meal starts open and Mark as fed is withheld', () => {
  const card = mealCardOf(makeHarness().api.viewToday());
  assert.match(card, new RegExp(`id="meal-change-${TODAY}" open><summary>Change meal</summary>`));
  assert.doesNotMatch(card, /data-act="fed"/);
  assert.match(card, /Choose a recipe under Change meal/);
});

test('after feeding, Today shows the fed time, saved amounts and bowl; Undo Fed and grams sit under Edit meal', () => {
  const meal = { recipe: 'fish', fedAt: '18:20', darfFed: 165, darfPlanned: 160, oilMl: 4, fibreG: 2.5, oilGiven: true, fibreGiven: true, egg: false, broth: false };
  const card = mealCardOf(makeHarness({ days: { [TODAY]: { meal } } }).api.viewToday());
  const at = text => card.indexOf(text);
  assert.match(card, /Fish · DARF fed<\/span><strong>165 g<\/strong>/);
  assert.match(card, /<dt>DARF planned<\/dt><dd>160 g<\/dd>/, 'a differing plan stays visible');
  assert.match(card, /<dt>Salmon oil<\/dt><dd>4 ml<\/dd>.*<dt>Pro-Fibre<\/dt><dd>2\.5 g<\/dd>/s);
  assert.match(card, new RegExp(`id="meal-fed-status-${TODAY}" tabindex="-1">Fed at 18:20<`));
  assert.ok(at(`id="bowl-${TODAY}-cleared"`) > 0 && at(`id="bowl-${TODAY}-cleared"`) < at(`id="meal-change-${TODAY}"`));
  assert.match(card, /<summary>Edit meal<\/summary>/);
  for (const control of [`id="meal-unfeed-${TODAY}"`, `id="in-darfFed-${TODAY}"`, `id="meal-correction-${TODAY}"`])
    assert.ok(at(control) > at(`id="meal-change-${TODAY}"`), control + ' is under Edit meal');
  assert.doesNotMatch(card, /id="meal-fed-action-/);
});

test('Mark as fed records the time now and the shown DARF amount through the outbox', async () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish' } } } });
  const shown = Number(mealCardOf(h.api.viewToday()).match(/DARF Active<\/span><strong>(\d+) g/)[1]);
  await h.click('fed', { date: TODAY }, `meal-fed-action-${TODAY}`);
  assert.equal(h.api.S.days[TODAY].meal.fedAt, '10:00');
  assert.equal(h.api.S.days[TODAY].meal.darfFed, shown);
  assert.equal([...h.storage.keys()].filter(key => key.startsWith('murphy-outbox-v2:ui-test-only:')).length, 1);
});

test('Mark as fed saves exactly the amounts shown above it, including Bella & Duke, oil and fibre', async () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish' } } } });
  const card = mealCardOf(h.api.viewToday());
  const shown = label => card.match(new RegExp(`<dt>${label}</dt><dd>([\\d.]+) (?:g|ml)</dd>`))[1];
  assert.equal(shown('Bella &amp; Duke'), String(h.api.S.settings.bdGrams));
  const darf = Number(card.match(/DARF Active<\/span><strong>(\d+) g/)[1]);
  assert.doesNotMatch(card, /data-act="useplandarf"/, 'no retained amount, no notice');
  await h.click('fed', { date: TODAY }, `meal-fed-action-${TODAY}`);
  const saved = h.api.S.days[TODAY].meal;
  assert.deepEqual([saved.darfFed, saved.darfPlanned, String(saved.oilMl), String(saved.fibreG)], [darf, darf, shown('Salmon oil'), shown('Pro-Fibre')]);
});

test('the retained DARF amount is prominent before Mark as fed, and the plan can be recorded instead (CX-01, CC-02)', async () => {
  // Fish fed at 160 g, Undo Fed, then Lamb chosen: the earlier actual amount is retained.
  for (const amount of [160, 150, 0]) {
    const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'lamb', darfFed: amount } } } });
    let card = mealCardOf(h.api.viewToday());
    assert.match(card, new RegExp(`Lamb · DARF to record</span><strong>${amount} g</strong>`));
    const planned = Number(card.match(/<dt>DARF planned<\/dt><dd>(\d+) g/)[1]);
    assert.notEqual(planned, amount);
    const at = text => card.indexOf(text);
    assert.ok(at(`id="meal-fed-help-${TODAY}"`) < at(`id="meal-use-plan-${TODAY}"`) && at(`id="meal-use-plan-${TODAY}"`) < at(`id="meal-fed-action-${TODAY}"`), 'the explanation and plan choice precede the action');
    assert.match(card, new RegExp(`id="meal-fed-help-${TODAY}">Records the time now, the other amounts above and <b>${amount} g DARF</b> actually fed, saved earlier for this meal\\. The plan is ${planned} g\\.`));
    assert.match(card, new RegExp(`data-act="useplandarf" data-date="${TODAY}">Record the ${planned} g plan instead<`));
    await h.click('useplandarf', { date: TODAY }, `meal-use-plan-${TODAY}`);
    assert.equal(h.api.S.days[TODAY].meal.darfFed, undefined, 'only the retained amount is removed');
    assert.equal(h.api.S.days[TODAY].meal.recipe, 'lamb');
    card = mealCardOf(h.api.viewToday());
    assert.doesNotMatch(card, /data-act="useplandarf"/);
    assert.match(card, new RegExp(`DARF Active</span><strong>${planned} g</strong>`));
    await h.click('fed', { date: TODAY }, `meal-fed-action-${TODAY}`);
    assert.equal(h.api.S.days[TODAY].meal.darfFed, planned, 'Mark as fed now records the displayed plan');
    // Keeping the retained amount records exactly what the notice states.
    const kept = makeHarness({ days: { [TODAY]: { meal: { recipe: 'lamb', darfFed: amount } } } });
    await kept.click('fed', { date: TODAY }, `meal-fed-action-${TODAY}`);
    assert.equal(kept.api.S.days[TODAY].meal.darfFed, amount);
  }
  const over = makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish', darfFed: 160 } } } });
  over.api.S.settings = { ...over.api.S.settings, targetKcal: 1 };
  const overCard = mealCardOf(over.api.viewToday());
  assert.match(overCard, /DARF to record<\/span><strong>160 g<\/strong>/);
  assert.match(overCard, /<dt>DARF planned<\/dt><dd>0 g<\/dd>/);
  assert.match(overCard, /Other ingredients exceed the calorie target\. Planned DARF is 0 g\./);
});

test('fed supplements keep unknown inclusion visible for every amount (CX-02)', () => {
  const expected = {
    true: { 4: '4 ml', 0: '0 ml', null: 'Included' },
    false: { 4: 'Not given · 4 ml originally recorded', 0: 'Not given', null: 'Not given' },
    undefined: { 4: 'Inclusion not recorded · 4 ml originally recorded', 0: 'Inclusion not recorded · 0 ml originally recorded', null: 'Inclusion not recorded' },
  };
  for (const [flagKey, oilLabel, fibreFlag, fibreLabel] of [['oilGiven', 'Salmon oil', 'fibreGiven', 'Pro-Fibre']]) {
    for (const inclusion of [true, false, undefined]) for (const amount of [4, 0, null]) {
      const meal = { recipe: 'fish', fedAt: '18:20', darfFed: 160, darfPlanned: 160, oilMl: amount, fibreG: amount };
      if (inclusion !== undefined) { meal[flagKey] = inclusion; meal[fibreFlag] = inclusion; }
      const card = mealCardOf(makeHarness({ days: { [TODAY]: { meal } } }).api.viewToday());
      const text = expected[String(inclusion)][String(amount)];
      assert.match(card, new RegExp(`<dt>${oilLabel}</dt><dd>${text}</dd>`), `oil ${inclusion}/${amount}`);
      assert.match(card, new RegExp(`<dt>${fibreLabel}</dt><dd>${text.replace(/ ml/g, ' g')}</dd>`), `fibre ${inclusion}/${amount}`);
    }
  }
});

test('a recent supplement change is cautioned beside the amounts while Change meal is closed (AGY-02)', () => {
  for (const meal of [{ recipe: 'fish' }, { recipe: 'fish', fedAt: '18:20', darfFed: 160, darfPlanned: 160, oilMl: 4, fibreG: 2.5, oilGiven: true, fibreGiven: true }]) {
    const h = makeHarness({ days: { [TODAY]: { meal } } });
    h.api.S.settings = { ...h.api.S.settings, oilSchedule: [{ from: '2026-01-01', ml: 8 }, { from: '2026-10-25', ml: 4 }] };
    const card = mealCardOf(h.api.viewToday());
    const caution = card.indexOf('Fibre or oil changed on Sun 25 Oct. An extra now will muddy the read-out.');
    assert.ok(caution > card.indexOf('<dl class="meal-amounts">') && caution < card.indexOf(`id="meal-change-${TODAY}"`), (meal.fedAt ? 'fed' : 'planned') + ': visible above Change meal');
    assert.equal(card.split('Fibre or oil changed').length - 1, 1, 'shown once, not repeated inside Change meal');
  }
  const quiet = mealCardOf(makeHarness({ days: { [TODAY]: { meal: { recipe: 'fish' } } } }).api.viewToday());
  assert.doesNotMatch(quiet, /Fibre or oil changed/, 'no caution without a change in the past week');
});

test('section summaries are separated from their titles for assistive technology (AGY-05)', () => {
  const page = makeHarness().api.viewToday();
  for (const [kind, title] of [['activity', 'Activity'], ['treats', 'Treats'], ['events', 'Observations'], ['notes', 'Notes']])
    assert.match(page, new RegExp(`id="${kind}-${TODAY}"><summary class="sec">${title} <span class="fold-strip"`));
  assert.match(page, /<summary class="sec">Weight &amp; condition <span class="assessment-strip"/);
});

test('closed sections summarise what is recorded, with yesterday’s Tractive date and escaped notes', () => {
  const h = makeHarness({ days: {
    [TODAY]: { walkMin: 40, walkKm: 3.2, treats: 2, events: ['vomited', 'lethargic'], notes: '<b>Ate grass</b>\nsecond line' },
    [YESTERDAY]: { activeMin: 55 } } });
  assert.equal(h.api.foldSummary('activity', TODAY), 'Walked 40 min · 3.2 km · Tractive 27 Oct: 55 min');
  assert.equal(h.api.foldSummary('treats', TODAY), 'Dried necks and feet: 2');
  assert.equal(h.api.foldSummary('events', TODAY), '<span class="watch-text">Vomited · Lethargic</span>', 'recorded symptoms stand out (AGY-06)');
  assert.equal(h.api.foldSummary('notes', TODAY), '&lt;b&gt;Ate grass&lt;/b&gt;');
  const empty = makeHarness();
  assert.deepEqual(['activity', 'treats', 'events', 'notes'].map(kind => empty.api.foldSummary(kind, TODAY)),
    ['Not recorded', 'Not recorded', 'None recorded · Add observation', 'No notes']);
  assert.equal(makeHarness({ days: { [TODAY]: { treats: 0 } } }).api.foldSummary('treats', TODAY), 'Dried necks and feet: 0', 'zero is a recorded value');
});

test('Still to log includes tonight’s meal until it is marked as fed', async () => {
  const chip = /data-act="jump" data-k="meal" data-date="2026-10-28">([^<]+)</;
  assert.equal(makeHarness().api.todoCard(TODAY).match(chip)[1], 'tonight’s recipe not chosen');
  const ids = [...makeHarness().api.todoCard(TODAY).matchAll(/<button class="chip" id="([^"]+)" data-act="jump" data-k="(\w+)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(ids.map(([id, k]) => id === `todo-${TODAY}-${k}`), [true, true, true, true], 'every shortcut has a stable ID for focus restoration (CX-04)');
  assert.equal(makeHarness({ days: { [TODAY]: { meal: { recipe: 'lamb' } } } }).api.todoCard(TODAY).match(chip)[1], 'tonight’s meal not fed yet');
  const complete = makeHarness({ days: { [TODAY]: { stools: [stool], weight: 18.7, bcs: 5, meal: fedMeal } } }).api.todoCard(TODAY);
  assert.doesNotMatch(complete, chip);
  assert.match(complete, /Core observations recorded<\/b>Stools, weight and condition are recorded, and tonight’s meal is marked as fed\./);
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'lamb' } } } });
  await h.click('jump', { k: 'meal', date: TODAY });
  assert.equal(h.document.activeElement.selector, `#meal-section-${TODAY}`, 'the shortcut lands on the card, amounts first');
});

test('History keeps its complete day editor and states precisely what is recorded', () => {
  const h = makeHarness({ days: { [YESTERDAY]: { stools: [stool], weight: 18.7, bcs: 5 } } });
  h.api.S.cursor = YESTERDAY;
  const page = h.api.viewDay();
  assert.doesNotMatch(page, /today-fold|data-meal-brief|meal-change/);
  assert.match(page, new RegExp(`<section class="card sec" id="activity-${YESTERDAY}" tabindex="-1"`));
  assert.match(page, /<h3 class="lab">Evening Meal<\/h3>/);
  assert.match(page, /<b>Core observations recorded<\/b>Stools, weight and condition are recorded\./);
  h.api.S.cursor = TODAY;
  assert.match(h.api.viewDay(), /<b>Not yet recorded<\/b>no stool logged, no weight, no condition score/);
});

test('History chooses a date inline with the existing bounds and no dialog', () => {
  const h = makeHarness({ days: { '2026-09-10': {} } });
  h.api.S.cursor = YESTERDAY;
  const page = h.api.viewDay();
  assert.match(page, /<input class="date-overlay" id="history-date" type="date" data-act="historydate" required min="2026-09-07" max="2026-10-28" value="2026-10-27"/);
  assert.doesNotMatch(html, /<dialog|history-picker/);
});

test('Escape cancels a draft field; Return in the stool time saves through the Save control', async () => {
  const h = makeHarness();
  const key = (name, target) => ({ key: name, isComposing: false, preventDefault() { this.prevented = true; }, target });
  // Escape restores the saved value and clears the draft marker.
  const attributes = new Set(['data-dirty']), confirmRow = { removed: false, remove() { this.removed = true; } };
  const field = { id: 'in-treats-' + TODAY, dataset: {}, value: '3', defaultValue: '1', setCustomValidity() {}, removeAttribute() {},
    matches: selector => selector === 'input', closest: selector => selector === '[data-form]' ? form : null };
  const form = { dataset: { key: 'treats', date: TODAY }, hasAttribute: name => attributes.has(name), removeAttribute: name => attributes.delete(name),
    querySelector: selector => selector === 'input,textarea' ? field : selector === '[data-confirm]' ? confirmRow : null };
  h.document.activeElement = field;
  const escape = key('Escape', field);
  await h.dispatch('keydown', escape);
  assert.equal(escape.prevented, true);
  assert.equal(field.value, '1');
  assert.equal(attributes.has('data-dirty'), false);
  assert.equal(confirmRow.removed, true);
  // Return in the stool time field uses the stool Save control (and its validation).
  const save = h.element('#main [data-act="savestool"]'); let saved = 0; save.click = () => saved++;
  const time = { id: 'st-t', matches: selector => selector === '#st-t,#st-date', closest: () => null };
  await h.dispatch('keydown', key('Enter', time));
  assert.equal(saved, 1);
});

test('weight target labels use the 19 kg centre and absolute 0.5 kg tolerance throughout the app', () => {
  const h = makeHarness();
  assert.equal(h.api.WEIGHT_TARGET_TEXT, '19 kg ±0.5 kg');
  assert.equal(h.api.WEIGHT_RANGE_TEXT, '18.5–19.5 kg');
  assert.doesNotMatch(html, /18\.70|18\.513|18\.887|tolerancePct/);
  h.api.S.cursor = TODAY;
  for (const markup of [h.api.viewToday(), h.api.viewDay(), h.api.viewReview(), h.api.weightHintContent(TODAY)]) {
    assert.ok(markup.includes(h.api.WEIGHT_TARGET_TEXT));
    assert.ok(markup.includes(h.api.WEIGHT_RANGE_TEXT));
  }
  assert.ok(h.api.viewSettings().includes(`The fixed ${h.api.WEIGHT_TARGET_TEXT} target range is assessed separately.`));
});

test('decimal target configurations keep clean labels and inclusive bounds without rounding readings', () => {
  for (const [kg, toleranceKg, lower, upper] of [[18.6, .3, 18.3, 18.9], [19.2, .1, 19.1, 19.3], [18.7, .187, 18.513, 18.887]]) {
    // Exercise the real module with alternate fixed constants, not a copied calculation.
    const source = moduleSource.replace('Object.freeze({kg:19,toleranceKg:.5,', `Object.freeze({kg:${kg},toleranceKg:${toleranceKg},`);
    assert.notEqual(source, moduleSource, 'the test must replace the fixed target');
    const { api } = makeHarness({ source });
    assert.equal(api.WEIGHT_TARGET_TEXT, `${kg} kg ±${toleranceKg} kg`);
    assert.equal(api.WEIGHT_RANGE_TEXT, `${lower}–${upper} kg`);
    for (const [reading, expected] of [[lower - .000001, 'below'], [lower, 'within'], [kg, 'within'], [upper, 'within'], [upper + .000001, 'above']]) {
      assert.equal(api.weightAssessment(reading).status, expected, `${kg} ±${toleranceKg}: ${reading}`);
      assert.equal(api.weightAssessment(Number(api.weightNumber(reading))).status, expected, 'display precision preserves the status');
    }
  }
});

test('weight classification includes both boundaries without rounding outside readings into range', () => {
  const { api } = makeHarness();
  for (const [kg, status] of [[18.49, 'below'], [18.499, 'below'], [18.5, 'within'], [18.7, 'within'],
    [19, 'within'], [19.5, 'within'], [19.501, 'above'], [19.51, 'above']]) {
    assert.equal(api.weightAssessment(kg).status, status, `${kg} kg`);
    assert.equal(api.weightAssessment(Number(api.weightNumber(kg))).status, status, `displayed ${kg} kg`);
  }
  for (const kg of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(api.weightAssessment(kg).status, 'missing');
  assert.equal(api.weightDeviation(19), '0.00 kg (0.00%) from target');
  assert.equal(api.weightDeviation(19.5), '+0.50 kg (+2.63%) from target');
  assert.equal(api.weightDeviation(18.5), '−0.50 kg (−2.63%) from target');
});

test('weigh-in by difference rounds the subtraction to 2 dp, free of IEEE 754 artefacts', () => {
  const { api } = makeHarness();
  assert.notEqual(102.4 - 83.85, 18.55, 'the raw JavaScript subtraction carries an artefact (18.55000000000001)');
  assert.equal(api.netWeightKg(83.85, 102.4), 18.55);
  assert.deepEqual({ ...api.weighInCheck('83.85', '102.4') }, { kg: 18.55, empty: false, problem: null });
  // Further pairs whose raw difference is not the exact 2 dp value.
  for (const [solo, combined, kg] of [[70.1, 88.8, 18.7], [80.3, 99.75, 19.45], [64.07, 83.03, 18.96], [90.9, 110, 19.1], [75.33, 94.78, 19.45]]) {
    assert.equal(api.netWeightKg(solo, combined), kg, `${combined} − ${solo}`);
    assert.equal(api.weighInCheck(String(solo), String(combined)).kg, kg);
  }
  // Every 2 dp pair in a realistic band subtracts to its exact 2 dp result.
  for (let s = 6000; s <= 6100; s += 7) for (let n = 1000; n <= 3000; n += 13) {
    const solo = s / 100, combined = Number(((s + n) / 100).toFixed(2));
    assert.equal(api.netWeightKg(solo, combined), n / 100, `${combined} − ${solo}`);
  }
  assert.equal(api.weighInCheck(' 83.85 ', '102.40').kg, 18.55, 'whitespace and trailing zeros are harmless');
  assert.equal(api.weighInCheck('83.850', '102.4').kg, 18.55, 'trailing zeros are not extra precision');
  assert.equal(api.weighInCheck('83.', '102.4').kg, 19.4, 'a trailing point is a whole number');
  // At the 500 kg reading cap, every 2 dp pair still subtracts exactly.
  for (let s = 47000; s <= 48000; s += 3) for (let n = 1000; n <= 3000; n += 17) {
    const solo = s / 100, combined = Number(((s + n) / 100).toFixed(2));
    if (combined > 500) continue;
    assert.equal(api.weighInCheck(String(solo), String(combined)).kg, n / 100, `${combined} − ${solo}`);
  }
});

test('weigh-in validation blocks empty, non-numeric, non-positive, inverted and out-of-range readings', () => {
  const { api } = makeHarness();
  const problem = (solo, combined, bad) => { const r = api.weighInCheck(solo, combined, bad); assert.equal(r.kg, null, `${solo} / ${combined}`); return r.problem; };
  // Incomplete
  assert.equal(problem('', '').part, 'solo');
  assert.equal(problem('', '102.4').part, 'solo');
  assert.equal(problem('83.85', '').part, 'combined');
  assert.equal(problem(null, undefined).part, 'solo');
  assert.equal(api.weighInCheck('83.85', '').empty, true, 'one empty reading is incomplete, not invalid');
  assert.match(problem('83.85', '').message, /combined weight holding Murphy/);
  // NaN, zero and negatives
  for (const bad of ['abc', 'NaN', '0', '-5', 'Infinity']) {
    assert.equal(problem(bad, '102.4').part, 'solo', `solo ${bad}`);
    assert.equal(problem('83.85', bad).part, 'combined', `combined ${bad}`);
  }
  assert.match(problem('0', '102.4').message, /above zero/);
  // Readings are text exactly as typed, so nothing a keyboard sends is dropped.
  assert.match(problem('e', '102.4').message, /^Your weight: enter plain kilograms/);
  assert.match(problem('83.85', ',').message, /^The combined weight: enter plain kilograms/);
  for (const text of ['1,2,3', '83,85.1', '83.85.1', '+83.85']) assert.match(problem(text, '102.4').message, /plain kilograms/, text);
  // One decimal comma reads as a point, for keypads that show a comma.
  assert.equal(api.weighInCheck('83,85', '102,4').kg, 18.55);
  assert.equal(api.weighInCheck(' 83,850 ', '102,40').kg, 18.55);
  assert.match(problem('83,855', '102.4').message, /two decimal places/);
  // Codex: a native number field turned '8,5' into '85' and saved 17.4 kg; it now reads 8.5.
  assert.match(problem('8,5', '102.4').message, /^That makes Murphy 93\.90 kg/);
  // More than two decimal places
  assert.match(problem('83.855', '102.4').message, /two decimal places/);
  // Combined must be strictly greater than solo
  for (const [solo, combined] of [['83.85', '83.85'], ['102.4', '83.85'], ['83.85', '83.84']]) {
    const p = problem(solo, combined);
    assert.equal(p.part, 'combined');
    assert.equal(p.message, 'The combined weight must be more than your weight alone.');
  }
  // Murphy's net weight keeps the single field's former 10–30 kg bounds
  assert.deepEqual({ ...api.WEIGH_IN_RANGE }, { minKg: 10, maxKg: 30, maxReadingKg: 500 });
  assert.match(problem('83.85', '88.85').message, /That makes Murphy 5\.00 kg, outside 10–30 kg/);
  assert.equal(problem('50', '80.01').part, 'combined');
  assert.equal(api.weighInCheck('50', '60').kg, 10, 'lower bound inclusive');
  assert.equal(api.weighInCheck('50', '80').kg, 30, 'upper bound inclusive');
  // Precision is read from the typed digits: no tolerance lets extra digits through.
  for (const solo of ['83.850000001', '83.8500001', '0.000000001', '83.851']) {
    assert.match(problem(solo, '102.4').message, /^Your weight: use up to two decimal places\.$/, solo);
  }
  // Exponent notation is never a plain kilogram reading, however small or large.
  for (const solo of ['1e-9', '1e2', '8.385E1']) assert.match(problem(solo, '102.4').message, /plain kilograms/, solo);
  assert.match(problem('83.85', '1e17').message, /^The combined weight: enter plain kilograms/);
  // Readings above the cap never reach the subtraction (1e17 + 9 would round to 1e17 + 16).
  assert.equal(problem('100000000000000000', '100000000000000009').message, 'Your weight must be at most 500 kg.');
  assert.equal(problem('480', '500.01').message, 'The combined weight must be at most 500 kg.');
  assert.equal(api.weighInCheck('480', '500').kg, 20, 'a 500 kg reading is allowed');
});

test('weigh-in field: two iPhone decimal inputs, one hidden net value and no stored readings', () => {
  const h = makeHarness({ days: { [TODAY]: { weight: 18.7, bcs: 5 }, [YESTERDAY]: { weight: 18.6, weightMissed: true } } });
  const html = h.api.weighInField(TODAY);
  for (const part of ['solo', 'combined']) {
    const input = html.match(new RegExp(`<input id="in-weight${part}-${TODAY}"[^>]*>`))[0];
    assert.match(input, /type="text"/); assert.match(input, /inputmode="decimal"/); assert.doesNotMatch(input, /step=|min=/);
    assert.match(input, /autocorrect="off"/); assert.match(input, /spellcheck="false"/);
    assert.doesNotMatch(input, /value=/, 'readings always start empty; they are never stored');
  }
  assert.match(html, new RegExp(`<label for="in-weightsolo-${TODAY}">Your weight \\(solo\\), kg</label>`));
  assert.match(html, new RegExp(`<label for="in-weightcombined-${TODAY}">Combined weight \\(holding Murphy\\), kg</label>`));
  // The first input in the form is still the single saved value the draft and save paths read.
  assert.match(html, new RegExp(`^<div data-form data-date="${TODAY}" data-key="weight"[^>]*>\\s*<input id="in-weight-${TODAY}" type="number" step="any" value="18.7" hidden >`));
  assert.match(html, /data-weigh-result data-state="idle">Saved 18\.70 kg · weigh again to replace it\.<\/output>/);
  assert.match(h.api.weighInField('2026-10-20'), /Before feeding: weigh alone, then holding Murphy\./);
  const missed = h.api.weighInField(YESTERDAY);
  assert.equal((missed.match(/ disabled /g) || []).length, 2, 'both readings are locked while Weight missed is on');
  assert.match(missed, new RegExp(`<input id="in-weight-${YESTERDAY}" type="number" step="any" value="" hidden disabled>`));
  // Both Today and History editors use it.
  assert.match(h.api.viewToday(), new RegExp(`id="in-weightcombined-${TODAY}"`));
  h.api.S.cursor = TODAY;
  assert.match(h.api.viewDay(), new RegExp(`id="in-weightcombined-${TODAY}"`));
  assert.match(css, /\.field input\{[^}]*font-size:max\(16px,/, 'inputs never trigger iOS focus zoom');
  assert.match(css, /input,select,\.btn\{min-height:44px\}/);
});

test('rolling means and History use the new band while missing weights stay excluded', () => {
  for (const kg of [18.5, 19.5]) {
    const h = makeHarness({ days: {
      '2026-10-25': { weight: 0 },
      '2026-10-26': { weight: 30, weightMissed: true },
      [YESTERDAY]: { weight: kg - .1, bcs: 5 },
      [TODAY]: { weight: kg + .1, bcs: 5 },
    } });
    const mean = h.api.weightOverview(TODAY).mean;
    assert.equal(mean.n, 2);
    assert.ok(Math.abs(mean.mean - kg) < 1e-12);
    assert.match(h.api.weightMeanContent(mean), /data-weight-status="within"/);
  }
  const h = makeHarness({ days: { [TODAY]: { weight: 19, bcs: 5 } } });
  const before = JSON.stringify(h.api.S.days);
  assert.match(h.api.viewHistory(), /19\.00 kg<\/span> <span class="diary-flags" data-weight-status="within">Within range/);
  h.api.viewToday(); h.api.viewReview(); h.api.viewSettings();
  h.api.exportAll();
  const backup = JSON.parse(h.api.downloads.at(-1)[1]);
  assert.equal(backup.days[TODAY].weight, 19);
  assert.equal(backup.days[TODAY].bcs, 5);
  assert.equal(JSON.stringify(h.api.S.days), before);
  assert.equal(h.storage.size, 0, 'assessment and exports do not write records or queue Firebase changes');
});

test('weight chart includes the full target band and correctly flags daily and weekly values', () => {
  const { api } = makeHarness();
  const pts = [18.49, 18.5, 19, 19.5, 19.51].map((y, i) => ({ x: api.toDay('2026-10-19') + i, y }));
  const chart = api.lineChart(pts, 'kg');
  assert.match(chart, /Shaded band: 18\.5–19\.5 kg\. Short horizontal dashes: 19 kg target/);
  assert.equal((chart.match(/class="chart-point weight-outside"/g) || []).length, 2);
  assert.match(chart, /Square markers: outside range \(2 readings\)/);
  assert.match(chart, /<td>19\.00<\/td><td>5<\/td><td>Within range<\/td>/);
  // A single reading at the centre must still leave both band boundaries visible.
  for (const markup of [chart, api.lineChart([{ x: pts[0].x, y: 19 }], 'kg')]) {
    const band = markup.match(/class="weight-target-band" x="0" y="([\d.]+)" width="100" height="([\d.]+)"/);
    assert.ok(band && Number(band[1]) >= 0 && Number(band[2]) > 0 && Number(band[1]) + Number(band[2]) <= 100);
    assert.doesNotMatch(markup, /NaN|Infinity/);
  }
});

test('the wider monitoring band does not change the weekly ration rule or BCS reduction hold', () => {
  const { api } = makeHarness();
  const weights = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, '0')}`, kg: i < 7 ? 18.8 : 19.1 }));
  assert.equal(api.weightAssessment(19.1).status, 'within');
  const args = { weights, asOf: TODAY, settings: api.S.settings };
  assert.equal(api.S.settings.deadbandPct, 1);
  assert.ok(api.computeDarfAdjustment({ ...args, bcs7dMean: 5.5 }).adjustmentG < 0, 'weekly gain is still assessed independently');
  assert.equal(api.computeDarfAdjustment({ ...args, bcs7dMean: 5 }).adjustmentG, 0, 'ideal BCS still holds reductions');
});

test('recorded symptoms stay distinct from the empty summary when forced colours drop the warning colour (AGY-07)', () => {
  assert.match(css, /\.fold-strip \.watch-text\{font-weight:650\}/);
  assert.match(css, /\.assessment-strip,\.fold-strip\{[^}]*font-weight:500/);
});

test('fields never render below 16px, so iOS does not zoom on focus at any text size', () => {
  assert.match(css, /input,select,textarea\{font-size:max\(16px,1rem\)\}/);
  assert.match(css, /\.tin\{[^}]*font-size:max\(16px,1rem\)/);
  assert.match(css, /\.field input\{[^}]*font-size:max\(16px,1\.0625rem\)/);
});

test('recovered Today shortcuts use the displayed draft day rather than the current day', async () => {
  const h = makeHarness({dirty:true});
  h.api.setDraftToday('2026-10-26');
  await h.click('jump',{k:'weight',date:'2026-10-26'});
  assert.equal(h.document.activeElement.selector,'#in-weightsolo-2026-10-26');
  await h.click('jump',{k:'bowl',date:'2026-10-26'});
  assert.equal(h.api.S.cursor,'2026-10-25');
});

for(const [now,expected] of [['2027-01-01T12:00:00Z','2026-12'],['2024-03-01T12:00:00Z','2024-02'],['2026-11-01T12:00:00Z','2026-10']]) {
  test(`last-month export selects ${expected} at ${now.slice(0,10)}`,()=>{
    assert.equal(makeHarness({now}).api.previousMonth(),expected);
  });
}

test('last-month CSV and Markdown export only the completed month, retaining this-month defaults', async()=>{
  const h=makeHarness({days:{'2026-09-30':{notes:'last-month-note',stools:[stool]},[TODAY]:{notes:'current-month-note'}}});
  await h.click('exportmonth',{month:'previous'});
  assert.equal(h.api.downloads[0][0],'Murphy_Log_2026-09.csv');
  assert.match(h.api.downloads[0][1],/last-month-note/);
  assert.doesNotMatch(h.api.downloads[0][1],/current-month-note/);
  h.timers.shift()();
  assert.equal(h.api.downloads[1][0],'Murphy_Log_2026-09_stools.csv');
  assert.match(h.api.downloads[1][1],/2026-09-30,07:30,4/);
  await h.click('exportmd',{month:'previous'});
  assert.equal(h.api.downloads[2][0],'Murphy_Log_2026-09.md');
  assert.match(h.api.downloads[2][1],/September|Sept/);
  assert.match(h.api.downloads[2][1],/last-month-note/);
  assert.doesNotMatch(h.api.downloads[2][1],/current-month-note/);
  await h.click('exportmonth');
  assert.equal(h.api.downloads[3][0],'Murphy_Log_2026-10.csv');
  await h.click('exportmd');
  assert.equal(h.api.downloads[4][0],'Murphy_Log_2026-10.md');
});

test('tab bar exposes the four primary destinations and normalizes legacy routes', () => {
  const tabMatches = [...html.matchAll(/<nav[^>]*id="tabbar"[\s\S]*?<\/nav>/g)][0][0];
  const tabs = [...tabMatches.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['today', 'history', 'review', 'settings']);
  const h = makeHarness();
  assert.equal(h.api.normalizeTab('today'), 'today');
  assert.equal(h.api.normalizeTab('history'), 'history');
  assert.equal(h.api.normalizeTab('day'), 'day');
  assert.equal(h.api.normalizeTab('status'), 'review');
  assert.equal(h.api.normalizeTab('review'), 'review');
  assert.equal(h.api.normalizeTab('more'), 'settings');
  assert.equal(h.api.normalizeTab('settings'), 'settings');
  assert.equal(h.api.normalizeTab('unknown'), 'today');
  assert.equal(h.api.navDestination('day'), 'history');
  assert.equal(h.api.navDestination('history'), 'history');
});

test('History renders stacked daily summaries with preceding confirmed meals, tomorrow preview and All-range future records', async () => {
  const h = makeHarness({
    days: {
      '2026-10-26': { meal: { recipe: 'beef', fedAt: '18:10', darfFed: 145, darfPlanned: 145, bowl: 'cleared' } },
      [YESTERDAY]: {
        stools: [
          { id: 's1', time: '07:20', bristol: 3, mucus: false, blood: false },
          { id: 's2', time: '14:40', bristol: 6, mucus: true, blood: true },
        ],
        weight: 19.1,
        bcs: 5.5,
        events: ['vomited'],
        meal: { recipe: 'chicken', darfPlanned: 150 }, // unfed plan must not appear as Today's confirmed meal
      },
      [TODAY]: {
        weightMissed: true,
        meal: { recipe: 'lamb', fedAt: '18:45', darfFed: 140, darfPlanned: 140, bowl: 'left' },
      },
      '2026-12-05': { notes: 'Imported future date mistake' },
    },
  });
  assert.doesNotMatch(html, /class="log-table"/);
  const list14 = h.api.viewHistory();
  assert.match(list14, /id="open-day-2026-10-27"/);
  assert.match(list14, /2 stools · Types 3–6/);
  assert.match(list14, /<strong class="flag-blood">Blood<\/strong> · <strong class="flag-mucus">Mucus<\/strong>/);
  assert.match(list14, /19\.10 kg/);
  assert.match(list14, /BCS 5\.5/);
  assert.match(list14, /Observations: <strong class="watch-text">Vomited<\/strong>/);
  assert.match(list14, /Preceding meal · 26 Oct 2026 at 18:10/);
  assert.match(list14, /Beef · 145 g DARF · Bowl: Cleared/);
  // Today's preceding meal was unfed on 27 Oct, so Today shows Not recorded as fed.
  assert.match(list14, /Preceding meal \(27 Oct 2026\): Not recorded as fed/);
  // Today's meal IS fed, so 29 Oct appears as non-opening tomorrow preview.
  assert.match(list14, /Tomorrow’s tracking/);
  assert.doesNotMatch(list14, /id="open-day-2026-10-29"/);
  assert.doesNotMatch(list14, /id="open-day-2026-12-05"/);

  h.api.S.range = 9999;
  const listAll = h.api.viewHistory();
  assert.match(listAll, /id="open-day-2026-12-05"/);

  h.api.S.cursor = YESTERDAY;
  h.api.S.tab = 'day';
  const dayHtml = h.api.viewDay();
  assert.match(dayHtml, /id="history-back" data-act="historylist">← All days<\/button>/);
  await h.click('historylist');
  assert.equal(h.api.S.tab, 'history');
  assert.equal(h.document.activeElement.selector, `#open-day-${YESTERDAY}`);
  // Returning from day editor via tabbar navigation (no explicit target) restores the same card (CC-D2)
  h.api.S.tab = 'day';
  h.api.navigateTo('history');
  assert.equal(h.api.S.tab, 'history');
  assert.equal(h.document.activeElement.selector, `#open-day-${YESTERDAY}`);
  // Navigating to History from Today starts at the screen heading rather than jumping to a stale cursor
  h.api.S.tab = 'today';
  h.api.navigateTo('history');
  assert.equal(h.document.activeElement.selector, '#main h2.screen');
  assert.equal(h.storage.size, 0, 'opening and returning from day editor creates no writes');
});

test('Review leads with actionable advice, shows years on all alerts and preserves accessible chart tables', () => {
  const days = {
    '2025-12-30': { stools: [{ id: 'old1', time: '08:00', bristol: 7, mucus: false, blood: true }], weight: 18.4, bcs: 5 },
    '2026-01-02': { stools: [{ id: 'jan1', time: '08:30', bristol: 7, mucus: true, blood: true }], weight: 19.2, bcs: 5 },
  };
  for (let d = 12; d <= 18; d++) days[`2026-10-${d}`] = { weight: 18.6, bcs: 5.5, stools: [{ id: 'a' + d, time: '08:00', bristol: 4, mucus: false, blood: false }], meal: { ...fedMeal, bowl: 'cleared' } };
  for (let d = 19; d <= 25; d++) days[`2026-10-${d}`] = { weight: 19.1, bcs: 5.5, stools: [{ id: 'b' + d, time: '08:00', bristol: 6, mucus: true, blood: false }], meal: { ...fedMeal, bowl: 'cleared' } };
  for (let d = 26; d <= 28; d++) days[`2026-10-${d}`] = { weight: 19.1, bcs: 5.5, stools: [{ id: 'c' + d, time: '08:00', bristol: 6, mucus: true, blood: d === 28 }], meal: { ...fedMeal, bowl: 'cleared' } };
  const h = makeHarness({ days });

  assert.equal(h.api.formatAlertDates(['2025-12-30', '2026-01-02'], TODAY), 'Historical · 30 Dec 2025, 2 Jan 2026');
  assert.equal(h.api.formatAlertDates(['2025-12-30', '2026-10-28'], TODAY), '30 Dec 2025, 28 Oct 2026');
  const todayHtml = h.api.viewToday();
  assert.match(todayHtml, /data-act="go" data-tab="review">Open Review<\/button>/);
  assert.match(todayHtml, /Blood recorded \(latest 28 Oct 2026 · 3 dates\)/);

  const reviewHtml = h.api.viewReview();
  const applyIdx = reviewHtml.indexOf('data-act="applyadv"');
  const detailsIdx = reviewHtml.indexOf('id="review-ration-details"');
  const trendsIdx = reviewHtml.indexOf('id="review-trends"');
  const compIdx = reviewHtml.indexOf('id="review-comparisons"');
  assert.ok(applyIdx > 0 && applyIdx < detailsIdx, 'actionable ration Apply button precedes explanation disclosure');
  assert.ok(detailsIdx < trendsIdx && trendsIdx < compIdx, 'advice precedes optional trends and comparisons disclosures');
  assert.match(reviewHtml, /30 Dec 2025, 2 Jan 2026, 28 Oct 2026/);
  assert.match(reviewHtml, /data-act="refuseadv">Keep current ration this week<\/button>/);
  assert.match(reviewHtml, /Current DARF adjustment/);
  assert.match(reviewHtml, /Oil changes adjust the base ration, not this adjustment\./);
  assert.match(reviewHtml, /id="trend-range-note">Applies to History and Review\.<\/p>/);
  assert.match(reviewHtml, /id="comp-range-note">Applies to History and Review\.<\/p>/);
  assert.equal(
    h.api.rationAlertDateText(h.api.weeklyAdvice(), ['2026-10-20']),
    'Diet or routine changed 20 Oct 2026 · windows 12 Oct 2026 to 25 Oct 2026'
  );
  assert.match(reviewHtml, /19 Oct 2026 to 25 Oct 2026/);
  assert.match(reviewHtml, /12 Oct 2026 to 18 Oct 2026/);
  for (const tableId of [
    'chart-values-weight',
    'chart-values-weight-weekly-average',
    'chart-values-condition',
    'chart-values-condition-weekly-average',
    'chart-values-stool',
  ]) {
    assert.match(reviewHtml, new RegExp(`id="${tableId}"`), `preserves accessible chart table #${tableId}`);
  }
  assert.equal(h.storage.size, 0, 'rendering Review creates no writes');
});

test('Today alert banners use actual current date on recovered drafts and keep multi-date blood summaries compact (CX-D1, CC-D1, CC-D3)', () => {
  const days = {
    // 30 July 2026 is 94 days before 1 Nov 2026 (> vetWindowDays=90 -> Historical),
    // whereas against 20 Oct 2026 it would be 82 days (within 90 days -> current).
    '2026-07-30': { stools: [{ id: 'b-jul30', time: '08:00', bristol: 4, mucus: false, blood: true }] },
  };
  for (let d = 17; d <= 31; d++) {
    const iso = `2026-10-${d}`;
    days[iso] = { stools: [{ id: 'clean-' + d, time: '08:00', bristol: 4, mucus: false, blood: false }] };
  }
  const h = makeHarness({ now: '2026-11-01T12:00:00Z', days });
  h.api.S.settings = { ...h.api.S.settings, fibreSchedule: [{ from: '2026-10-16', g: 2.5 }] };
  h.api.setDraftToday('2026-10-20');

  const todayHtml = h.api.viewToday();
  // Draft date is preserved for screen heading and logging controls:
  assert.match(todayHtml, /<span class="moment">Unfinished entries<\/span><h2 class="screen">Tue 20 Oct<\/h2>/);
  assert.match(todayHtml, /data-todo="2026-10-20"/);
  // Current advice & vet historical classification use localToday() (1 Nov 2026), not 20 Oct 2026, with clean punctuation:
  assert.match(todayHtml, /<b>Pro-Fibre · 1 Nov 2026 · dose since 16 Oct 2026<\/b>15 clean days\. Step Pro-Fibre from 2\.5 g to 5 g\. <button/);
  assert.doesNotMatch(todayHtml, /Pro-Fibre · 20 Oct 2026|\.\s*\(dose since/);
  // CR-02: a vet item whose dates are all outside the vet window stays in Review
  // but no longer raises Today's banner; one inside the window still does.
  assert.doesNotMatch(todayHtml, /Blood recorded/);
  assert.match(h.api.viewReview(), /Blood recorded/);
  h.api.S.days = { ...h.api.S.days, '2026-10-30': { stools: [{ id: 'b-oct30', time: '08:00', bristol: 4, mucus: false, blood: true }] } };
  assert.match(h.api.viewToday(), /Blood recorded \(latest 30 Oct 2026 · 2 dates\)/);
  h.api.S.days = days;

  // 10 historical blood dates summarize to latest + count on Today while Review keeps all 10 dates:
  const blood10 = ['2025-11-01', '2025-12-01', '2025-12-31', '2026-01-30', '2026-03-01', '2026-03-31', '2026-04-30', '2026-05-30', '2026-06-29', '2026-07-29'];
  assert.equal(
    h.api.formatVetAlertHeadline({ title: 'Blood recorded', dates: blood10 }, '2026-11-01'),
    'Blood recorded (Historical · latest 29 July 2026 · 10 dates)'
  );
  const fullReviewDates = h.api.formatAlertDates(blood10, '2026-11-01');
  assert.match(fullReviewDates, /^Historical · 1 Nov 2025, 1 Dec 2025, .*29 July 2026$/);
  assert.equal(fullReviewDates.split(', ').length, 10);
});

test('release identifiers stay aligned across HTML shell, module and service worker', () => {
  const swSource = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  const htmlVer = html.match(/<html[^>]*data-version="([^"]+)"/)?.[1];
  const swVer = swSource.match(/const VERSION = '([^']+)'/)?.[1];
  const h = makeHarness();
  assert.equal(htmlVer, '3.12.1');
  assert.equal(h.api.APP_VERSION, htmlVer);
  assert.equal(swVer, htmlVer);
});

test('Settings groups Account, Appearance, Feeding plan, Backup & export, and Advanced without adding import preview', () => {
  const h = makeHarness({
    now: '2026-11-01T12:00:00Z',
    days: { '2026-10-20': { notes: 'Oct entry' } },
  });
  h.api.S.settings = {
    ...h.api.S.settings,
    regimeChanges: ['2026-10-15'],
  };
  h.api.S.changes = [{ id: 'chg-1', date: '2026-10-12', deltaG: -5, source: 'rule' }];

  const out = h.api.viewSettings();
  const ids = ['settings-account', 'settings-appearance', 'settings-feeding-plan', 'settings-backup-export', 'settings-advanced'];
  const indices = ids.map(id => out.indexOf(`id="${id}"`));
  assert.ok(indices.every(i => i > 0), 'all five Settings groups render with stable IDs');
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i - 1] < indices[i], `${ids[i - 1]} precedes ${ids[i]}`);
  }

  const advStart = indices[4];
  const beforeAdv = out.slice(0, advStart);
  const insideAdv = out.slice(advStart);

  // Everyday ration inputs stay directly accessible in Feeding plan; detailed constants live under Advanced.
  for (const openKey of ['targetKcal', 'bdGrams']) {
    assert.match(beforeAdv, new RegExp(`id="in-setnum-${openKey}"`));
    assert.doesNotMatch(insideAdv, new RegExp(`id="in-setnum-${openKey}"`));
  }
  for (const advKey of ['kcalPerGDarf', 'kcalPerMlOil', 'darfMinG', 'deadbandPct', 'damping', 'maxStepG', 'maxCumulativeG', 'minWeighIns', 'kcalPerKgTissue', 'bcsHoldAtOrBelow']) {
    assert.doesNotMatch(beforeAdv, new RegExp(`id="in-setnum-${advKey}"`));
    assert.match(insideAdv, new RegExp(`id="in-setnum-${advKey}"`));
  }

  // Updated item-6 copy and year-inclusive dates:
  assert.match(beforeAdv, /id="settings-check-offline"[^>]*>Check offline access<\/button>/);
  assert.doesNotMatch(html, /Check app files/);
  assert.match(beforeAdv, /Diet or routine changes/);
  assert.match(beforeAdv, /15 Oct 2026/);
  assert.match(beforeAdv, /id="add-regime" data-act="addregime">\+ Record diet or routine change today<\/button>/);
  assert.match(insideAdv, /12 Oct 2026 &middot; rule/);
  assert.match(insideAdv, /id="run-selftest" data-act="selftest">Run self-tests<\/button>/);
  assert.match(insideAdv, /When to call the vet/);
  assert.match(insideAdv, /id="erase-log" data-act="erase"/);

  // Unified monthly Export + separate Full backup + existing Import (no import preview):
  assert.match(beforeAdv, /<select class="tin" id="export-month" data-act="exportmonthselect">/);
  assert.match(beforeAdv, /id="export-fmt-csv"[^>]*data-act="exportfmt" data-fmt="csv">CSV<\/button>/);
  assert.match(beforeAdv, /id="export-fmt-md"[^>]*data-act="exportfmt" data-fmt="md">Markdown<\/button>/);
  assert.match(beforeAdv, /id="export-run" data-act="exportrun"[^>]*>Export<\/button>/);
  assert.match(beforeAdv, /id="export-all" data-act="exportall">Full backup \(JSON\)<\/button>/);
  assert.match(beforeAdv, /id="backup-file" class="tin" type="file" accept="application\/json,\.json" data-act="import">/);
  assert.doesNotMatch(out, /preview/i);
  assert.equal(h.storage.size, 0, 'rendering Settings creates no writes');
});

test('Settings monthly export handles 1 November and year/leap boundaries, exports both CSV files or Markdown, and writes nothing', async () => {
  // 1 November boundary with October & November records + historical 2025-12 record + ancient 1980-05 record:
  const h = makeHarness({
    now: '2026-11-01T09:15:00Z',
    days: {
      '1980-05-01': { notes: 'ancient-import' },
      '2025-12-30': { notes: 'dec-2025-note' },
      '2026-10-31': { notes: 'october-note', stools: [stool] },
      '2026-11-01': { notes: 'november-note' },
    },
  });
  const opts = h.api.exportMonthOptions();
  assert.ok(opts.length <= 125, 'ancient imported dates keep month option count bounded');
  assert.equal(opts[0].ym, '2026-11');
  assert.equal(opts[0].label, 'Nov 2026 (this month)');
  assert.equal(opts[1].ym, '2026-10');
  assert.equal(opts[1].label, 'Oct 2026 (last month)');
  assert.ok(opts.some(o => o.ym === '2025-12' && o.label === 'Dec 2025'));
  assert.ok(opts.some(o => o.ym === '1980-05' && o.label === 'May 1980'));
  assert.equal(h.api.selectedExportMonth(opts), '2026-11');

  // Select October on 1 November via change event -> zero writes, updates output note:
  await h.dispatch('change', {
    target: {
      value: '2026-10',
      dataset: { act: 'exportmonthselect' },
      closest: () => ({ value: '2026-10', dataset: { act: 'exportmonthselect' } }),
    },
  });
  assert.equal(h.api.S.exportMonth, '2026-10');
  assert.equal(h.api.selectedExportMonth(), '2026-10');
  assert.match(h.element('#export-output-note').textContent, /Murphy_Log_2026-10\.csv.*Murphy_Log_2026-10_stools\.csv/);
  assert.equal(h.storage.size, 0);

  // Single Export button in CSV mode downloads daily CSV + delayed stools CSV for October only:
  await h.click('exportrun');
  assert.equal(h.api.downloads.length, 1);
  assert.equal(h.api.downloads[0][0], 'Murphy_Log_2026-10.csv');
  assert.match(h.api.downloads[0][1], /october-note/);
  assert.doesNotMatch(h.api.downloads[0][1], /november-note/);
  h.timers.shift()();
  assert.equal(h.api.downloads.length, 2);
  assert.equal(h.api.downloads[1][0], 'Murphy_Log_2026-10_stools.csv');
  assert.match(h.api.downloads[1][1], /2026-10-31,07:30,4/);

  // Switch format to Markdown and Export October:
  await h.click('exportfmt', { fmt: 'md' });
  assert.equal(h.api.S.exportFormat, 'md');
  assert.equal(h.element('#export-output-note').textContent, 'Markdown downloads Murphy_Log_2026-10.md.');
  await h.click('exportrun');
  assert.equal(h.api.downloads[2][0], 'Murphy_Log_2026-10.md');
  assert.match(h.api.downloads[2][1], /# Murphy's Logs: Oct 2026/);
  assert.match(h.api.downloads[2][1], /october-note/);
  assert.doesNotMatch(h.api.downloads[2][1], /november-note/);

  // Separate Full backup exports everything as JSON:
  await h.click('exportall');
  assert.equal(h.api.downloads[3][0], 'Murphy_Log_backup_2026-11-01.json');
  assert.match(h.api.downloads[3][1], /"version": "3\.12\.0"/);
  assert.equal(h.storage.size, 0, 'selecting months, formats and exporting writes nothing to storage');

  // Empty-account check on 1 November, 1 January and leap-year 1 March:
  for (const [now, curYm, prevYm, prevLabel] of [
    ['2026-11-01T00:05:00Z', '2026-11', '2026-10', 'Oct 2026 (last month)'],
    ['2027-01-01T00:05:00Z', '2027-01', '2026-12', 'Dec 2026 (last month)'],
    ['2024-03-01T00:05:00Z', '2024-03', '2024-02', 'Feb 2024 (last month)'],
  ]) {
    const emptyH = makeHarness({ now, days: {} });
    emptyH.api.S.settings = { ...emptyH.api.S.settings, startDate: curYm + '-01' };
    const mOpts = emptyH.api.exportMonthOptions();
    assert.equal(mOpts[0].ym, curYm);
    assert.equal(mOpts[1].ym, prevYm);
    assert.equal(mOpts[1].label, prevLabel);
  }
});

test('Settings refreshes current-day supplements during deferred renders and gives disclosure summaries stable focus IDs (CX-E1, CX-E2)', () => {
  let currentNow = Date.parse('2026-11-01T23:55:00Z');
  const h = makeHarness({ now: '2026-11-01T23:55:00Z', dirty: true });
  h.api.S.settings = {
    ...h.api.S.settings,
    oilSchedule: [{ from: '2026-11-01', ml: 8 }, { from: '2026-11-02', ml: 4 }],
    fibreSchedule: [{ from: '2026-11-01', g: 2.5 }, { from: '2026-11-02', g: 5 }],
  };

  const outNov1 = h.api.viewSettings();
  assert.match(outNov1, /<span class="v" id="settings-oil-today">8 ml<\/span>/);
  assert.match(outNov1, /<span class="v" id="settings-fibre-today">2\.5 g<\/span>/);
  assert.match(outNov1, /<summary id="settings-schedules-summary">Supplement schedule history<\/summary>/);
  assert.match(outNov1, /<summary class="sec" id="settings-advanced-summary">Advanced/);

  // Simulate the live DOM nodes populated on 1 Nov, then check refreshSettingsReadOnly:
  const oilNode = h.element('#settings-oil-today');
  const fibNode = h.element('#settings-fibre-today');
  oilNode.textContent = '8 ml';
  fibNode.textContent = '2.5 g';
  h.api.refreshSettingsReadOnly();
  assert.equal(oilNode.textContent, '8 ml');
  assert.equal(fibNode.textContent, '2.5 g');

  // Verify midnight schedule evaluation on 2 Nov updates read-only amounts with zero storage writes:
  const hNov2 = makeHarness({ now: '2026-11-02T00:05:00Z', dirty: true });
  hNov2.api.S.settings = h.api.S.settings;
  const oilNov2 = hNov2.element('#settings-oil-today');
  const fibNov2 = hNov2.element('#settings-fibre-today');
  oilNov2.textContent = '8 ml';
  fibNov2.textContent = '2.5 g';
  hNov2.api.refreshSettingsReadOnly();
  assert.equal(oilNov2.textContent, '4 ml');
  assert.equal(fibNov2.textContent, '5 g');
  assert.equal(hNov2.storage.size, 0);
  void currentNow;
});

test('offline save stores to durable outbox with calm status, suppresses raw SDK error text, and auto-syncs on reconnection', async () => {
  let remoteCalls = [];
  const trackCalls = {
    doc: (db, col, id) => ({ col, id }),
    setDoc: async (ref, data) => { remoteCalls.push({ type: 'setDoc', ref, data }); },
    runTransaction: async (db, fn) => {
      remoteCalls.push({ type: 'runTransaction' });
      const tx = {
        get: async (ref) => { remoteCalls.push({ type: 'tx.get', ref }); return { exists: () => true, data: () => ({}) }; },
        set: (ref, data) => { remoteCalls.push({ type: 'tx.set', ref, data }); }
      };
      return await fn(tx);
    }
  };

  const h = makeHarness({
    onLine: false,
    days: { [TODAY]: { stools: [] } },
    firebaseOverrides: trackCalls
  });

  h.api.S.ready = true;
  assert.equal(h.context.navigator.onLine, false);

  // 1. Save stool while offline
  const stoolPayload = { stools: [{ id: 's-offline-1', time: '09:15', bristol: 4, mucus: false, blood: false }] };
  const saved = await h.api.saveDay(TODAY, stoolPayload);
  assert.equal(saved, true, 'saveDay succeeds offline');

  // Assert calm status and no alarming technical error banner:
  assert.equal(h.api.S.status, 'Offline · saved on this device');
  assert.equal(h.element('#state').className, 'state warn');
  assert.equal(h.api.S.banner, null, 'No technical error banner on offline save');

  // Assert ZERO remote operations (no transactions, no reads, no writes):
  assert.equal(remoteCalls.length, 0, 'No remote network operations attempted while offline');

  // Assert outbox queue has exactly one item:
  const getOutbox = () => [...h.storage.keys()].filter(k => k.startsWith('murphy-outbox-v2:ui-test-only:'));
  assert.equal(getOutbox().length, 1, 'Operation is safely committed to localStorage outbox');

  // Assert optimistic state updated immediately:
  assert.equal(h.api.S.days[TODAY].stools.length, 1);
  assert.equal(h.api.S.days[TODAY].stools[0].id, 's-offline-1');

  // 2. Poor-signal error suppression and compact banner retention (B3):
  // Simulate poor signal where navigator.onLine is true, but network fails with unavailable:
  h.context.navigator.onLine = true;
  h.api.S.banner = { source: 'sync', kind: 'warn', retry: true, compact: true, title: 'Sync pending', text: 'Dismissed sync failure' };

  // Make runTransaction reject with unavailable:
  h.context.runTransaction = async () => {
    remoteCalls.push({ type: 'runTransaction-rejected' });
    const err = new Error('Failed to get document because the client is offline.');
    err.code = 'unavailable';
    throw err;
  };

  await h.api.flushWrites();

  // Assert compact banner remained compact (not re-expanded):
  assert.equal(h.api.S.banner.compact, true, 'User-dismissed compact banner remains compact on failed background retry');
  assert.doesNotMatch(h.api.S.banner.text, /Failed to get document/, 'Raw Firebase error text is suppressed');
  assert.match(h.api.S.banner.text, /saved on this device and will sync automatically/, 'Calm explanation is presented');

  // Restore working remote transaction:
  h.context.runTransaction = trackCalls.runTransaction;

  // 3. Independent Lifecycle Reconnect: visibilitychange (hidden=false) (B4 / P2)
  const visListeners = h.listeners.get('visibilitychange') || [];
  assert.ok(visListeners.length > 0, 'visibilitychange listener registered');
  h.document.hidden = false;
  for (const cb of visListeners) cb();
  assert.ok(h.api.pendingFlush(), 'flushTask initiated by visibilitychange listener');
  await h.api.pendingFlush();
  assert.equal(getOutbox().length, 0, 'Outbox queue drained by visibilitychange event');
  assert.equal(h.api.S.status, 'Synced');
  assert.equal(h.api.S.banner, null);

  // 4. Independent Lifecycle Reconnect: focus event with fresh pending queue
  const stoolPayload2 = { stools: [{ id: 's-offline-2', time: '11:30', bristol: 3, mucus: false, blood: false }] };
  h.context.navigator.onLine = false;
  await h.api.saveDay(TODAY, stoolPayload2);
  assert.equal(getOutbox().length, 1, 'Fresh item queued in outbox');
  h.context.navigator.onLine = true;

  const focusListeners = h.windowListeners.get('focus') || [];
  assert.ok(focusListeners.length > 0, 'focus listener registered');
  for (const cb of focusListeners) cb();
  assert.ok(h.api.pendingFlush(), 'flushTask initiated by focus listener');
  await h.api.pendingFlush();
  assert.equal(getOutbox().length, 0, 'Outbox queue drained by focus event');
  assert.equal(h.api.S.status, 'Synced');

  // 5. Independent Lifecycle Reconnect: 15-second polling interval with fresh pending queue
  const stoolPayload3 = { stools: [{ id: 's-offline-3', time: '14:00', bristol: 4, mucus: false, blood: false }] };
  h.context.navigator.onLine = false;
  await h.api.saveDay(TODAY, stoolPayload3);
  assert.equal(getOutbox().length, 1, 'Fresh item queued in outbox');
  h.context.navigator.onLine = true;

  const retryInterval = h.intervals.find(i => i.ms === 15000);
  assert.ok(retryInterval, '15-second retry interval is registered');
  retryInterval.callback();
  assert.ok(h.api.pendingFlush(), 'flushTask initiated by 15-second interval callback');
  await h.api.pendingFlush();
  assert.equal(getOutbox().length, 0, 'Outbox queue drained by 15-second interval');
  assert.equal(h.api.S.status, 'Synced');

  // 6. Independent Lifecycle Reconnect: online event with fresh pending queue
  const stoolPayload4 = { stools: [{ id: 's-offline-4', time: '16:00', bristol: 4, mucus: false, blood: false }] };
  h.context.navigator.onLine = false;
  await h.api.saveDay(TODAY, stoolPayload4);
  assert.equal(getOutbox().length, 1, 'Fresh item queued in outbox');
  h.context.navigator.onLine = true;

  const onlineListeners = h.windowListeners.get('online') || [];
  assert.ok(onlineListeners.length > 0, 'online listener registered');
  for (const cb of onlineListeners) cb();
  assert.ok(h.api.pendingFlush(), 'flushTask initiated by online event listener');
  await h.api.pendingFlush();
  assert.equal(getOutbox().length, 0, 'Outbox queue drained by online event');
  assert.equal(h.api.S.status, 'Synced');
});

test('AG-13: a failed background sync backs off the 15-second retry; lifecycle events and Retry sync still try at once', async () => {
  let attempts = 0;
  const unavailable = async () => { attempts++; const e = new Error('Failed to get document because the client is offline.'); e.code = 'unavailable'; throw e; };
  const h = makeHarness({ days: { [TODAY]: { stools: [] } }, firebaseOverrides: { doc: (_db, col, id) => ({ col, id }), runTransaction: unavailable } });
  h.api.S.ready = true;
  await h.api.saveDay(TODAY, { stools: [{ id: 's-backoff', time: '09:15', bristol: 4, mucus: false, blood: false }] });
  await h.api.pendingFlush();
  assert.equal(attempts, 1);
  assert.equal(h.api.S.status, 'Saved locally; retry sync');
  const periodic = h.intervals.find(i => i.ms === 15000);
  periodic.callback();
  assert.equal(h.api.pendingFlush(), null, 'the periodic retry waits out the back-off (the test clock is fixed)');
  for (const cb of h.windowListeners.get('focus') || []) cb();
  assert.ok(h.api.pendingFlush(), 'returning to the app still retries immediately');
  await h.api.pendingFlush();
  assert.equal(attempts, 2);
  await h.click('retrysync');
  await h.api.pendingFlush();
  assert.equal(attempts, 3, 'Retry sync bypasses the back-off');
  assert.equal(h.api.queuedWrites().length, 1, 'the entry stays queued throughout');
});

test('Zero-Friction Bowl Logging: Mark as fed sets status to served and auto-clears the bowl at current timestamp', async () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'turkey' } } } });
  await h.click('fed', { date: TODAY }, `meal-fed-action-${TODAY}`);
  const meal = h.api.S.days[TODAY].meal;
  assert.equal(meal.fedAt, '10:00', 'served at current timestamp');
  assert.equal(meal.bowl, 'cleared', 'auto-cleared with zero confirmation prompts');
  assert.equal(meal.recipe, 'turkey');
  assert.ok(meal.darfFed > 0);
  assert.equal(h.confirms.length, 0, 'no confirmation prompts');
});

test('Zero-Friction Bowl Logging: explicit feeding time sets served and auto-clears the bowl at entered timestamp', async () => {
  const h = makeHarness({ days: { [YESTERDAY]: { meal: { recipe: 'beef' } } } });
  h.api.S.tab = 'day';
  h.api.S.cursor = YESTERDAY;
  const timeInput = h.element(`#fed-time-${YESTERDAY}`);
  timeInput.value = '19:45';
  const feedingForm = {
    querySelector: sel => sel === 'input' ? timeInput : null,
    removeAttribute() {},
  };
  const target = {
    id: `fed-save-${YESTERDAY}`,
    dataset: { act: 'fed', date: YESTERDAY, fedTime: 'explicit' },
    disabled: false,
    querySelector: () => null,
    closest: sel => sel === '#feedback' ? null : sel === '[data-feeding]' ? feedingForm : target,
    focus() { h.document.activeElement = this; }
  };
  await h.dispatch('click', { target });
  const meal = h.api.S.days[YESTERDAY].meal;
  assert.equal(meal.fedAt, '19:45', 'served at entered timestamp');
  assert.equal(meal.bowl, 'cleared', 'auto-cleared on explicit entry');
});

test('Zero-Friction Bowl Logging: user can edit bowl after the fact and Undo Fed clears served and bowl status', async () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'lamb', fedAt: '18:00', bowl: 'cleared', darfFed: 140 } } } });
  // Tapping 'left' changes the bowl
  await h.click('bowl', { date: TODAY, k: 'left' }, `bowl-${TODAY}-left`);
  assert.equal(h.api.S.days[TODAY].meal.bowl, 'left');
  // Tapping 'left' again unmarks bowl
  await h.click('bowl', { date: TODAY, k: 'left' }, `bowl-${TODAY}-left`);
  assert.ok(!h.api.S.days[TODAY].meal.bowl, 'bowl is unmarked');
  // Undo Fed unmarks both served and bowl
  await h.click('unfeed', { date: TODAY }, `meal-unfeed-${TODAY}`);
  assert.ok(!h.api.S.days[TODAY].meal.fedAt, 'fedAt cleared');
  assert.ok(!h.api.S.days[TODAY].meal.bowl, 'bowl cleared');
});

test('Instant Stool Logging: single tap on rating in open form immediately saves with selected timestamp', async () => {
  const h = makeHarness({ days: { [TODAY]: { stools: [] } } });
  h.api.S.adding = TODAY;
  h.api.setDraft({ id: 's-edit-test', time: '08:15', bristol: 3, mucus: true, blood: false });
  h.element('#st-t').value = '08:15';
  h.element('#st-date').value = TODAY;
  // Selecting rating 5 immediately saves without pressing Save
  await h.click('stooltype', { b: '5' });
  const stools = h.api.S.days[TODAY].stools || [];
  assert.equal(stools.length, 1);
  assert.equal(stools[0].bristol, 5);
  assert.equal(stools[0].time, '08:15');
  assert.equal(stools[0].mucus, true);
  assert.equal(h.api.S.adding, null, 'draft is cleared');
});

test('Instant Stool Logging: saved entry is fully editable and deletable with Undo', async () => {
  const h = makeHarness({ days: { [TODAY]: { stools: [{ id: 's-orig', time: '09:00', bristol: 4, mucus: false, blood: false }] } } });
  // Delete inline
  await h.click('delstool', { date: TODAY, id: 's-orig' });
  assert.equal((h.api.S.days[TODAY].stools || []).length, 0);
  assert.ok(h.api.S.undo && h.api.S.undo.kind === 'stool', 'Undo record is kept');
  // Undo restores it
  await h.click('undo');
  assert.equal((h.api.S.days[TODAY].stools || []).length, 1);
  assert.equal(h.api.S.days[TODAY].stools[0].id, 's-orig');
});

test('5-Entry Rolling Weight Average: strictly averages the previous 5 logged weights regardless of elapsed time', () => {
  const h = makeHarness();
  // Entries spread over multiple months and non-uniform intervals
  const weights = [
    { date: '2026-05-01', kg: 18.0 },
    { date: '2026-06-15', kg: 18.2 },
    { date: '2026-08-01', kg: 18.4 },
    { date: '2026-09-10', kg: 18.6 },
    { date: '2026-10-01', kg: 18.8 },
    { date: '2026-10-28', kg: 19.0 },
  ];
  // As of 2026-10-28, previous 5 entries are 18.2, 18.4, 18.6, 18.8, 19.0 (sum = 93.0 / 5 = 18.6)
  const result = h.api.fiveEntryWeightMean(weights, '2026-10-28');
  assert.equal(result.n, 5);
  assert.ok(Math.abs(result.mean - 18.6) < 1e-10);
  assert.equal(result.from, '2026-06-15');
  assert.equal(result.to, '2026-10-28');

  // As of 2026-08-01, only 3 entries exist
  const result3 = h.api.fiveEntryWeightMean(weights, '2026-08-01');
  assert.equal(result3.n, 3);
  assert.ok(Math.abs(result3.mean - ((18.0 + 18.2 + 18.4) / 3)) < 1e-10);

  // Missing or non-positive weights are excluded
  const dirtyWeights = [
    { date: '2026-10-20', kg: 18.5 },
    { date: '2026-10-21', kg: 0 },
    { date: '2026-10-22', kg: 19.5, weightMissed: true },
    { date: '2026-10-23', kg: 18.7 },
  ];
  const dirtyResult = h.api.fiveEntryWeightMean(dirtyWeights, '2026-10-28');
  assert.equal(dirtyResult.n, 2);
  assert.ok(Math.abs(dirtyResult.mean - 18.6) < 1e-10);

  // UI label displays 5-entry mean
  const html = h.api.weightMeanContent(result);
  assert.match(html, /5-entry mean 18\.60 kg/);
});

test('BCS-Exclusive DARF Ration Adjustment: BCS is the sole deciding factor; weight deltas are decoupled', () => {
  const { api } = makeHarness();
  const settings = api.S.settings;

  // Massive weight gain (+10%) with ideal BCS (5.0) -> NO ration change
  const weightsGain = [
    ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, '0')}`, kg: 18.0 })),
    ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(19 + i).padStart(2, '0')}`, kg: 19.8 })),
  ];
  const adjIdealBcs = api.computeDarfAdjustment({ weights: weightsGain, asOf: TODAY, bcs7dMean: 5.0, settings });
  assert.equal(adjIdealBcs.applied, false, 'ideal BCS holds current ration despite 10% weight gain');
  assert.equal(adjIdealBcs.adjustmentG, 0);
  assert.match(adjIdealBcs.reason, /Body condition score is ideal \(5\.0 \/ 9\)/);

  // Massive weight loss (-10%) with ideal BCS (5.0) -> NO ration change
  const weightsLoss = [
    ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, '0')}`, kg: 19.8 })),
    ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(19 + i).padStart(2, '0')}`, kg: 18.0 })),
  ];
  const adjIdealBcsLoss = api.computeDarfAdjustment({ weights: weightsLoss, asOf: TODAY, bcs7dMean: 5.0, settings });
  assert.equal(adjIdealBcsLoss.applied, false, 'ideal BCS holds current ration despite 10% weight drop');
  assert.equal(adjIdealBcsLoss.adjustmentG, 0);

  // Overweight BCS (5.5, 6.0, 7.0) -> reduces DARF kibble ration
  const adj55 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.5, settings });
  assert.equal(adj55.applied, true);
  assert.equal(adj55.adjustmentG, -5, 'BCS 5.5 (0.5 above ideal) reduces by 5 g');

  const adj60 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 6.0, settings });
  assert.equal(adj60.applied, true);
  assert.equal(adj60.adjustmentG, -10, 'BCS 6.0 (1.0 above ideal) reduces by 10 g');

  const adj70 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 7.0, settings });
  assert.equal(adj70.applied, true);
  assert.equal(adj70.adjustmentG, -15, 'BCS 7.0 capped at maxStepG (15 g reduction)');
  assert.equal(adj70.limitedBy, 'maxStepG');

  // Underweight BCS (4.5, 4.0, 3.0) -> increases DARF kibble ration
  const adj45 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.5, settings });
  assert.equal(adj45.applied, true);
  assert.equal(adj45.adjustmentG, 5, 'BCS 4.5 (0.5 below ideal) increases by 5 g');

  const adj40 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.0, settings });
  assert.equal(adj40.applied, true);
  assert.equal(adj40.adjustmentG, 10, 'BCS 4.0 (1.0 below ideal) increases by 10 g');

  const adj30 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 3.0, settings });
  assert.equal(adj30.applied, true);
  assert.equal(adj30.adjustmentG, 15, 'BCS 3.0 capped at maxStepG (15 g increase)');
  assert.equal(adj30.limitedBy, 'maxStepG');

  // Missing BCS holds any ration change
  const adjNull = api.computeDarfAdjustment({ weights: weightsGain, asOf: TODAY, bcs7dMean: null, settings });
  assert.equal(adjNull.applied, false);
  assert.equal(adjNull.adjustmentG, 0);
  assert.match(adjNull.reason, /No Body Condition Score/);
});

test('Zero-Friction Bowl Logging: editing feeding time on an already-fed meal preserves an explicitly unmarked bowl', async () => {
  const h = makeHarness({ days: { [TODAY]: { meal: { recipe: 'beef', darfPlanned: 150 } } } });
  // Initial mark as fed auto-clears bowl
  await h.click('fed', { date: TODAY }, 'meal-fed-action-' + TODAY);
  assert.equal(h.api.S.days[TODAY].meal.fedAt !== null, true);
  assert.equal(h.api.S.days[TODAY].meal.bowl, 'cleared');

  // Explicitly unmark bowl by clicking 'cleared'
  await h.click('bowl', { date: TODAY, k: 'cleared' });
  assert.ok(h.api.S.days[TODAY].meal.bowl == null, 'bowl is unmarked');

  // Edit feeding time via explicit input
  const inputEl = { id: 'in-fedAt-' + TODAY, value: '19:45', defaultValue: '18:00', reportValidity: () => true };
  const formEl = { querySelector: sel => sel === 'input' ? inputEl : null, removeAttribute() {} };
  const target = {
    id: 'save-feeding-' + TODAY,
    dataset: { act: 'savefeedingtime', date: TODAY, fedTime: 'explicit' },
    disabled: false,
    querySelector: () => null,
    closest: sel => sel === '[data-feeding]' ? formEl : target,
    removeAttribute() {},
    focus() {}
  };
  await h.dispatch('click', { target });

  // Time updated, but bowl remains unmarked (not reverted to 'cleared')
  assert.equal(h.api.S.days[TODAY].meal.fedAt, '19:45');
  assert.ok(h.api.S.days[TODAY].meal.bowl == null, 'unmarked bowl state is preserved after time edit');
});

test('Instant Stool Logging: rating autosave on a deleted stool aborts safely and prevents outbox corruption', async () => {
  const origStool = { id: 's-orig-del', time: '08:00', bristol: 4, mucus: false, blood: false };
  const h = makeHarness({ days: { [TODAY]: { stools: [origStool] } } });
  h.api.S.adding = TODAY;
  h.api.setDraft({ ...origStool }, { ...origStool });
  h.element('#st-t').value = '08:00';
  h.element('#st-date').value = TODAY;

  // Stool is deleted while form is still open
  h.api.S.days[TODAY].stools = [];

  // Tapping rating 5
  await h.click('stooltype', { b: '5' });

  // Missing-original guard stops save and records error
  assert.equal((h.api.S.days[TODAY].stools || []).length, 0);
  assert.equal(h.api.queuedWrites().length, 0, 'no malformed write queued to outbox');
  assert.ok(h.api.S.localSaveError, 'save error was recorded');
  assert.match(h.api.S.banner?.text, /removed or moved elsewhere/);
});

test('Instant Stool Logging: rating autosave enforces date and time validity before write', async () => {
  const h = makeHarness({ days: { [TODAY]: { stools: [] } } });
  h.api.S.adding = TODAY;
  h.api.setDraft({ id: 's-validate', time: '08:00', bristol: 3, mucus: false, blood: false });

  // 1. Future date rejects write
  h.element('#st-t').value = '08:00';
  h.element('#st-date').value = '2099-01-01';
  await h.click('stooltype', { b: '4' });
  assert.equal((h.api.S.days[TODAY].stools || []).length, 0);
  assert.equal((h.api.S.days['2099-01-01']?.stools || []).length, 0);
  assert.equal(h.api.queuedWrites().length, 0, 'no future write saved');
  assert.equal(h.element('#st-error').textContent, 'Choose a date on or before today.');

  // 2. Invalid time rejects write
  h.element('#st-date').value = TODAY;
  h.element('#st-t').value = '';
  h.element('#st-t').checkValidity = () => false;
  h.element('#st-t').reportValidity = () => false;
  await h.click('stooltype', { b: '4' });
  assert.equal((h.api.S.days[TODAY].stools || []).length, 0);
  assert.equal(h.api.queuedWrites().length, 0, 'no write saved with invalid time');
  assert.equal(h.element('#st-error').textContent, 'Enter the time of this stool.');
  assert.equal(h.api.draft().bristol, 4, 'draft bristol is updated even when date/time validation fails');
});

test('Instant Stool Logging: failed quick-log saveDay binds error and clears on retry or dismiss', async () => {
  const h = makeHarness({ days: { [TODAY]: { stools: [] } } });
  let fail = true;
  h.storage.set = (k, v) => {
    if (fail) throw new Error('Quota exceeded');
    Map.prototype.set.call(h.storage, k, v);
  };
  await h.click('openstool', { b: '4', date: TODAY });
  assert.equal(h.api.S.localSaveError, 'quickstool:' + TODAY, 'quickstool error bound on failure');

  // Dismissing the banner acknowledges the instant-action error and restores clean status
  await h.click('dismiss-banner');
  assert.equal(h.api.S.localSaveError, null, 'dismiss clears instant-action error');

  // Re-inject failure
  fail = true;
  await h.click('openstool', { b: '5', date: TODAY });
  assert.equal(h.api.S.localSaveError, 'quickstool:' + TODAY);

  // Restoring storage and retrying the quick tap clears the error and saves the stool
  fail = false;
  await h.click('openstool', { b: '5', date: TODAY });
  assert.equal(h.api.S.localSaveError, null, 'successful retry clears error');
  assert.equal(h.api.S.days[TODAY].stools.length, 1);
  assert.equal(h.api.S.days[TODAY].stools[0].bristol, 5);
});

test('BCS-Exclusive DARF Ration Adjustment: decoupled from settings.bcsTarget and discretizes with symmetric deadband around ideal 5.0', () => {
  const { api } = makeHarness();
  const settings = api.S.settings;

  // 1. Decoupled from settings.bcsTarget:
  // Even if legacy chart setting bcsTarget is set to 6, 5.0 holds at 0 g, and 5.5 reduces by -5 g
  const settingsWithBcs6 = { ...settings, bcsTarget: 6 };
  const at50 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.0, settings: settingsWithBcs6 });
  assert.equal(at50.applied, false, 'BCS 5.0 holds at 0 g even when settings.bcsTarget is 6');
  assert.equal(at50.adjustmentG, 0);

  const at55 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.5, settings: settingsWithBcs6 });
  assert.equal(at55.applied, true);
  assert.equal(at55.adjustmentG, -5, 'BCS 5.5 reduces by 5 g even when settings.bcsTarget is 6');

  // 2. Deadband around ideal 5.0 (+/-0.25) and symmetric tie-breaking:
  // Float value 5.06 holds at 0 g (does NOT produce -1 g noise!)
  const at506 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.06, settings });
  assert.equal(at506.applied, false, 'BCS 5.06 holds at 0 g');
  assert.equal(at506.adjustmentG, 0);

  // Exact deadband boundaries: symmetric half-way ties round away from 5.0
  // 5.25 produces -5 g (1 step down) and 4.75 produces +5 g (1 step up)
  const at525 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.25, settings });
  assert.equal(at525.applied, true, 'exact BCS 5.25 reduces by 5 g');
  assert.equal(at525.adjustmentG, -5);

  const at475 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.75, settings });
  assert.equal(at475.applied, true, 'exact BCS 4.75 increases by 5 g');
  assert.equal(at475.adjustmentG, 5);

  // Quarter-point transitions at 0.75: symmetric ties round away from 5.0
  // 5.75 produces -10 g (2 steps down) and 4.25 produces +10 g (2 steps up)
  const at575 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.75, settings });
  assert.equal(at575.applied, true, 'exact BCS 5.75 reduces by 10 g');
  assert.equal(at575.adjustmentG, -10);

  const at425 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.25, settings });
  assert.equal(at425.applied, true, 'exact BCS 4.25 increases by 10 g');
  assert.equal(at425.adjustmentG, 10);

  // Values inside deadband:
  // Float value 5.24 holds at 0 g
  const at524 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.24, settings });
  assert.equal(at524.applied, false, 'BCS 5.24 holds at 0 g inside deadband');
  assert.equal(at524.adjustmentG, 0);

  // Float value 4.76 holds at 0 g inside deadband
  const at476 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.76, settings });
  assert.equal(at476.applied, false, 'BCS 4.76 holds at 0 g inside deadband');
  assert.equal(at476.adjustmentG, 0);

  // Adjacent values just outside deadband:
  // Float value 5.26 rounds to 5.5 (-5 g)
  const at526 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 5.26, settings });
  assert.equal(at526.applied, true);
  assert.equal(at526.adjustmentG, -5);

  // Float value 4.74 rounds to 4.5 (+5 g)
  const at474 = api.computeDarfAdjustment({ weights: [], asOf: TODAY, bcs7dMean: 4.74, settings });
  assert.equal(at474.applied, true);
  assert.equal(at474.adjustmentG, 5);
});

test('BCS-Exclusive DARF Ration Adjustment: single-step clamp preserves maxStepG when existing offset exceeds cumulative cap', () => {
  const { api } = makeHarness();
  const settings = { ...api.S.settings, maxStepG: 15, maxCumulativeG: 40 };

  // Offset +60g (beyond 40g cap) with BCS 5.5: raw step is -5g, projected is +55g.
  // Cumulative cap calculation gives 40 - 60 = -20g, which must clamp to maxStepG (-15g).
  const overPositive = api.computeDarfAdjustment({
    weights: [], asOf: TODAY, currentOffsetG: 60, bcs7dMean: 5.5, settings
  });
  assert.equal(overPositive.applied, true);
  assert.equal(overPositive.adjustmentG, -15, 'step does not exceed -15g when starting past +40g cap');
  assert.equal(overPositive.limitedBy, 'maxStepG');
  assert.match(overPositive.reason, /reduce DARF by 15 g and held at the single-step cap/);

  // Offset -60g (beyond -40g cap) with BCS 4.5: raw step is +5g, projected is -55g.
  // Cumulative cap calculation gives -40 - (-60) = +20g, which must clamp to maxStepG (+15g).
  const overNegative = api.computeDarfAdjustment({
    weights: [], asOf: TODAY, currentOffsetG: -60, bcs7dMean: 4.5, settings
  });
  assert.equal(overNegative.applied, true);
  assert.equal(overNegative.adjustmentG, 15, 'step does not exceed +15g when starting past -40g cap');
  assert.equal(overNegative.limitedBy, 'maxStepG');
  assert.match(overNegative.reason, /increase DARF by 15 g and held at the single-step cap/);
});

test('weeklyAdvice: condition-score assessment window strictly evaluates the week before Monday', () => {
  const h = makeHarness();
  // TODAY is 2026-10-28 (Wednesday).
  // mondayOf(TODAY) is 2026-10-26 (Monday).
  // The week before Monday is 2026-10-19 (Monday) through 2026-10-25 (Sunday).
  // Put BCS 6.0 in the prior completed week (2026-10-19 .. 2026-10-25).
  // Put BCS 5.0 in the current mid-week (2026-10-26 .. 2026-10-28).
  for (let d = h.api.toDay('2026-10-19'); d <= h.api.toDay('2026-10-25'); d++) {
    const iso = h.api.toIso(d);
    h.api.S.days[iso] = { ...(h.api.S.days[iso] || {}), bcs: 6.0 };
  }
  for (let d = h.api.toDay('2026-10-26'); d <= h.api.toDay('2026-10-28'); d++) {
    const iso = h.api.toIso(d);
    h.api.S.days[iso] = { ...(h.api.S.days[iso] || {}), bcs: 5.0 };
  }
  const adv = h.api.weeklyAdvice();
  // Prior week mean is 6.0 -> calls for -10g.
  // If it incorrectly used 7 days ending today (2026-10-22 to 2026-10-28), mean would include 5.0s and differ.
  assert.equal(adv.bcs, 6.0, 'bcs is exactly 6.0 from the completed week before Monday');
  assert.equal(adv.applied, true);
  assert.equal(adv.adjustmentG, -10);
});

test('Trends chart: condition chart draws target line at fixed 5.0 clinical ideal, not settings.bcsTarget', () => {
  const h = makeHarness();
  h.api.S.settings.bcsTarget = 6.0; // legacy setting
  const reviewHtml = h.api.viewReview();
  assert.ok(reviewHtml.includes('Condition'), 'Review includes Condition section');
  const conditionChart = h.api.lineChart([{ x: h.api.toDay('2026-10-20'), y: 5.0 }], 'bcs');
  assert.ok(conditionChart.includes('Short horizontal dashes mark the ideal centre.'), 'chart summary notes ideal centre');
  // For forceRange [3,7], lo=3, hi=7.
  // py(y) = (1 - (y-3)/(7-3))*100.
  // py(5.0) = (1 - 2/4)*100 = 50.
  // py(6.0) = (1 - 3/4)*100 = 25.
  const forcedChart = h.api.lineChart([{ x: h.api.toDay('2026-10-20'), y: 5.0 }], 'bcs', [3, 7]);
  assert.match(forcedChart, /y1="50"/, 'target line is drawn at y=50% representing fixed 5.0');
  assert.doesNotMatch(forcedChart, /y1="25"/, 'target line is not drawn at y=25% representing 6.0');
});
