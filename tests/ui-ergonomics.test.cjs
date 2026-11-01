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

function makeHarness({ days = {}, dirty = false } = {}) {
  const storage = new Map(), listeners = new Map(), nodes = new Map(), confirms = [];
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      selector, id: selector.startsWith('#') ? selector.slice(1) : '', value: '', dataset: {}, innerHTML: '', textContent: '',
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, setAttribute() {}, removeAttribute() {}, matches: () => false, closest: () => null,
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
  const fixed = Date.parse(TODAY + 'T10:00:00Z');
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
    setInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: forbidden('network'), prompt: forbidden('prompt'),
    confirm: message => { confirms.push(message); return true; },
  });
  vm.runInContext(moduleSource + `
    globalThis.renders = [];
    render = (...args) => { globalThis.renders.push(args); };
    renderFeedback = () => {};
    globalThis.api = { S, stoolsCard, todoCard, viewToday, viewDay, WEIGHT_TARGET_TEXT, WEIGHT_RANGE_TEXT,
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
  return { api, storage, confirms, element, document, click, dispatch };
}

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

test('in-page jumps keep drafts without a discard prompt; the History jump still guards them', async () => {
  const h = makeHarness({ dirty: true });
  await h.click('jump', { k: 'weight' });
  await h.click('jump', { k: 'stool' });
  assert.deepEqual(h.confirms, []);
  await h.click('jump', { k: 'bowl' });
  assert.equal(h.confirms.length, 1);
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
  const field = { id: 'in-treats-' + TODAY, value: '3', defaultValue: '1', setCustomValidity() {}, removeAttribute() {},
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

test('fields never render below 16px, so iOS does not zoom on focus at any text size', () => {
  assert.match(css, /input,select,textarea\{font-size:max\(16px,1rem\)\}/);
  assert.match(css, /\.tin\{[^}]*font-size:max\(16px,1rem\)/);
  assert.match(css, /\.field input\{[^}]*font-size:max\(16px,1\.0625rem\)/);
});
