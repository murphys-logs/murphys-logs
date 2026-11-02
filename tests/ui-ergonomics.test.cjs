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

function makeHarness({ days = {}, dirty = false, now = TODAY + 'T10:00:00Z' } = {}) {
  const storage = new Map(), listeners = new Map(), nodes = new Map(), confirms = [], timers = [];
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
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
  };
  const fixed = Date.parse(now);
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
  const forbidden = name => () => { throw Error('Unexpected ' + name + ' in a local UI test'); };
  const firebase = Object.fromEntries(importNames.map(name => [name, name === 'onAuthStateChanged' ? () => () => {} : forbidden('Firebase call: ' + name)]));
  Object.assign(firebase, { initializeApp: () => ({}), getAuth: () => ({}), initializeFirestore: () => ({}),
    persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}) });
  const context = vm.createContext({
    ...firebase, document, console, URL, Date: ClockDate, crypto: { randomUUID }, CSS: { escape: value => value },
    navigator: { onLine: true }, localStorage: {
      get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
    },
    window: { addEventListener() {}, AppShell: { ready() {} } },
    ResizeObserver: class { observe() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setInterval() {}, setTimeout(callback) { timers.push(callback); }, clearTimeout() {}, fetch: forbidden('network'), prompt: forbidden('prompt'),
    confirm: message => { confirms.push(message); return true; },
  });
  vm.runInContext(moduleSource + `
    globalThis.renders = [];
    render = (...args) => { globalThis.renders.push(args); };
    const realRenderFeedback = renderFeedback;
    renderFeedback = () => {};
    globalThis.testDownloads = [];
    download = (...args) => globalThis.testDownloads.push(args);
    globalThis.api = { S, setStatus, storeError, bindSaveError, clearSaveError, resetSaveFeedback, feedback: realRenderFeedback, stoolsCard, todoCard, viewToday, viewDay, todayMealCard, foldSummary, WEIGHT_TARGET_TEXT, WEIGHT_RANGE_TEXT,
      exportMonthCsv, exportMonthMd, previousMonth, downloads: globalThis.testDownloads,
      setDraftToday: value => { draftToday = value; },
      draft: () => stoolDraft, setDraft: (draft, original = null) => { stoolDraft = draft; stoolOriginal = original; } };
  `, context, { filename: htmlPath, timeout: 5000 });
  const { api } = context;
  api.S.user = { uid: 'ui-test-only', email: 'test.invalid' };
  api.S.days = JSON.parse(JSON.stringify(days));
  const dispatch = async (name, event) => { for (const callback of listeners.get(name) || []) await callback(event); };
  const click = (act, data = {}, id = '') => {
    const target = { id, dataset: { act, ...data }, disabled: false, closest: selector => selector === '#feedback' ? null : target,
      focus() { document.activeElement = this; } };
    return dispatch('click', { target }).then(() => target);
  };
  return { api, storage, confirms, element, document, click, dispatch, timers };
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

test('tapping a quick-log type opens a prefilled entry without a discard prompt', async () => {
  const h = makeHarness();
  await h.click('openstool', { date: TODAY, b: '4' }, `quick-stool-${TODAY}-4`);
  assert.equal(h.api.S.adding, TODAY);
  assert.equal(h.api.draft().bristol, 4);
  assert.equal(h.api.draft().time, '10:00', 'time defaults to now (London)');
  assert.equal(h.document.activeElement.selector, '#main [data-act="stooltype"].on', 'focus lands on the chosen type, not the time field');
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
  assert.equal(h.document.activeElement.selector, '#in-weight-2026-10-27', 'not the current London date');
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

test('weight target labels derive from the single monitoring constant', () => {
  const h = makeHarness();
  assert.equal(h.api.WEIGHT_TARGET_TEXT, '18.70 kg ±1%');
  assert.equal(h.api.WEIGHT_RANGE_TEXT, '18.513–18.887 kg');
  const lines = html.split('\n').filter(line => /18\.70|18\.513|18\.887/.test(line));
  assert.deepEqual(lines.map(line => line.trim().slice(0, 26)), ['const WEIGHT_TARGET = Obje']);
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
  assert.equal(h.document.activeElement.selector,'#in-weight-2026-10-26');
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
