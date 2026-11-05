'use strict';

// Exercise the actual app and local-only Firebase adapter used by restore-sync.
// APP_HTML can point at the pre-fix app to demonstrate the regressions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const harnessFile = fs.readFileSync(path.join(__dirname, 'restore-sync.test.cjs'), 'utf8');
const marker = "const date = '2026-10-27';";
assert.ok(harnessFile.includes(marker), 'Shared adapter boundary exists');
let harnessSource = harnessFile.split(marker)[0];
const exportsMarker = 'oilMlOn, removeWithUndo, undoRemoval };';
assert.ok(harnessSource.includes(exportsMarker), 'Shared application exports exist');
harnessSource = harnessSource.replace(exportsMarker,
  'oilMlOn, removeWithUndo, undoRemoval, setAsideUnreadable, setAsideOutbox, exportOutboxRecovery };');
harnessSource = harnessSource.replace('return { api, remote, watchCache, storage,', 'return { api, downloads, remote, watchCache, storage,');
const makeHarness = vm.compileFunction(harnessSource + '\nreturn makeHarness;',
  ['require', '__dirname', 'process', 'console'])(require, __dirname, process, console);

const uid = 'restore-test-only';
const prefix = `murphy-outbox-quarantine:${uid}:`;
const key = `murphy-outbox-v2:${uid}:1000-bad`;
const plain = value => JSON.parse(JSON.stringify(value));
function seed(entries) {
  const h = makeHarness({ storage: entries });
  h.start();
  h.api.queuedWrites();
  return h;
}
function recovery(h) {
  h.api.exportOutboxRecovery();
  return JSON.parse(h.downloads.at(-1)[1]);
}

test('legacy and guarded outboxes with the same suffix retain every raw payload', () => {
  const legacy = `murphy-outbox:${uid}:1000-bad`;
  const h = seed([[legacy, '{broken legacy'], [key, '{broken guarded']]);
  assert.equal(h.api.setAsideUnreadable(), true);
  assert.equal(h.storage.has(legacy), false);
  assert.equal(h.storage.has(key), false);
  const copies = plain(h.api.setAsideOutbox());
  assert.equal(new Set(copies.map(item => item.storedAt)).size, 2);
  assert.deepEqual(Object.fromEntries(copies.map(item => [item.key, item.raw])), {
    [legacy]: '{broken legacy', [key]: '{broken guarded',
  });
  assert.deepEqual(recovery(h).setAside, copies);
  assert.deepEqual(h.exported().setAsideOutbox, copies);
  assert.equal(h.api.queuedWrites().length, 0);
});

test('existing destination collisions and repeated set-aside preserve all copies', () => {
  const target = prefix + encodeURIComponent(key);
  const existing = JSON.stringify({ key: 'different-source', raw: 'keep these bytes' });
  const otherAccount = 'murphy-outbox-quarantine:someone-else:kept';
  const h = seed([[key, 'null'], [target, existing], [otherAccount, 'private']]);
  assert.equal(h.api.setAsideUnreadable(), true);
  assert.equal(h.storage.get(target), existing);
  assert.equal(h.api.setAsideOutbox().length, 2);
  h.storage.set(key, 'null');
  h.api.queuedWrites();
  assert.equal(h.api.setAsideUnreadable(), true);
  assert.equal(h.api.setAsideOutbox().length, 2, 'identical source reuses its verified copy');
  assert.equal(h.storage.get(otherAccount), 'private');
  assert.ok(recovery(h).setAside.every(item => item.storedAt.startsWith(prefix)));
});

for (const failAt of [1, 2]) {
  test(`quota failure on copy ${failAt} retains originals for every uncopied entry`, () => {
    const second = key + '-second';
    const h = seed([[key, 'null'], [second, '{broken']]);
    let copies = 0;
    h.controls.beforeSetItem = destination => {
      if (destination.startsWith(prefix) && ++copies === failAt) throw Error('QuotaExceededError');
    };
    assert.equal(h.api.setAsideUnreadable(), false);
    const saved = plain(h.api.setAsideOutbox());
    assert.equal(saved.length, failAt - 1);
    for (const [source, raw] of [[key, 'null'], [second, '{broken']]) {
      assert.ok(h.storage.get(source) === raw || saved.some(item => item.key === source && item.raw === raw));
    }
    assert.match(h.api.S.banner.text, new RegExp(`${failAt - 1} of 2 were set aside`));
    assert.equal(h.storage.get(second), '{broken');
  });
}

test('source changed after queue inspection remains in place without copying stale bytes', () => {
  const h = seed([[key, 'null']]);
  h.storage.set(key, '{newer bytes');
  assert.equal(h.api.setAsideUnreadable(), false);
  assert.equal(h.storage.get(key), '{newer bytes');
  assert.equal(h.api.setAsideOutbox().length, 0);
});

test('source changed during the quarantine copy is retained alongside the copied snapshot', () => {
  const h = seed([[key, 'null']]);
  h.controls.beforeSetItem = destination => {
    if (destination.startsWith(prefix)) h.storage.set(key, '{newer bytes');
  };
  assert.equal(h.api.setAsideUnreadable(), false, 'changed source must not be removed');
  assert.equal(h.storage.get(key), '{newer bytes');
  assert.equal(h.api.setAsideOutbox()[0].raw, 'null');
  assert.match(h.api.S.banner.text, /modified/);
  const exported = recovery(h);
  assert.equal(exported.unreadable[0].raw, '{newer bytes');
  assert.equal(exported.setAside[0].raw, 'null');
});

test('corrupt envelope metadata cannot replace its storage location or disable exports', () => {
  const first = prefix + 'first';
  const second = prefix + 'second';
  const h = seed([
    [first, JSON.stringify({ key: 'a', raw: 'raw-a', storedAt: null })],
    [second, JSON.stringify({ key: 'b', raw: 'raw-b', storedAt: 42 })],
    [prefix + 'third', '{invalid envelope'],
  ]);
  const copies = plain(h.api.setAsideOutbox());
  assert.deepEqual(copies.map(item => item.storedAt), [first, second, prefix + 'third']);
  assert.deepEqual(copies.map(item => item.raw), ['raw-a', 'raw-b', '{invalid envelope']);
  assert.deepEqual(recovery(h).setAside, copies);
  assert.deepEqual(h.exported().setAsideOutbox, copies);
});

test('Full backup retains set-aside data and reimports ordinary records without replaying it', async () => {
  const date = '2026-11-05';
  // This is a valid-looking write: a quarantine entry must never become an outbox entry.
  const heldRaw = JSON.stringify({ col: 'days', id: date, patch: { notes: 'DO NOT REPLAY' } });
  const source = seed([[prefix + 'held', JSON.stringify({ key, raw: heldRaw })]]);
  source.api.S.days[date] = { date, weight: 19.2 };
  const backup = source.exported();
  assert.equal(backup.setAsideOutbox[0].raw, heldRaw);
  const receiving = seed([]);
  await receiving.importData(backup);
  assert.equal(receiving.api.S.days[date].weight, 19.2);
  assert.equal(receiving.api.S.days[date].notes, undefined);
  await receiving.drain();
  assert.equal(receiving.remote.days[date].weight, 19.2);
  assert.equal(receiving.remote.days[date].notes, undefined);
  assert.equal(receiving.api.queuedWrites().length, 0);
  assert.equal(receiving.api.setAsideOutbox().length, 0);
  assert.ok(receiving.serverWrites.every(write => !JSON.stringify(write).includes('DO NOT REPLAY')));
});
