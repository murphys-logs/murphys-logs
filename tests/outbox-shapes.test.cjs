'use strict';

// Exercise the actual outbox and sender through the existing synthetic adapter.
// APP_HTML selects a pre-fix application for fail-before/pass-after verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harnessFile = fs.readFileSync(path.join(__dirname, 'restore-sync.test.cjs'), 'utf8');
const boundary = "const date = '2026-10-27';";
const apiMarker = 'oilMlOn, removeWithUndo, undoRemoval };';
assert.ok(harnessFile.includes(boundary) && harnessFile.includes(apiMarker), 'Expected adapter boundaries');
const source = harnessFile.slice(0, harnessFile.indexOf(boundary)).replace(apiMarker,
  'oilMlOn, removeWithUndo, undoRemoval, validQueuedOp, getUnreadable:()=>unreadableOutbox };');
const { makeHarness, copy } = vm.compileFunction(source + '\nreturn {makeHarness, copy};',
  ['require', '__dirname', 'process', 'console'])(require, __dirname, process, console);

const date = '2026-11-05', destination = '2026-11-04', stamp = '2026-11-05T09:00:00.000Z';
const record = { id: 'saved-stool', time: '08:00', bristol: 4, blood: false };
const change = { id: 'saved-change', date, deltaG: 2, source: 'manual' };
const baseline = () => ({ days: { [date]: { date, weight: 19.1, stools: [record], updatedAt: stamp } },
  changes: {}, settings: { regimeChanges: [] } });
const prefixes = ['murphy-outbox', 'murphy-outbox-guarded', 'murphy-outbox-v2'];
const key = (prefix, suffix) => `${prefix}:restore-test-only:${suffix}`;
const later = { col: 'days', id: date, patch: { notes: 'Later confirmed observation' } };

async function assertIsolated(op, prefix = prefixes[2], suffix = '1793869200000-bad') {
  const raw = typeof op === 'string' ? op : JSON.stringify(op), badKey = key(prefix, suffix);
  const h = makeHarness({ server: baseline(), storage: [[badKey, raw],
    [key(prefixes[2], '1793869200001-later'), JSON.stringify(later)]] });
  h.start(baseline());
  assert.equal(h.api.getUnreadable().length, 1, 'Malformed entry is isolated rather than blocking replay');
  assert.equal(h.api.S.days[date].notes, later.patch.notes, 'Later confirmed observation remains visible');
  assert.equal(h.exported().days[date].notes, later.patch.notes, 'Full backup retains later observation');
  assert.equal(h.storage.get(badKey), raw, 'Original key and raw bytes stay intact');
  await h.drain();
  assert.equal(h.serverWrites.length, 0, 'Unknown dependencies stay held');
  assert.equal(h.api.S.status, 'Sync held · needs attention');
}

test('R2: original malformed aggregates, deltas and null remain isolated across every prefix', async () => {
  for (const prefix of prefixes) for (const malformed of [null, { items: [null] },
    { col: 'days', id: date, stools: { put: [] } }]) await assertIsolated(malformed, prefix);
});

test('R2: every emitted operation family remains readable, including legacy/guarded commands', () => {
  const move = { from: date, to: destination, id: record.id, patch: { blood: true }, updatedAt: stamp };
  const ordinary = { col: 'days', id: date, patch: { date, weight: 19.2, updatedAt: stamp }, remove: [['notes']] };
  const operations = [ordinary,
    { col: 'days', id: date, patch: { date }, stools: { put: [record, { id: 'partial-edit', blood: true }], drop: ['old-stool'] } },
    { col: 'settings', id: 'main', patch: { theme: 'dark', regimeChanges: [destination] } },
    { col: 'settings', id: 'main', patch: { date: 123, updatedAt: { legacy: true } } },
    { col: 'changes', id: change.id, patch: change },
    { col: 'changes', id: change.id, patch: { ...change, updatedAt: { legacy: true } } },
    { col: 'days', id: date, remove: [['stools'], ['updatedAt'], ['meal', 'fedAt']] },
    { col: 'settings', id: 'main', remove: [['regimeChanges']] },
    ...['days', 'settings', 'changes'].map(col => ({ col, id: col === 'days' ? date : col === 'settings' ? 'main' : change.id, erase: true })),
    { regime: { date, count: 1 } }, { regime: { date, drop: true } },
    { regime: { date, count: 2, indices: [0, 2] } },
    { recover: { id: 'undo-stool', kind: 'stool', date, record, index: 0 } },
    { recover: { id: 'undo-change', kind: 'change', record: change } },
    { move, items: [{ col: 'days', id: date, stools: { put: [], drop: [record.id] } },
      { col: 'days', id: destination, stools: { put: [record], drop: [] } }] },
    { items: [{ col: 'days', id: destination, patch: { date: destination, stools: [record], updatedAt: stamp }, restore: true },
      { col: 'settings', id: 'main', patch: { targetKcal: 1240 }, restore: true },
      { col: 'changes', id: change.id, patch: change, restore: true }] },
    { items: [{ items: [ordinary] }] }
  ];
  for (const prefix of prefixes) {
    const h = makeHarness({ storage: operations.map((op, i) => [key(prefix, `17938692000${String(i).padStart(2, '0')}-valid`), JSON.stringify(op)]) });
    assert.equal(h.api.queuedWrites().length, operations.length, prefix);
    assert.equal(h.api.getUnreadable().length, 0, prefix);
  }
});

test('R2: restore commands require the patch that their transaction helper dereferences', async () => {
  for (const col of ['days', 'settings']) {
    const malformed = { col, id: col === 'days' ? date : 'main', restore: true };
    await assertIsolated(malformed);
    await assertIsolated({ items: [malformed] });
  }
});

test('R2: malformed recovery and regime numeric fields are isolated before coercion or looping', async () => {
  const malformed = [
    { recover: { kind: 'stool', date, record, index: { toString: null } } },
    { recover: { kind: 'stool', date, record, updatedAt: { toString: null } } },
    { regime: { date, count: { toString: null } } },
    { regime: { date, count: Number.MAX_SAFE_INTEGER } },
    { regime: { date, count: 3, indices: [0, 1] } },
    { regime: { date, count: 2, indices: [{ toString: null }] } },
    `{"regime":{"date":"${date}","count":1e309}}`
  ];
  for (const op of malformed) {
    // Assert before running the adapter so a regression cannot enter an infinite loop.
    const h = makeHarness();
    assert.equal(h.api.validQueuedOp(typeof op === 'string' ? JSON.parse(op) : op), false);
    await assertIsolated(op);
  }
});

test('R2: malformed timestamp, stool list and regime-list patches cannot poison later replay', async () => {
  for (const op of [
    { col: 'days', id: date, patch: { updatedAt: { toString: null } }, restore: true },
    { col: 'days', id: date, patch: { stools: [null] } },
    { col: 'settings', id: 'main', patch: { regimeChanges: {} } },
    { col: 'changes', id: 'bad-change', patch: { date: { toString: null } } }
  ]) await assertIsolated(op);
});

test('R2: malformed document paths, removal paths and command flags stay recoverable', async () => {
  for (const op of [
    ...['other/document', '.', '..', 'x'.repeat(1500)].map(id => ({ col: 'changes', id, patch: change })),
    { recover: { kind: 'change', record: { ...change, id: 'other/document' } } },
    { col: 'days', id: date, remove: [['__proto__', 'polluted']] },
    { col: 'settings', id: 'main', remove: [['constructor', 'prototype', 'polluted']] },
    { col: 'changes', id: change.id, erase: 'false' },
    { col: 'days', id: date, patch: {}, restore: {} },
    { move: { from: date, to: destination, id: record.id, patch: {} } }
  ]) await assertIsolated(op);
});

test('R2: structures deeper than imported records support are isolated before recursive merging', async () => {
  let extra = 'retained leaf';
  for (let i = 0; i < 33; i++) extra = { next: extra };
  await assertIsolated({ col: 'days', id: date, patch: { extra } });
});

test('R2: removal paths cannot turn array or scalar fields into objects that break later commands', async () => {
  for (const op of [
    { col: 'days', id: date, remove: [['stools', 'bad']] },
    { col: 'settings', id: 'main', remove: [['regimeChanges', 'bad']] },
    { col: 'days', id: date, remove: [['updatedAt', 'toString', 'bad']] },
    { col: 'changes', id: change.id, remove: [['date', 'toString', 'bad']] }
  ]) await assertIsolated(op);
});

test('R2: nested legacy stool Undo receives its durable aggregate timestamp and can drain', async () => {
  const restored = { ...record, id: 'legacy-nested-stool' };
  for (const prefix of prefixes) {
    const op = { items: [{ items: [{ recover: { kind: 'stool', date, record: restored, index: 0 } }] },
      { recover: { kind: 'change', record: change } }] };
    const h = makeHarness({ server: baseline(), storage: [[key(prefix, '1793869200000-legacy-aggregate'), JSON.stringify(op)]] });
    h.start(baseline());
    assert.ok(h.api.S.days[date].stools.some(s => s.id === restored.id));
    assert.equal(h.api.getUnreadable().length, 0);
    await h.drain();
    assert.equal(h.api.queuedWrites().length, 0);
    assert.equal(h.remote.days[date].stools.filter(s => s.id === restored.id).length, 1);
    assert.deepEqual(copy(h.api.S.changes), [change]);
  }
});

test('R2: an unusable legacy recovery key timestamp is isolated before normalization throws', async () => {
  await assertIsolated({ recover: { kind: 'stool', date, record } }, prefixes[1], '0not-a-clock');
  await assertIsolated({ recover: { kind: 'stool', date, record } }, prefixes[1], '1793869200000000000000000-invalid-clock');
});

test('R2: valid moves keep AG-05 semantic conflicts visible and are never syntactically quarantined', async () => {
  const move = { move: { from: date, to: destination, id: 'absent-stool', patch: {}, updatedAt: stamp } };
  const h = makeHarness({ server: baseline(), storage: [[key(prefixes[2], '1793869200000-move'), JSON.stringify(move)]] });
  h.start(baseline());
  await h.drain();
  assert.equal(h.api.getUnreadable().length, 0);
  assert.equal(h.api.queuedWrites().length, 1);
  assert.match(h.api.S.banner.text, /removed or moved elsewhere/);
  assert.equal(h.serverWrites.length, 0);
});

test('R2: valid move and regime Undo still send through their original transaction paths', async () => {
  const move = { from: date, to: destination, id: record.id, patch: { blood: true }, updatedAt: stamp };
  const aggregate = { items: [
    { move, items: [{ col: 'days', id: date, stools: { put: [], drop: [record.id] } },
      { col: 'days', id: destination, stools: { put: [{ ...record, blood: true }], drop: [] } }] },
    { regime: { date, count: 2, indices: [0, 1] } }
  ] };
  const h = makeHarness({ server: baseline(), storage: [[key(prefixes[1], '1793869200000-aggregate'), JSON.stringify(aggregate)]] });
  h.start(baseline());
  await h.drain();
  assert.equal(h.api.queuedWrites().length, 0);
  assert.deepEqual(h.remote.days[date].stools, []);
  assert.deepEqual(h.remote.days[destination].stools, [{ ...record, blood: true }]);
  assert.deepEqual(h.remote.settings.regimeChanges, [date, date]);
  assert.equal(h.transactions.length, 2);
});
