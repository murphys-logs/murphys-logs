'use strict';
// Review-only probes: passing assertions reproduce the reported defects.
// Exercise the current module through its existing synthetic local harness.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const harnessPath = path.join(root, 'tests/ui-ergonomics.test.cjs');
const text = fs.readFileSync(harnessPath, 'utf8');
const prefix = text.slice(0, text.indexOf("test('dismissing"));
const harness = new Module(harnessPath, module);
harness.filename = harnessPath;
harness.paths = Module._nodeModulePaths(path.dirname(harnessPath));
harness._compile(prefix + '\nmodule.exports = makeHarness;', harnessPath);
const makeHarness = harness.exports;

const days = {
  '2026-11-04': {stools:[{id:'s1',time:'08:00',bristol:1},{id:'s2',time:'10:00',bristol:4}]},
  '2026-12-01': {events:['vomited','lethargic'], meal:{recipe:'lamb',fedAt:'18:00',bowl:'refused'}},
  '2026-12-02': {events:['vomited'], meal:{recipe:'lamb',fedAt:'18:00',bowl:'refused'}}
};
const h = makeHarness({days, now:'2026-11-04T12:00:00Z'});
require('node:vm').runInContext('validateBackup(' + JSON.stringify({days}) + ')', h.context);
const vet = JSON.parse(JSON.stringify(h.api.insights().vet));
assert(vet.some(x => x.title === 'Vomited on two or more days this week'));
assert(vet.some(x => x.title === 'Bowl refused twice this week'));
console.log(JSON.stringify({case:'future-observations-enter-current-alerts',today:'2026-11-04',alerts:vet}, null, 2));
h.api.exportMonthCsv('2026-11');
const [,csv] = h.api.downloads[0];
assert.equal(csv.split('\n')[1].split(',')[1], '4');
assert(h.api.viewHistory().includes('Types 1–4'));
console.log(JSON.stringify({case:'worstBristol-is-highest-score',input:[1,4],exportHeader:csv.split('\n')[0],exportRow:csv.split('\n')[1],history:'Types 1–4'},null,2));
const planned = makeHarness({now:'2026-11-04T12:00:00Z',days:{'2026-11-04':{meal:{recipe:'lamb',egg:true,broth:false,fibreGiven:true,oilGiven:true,bowl:'cleared'}}}});
const review = planned.api.viewReview();
assert.match(review, /Egg \/ broth nights<\/span><span class="v">1 \/ 0/);
assert.match(review, /Fibre \/ oil confirmed<\/span><span class="v">1 \/ 1/);
assert.match(review, /Bowl<\/span><span class="v">1 cleared, 0 left, 0 refused/);
console.log(JSON.stringify({case:'unfed-meal-counted-as-consumed',fedAt:null,eggNights:1,confirmedFibre:1,confirmedOil:1,clearedBowls:1},null,2));
