'use strict';

// Review-specific allowlist, not a substitute for reviewing the permitted UI diff.
// Run from any directory: node docs/reviews/2026-11-06/audit-boundaries.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const base = 'f28696bc8027c2d1788d167cc2119e8063627c68';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const before = file => git(['show', `${base}:${file}`]).replace(/\r\n/g, '\n');
const after = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function omitPresentation(source) {
  for (const [start, end] of [
    ['function render(force=false){', '\nfunction leaveDraft(){'],
    ['function viewReview(){', '\nfunction weekContext(today){'],
    ['function syncSectionBody(){', '\nfunction refreshSyncSection(){'],
  ]) {
    assert.equal(source.split(start).length, 2, `unique ${start}`);
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(to > from, `end of ${start}`);
    source = source.slice(0, from) + '// reviewed presentation function\n' + source.slice(to);
  }
  return source;
}
const html = before('index.html')
  .replace('data-version="3.12.0"', 'data-version="3.12.2"')
  .replace("const APP_VERSION = '3.12.0';", "const APP_VERSION = '3.12.2';");
assert.equal(omitPresentation(after('index.html')), omitPresentation(html),
  'Outside the three reviewed presentation functions and app release IDs, index.html must be identical');
assert.equal(after('sw.js'), before('sw.js').replace("const VERSION = '3.12.0';", "const VERSION = '3.12.2';"),
  'Worker must be identical apart from the application release identifier');
const changed = (git(['diff', '--name-only', base]) + git(['ls-files', '--others', '--exclude-standard']))
  .trim().split(/\r?\n/).filter(Boolean);
for (const file of changed) assert.ok(['index.html', 'sw.js'].includes(file) || /^(tests|docs)\//.test(file), `Unexpected changed file: ${file}`);
console.log(JSON.stringify({ base, allowedPresentationFunctions: ['render', 'viewReview', 'syncSectionBody'],
  result: 'PASS: source outside the three presentation functions and app release IDs is identical; worker release ID only. Manually review the permitted function diffs before concluding the Firebase/data boundary audit.' }));
