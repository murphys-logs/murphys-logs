'use strict';
// Review-only probes: passing assertions confirm reported behavior and a policy control.
// Exercise the current module through its existing synthetic local harness.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
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
vm.runInContext('validateBackup(' + JSON.stringify({days}) + ')', h.context);
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

// AG-03 extension (Claude S1): the recent-recipe summary includes unfed plans.
const recent = makeHarness({now:'2026-11-04T12:00:00Z',days:{
  '2026-11-01':{meal:{recipe:'duck'}},
  '2026-11-02':{meal:{recipe:'fish',fedAt:'18:00'}},
  '2026-11-03':{meal:{recipe:'salmon'}}
}});
const mealContext = vm.runInContext("mealContext('2026-11-04',null)", recent.context);
assert.match(mealContext, /Last six: Salmon, Fish, Duck/);
console.log(JSON.stringify({case:'recent-recipes-include-unfed-plans',lastSix:'Salmon, Fish, Duck',confirmedFedRecipes:['Fish']},null,2));

// AG-03 extension (Claude S2): same quantity, different feeding state, no label.
const exportedMeals = makeHarness({now:'2026-11-04T12:00:00Z',days:{
  '2026-11-02':{meal:{recipe:'lamb',fedAt:'18:00',darfFed:130,darfPlanned:130}},
  '2026-11-03':{meal:{recipe:'lamb',darfPlanned:130}}
}});
exportedMeals.api.exportMonthMd('2026-11');
const markdown = exportedMeals.api.downloads[0][1];
const fedRow = markdown.split('\n').find(line => line.startsWith('| 2 Nov |'));
const plannedRow = markdown.split('\n').find(line => line.startsWith('| 3 Nov |'));
assert.ok(fedRow && plannedRow);
assert.equal(fedRow.replace('| 2 Nov |', '| DATE |'), plannedRow.replace('| 3 Nov |', '| DATE |'));
assert.match(fedRow, /\| 130 \|/);
console.log(JSON.stringify({case:'markdown-amount-hides-feeding-state',fedRow,plannedRow},null,2));

// Policy control, not an assertion that refusing an unfed meal is erroneous:
// History permits recording Refused without a fedAt, and current alerts use it.
const refused = makeHarness({now:'2026-11-04T12:00:00Z',days:{
  '2026-11-02':{meal:{recipe:'lamb',bowl:'refused'}},
  '2026-11-03':{meal:{recipe:'fish',bowl:'refused'}}
}});
const refusalAlert = refused.api.insights().vet.find(v => v.title==='Bowl refused twice this week');
assert.ok(refusalAlert);
const historicalEditor = vm.runInContext("mealEditor('2026-11-03')", refused.context);
const bowlButtons = historicalEditor.match(/<button\b[^>]*data-act="bowl"[^>]*>/g);
assert.equal(bowlButtons?.length, 3);
bowlButtons.forEach(button => assert.doesNotMatch(button, /\bdisabled\b/));
console.log(JSON.stringify({case:'unfed-refusal-policy-control',message:'Do not blanket-gate recorded bowl refusals without an explicit product decision.',alert:refusalAlert.title},null,2));
