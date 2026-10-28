'use strict';

// node --test --test-isolation=none tests/restore-sync.test.cjs
// APP_HTML may point at the pre-fix app for the regression check. This harness
// loads the actual application module; its Firebase adapter is entirely local.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const htmlPath = process.env.APP_HTML ? path.resolve(process.env.APP_HTML) : path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const moduleMatch = html.match(/<script\s+type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, 'Application module is present');
const importNames = [];
const moduleSource = moduleMatch[1].replace(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];\s*/gm, (_, names) => {
  importNames.push(...names.split(',').map(name => name.trim()));
  return '';
});
assert.doesNotMatch(moduleSource, /^\s*import\s/m, 'Every SDK import needs an explicit stub');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sortedFields = value => Array.isArray(value) ? value.map(sortedFields)
  : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedFields(value[key])])) : value;
const deleted = Object.freeze({ testDeleteField: true });
function merge(base, patch) {
  const result = copy(base || {});
  for (const [key, value] of Object.entries(patch)) {
    if (value === deleted) delete result[key];
    else result[key] = isObject(value) ? merge(result[key], value) : copy(value);
  }
  return result;
}
const empty = () => ({ days: {}, changes: {}, settings: {} });

function makeHarness({ server = empty(), storage: restoredStorage, sortSnapshotFields = false, localWriteSnapshots = false, separateWatchCache = false } = {}) {
  const remote = { ...empty(), ...copy(server) };
  const watchCache = empty();
  const snapshotData = value => sortSnapshotFields ? sortedFields(copy(value)) : copy(value);
  const storage = new Map(restoredStorage || []);
  const subscriptions = new Map(), nodes = new Map(), downloads = [];
  const serverWrites = [], transactions = [], failures = new Set();
  let held = true;
  const waitingLocks = [];
  const controls = { beforeTransaction: null, beforeSet: null, afterRead: null, beforeCommit: null, afterTransaction: null, retryTransaction: null, beforeRemoveItem: null };
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      id: selector.startsWith('#') ? selector.slice(1) : '',
      value: '', textContent: '', innerHTML: '', content: '', dataset: {},
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, setAttribute() {}, removeAttribute() {},
      getBoundingClientRect: () => ({ height: 0 }),
      querySelector: element, querySelectorAll: () => [], contains: () => false,
    });
    return nodes.get(selector);
  };
  const document = {
    querySelector: element, querySelectorAll: () => [], getElementById: id => element('#' + id),
    addEventListener() {}, documentElement: element('html'), activeElement: element('body'),
  };
  const docData = ref => ref.col === 'settings' ? remote.settings : remote[ref.col][ref.id];
  const snapshot = value => ({ exists: () => value !== undefined, data: () => snapshotData(value), metadata: { fromCache: false } });
  const applySet = (ref, patch, options) => {
    const next = options?.merge ? merge(docData(ref), patch) : copy(patch);
    if (ref.col === 'settings') remote.settings = next;
    else remote[ref.col][ref.id] = next;
    serverWrites.push({ col: ref.col, id: ref.id, patch: copy(patch) });
  };
  const forbidden = name => () => { throw new Error('Unexpected external operation: ' + name); };
  const firebase = {
    initializeApp: () => ({}), getAuth: () => ({}), initializeFirestore: () => ({}),
    persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    onAuthStateChanged: () => () => {}, signInWithEmailAndPassword: forbidden('sign in'), signOut: forbidden('sign out'),
    doc: (_db, col, id) => ({ col, id }), collection: (_db, col) => ({ col }),
    onSnapshot(ref, _options, callback) {
      subscriptions.set(ref.col, callback);
      return () => subscriptions.delete(ref.col);
    },
    deleteField: () => deleted,
    async setDoc(ref, patch, options) {
      if (controls.beforeSet) await controls.beforeSet(ref, patch);
      applySet(ref, patch, options);
      if (localWriteSnapshots) {
        const current = ref.col === 'settings' ? watchCache.settings : watchCache[ref.col][ref.id];
        const next = options?.merge ? merge(current, patch) : copy(patch);
        const records = ref.col === 'settings' ? next : { ...watchCache[ref.col], [ref.id]: next };
        emit(ref.col, records, { changedIds: [ref.id], hasPendingWrites: true });
      }
    },
    async deleteDoc(ref) {
      delete remote[ref.col][ref.id];
      if (localWriteSnapshots) {
        const records = { ...watchCache[ref.col] };
        delete records[ref.id];
        emit(ref.col, records, { changedIds: [ref.id], hasPendingWrites: true });
      }
    },
    async runTransaction(_db, callback) {
      const ordinal = transactions.length + 1;
      const transaction = { ordinal, reads: [], attempts: 0 };
      transactions.push(transaction);
      if (controls.beforeTransaction) await controls.beforeTransaction(ordinal);
      if (failures.delete(ordinal)) throw new Error('Synthetic interrupted transaction');
      for (;;) {
        const attempt = ++transaction.attempts;
        assert.ok(attempt <= 5, 'Synthetic transaction retries stay bounded');
        const pending = [];
        const result = await callback({
          get: async ref => {
            transaction.reads.push({ col: ref.col, id: ref.id, attempt });
            const value = copy(docData(ref));
            if (controls.afterRead) await controls.afterRead({ ordinal, attempt, ref, value });
            return snapshot(value);
          },
          set: (ref, patch, options) => pending.push({ ref, patch, options }),
          delete: ref => pending.push({ ref, erase: true }),
        });
        if (controls.beforeCommit) await controls.beforeCommit({ ordinal, attempt });
        if (controls.retryTransaction && await controls.retryTransaction({ ordinal, attempt })) continue;
        // Atomic per transaction. Deliberately emit NO subscription callback;
        // a skipped write need not generate a subsequent server data snapshot.
        for (const item of pending) {
          if (item.erase) delete remote[item.ref.col][item.ref.id];
          else applySet(item.ref, item.patch, item.options);
        }
        if (controls.afterTransaction) await controls.afterTransaction({ ordinal, attempt });
        return result;
      }
    },
  };
  for (const name of importNames) assert.ok(Object.hasOwn(firebase, name), 'Unstubbed SDK import: ' + name);
  const context = vm.createContext({
    ...firebase, document, console, URL, Blob, crypto: { randomUUID },
    navigator: { onLine: true, locks: {
      request(_name, callback) {
        if (!held) return Promise.resolve().then(callback);
        return new Promise((resolve, reject) => waitingLocks.push({ callback, resolve, reject }));
      },
    } },
    localStorage: {
      get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => {
        if (controls.beforeRemoveItem) controls.beforeRemoveItem(key);
        storage.delete(key);
      },
    },
    window: { addEventListener() {}, AppShell: { ready() {} } },
    ResizeObserver: class { observe() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    setInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: forbidden('network'),
    confirm: forbidden('confirmation'), prompt: forbidden('prompt'),
    captureDownload: (...args) => downloads.push(args),
  });
  vm.runInContext(moduleSource + `
    render = () => {};
    renderFeedback = () => {};
    download = captureDownload;
    globalThis.testApi = { S, DEFAULTS, write, flushWrites, subscribe, queuedWrites, importJson, exportAll, moveStool, oilMlOn };
  `, context, { filename: htmlPath, timeout: 5000 });
  const api = context.testApi;
  api.S.user = { uid: 'restore-test-only', email: 'test.invalid' };
  function emit(col, records = separateWatchCache ? watchCache[col] : remote[col], { fromCache = false, changed = true, changedIds, hasPendingWrites = false } = {}) {
    const callback = subscriptions.get(col);
    assert.ok(callback, 'Subscription exists for ' + col);
    const previous = watchCache[col];
    watchCache[col] = copy(records);
    if (col === 'settings') callback({ ...snapshot(copy(records)), metadata: { fromCache, hasPendingWrites } });
    else callback({
      docs: Object.entries(records || {}).map(([id, value]) => ({ id, data: () => snapshotData(value) })),
      docChanges: () => changed ? (changedIds || Object.keys(records || {})).map(id => ({
        type: Object.hasOwn(records || {}, id) ? (Object.hasOwn(previous || {}, id) ? 'modified' : 'added') : 'removed',
        doc: { id, data: () => snapshotData(records?.[id] ?? previous?.[id]) },
      })) : [], metadata: { fromCache, hasPendingWrites },
    });
  }
  function start(local = empty(), order = ['days', 'changes', 'settings']) {
    api.subscribe();
    for (const col of order) emit(col, local[col], { fromCache: true });
  }
  async function drain() {
    const pending = api.flushWrites();
    held = false;
    for (const request of waitingLocks.splice(0)) Promise.resolve().then(request.callback).then(request.resolve, request.reject);
    await pending;
  }
  async function importData(data) {
    const text = JSON.stringify(data);
    await api.importJson({ size: Buffer.byteLength(text), text: async () => text });
    assert.equal(api.S.banner?.title, 'Import saved locally');
  }
  function exported() {
    api.exportAll();
    return JSON.parse(downloads.at(-1)[1]);
  }
  return { api, remote, watchCache, storage, serverWrites, transactions, failures, controls, emit, start, drain, importData, exported };
}

const date = '2026-10-27';
const time = hour => `2026-10-28T${String(hour).padStart(2, '0')}:00:00.000Z`;
const oldDay = { date, updatedAt: time(8), weight: 18.1 };
const importedDay = { date, updatedAt: time(11), weight: 18.5, notes: 'backup only' };
const newerDay = { date, updatedAt: time(12), weight: 18.9, notes: 'server retained' };
const cached = () => ({ ...empty(), days: { [date]: copy(oldDay) } });
const change = (id, deltaG) => ({ id, date, deltaG, source: 'manual' });
function assertDrained(h) {
  assert.equal(h.api.queuedWrites().length, 0);
  assert.equal(h.api.S.status, 'Synced');
}
function assertDayAndExport(h, expected) {
  assert.deepEqual(copy(h.api.S.days[date]), expected);
  assert.deepEqual(h.exported().days[date], expected);
}

test('an uncontested import writes its records once and drains the durable queue', async () => {
  const h = makeHarness();
  h.start();
  const added = change('new-change', -2.5);
  await h.importData({ days: { [date]: importedDay }, changes: [added], settings: { theme: 'dark' } });
  assert.equal(h.api.queuedWrites().length, 1);
  await h.drain();
  assert.equal(h.serverWrites.length, 3);
  assertDayAndExport(h, importedDay);
  assert.deepEqual(copy(h.api.S.changes), [added]);
  assert.equal(h.api.S.settings.theme, 'dark');
  assert.equal(h.remote.settings.theme, 'dark');
  assertDrained(h);
});

for (const [label, retained] of [['newer', newerDay], ['equal timestamp', { ...newerDay, updatedAt: time(11) }]]) {
  test(`restore skipped for a ${label} server day reconciles screen and export without a later snapshot`, async () => {
    const h = makeHarness({ server: { ...empty(), days: { [date]: retained } } });
    h.start(cached());
    await h.importData({ days: { [date]: importedDay } });
    assert.equal(h.api.S.days[date].weight, importedDay.weight, 'backup initially overlays the older cache');
    await h.drain();
    assert.equal(h.serverWrites.length, 0);
    assert.deepEqual(h.remote.days[date], retained);
    assertDayAndExport(h, retained);
    assertDrained(h);
  });
}

test('accepted day restore retains server-only fields immediately, without waiting for a subscription', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: { ...oldDay, walkMin: 42 } } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay } });
  await h.drain();
  assert.equal(h.serverWrites.length, 1);
  assertDayAndExport(h, { ...oldDay, walkMin: 42, ...importedDay });
  assertDrained(h);
});

test('an existing server change ID replaces its optimistic imported version after a skipped restore', async () => {
  const kept = change('c1', 8);
  const h = makeHarness({ server: { ...empty(), changes: { c1: kept } } });
  h.start();
  await h.importData({ days: {}, changes: [change('c1', -5)] });
  await h.drain();
  assert.equal(h.serverWrites.length, 0);
  assert.deepEqual(copy(h.api.S.changes), [kept]);
  assert.deepEqual(h.exported().changes, [kept]);
  assertDrained(h);
});

test('settings restore keeps server keys and reconciles newly accepted keys with no subsequent snapshot', async () => {
  const h = makeHarness({ server: { ...empty(), settings: { theme: 'dark', targetKcal: 1300 } } });
  h.start();
  await h.importData({ days: {}, settings: { theme: 'light', targetKcal: 1240, bdGrams: 550 } });
  await h.drain();
  assert.equal(h.serverWrites.length, 1);
  assert.deepEqual(h.remote.settings, { theme: 'dark', targetKcal: 1300, bdGrams: 550 });
  for (const [key, value] of Object.entries(h.remote.settings)) {
    assert.equal(h.api.S.settings[key], value, key);
    assert.equal(h.exported().settings[key], value, 'export ' + key);
  }
  assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
  assertDrained(h);
});

test('one mixed import reconciles accepted and skipped days, changes and settings', async () => {
  const second = '2026-10-26', kept = change('c1', 8), added = change('c2', -2.5);
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay }, changes: { c1: kept }, settings: { theme: 'dark' } } });
  h.start(cached());
  await h.importData({
    days: { [date]: importedDay, [second]: { date: second, updatedAt: time(11), weight: 18.6 } },
    changes: [change('c1', -5), added], settings: { theme: 'light', bdGrams: 550 },
  });
  assert.equal(h.api.queuedWrites().length, 1, 'aggregate remains one durable import');
  await h.drain();
  assert.equal(h.serverWrites.length, 3);
  assert.deepEqual(copy(h.api.S.days), h.remote.days);
  assert.deepEqual(h.exported().days, h.remote.days);
  assert.deepEqual(copy(h.api.S.changes), [kept, added]);
  assert.equal(h.api.S.settings.theme, 'dark');
  assert.equal(h.api.S.settings.bdGrams, 550);
  assertDrained(h);
});

test('early settings and changes snapshots survive the first days snapshot and queued restore replay', async () => {
  const kept = change('c1', 8);
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay }, changes: { c1: kept }, settings: { theme: 'dark' } } });
  h.api.subscribe();
  await h.importData({ days: { [date]: importedDay }, changes: [change('c1', -5)], settings: { theme: 'light' } });
  h.emit('settings'); h.emit('changes'); h.emit('days');
  assert.deepEqual(copy(h.api.S.changes), [kept]);
  assert.equal(h.api.S.settings.theme, 'dark');
  assertDayAndExport(h, newerDay);
  await h.drain();
  assertDayAndExport(h, newerDay);
  assert.equal(h.serverWrites.length, 0);
  assertDrained(h);
});

test('a newer server snapshot received while an import is queued is not covered by a stale restore', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay } });
  h.emit('days');
  assertDayAndExport(h, newerDay);
  await h.drain();
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('later queued day and settings edits stay visible during restore reconciliation and subsequently sync', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay }, settings: { theme: 'dark' } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay }, settings: { theme: 'light' } });
  const patch = { weight: 19.1, updatedAt: time(13) };
  await h.api.write({ col: 'days', id: date, patch });
  await h.api.write({ col: 'settings', id: 'main', patch: { theme: 'system' } });
  let checked = false;
  h.controls.beforeSet = () => {
    checked = true;
    assert.equal(h.api.S.days[date].weight, 19.1, 'pending user edit survives the skipped restore');
    assert.equal(h.api.S.settings.theme, 'system', 'pending settings edit survives reconciliation');
  };
  await h.drain();
  assert.ok(checked);
  assertDayAndExport(h, { ...newerDay, ...patch });
  assert.equal(h.remote.settings.theme, 'system');
  assert.equal(h.api.S.settings.theme, 'system');
  assertDrained(h);
});

test('an interrupted mixed import retries committed items without resurrecting superseded backup data', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay }, changes: [change('c1', -5)] });
  h.failures.add(2);
  await h.drain();
  assert.equal(h.serverWrites.length, 1, 'first item committed before the synthetic failure');
  assert.equal(h.api.queuedWrites().length, 1);
  assert.equal(h.api.S.status, 'Saved locally; retry sync');
  h.remote.days[date] = copy(newerDay);
  h.remote.changes.c1 = change('c1', 8);
  await h.api.flushWrites();
  assert.equal(h.serverWrites.length, 1, 'retry skips both newer server records');
  assertDayAndExport(h, newerDay);
  assert.deepEqual(copy(h.api.S.changes), [change('c1', 8)]);
  assertDrained(h);
});

test('reload with a durable outbox reconciles against server snapshots arriving before days', async () => {
  const server = { ...empty(), days: { [date]: newerDay }, changes: { c1: change('c1', 8) }, settings: { theme: 'dark' } };
  const first = makeHarness({ server });
  first.start(cached());
  await first.importData({ days: { [date]: importedDay }, changes: [change('c1', -5)], settings: { theme: 'light' } });
  const reloaded = makeHarness({ server, storage: [...first.storage] });
  reloaded.start(server, ['settings', 'changes', 'days']);
  await reloaded.drain();
  assertDayAndExport(reloaded, newerDay);
  assert.deepEqual(copy(reloaded.api.S.changes), [change('c1', 8)]);
  assert.equal(reloaded.api.S.settings.theme, 'dark');
  assert.equal(reloaded.serverWrites.length, 0);
  assertDrained(reloaded);
});

function stoolLocations(days, id) {
  return Object.entries(days).flatMap(([day, record]) => (record.stools || []).filter(stool => stool.id === id).map(() => day));
}

for (const destinations of [['2026-10-26'], ['2026-10-26', '2026-10-25']]) {
  test(`pending stool move ${[date, ...destinations].join(' → ')} survives every preceding restore acknowledgement`, async () => {
    const original = { id: 'moving-stool', time: '08:00', bristol: 3 };
    const serverStool = { ...original, bristol: 4, serverOnly: 'retain with moved record' };
    const h = makeHarness({ server: { ...empty(), days: { [date]: { ...newerDay, stools: [serverStool] } } } });
    h.start({ ...empty(), days: { [date]: { ...oldDay, stools: [original] } } });
    await h.importData({ days: { [date]: { ...importedDay, stools: [original] } } });
    let from = date;
    for (const destination of destinations) {
      const current = copy(h.api.S.days[from].stools[0]);
      assert.equal(await h.api.moveStool(from, destination, current, current), true);
      from = destination;
    }
    const finalDate = destinations.at(-1);
    h.controls.beforeTransaction = () => assert.deepEqual(stoolLocations(h.api.S.days, original.id), [finalDate], 'pending move chain stays projected while earlier operations finish');
    await h.drain();
    assert.deepEqual(stoolLocations(h.remote.days, original.id), [finalDate]);
    assert.deepEqual(stoolLocations(h.api.S.days, original.id), [finalDate]);
    assert.deepEqual(copy(h.api.S.days[finalDate].stools[0]), serverStool, 'move transfers the authoritative source record');
    assert.deepEqual(copy(h.api.S.days), h.remote.days);
    assert.deepEqual(h.exported().days, h.remote.days);
    assertDrained(h);
  });
}

test('ordinary writes acknowledged before a restore retain another day, settings and change without snapshots', async () => {
  const other = '2026-10-24', kept = change('kept-change', 8), added = change('ordinary-change', -2.5);
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay }, changes: { [kept.id]: kept } } });
  h.start(cached());
  await h.api.write({ col: 'days', id: other, patch: { date: other, updatedAt: time(13), weight: 18.4 } });
  await h.api.write({ col: 'settings', id: 'main', patch: { theme: 'dark' } });
  await h.api.write({ col: 'changes', id: added.id, patch: added });
  await h.importData({ days: { [date]: importedDay }, changes: [change(kept.id, -5)], settings: { theme: 'light', bdGrams: 550 } });
  await h.drain();
  assertDayAndExport(h, newerDay);
  assert.deepEqual(copy(h.api.S.days[other]), h.remote.days[other]);
  assert.deepEqual(Object.fromEntries(copy(h.api.S.changes).map(record => [record.id, record])), h.remote.changes);
  assert.equal(h.api.S.settings.theme, 'dark');
  assert.equal(h.api.S.settings.bdGrams, 550);
  assertDrained(h);
});

for (const col of ['days', 'changes', 'settings']) for (const timing of ['during its read', 'before its promise resolves']) {
  test(`a newer ${col} snapshot arriving ${timing} outranks the older transaction receipt`, async () => {
    const initialServer = { ...empty(), days: { [date]: newerDay }, changes: { c1: change('c1', 8) }, settings: { theme: 'dark', targetKcal: 1300 } };
    const h = makeHarness({ server: initialServer });
    h.start(cached());
    const data = col === 'days' ? { days: { [date]: importedDay } }
      : col === 'changes' ? { days: {}, changes: [change('c1', -5)] }
      : { days: {}, settings: { theme: 'light', targetKcal: 1240 } };
    await h.importData(data);
    const emitNewerSnapshot = ({ ordinal }) => {
      if (ordinal !== 1) return;
      if (col === 'days') h.remote.days[date] = { ...newerDay, updatedAt: time(13), weight: 19.2 };
      else if (col === 'changes') h.remote.changes.c1 = change('c1', 9);
      else h.remote.settings = { theme: 'system', targetKcal: 1400 };
      h.emit(col);
    };
    h.controls[timing === 'during its read' ? 'afterRead' : 'afterTransaction'] = emitNewerSnapshot;
    await h.drain();
    assert.equal(h.serverWrites.length, 0);
    if (col === 'days') assertDayAndExport(h, h.remote.days[date]);
    else if (col === 'changes') assert.deepEqual(copy(h.api.S.changes), [h.remote.changes.c1]);
    else {
      assert.equal(h.api.S.settings.theme, 'system');
      assert.equal(h.api.S.settings.targetKcal, 1400);
      assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
    }
    assertDrained(h);
  });
}

test('a settings metadata callback during a restore read does not discard its authoritative receipt', async () => {
  const h = makeHarness({ server: { ...empty(), settings: { theme: 'dark', targetKcal: 1300 } } });
  h.start();
  await h.importData({ days: {}, settings: { theme: 'light', targetKcal: 1240 } });
  h.controls.afterRead = () => h.emit('settings', {}, { changed: false });
  await h.drain();
  assert.equal(h.serverWrites.length, 0);
  assert.equal(h.api.S.settings.theme, 'dark');
  assert.equal(h.api.S.settings.targetKcal, 1300);
  assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
  assertDrained(h);
});

for (const callbackType of ['metadata only', 'unrelated document']) {
  test(`a ${callbackType} callback during the transaction read does not invalidate its target receipt`, async () => {
    const other = '2026-10-24', oldOther = { date: other, weight: 18.2, updatedAt: time(8) };
    const newOther = { ...oldOther, weight: 18.3, updatedAt: time(12) };
    const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay, [other]: newOther } } });
    h.start({ ...cached(), days: { [date]: oldDay, [other]: oldOther } });
    await h.importData({ days: { [date]: importedDay } });
    h.controls.afterRead = ({ ordinal, attempt, ref }) => {
      if (ordinal !== 1 || attempt !== 1 || ref.col !== 'days') return;
      // A previously queued listener event can arrive after a transaction read.
      // Its target doc is unchanged in docChanges; only the other doc advances.
      const records = { [date]: oldDay, [other]: callbackType === 'metadata only' ? oldOther : newOther };
      h.emit('days', records, { changed: callbackType !== 'metadata only', changedIds: [other] });
    };
    await h.drain();
    assertDayAndExport(h, newerDay);
    if (callbackType === 'unrelated document') assert.deepEqual(copy(h.api.S.days[other]), newOther);
    assertDrained(h);
  });
}

test('a retried transaction reconciles only its final successful read and commits no aborted attempt', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay } });
  h.controls.retryTransaction = ({ ordinal, attempt }) => {
    if (ordinal !== 1 || attempt !== 1) return false;
    h.remote.days[date] = copy(newerDay);
    return true;
  };
  await h.drain();
  assert.equal(h.transactions.length, 1);
  assert.equal(h.transactions[0].attempts, 2);
  assert.equal(h.serverWrites.length, 0, 'the first callback scheduled a write, but that attempt did not commit');
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('an acknowledged stool delta remains in another day when a later restore rebases without snapshots', async () => {
  const other = '2026-10-24', removed = { id: 'old-stool', time: '07:00', bristol: 3 };
  const added = { id: 'new-stool', time: '08:00', bristol: 4 };
  const otherDay = { date: other, stools: [removed], notes: 'keep this day' };
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay, [other]: otherDay } } });
  h.start({ ...empty(), days: { [date]: oldDay, [other]: otherDay } });
  await h.api.write({ col: 'days', id: other, patch: { date: other, updatedAt: time(13) }, stools: { put: [added], drop: [removed.id] } });
  await h.importData({ days: { [date]: importedDay } });
  await h.drain();
  assert.deepEqual(copy(h.api.S.days[other]), h.remote.days[other]);
  assert.deepEqual(copy(h.api.S.days[other].stools), [added]);
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('accepted stool and change recoveries remain acknowledged across a later restore without snapshots', async () => {
  const other = '2026-10-24', record = { id: 'restored-stool', time: '08:00', bristol: 4 }, restoredChange = change('restored-change', -2.5);
  const otherDay = { date: other, stools: [], notes: 'keep this day' };
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay, [other]: otherDay } } });
  h.start({ ...empty(), days: { [date]: oldDay, [other]: otherDay } });
  await h.api.write({ recover: { id: 'recover-stool-operation', kind: 'stool', date: other, record, index: 0 } });
  await h.api.write({ recover: { id: 'recover-change-operation', kind: 'change', record: restoredChange } });
  await h.importData({ days: { [date]: importedDay } });
  await h.drain();
  assert.deepEqual(copy(h.api.S.days[other]), h.remote.days[other]);
  assert.deepEqual(copy(h.api.S.days[other].stools), [record]);
  assert.deepEqual(copy(h.api.S.changes), [restoredChange]);
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('an acknowledged regime marker is not lost or duplicated when a later restore rebases', async () => {
  const marker = '2026-10-28', prior = '2026-10-20';
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay }, settings: { regimeChanges: [prior], theme: 'dark' } } });
  h.start({ ...cached(), settings: { regimeChanges: [prior], theme: 'dark' } });
  await h.api.write({ regime: { date: marker, count: 1 } });
  await h.importData({ days: { [date]: importedDay } });
  await h.drain();
  assert.deepEqual(copy(h.api.S.settings.regimeChanges), [prior, marker]);
  assert.deepEqual(h.remote.settings.regimeChanges, [prior, marker]);
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('a delayed older same-day snapshot during a newer server read cannot leave Synced showing the older day', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: newerDay } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay } });
  h.controls.afterRead = ({ ordinal, ref }) => {
    if (ordinal === 1 && ref.col === 'days') {
      h.emit('days', { [date]: { ...oldDay, updatedAt: time(9), weight: 18.3 } });
    }
  };
  await h.drain();
  assert.equal(h.serverWrites.length, 0);
  assertDayAndExport(h, newerDay);
  assertDrained(h);
});

test('two ordinary patches in one aggregate preserve both edits when no subscription follows', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  h.start(cached());
  await h.api.write({ items: [
    { col: 'days', id: date, patch: { weight: 19.1, updatedAt: time(13) } },
    { col: 'days', id: date, patch: { notes: 'second edit', updatedAt: time(14) } },
  ] });
  await h.drain();
  const expected = { ...oldDay, weight: 19.1, notes: 'second edit', updatedAt: time(14) };
  assert.deepEqual(h.remote.days[date], expected);
  assertDayAndExport(h, expected);
  assertDrained(h);
});

test('continuously changing snapshots retain the outbox with bounded retry work and converge once the race stops', async () => {
  const h = makeHarness({ server: { ...empty(), settings: { theme: 'dark', targetKcal: 1300 } } });
  h.start();
  await h.importData({ days: {}, settings: { theme: 'light', targetKcal: 1240 } });
  let reads = 0;
  h.controls.afterRead = ({ ref }) => {
    if (ref.col !== 'settings') return;
    if (++reads >= 12) throw Error('Harness stopped unbounded reconciliation reads');
    h.remote.settings = { ...h.remote.settings, targetKcal: 1300 + reads };
    h.emit('settings');
  };
  await h.drain();
  assert.ok(reads > 0 && reads < 12, 'continuous changes stop before the harness safety limit');
  assert.equal(h.api.queuedWrites().length, 1, 'an ambiguous receipt must not clear the durable import');
  assert.equal(h.api.S.status, 'Saved locally; retry sync');
  assert.equal(h.serverWrites.length, 0);
  h.controls.afterRead = null;
  await h.api.flushWrites();
  assert.equal(h.api.S.settings.theme, 'dark');
  assert.equal(h.api.S.settings.targetKcal, h.remote.settings.targetKcal);
  assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
  assertDrained(h);
});

test('an accepted restore echoed by its own watch needs no additional server confirmation read', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  h.start(cached());
  await h.importData({ days: { [date]: importedDay } });
  h.controls.afterTransaction = ({ ordinal }) => {
    if (ordinal === 1) h.emit('days');
  };
  await h.drain();
  assert.equal(h.transactions.length, 1, 'the matching watch already confirms the accepted result');
  assert.equal(h.serverWrites.length, 1);
  assertDayAndExport(h, importedDay);
  assertDrained(h);
});

test('an ordinary write stays queued when confirmation fails and can retry after the network recovers', async () => {
  const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  h.start(cached());
  const patch = { weight: 19.1, updatedAt: time(13) };
  await h.api.write({ col: 'days', id: date, patch });
  h.controls.beforeSet = () => {
    h.remote.days[date] = { ...oldDay, updatedAt: time(9), notes: 'concurrent saved note' };
    h.emit('days');
  };
  h.failures.add(1);
  await h.drain();
  assert.equal(h.transactions.length, 1, 'the conflicting watch requires confirmation');
  assert.equal(h.api.queuedWrites().length, 1, 'a failed confirmation keeps the durable write');
  assert.equal(h.api.S.status, 'Saved locally; retry sync');
  assert.equal(h.remote.days[date].weight, 19.1, 'the original write already reached the server');
  h.controls.beforeSet = null;
  await h.api.flushWrites();
  assertDayAndExport(h, h.remote.days[date]);
  assert.equal(h.api.S.days[date].notes, 'concurrent saved note');
  assertDrained(h);
});

test('failure removing a committed import from local storage survives reload and retries idempotently', async () => {
  const first = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
  first.start(cached());
  await first.importData({ days: { [date]: importedDay } });
  first.controls.beforeRemoveItem = key => {
    if (key.startsWith('murphy-outbox:')) throw Error('Synthetic storage removal failure');
  };
  await first.drain();
  assert.equal(first.serverWrites.length, 1, 'the server commit preceded local outbox removal');
  assert.equal(first.api.queuedWrites().length, 1);
  assert.equal(first.api.S.status, 'Saved locally; retry sync');
  const reloaded = makeHarness({ server: first.remote, storage: [...first.storage] });
  reloaded.start(first.remote);
  await reloaded.drain();
  assert.equal(reloaded.serverWrites.length, 0, 'the equal saved timestamp makes the reload retry a no-op');
  assertDayAndExport(reloaded, importedDay);
  assertDrained(reloaded);
});

for (const delay of [2, 3, 4]) {
  test(`a stale watch between ordinary aggregate patches cannot discard the first edit (${delay} microtasks)`, async () => {
    const h = makeHarness({ server: { ...empty(), days: { [date]: oldDay } } });
    h.start(cached());
    let writes = 0, delayedWatch;
    h.controls.beforeSet = () => {
      if (++writes !== 1) return;
      let pending = Promise.resolve();
      for (let i = 0; i < delay; i++) pending = pending.then(() => {});
      delayedWatch = pending.then(() => h.emit('days', {
        [date]: { ...oldDay, notes: 'stale callback' },
      }, { changedIds: [date] }));
    };
    await h.api.write({ items: [
      { col: 'days', id: date, patch: { date, weight: 18.5 } },
      { col: 'days', id: date, patch: { notes: 'later' } },
    ] });
    await h.drain();
    await delayedWatch;
    const expected = { ...oldDay, weight: 18.5, notes: 'later' };
    assert.equal(writes, 2);
    assert.deepEqual(h.remote.days[date], expected);
    assertDayAndExport(h, expected);
    assertDrained(h);
  });
}

for (const col of ['days', 'settings']) {
  test(`CC3-01: a matching ${col} local watch with SDK field order needs no confirmation transaction`, async () => {
    const initial = { ...empty(), days: { [date]: oldDay }, settings: { theme: 'system', targetKcal: 1240 } };
    const h = makeHarness({ server: initial, sortSnapshotFields: true, localWriteSnapshots: true, separateWatchCache: true });
    h.start(initial);
    const patch = col === 'days'
      ? { meal: { recipe: 'beef', fedAt: '18:00', bowl: 'cleared' }, updatedAt: time(13) }
      : { theme: 'dark', bdGrams: 550, targetKcal: 1300 };
    h.failures.add(1); // A needless confirmation would fail despite the successful ordinary write.
    await h.api.write({ col, id: col === 'days' ? date : 'main', patch });
    await h.drain();
    assert.equal(h.transactions.length, 0, 'object insertion order alone must not cause a network read');
    if (col === 'days') assertDayAndExport(h, h.remote.days[date]);
    else assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
    assertDrained(h);
  });
}

for (const col of ['days', 'changes']) for (const outcome of ['accepted', 'skipped']) for (const action of ['created', 'deleted']) {
  test(`CC3-02: ${outcome} ${col} restore survives an unrelated ${action} document in a lagging collection watch`, async () => {
    const target = col === 'days' ? date : 'restored-change';
    const other = col === 'days' ? '2026-10-24' : 'other-change';
    const otherRecord = col === 'days' ? { date: other, weight: 18.4, updatedAt: time(8) } : change(other, 2);
    const initial = empty(), server = empty();
    if (col === 'days') {
      initial.days[target] = copy(oldDay);
      server.days[target] = copy(outcome === 'accepted' ? oldDay : newerDay);
    } else if (outcome === 'skipped') server.changes[target] = change(target, 8);
    if (action === 'deleted') {
      initial[col][other] = copy(otherRecord);
      server[col][other] = copy(otherRecord);
    }
    const h = makeHarness({ server, separateWatchCache: true, localWriteSnapshots: true });
    h.start(initial);
    await h.importData(col === 'days' ? { days: { [target]: importedDay } } : { days: {}, changes: [change(target, -5)] });
    await h.drain();
    const assertTarget = expected => {
      if (col === 'days') assertDayAndExport(h, expected);
      else {
        assert.deepEqual(copy(h.api.S.changes.find(record => record.id === target)), expected);
        assert.deepEqual(h.exported().changes.find(record => record.id === target), expected);
      }
    };
    assertTarget(h.remote[col][target]);
    assert.deepEqual(h.watchCache[col][target], initial[col][target], 'transaction work does not advance the SDK watch cache');
    await h.api.write(action === 'created' ? { col, id: other, patch: otherRecord } : { col, id: other, erase: true });
    await h.drain();
    assertTarget(h.remote[col][target]);
    assertDrained(h);
    const replacement = col === 'days' ? { ...newerDay, weight: 19.3, updatedAt: time(13) } : change(target, 9);
    h.remote[col][target] = copy(replacement);
    h.emit(col, { ...h.watchCache[col], [target]: replacement }, { changedIds: [target] });
    assertTarget(replacement);
    delete h.remote[col][target];
    const afterDeletion = { ...h.watchCache[col] };
    delete afterDeletion[target];
    h.emit(col, afterDeletion, { changedIds: [target] });
    assertTarget(undefined);
    assertDrained(h);
  });
}

for (const col of ['days', 'changes']) {
  test(`CC3-02: queued ${col} work waits for all initial cached snapshots before contacting the server`, async () => {
    const target = col === 'days' ? date : 'restored-change';
    const retained = col === 'days' ? newerDay : change(target, 8);
    const server = empty();
    server[col][target] = copy(retained);
    const h = makeHarness({ server, separateWatchCache: true });
    h.api.subscribe();
    await h.importData(col === 'days' ? { days: { [target]: importedDay } } : { days: {}, changes: [change(target, -5)] });
    await h.drain();
    assert.equal(h.transactions.length, 0);
    assert.equal(h.serverWrites.length, 0);
    assert.equal(h.api.queuedWrites().length, 1);
    h.emit('settings', {}, { fromCache: true });
    h.emit('changes', {}, { fromCache: true });
    await h.api.flushWrites();
    assert.equal(h.transactions.length, 0, 'two initial collections are not a complete baseline');
    assert.equal(h.api.queuedWrites().length, 1);
    h.emit('days', col === 'days' ? { [date]: oldDay } : {}, { fromCache: true });
    await h.drain();
    if (col === 'days') assertDayAndExport(h, retained);
    else {
      assert.deepEqual(copy(h.api.S.changes), [retained]);
      assert.deepEqual(h.exported().changes, [retained]);
    }
    assertDrained(h);
  });
}

for (const outcome of ['accepted', 'skipped']) {
  test(`CC3-02: ${outcome} settings acknowledgement survives unchanged cache metadata but allows real changes and deletion`, async () => {
    const server = { ...empty(), settings: outcome === 'accepted' ? {} : { theme: 'dark', targetKcal: 1300 } };
    const h = makeHarness({ server, separateWatchCache: true, sortSnapshotFields: true });
    h.start();
    await h.importData({ days: {}, settings: { theme: 'light', targetKcal: 1240, bdGrams: 550 } });
    await h.drain();
    const acknowledged = copy(h.remote.settings);
    assert.deepEqual(copy(h.api.S.savedSettings), acknowledged);
    assert.deepEqual(h.watchCache.settings, {}, 'the transaction has not reached the watch cache');
    h.emit('settings', h.watchCache.settings, { changed: false });
    assert.deepEqual(copy(h.api.S.savedSettings), acknowledged, 'unchanged watch data must not roll back a newer acknowledgement');
    for (const [key, value] of Object.entries(acknowledged)) assert.equal(h.exported().settings[key], value);
    h.remote.settings = { theme: 'system', targetKcal: 1400, bdGrams: 570 };
    h.emit('settings', h.remote.settings);
    assert.deepEqual(copy(h.api.S.savedSettings), h.remote.settings);
    assert.equal(h.api.S.settings.targetKcal, 1400);
    h.remote.settings = undefined;
    h.watchCache.settings = undefined;
    h.emit('settings');
    assert.deepEqual(copy(h.api.S.savedSettings), {});
    assert.equal(h.api.S.settings.theme, h.api.DEFAULTS.theme);
    assertDrained(h);
  });
}

test('CC3 comparison control: settings preserve meaningful array order, absent fields and value types', () => {
  const schedule = [{ from: '2026-01-01', ml: 4 }, { from: '2026-01-01', ml: 8 }];
  const settings = { oilSchedule: schedule, eggKcal: null, syntheticFlag: true };
  const initial = { ...empty(), settings };
  const h = makeHarness({ server: initial });
  h.start(initial);
  assert.equal(h.api.oilMlOn(date, h.api.S.settings), 8);
  const reordered = { ...settings, oilSchedule: [...schedule].reverse().map(({ from, ml }) => ({ ml, from })) };
  h.emit('settings', reordered);
  assert.equal(h.api.oilMlOn(date, h.api.S.settings), 4, 'the later same-date schedule entry changes the effective oil amount');
  assert.deepEqual(copy(h.api.S.savedSettings.oilSchedule), reordered.oilSchedule);
  const withoutLegacy = { ...reordered };
  delete withoutLegacy.eggKcal;
  h.emit('settings', withoutLegacy);
  assert.equal(Object.hasOwn(h.api.S.savedSettings, 'eggKcal'), false, 'a removed historical null field is still a data change');
  const changedType = { ...withoutLegacy, syntheticFlag: 'true' };
  h.emit('settings', changedType);
  assert.deepEqual(copy(h.api.S.savedSettings), changedType);
  assert.equal(h.exported().settings.syntheticFlag, 'true', 'boolean and string values must remain distinct');
});
