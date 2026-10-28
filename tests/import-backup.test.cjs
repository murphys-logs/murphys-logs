'use strict';

// Run with: node --test tests/import-backup.test.cjs
// APP_HTML can point at a baseline or candidate HTML file. No browser, packages,
// network access, Firebase account, or changes to production exports are needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const htmlPath = process.env.APP_HTML
  ? path.resolve(process.env.APP_HTML)
  : path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const moduleMatch = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, 'The application module must exist');
const importNames = [];
const moduleSource = moduleMatch[1].replace(
  /^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*/gm,
  (_, names) => {
    importNames.push(...names.split(',').map(name => name.trim()));
    return '';
  }
);
assert.ok(importNames.length, 'Firebase imports must be replaced by test stubs');
assert.doesNotMatch(moduleSource, /^\s*import\s/m, 'Unexpected import needs an explicit test boundary');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeHarness(seed = {}) {
  const storage = new Map();
  const storageWrites = [];
  const backendCalls = [];
  const nodes = new Map();
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      id: selector.startsWith('#') ? selector.slice(1) : '',
      value: '', textContent: '', innerHTML: '', content: '', dataset: {},
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
      getBoundingClientRect: () => ({ height: 0 }),
      querySelector: element, querySelectorAll: () => [],
      contains: () => false,
    });
    return nodes.get(selector);
  };
  const document = {
    querySelector: element,
    querySelectorAll: () => [],
    getElementById: id => element('#' + id),
    addEventListener() {},
    documentElement: element('html'),
    activeElement: element('body'),
  };
  const unexpectedBackend = name => (...args) => {
    backendCalls.push({ name, args });
    throw new Error('Unexpected backend call: ' + name);
  };
  const firebase = {
    initializeApp: () => ({}), getAuth: () => ({}),
    initializeFirestore: () => ({}), persistentLocalCache: () => ({}),
    persistentMultipleTabManager: () => ({}),
    // Deliberately do not sign in or start subscriptions during module boot.
    onAuthStateChanged: () => () => {},
    onSnapshot: unexpectedBackend('onSnapshot'),
    signInWithEmailAndPassword: unexpectedBackend('signInWithEmailAndPassword'),
    signOut: unexpectedBackend('signOut'),
    doc: unexpectedBackend('doc'), collection: unexpectedBackend('collection'),
    setDoc: unexpectedBackend('setDoc'), deleteDoc: unexpectedBackend('deleteDoc'),
    deleteField: unexpectedBackend('deleteField'),
    runTransaction: unexpectedBackend('runTransaction'),
  };
  for (const name of importNames) assert.ok(Object.hasOwn(firebase, name), 'Unstubbed SDK import: ' + name);
  const context = vm.createContext({
    ...firebase, document, console, URL, Blob,
    crypto: { randomUUID },
    navigator: {
      onLine: false,
      // Hold the browser lock boundary to model a queued offline import. The
      // real write(), serialization and optimistic applyOperation() still run.
      locks: { request: () => new Promise(() => {}) },
    },
    localStorage: {
      get length() { return storage.size; },
      key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem(key, value) {
        storageWrites.push({ key, value: String(value) });
        storage.set(key, String(value));
      },
      removeItem: key => storage.delete(key),
    },
    window: { addEventListener() {}, AppShell: { ready() {} } },
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    fetch: unexpectedBackend('fetch'),
    confirm: () => { throw new Error('Unexpected confirmation during import'); },
    prompt: () => { throw new Error('Unexpected prompt during import'); },
  });
  vm.runInContext(moduleSource + `
    // Only rendering is replaced. Validation, import, write, replay and pure
    // calculations below remain the functions from the application's module.
    render = () => {};
    renderFeedback = () => {};
    globalThis.testApi = {
      validateBackup, importJson, selfTest, recordedWeight, queuedWrites, bowlFor,
      S, DEFAULTS, settingsSpec
    };
  `, context, { filename: htmlPath, timeout: 5000 });
  const api = context.testApi;
  Object.assign(api.S, {
    user: { uid: 'local-test-only', email: 'test.invalid' },
    ready: true, days: {}, changes: [], savedSettings: {},
    ...clone(seed),
  });
  if (!seed.settings) api.S.settings = clone(api.DEFAULTS);
  return { api, storage, storageWrites, backendCalls };
}

function importFile(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return { size: Buffer.byteLength(text), text: async () => text };
}

function modelSnapshot(harness) {
  const { days, changes, settings, savedSettings } = harness.api.S;
  return clone({ days, changes, settings, savedSettings });
}

function healthyBackup() {
  return {
    exported: '2026-10-28T12:00:00.000Z',
    version: '3.5.0',
    days: {
      '2026-10-26': {
        date: '2026-10-26', updatedAt: '2026-10-26T20:00:00.000Z',
        weight: 0, notes: 'Historical zero means no measurement.',
        stools: [{ id: 'stable-stool-a', bristol: 3 }],
      },
      '2026-10-27': {
        date: '2026-10-27', updatedAt: '2026-10-27T20:00:00.000Z',
        weight: null, bcs: null, walkMin: null,
        stools: [{ id: 'stable-stool-b', time: '07:45', bristol: 4, mucus: false, blood: false }],
        meal: { recipe: 'lamb', fedAt: '18:45', darfFed: 123, egg: null, oilGiven: null },
      },
    },
    changes: [{ id: 'stable-change-a', date: '2026-10-27', deltaG: -5, source: 'manual' }],
    settings: { targetKcal: 1240, kcalPerGDarf: 4.62 },
  };
}

async function assertRejectedBeforeWrite(data, label, seed = {}) {
  const h = makeHarness(seed);
  const before = modelSnapshot(h);
  await h.api.importJson(importFile(data));
  assert.equal(h.api.S.banner?.title, 'Import failed', label + ': import must report failure');
  assert.equal(h.api.S.banner?.kind, 'bad', label + ': failure must be visible');
  assert.equal(h.storageWrites.length, 0, label + ': no outbox/localStorage writes');
  assert.equal(h.storage.size, 0, label + ': no queued prefix accepted');
  assert.equal(h.backendCalls.length, 0, label + ': no backend operation');
  assert.deepEqual(modelSnapshot(h), before, label + ': no optimistic record/settings changes');
  return h;
}

test('all 62 existing in-app calculation self-tests pass', () => {
  const h = makeHarness();
  h.api.selfTest();
  assert.match(h.api.S.testOut, /^62 passed, 0 failed\n/);
  assert.doesNotMatch(h.api.S.testOut, /^FAIL\s/m);
  assert.equal(h.storageWrites.length, 0);
  assert.equal(h.backendCalls.length, 0);
});

test('HTML, application module and service worker have one coherent release version', () => {
  const worker = fs.readFileSync(path.join(path.dirname(htmlPath), 'sw.js'), 'utf8');
  const shellVersion = html.match(/<html\b[^>]*\bdata-version=['"]([^'"]+)['"]/)?.[1];
  const appVersion = moduleSource.match(/\bconst\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
  const workerVersion = worker.match(/\bconst\s+VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
  assert.ok(shellVersion && appVersion && workerVersion, 'All three release identifiers must exist');
  assert.equal(shellVersion, appVersion, 'HTML and application release must match');
  assert.equal(workerVersion, appVersion, 'Worker must accept the published application release');
});

test('healthy import queues one complete operation and preserves original IDs and historical values', async () => {
  const h = makeHarness();
  const data = healthyBackup();
  const original = clone(data);
  assert.equal(h.api.validateBackup(data), data, 'validation returns the unmodified backup');
  assert.deepEqual(data, original);
  await h.api.importJson(importFile(data));
  assert.equal(h.storageWrites.length, 1, 'one durable aggregate operation');
  assert.equal(h.storage.size, 1);
  const [key, serialized] = [...h.storage][0];
  assert.match(key, /^murphy-outbox:local-test-only:/);
  const operation = JSON.parse(serialized);
  assert.equal(operation.items.length, 4, 'two days, one change and missing settings');
  assert.ok(operation.items.every(item => item.restore === true));
  assert.deepEqual(operation.items.filter(item => item.col === 'days').map(item => item.patch), Object.values(data.days));
  assert.deepEqual(clone(h.api.S.days), data.days);
  assert.deepEqual(clone(h.api.S.changes), data.changes);
  assert.equal(h.api.S.days['2026-10-26'].stools[0].id, 'stable-stool-a');
  assert.equal(h.api.S.days['2026-10-27'].stools[0].id, 'stable-stool-b');
  assert.equal(h.api.S.days['2026-10-26'].weight, 0);
  assert.equal(h.api.recordedWeight(h.api.S.days['2026-10-26']), null);
  assert.equal(h.api.S.days['2026-10-27'].weight, null);
  assert.equal(h.api.S.days['2026-10-27'].meal.oilGiven, null);
  assert.equal(h.backendCalls.length, 0);
  assert.equal(h.api.S.banner.title, 'Import saved locally');
});

test('omitted optional backup sections and historical stool metadata remain supported', async () => {
  const h = makeHarness();
  const data = { days: { '2026-10-27': { stools: [{ id: 'legacy-id', bristol: 4 }] } } };
  await h.api.importJson(importFile(data));
  assert.equal(h.storageWrites.length, 1);
  assert.deepEqual(clone(h.api.S.days), data.days);
  assert.equal(h.api.S.banner.title, 'Import saved locally');
});

test('required stool IDs reject missing, null, nonstring and existing invalid ID forms', async () => {
  const invalidIds = [undefined, null, '', 7, false, {}, [], '.', '..', 'has/slash', 'x'.repeat(1500)];
  for (const id of invalidIds) {
    const data = healthyBackup();
    data.days['2026-10-27'].stools[0].id = id;
    const h = await assertRejectedBeforeWrite(data, 'stool id ' + JSON.stringify(id));
    assert.match(h.api.S.banner.text, /2026-10-27/);
    assert.match(h.api.S.banner.text, /id/i);
  }
});

test('whitespace-only and embedded-control stool IDs reject the whole backup before any write', async () => {
  for (const id of [' ', '\t\n', 'a\u0000b', 'a\rb', 'a\r\nb']) {
    const data = healthyBackup();
    data.days['2026-10-27'].stools[0].id = id;
    const h = await assertRejectedBeforeWrite(data, 'stool id ' + JSON.stringify(id));
    assert.match(h.api.S.banner.text, /2026-10-27/);
    assert.match(h.api.S.banner.text, /id/i);
  }
});

test('duplicate stool IDs within one day reject the whole backup', async () => {
  const data = healthyBackup();
  data.days['2026-10-27'].stools.push({ id: 'stable-stool-b', bristol: 5, time: '19:10' });
  await assertRejectedBeforeWrite(data, 'duplicate stool id');
});

test('ID validation remains per-day; it does not silently rename identities across dates', async () => {
  const h = makeHarness();
  const data = healthyBackup();
  data.days['2026-10-27'].stools[0].id = 'stable-stool-a';
  await h.api.importJson(importFile(data));
  assert.equal(h.storageWrites.length, 1);
  assert.equal(h.api.S.days['2026-10-26'].stools[0].id, 'stable-stool-a');
  assert.equal(h.api.S.days['2026-10-27'].stools[0].id, 'stable-stool-a');
});

// Independent acceptance limits, including nonzero step bases. These values
// describe the existing editor contract; they do not invoke its validator to
// calculate expected results for the backup validator.
const visibleNumbers = {
  targetKcal: [1, 10000, 1], bdGrams: [1, 10000, 1],
  kcalPerGDarf: [0.01, 10000, 0.01], kcalPerMlOil: [0.01, 10000, 0.01],
  darfMinG: [1, 10000, 1], deadbandPct: [0, 100, 0.1],
  damping: [0.005, 1, 0.005], maxStepG: [1, 10000, 1],
  maxCumulativeG: [1, 10000, 1], minWeighIns: [1, 7, 1],
  kcalPerKgTissue: [1, 10000, 1], bcsHoldAtOrBelow: [0, 9, 0.5],
};

test('visible numeric settings accept editor boundary and step values', () => {
  const h = makeHarness();
  assert.deepEqual(Object.keys(h.api.settingsSpec).sort(), Object.keys(visibleNumbers).sort(), 'New editor settings need explicit acceptance coverage');
  for (const [key, [min, max, step]] of Object.entries(visibleNumbers)) {
    for (const value of [min, max, min + step]) {
      assert.doesNotThrow(() => h.api.validateBackup({ days: {}, settings: { [key]: value } }), `${key}=${value}`);
    }
  }
  assert.doesNotThrow(() => h.api.validateBackup({ days: {}, settings: { damping: 0.125, kcalPerGDarf: 4.62 } }));
});

test('visible numeric settings reject values outside editor bounds or between steps before any write', async () => {
  for (const [key, [min, max, step]] of Object.entries(visibleNumbers)) {
    for (const value of [min - step, max + step, min + step / 2]) {
      const data = healthyBackup();
      data.settings = { [key]: value };
      await assertRejectedBeforeWrite(data, `${key}=${value}`);
    }
  }
});

const legacyNumbers = ['attributionMinH', 'handoverHour', 'eggKcal', 'brothKcal'];
const hiddenNumbers = {
  windowDays: { valid: [1, 2, 366], invalid: [0, 367, 1.5] },
  fibreStreakDays: { valid: [1, 2, 366], invalid: [0, 367, 1.5] },
  fibreReviewWindow: { valid: [1, 2, 366], invalid: [0, 367, 1.5] },
  fibreReviewBadDays: { valid: [1, 2, 366], invalid: [0, 367, 1.5] },
  vetWindowDays: { valid: [1, 2, 366], invalid: [0, 367, 1.5] },
  fibreStepBackDays: { valid: [0, 1, 366], invalid: [-1, 367, 1.5] },
  fibreReviewMinDays: { valid: [0, 1, 366], invalid: [-1, 367, 1.5] },
  bcsTarget: { valid: [1, 4.25, 9], invalid: [0.99, 9.01] },
  fibreStepG: { valid: [0.0001, 2.75, 10000], invalid: [0, -0.1, 10000.01] },
  fibreRestG: { valid: [0, 2.75, 10000], invalid: [-0.1, 10000.01] },
  fibreCapG: { valid: [0, 2.75, 10000], invalid: [-0.1, 10000.01] },
};

test('active hidden settings accept agreed boundaries, including fractional quantities and zero delays', () => {
  const h = makeHarness();
  const numericKeys = Object.entries(h.api.DEFAULTS).filter(([, value]) => typeof value === 'number').map(([key]) => key).sort();
  assert.deepEqual(numericKeys, [...Object.keys(visibleNumbers), ...Object.keys(hiddenNumbers), ...legacyNumbers].sort(), 'New numeric settings need explicit policy coverage');
  assert.doesNotThrow(() => h.api.validateBackup({ days: {}, settings: clone(h.api.DEFAULTS) }));
  for (const [key, { valid }] of Object.entries(hiddenNumbers)) {
    for (const value of valid) {
      assert.doesNotThrow(() => h.api.validateBackup({ days: {}, settings: { [key]: value } }), `${key}=${value}`);
    }
  }
});

test('active hidden settings reject unsafe bounds and fractional day counts before any write', async () => {
  for (const [key, { invalid }] of Object.entries(hiddenNumbers)) {
    for (const value of invalid) {
      const data = healthyBackup();
      data.settings = { [key]: value };
      await assertRejectedBeforeWrite(data, `${key}=${value}`);
    }
  }
});

test('day-count settings require exact integers rather than floating step tolerance', async () => {
  const dayCounts = ['windowDays', 'fibreStreakDays', 'fibreReviewWindow', 'fibreReviewBadDays',
    'vetWindowDays', 'fibreStepBackDays', 'fibreReviewMinDays'];
  for (const key of dayCounts) {
    for (const value of [1.00000001, 1.99999999]) {
      const data = healthyBackup();
      data.settings = { [key]: value };
      await assertRejectedBeforeWrite(data, `${key}=${value}`);
    }
  }
});

test('active numeric settings reject explicit null; all numeric settings reject strings, booleans and nonfinite values', async () => {
  const defaults = makeHarness().api.DEFAULTS;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (typeof defaultValue !== 'number') continue;
    const invalid = [String(defaultValue), true, false, {}, []];
    if (!legacyNumbers.includes(key)) invalid.unshift(null);
    for (const value of invalid) {
      const data = healthyBackup();
      data.settings = { [key]: value };
      await assertRejectedBeforeWrite(data, `${key}=${JSON.stringify(value)}`);
    }
    const h = makeHarness();
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => h.api.validateBackup({ days: {}, settings: { [key]: value } }), /Invalid backup/, `${key} must reject ${value}`);
    }
    await assertRejectedBeforeWrite(`{"days":{},"settings":{"${key}":1e309}}`, key + '=JSON overflow');
  }
});

test('inactive and overridden legacy numeric fields retain finite-or-null import compatibility', async () => {
  for (const key of legacyNumbers) {
    for (const value of [null, 0, -1, 0.25, 10001]) {
      const h = makeHarness();
      const data = { days: {}, settings: { [key]: value } };
      assert.equal(h.api.validateBackup(data), data);
      await h.api.importJson(importFile(data));
      assert.equal(h.storageWrites.length, 1, `${key}=${value}`);
      const operation = JSON.parse([...h.storage.values()][0]);
      assert.equal(operation.items[0].patch[key], value, 'queued backup preserves the legacy value');
    }
  }
});

test('invalid tail entries fail preflight even when newer local days would otherwise skip them', async () => {
  const data = healthyBackup();
  delete data.days['2026-10-27'].stools[0].id;
  await assertRejectedBeforeWrite(data, 'invalid older skipped day', {
    days: { '2026-10-27': { updatedAt: '2026-10-28T20:00:00.000Z', weight: 18.7 } },
  });
});

test('invalid settings fail preflight even when already-saved settings would otherwise skip them', async () => {
  const data = healthyBackup();
  data.settings.kcalPerGDarf = 0;
  await assertRejectedBeforeWrite(data, 'invalid skipped setting', { savedSettings: { kcalPerGDarf: 4.62 } });
});

test('healthy merge keeps newer local days and existing change IDs/settings', async () => {
  const data = healthyBackup();
  const retainedDay = { updatedAt: '2026-10-28T20:00:00.000Z', weight: 18.7 };
  const retainedChange = { id: 'stable-change-a', date: '2026-10-27', deltaG: 8 };
  const h = makeHarness({
    days: { '2026-10-27': retainedDay }, changes: [retainedChange],
    savedSettings: { targetKcal: 1300 },
  });
  h.api.S.settings.targetKcal = 1300;
  await h.api.importJson(importFile(data));
  assert.equal(h.storageWrites.length, 1);
  const operation = JSON.parse([...h.storage.values()][0]);
  assert.deepEqual(operation.items.map(item => [item.col, item.id]), [['days', '2026-10-26'], ['settings', 'main']]);
  assert.deepEqual(operation.items[1].patch, { kcalPerGDarf: 4.62 });
  assert.deepEqual(clone(h.api.S.days['2026-10-27']), retainedDay);
  assert.deepEqual(clone(h.api.S.changes), [retainedChange]);
  assert.equal(h.api.S.settings.targetKcal, 1300);
});

test('malformed JSON and oversized backups fail without writes; a later valid import still succeeds', async () => {
  await assertRejectedBeforeWrite('{"days":', 'malformed JSON');
  const h = makeHarness();
  await h.api.importJson({ size: 10 * 1024 * 1024 + 1, text: async () => { throw new Error('Oversized file must not be read'); } });
  assert.equal(h.api.S.banner.title, 'Import failed');
  assert.match(h.api.S.banner.text, /10 MB/);
  assert.equal(h.storageWrites.length, 0);
  await h.api.importJson(importFile(healthyBackup()));
  assert.equal(h.storageWrites.length, 1, 'failure releases the importing guard');
  assert.equal(h.api.S.banner.title, 'Import saved locally');
});

async function acceptBackup(data) {
  const h = makeHarness(), original = clone(data);
  assert.equal(h.api.validateBackup(data), data);
  assert.deepEqual(data, original, 'validation must not normalize the backup');
  await h.api.importJson(importFile(data));
  assert.equal(h.api.S.banner.title, 'Import saved locally');
  assert.equal(h.storageWrites.length, 1, 'one aggregate durable write');
  assert.equal(h.backendCalls.length, 0);
  return { h, items: JSON.parse([...h.storage.values()][0]).items };
}

test('schedule boundary/fractional quantities, same-date ordering and extra fields survive import', async () => {
  for (const [key, unit] of [['oilSchedule', 'ml'], ['fibreSchedule', 'g']]) {
    const data = healthyBackup();
    const entries = [10000, 0.25, 0].map((value, index) => ({ from: '2026-10-01', [unit]: value, note: 'original-' + index }));
    data.settings = { [key]: entries };
    const { h, items } = await acceptBackup(data);
    assert.deepEqual(items.find(item => item.col === 'settings').patch[key], entries);
    assert.deepEqual(clone(h.api.S.settings[key]), entries);
  }
});

test('schedule quantities reject null, missing, wrong types, out-of-range and nonfinite values before writes', async () => {
  for (const [key, unit] of [['oilSchedule', 'ml'], ['fibreSchedule', 'g']]) {
    for (const value of [undefined, null, '4', true, false, {}, [], -0.01, 10000.01, 1e308]) {
      const data = healthyBackup();
      data.settings = { [key]: [{ from: '2026-10-01', [unit]: 4 }, { from: '2026-10-02', [unit]: value }] };
      await assertRejectedBeforeWrite(data, `${key}.${unit}=${JSON.stringify(value)}`);
    }
    const h = makeHarness();
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => h.api.validateBackup({ days: {}, settings: { [key]: [{ from: '2026-10-01', [unit]: value }] } }), /Invalid backup/);
    }
    await assertRejectedBeforeWrite(`{"days":{},"settings":{"${key}":[{"from":"2026-10-01","${unit}":1e309}]}}`, key + ' JSON overflow');
  }
});

test('present schedule/regime collections require arrays and validate every entry', async () => {
  for (const key of ['oilSchedule', 'fibreSchedule', 'regimeChanges']) {
    for (const value of [null, false, true, '', 4, {}]) {
      const data = healthyBackup(); data.settings = { [key]: value };
      await assertRejectedBeforeWrite(data, `${key}=${JSON.stringify(value)}`);
    }
    const unit = key === 'oilSchedule' ? 'ml' : 'g';
    const good = key === 'regimeChanges' ? '2026-10-01' : { from: '2026-10-01', [unit]: 4 };
    const badEntries = key === 'regimeChanges'
      ? [null, {}, false, 7, '2026-02-30', '2026-1-01']
      : [null, [], {}, { from: '2026-02-30', [unit]: 4 }, { from: null, [unit]: 4 }];
    for (const entry of badEntries) {
      const data = healthyBackup(); data.settings = { [key]: [good, entry] };
      await assertRejectedBeforeWrite(data, key + ' invalid later entry');
    }
  }
});

test('signed adjustment boundaries, fractional changes and zero preserve their payload', async () => {
  const data = healthyBackup();
  data.changes = [-10000, -0.25, 0, 0.25, 10000].map((deltaG, index) => ({
    id: 'change-' + index, date: '2026-10-27', deltaG, note: 'keep-' + index,
  }));
  const { h, items } = await acceptBackup(data);
  assert.deepEqual(items.filter(item => item.col === 'changes').map(item => item.patch), data.changes);
  assert.deepEqual(clone(h.api.S.changes), data.changes);
});

test('late adjustment records reject missing, wrong-type, nonfinite and excessive deltas before writes', async () => {
  for (const deltaG of [undefined, null, '5', false, true, {}, [], -10000.01, 10000.01, -1e308, 1e308]) {
    const data = healthyBackup();
    data.changes.push({ id: 'bad-change', date: '2026-10-28', deltaG });
    await assertRejectedBeforeWrite(data, 'change deltaG=' + JSON.stringify(deltaG));
  }
  const h = makeHarness();
  for (const deltaG of [NaN, Infinity, -Infinity]) {
    assert.throws(() => h.api.validateBackup({ days: {}, changes: [{ id: 'bad-change', date: '2026-10-28', deltaG }] }), /Invalid backup/);
  }
  for (const overflow of ['1e309', '-1e309']) {
    await assertRejectedBeforeWrite(`{"days":{},"changes":[{"id":"bad-change","date":"2026-10-28","deltaG":${overflow}}]}`, 'change JSON overflow');
  }
});

test('present startDate, theme and regime-suppression settings reject wrong types and unsupported values', async () => {
  const invalid = {
    startDate: [null, false, 20261028, {}, '', '2026-02-30', '2026-1-01', '2026-10-28T00:00:00Z'],
    theme: [null, false, true, 1, {}, [], '', 'sepia', 'DARK'],
    suppressOnRegimeChange: [null, 'false', 0, 1, {}, []],
  };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    const data = healthyBackup(); data.settings = { [key]: value };
    await assertRejectedBeforeWrite(data, `${key}=${JSON.stringify(value)}`);
  }
});

test('valid calendar dates, all themes, both booleans and empty arrays remain importable', async () => {
  for (const theme of ['system', 'light', 'dark']) for (const suppressOnRegimeChange of [false, true]) {
    const data = healthyBackup();
    data.settings = { startDate: '2024-02-29', theme, suppressOnRegimeChange, oilSchedule: [], fibreSchedule: [], regimeChanges: [] };
    const { h, items } = await acceptBackup(data);
    assert.deepEqual(items.find(item => item.col === 'settings').patch, data.settings);
    for (const [key, value] of Object.entries(data.settings)) assert.deepEqual(clone(h.api.S.settings[key]), value);
  }
});

test('strict setting validation runs even when existing saved settings would skip every invalid key', async () => {
  const invalid = { startDate: null, oilSchedule: null, fibreSchedule: null, regimeChanges: null, suppressOnRegimeChange: 'false', theme: 'sepia' };
  const defaults = clone(makeHarness().api.DEFAULTS);
  for (const [key, value] of Object.entries(invalid)) {
    const data = healthyBackup(); data.settings = { [key]: value };
    await assertRejectedBeforeWrite(data, 'invalid skipped ' + key, { savedSettings: { [key]: defaults[key] } });
  }
});

test('adjustment bounds apply even when the same change ID already exists locally', async () => {
  const data = healthyBackup();
  data.changes[0].deltaG = 10000.01;
  await assertRejectedBeforeWrite(data, 'invalid skipped change', {
    changes: [{ id: 'stable-change-a', date: '2026-10-27', deltaG: -5 }],
  });
});

test('omitted or null settings preserve defaults, and ordinary imported quantities produce a finite bowl', async () => {
  for (const nullSettings of [false, true]) {
    const data = healthyBackup();
    if (nullSettings) data.settings = null; else delete data.settings;
    const { h, items } = await acceptBackup(data);
    assert.ok(items.every(item => item.col !== 'settings'));
    assert.deepEqual(clone(h.api.S.settings), clone(h.api.DEFAULTS));
    const meal = h.api.bowlFor('2026-10-28', 'lamb', h.api.S.settings, h.api.S.changes, {});
    assert.equal(meal.darfG, 125, 'default October ration with the imported -5 g adjustment');
    assert.equal(meal.oilMl, 4);
    assert.equal(meal.fibreG, 2.5);
    assert.ok(Object.values(meal).filter(value => typeof value === 'number').every(Number.isFinite));
  }
  const data = healthyBackup();
  data.settings = { oilSchedule: [{ from: '2026-10-01', ml: 0 }], fibreSchedule: [{ from: '2026-10-01', g: 3.75 }] };
  const { h } = await acceptBackup(data);
  const meal = h.api.bowlFor('2026-10-28', 'lamb', h.api.S.settings, h.api.S.changes, {});
  assert.equal(meal.oilMl, 0);
  assert.equal(meal.fibreG, 3.75);
  assert.ok(Object.values(meal).filter(value => typeof value === 'number').every(Number.isFinite));
});
