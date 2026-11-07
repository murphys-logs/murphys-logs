'use strict';

// Protected-boundary audit for this change set. Compares the working tree with a
// base commit (default: the recorded base) and fails unless:
//  - index.html differs only inside <style>, in the two release identifiers,
//    and in the exact presentation-only pointer guard pinned below;
//  - sw.js differs only in VERSION;
//  - manifest.webmanifest, icon-180.png and .gitattributes are byte-identical;
//  - apart from that isolated guard, everything after </style> (Firebase imports,
//    configuration, initialisation, Auth, listeners, outbox/save/sync code and
//    calculations) is identical after normalising the release identifier.
// Run: node docs/reviews/2026-11-06-claude/audit-boundaries.cjs [base-sha]
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const base = process.argv[2] || 'ee42092658259605f56ef3cc9281418bb43b69f5';
const atBase = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, maxBuffer: 1 << 26 });
const now = file => fs.readFileSync(path.join(root, file));
const release = /(data-version="|const APP_VERSION = '|const VERSION = ')\d+\.\d+\.\d+(['"])/g;
const normal = text => text.replace(/\r\n/g, '\n').replace(release, '$1X$2');

for (const file of ['manifest.webmanifest', 'icon-180.png', '.gitattributes'])
  assert.ok(atBase(file).equals(now(file)), `${file} is byte-identical`);

assert.equal(normal(now('sw.js').toString()), normal(atBase('sw.js').toString()), 'sw.js differs only in VERSION');

const split = text => {
  const start = text.indexOf('<style>'), end = text.indexOf('</style>');
  assert.ok(start > 0 && end > start && text.indexOf('<style>', start + 1) === -1, 'one <style> block');
  return { head: text.slice(0, start), style: text.slice(start, end), rest: text.slice(end) };
};
const before = split(normal(atBase('index.html').toString())), after = split(normal(now('index.html').toString()));
assert.equal(after.head, before.head, 'index.html head before <style> is unchanged apart from data-version');
// Exact exception, not a blanket allowance for scripts: this new block tracks
// pointer IDs and toggles one presentation attribute. All pre-existing shell,
// application and Firebase code must still compare equal to base.
const guardPattern = /<script id="notice-pointer-guard">[\s\S]*?<\/script>\n/g;
const guards = after.rest.match(guardPattern) || [];
assert.equal(guards.length, 1, 'one isolated presentation pointer guard');
assert.equal(createHash('sha256').update(guards[0]).digest('hex'),
  '9d2b5f6d27e36ae8ec0a2baf35e82ebc2e78493a3bbf744a3f88b991e951a2b9', 'pointer guard matches its reviewed content');
assert.equal(after.rest.replace(guardPattern, ''), before.rest, 'all pre-existing markup and scripts are unchanged apart from APP_VERSION');

// Firebase surface, checked explicitly as well (subsumed by the comparison above).
const firebase = text => [...text.matchAll(/^.*(firebasejs|firebaseConfig|initializeApp|initializeFirestore|persistentLocalCache|getAuth|onAuthStateChanged|signInWithEmailAndPassword|runTransaction|setDoc|deleteDoc|onSnapshot).*$/gm)].map(m => m[0]);
assert.deepEqual(firebase(after.rest), firebase(before.rest), 'every Firebase-related line is identical');

const versions = text => [...text.toString().matchAll(release)].map(m => m[0]);
const shipped = [...versions(now('index.html')), ...versions(now('sw.js'))].map(v => v.match(/\d+\.\d+\.\d+/)[0]);
assert.equal(new Set(shipped).size, 1, `release identifiers agree: ${shipped.join(', ')}`);

const changedStyle = before.style.split('\n').length !== after.style.split('\n').length || before.style !== after.style;
console.log(JSON.stringify({ base, release: shipped[0], styleChanged: changedStyle,
  checked: ['manifest.webmanifest', 'icon-180.png', '.gitattributes', 'sw.js', 'index.html head/script/markup', 'exact pointer guard', 'Firebase lines'] }));
