'use strict';
// Review-only reproductions: assertions confirm observed defects and named safe controls.
// Synthetic adapters only; no network, account, or production writes.
// Run: node docs/reviews/2026-11-04/reproduce-offline.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../..');
process.env.APP_HTML = path.join(repo, 'index.html');
const harnessFile = fs.readFileSync(path.join(repo,'tests/restore-sync.test.cjs'),'utf8');
assert.ok(harnessFile.includes("const date = '2026-10-27';"), 'Expected harness boundary exists');
assert.ok(harnessFile.includes('oilMlOn, removeWithUndo, undoRemoval };'), 'Expected test API exists');
const harnessSource = harnessFile.split("const date = '2026-10-27';")[0]
  .replace('oilMlOn, removeWithUndo, undoRemoval };','oilMlOn, removeWithUndo, undoRemoval, saveDay, validateBackup, vetItems };')
  .replace('navigator: { onLine: true,', 'navigator: { get onLine(){ return controls.onLine ?? true; },');
const load = vm.compileFunction(harnessSource+'\nreturn {makeHarness, empty, copy};', ['require','__dirname','process','console']);
const {makeHarness, empty, copy} = load(require,path.join(repo,'tests'),process,console);
const date='2026-11-02', dest='2026-11-03', later='2026-11-04';
// Bound the deliberately unacknowledged-delete hook so a missing hook cannot exit silently.
const waitFor = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer=setTimeout(() => reject(Error('Expected adapter hook did not run')),2000); })]); }
  finally { clearTimeout(timer); }
};
(async()=>{
  const stool={id:'conflict-stool',time:'08:00',bristol:3,mucus:false,blood:false};
  const base={...empty(),days:{[date]:{date,stools:[stool]}}};
  const h=makeHarness({server:base,now:'2026-11-04T10:00:00Z'});
  h.start(base);
  assert.equal(await h.api.moveStool(date,dest,stool,stool),true);
  assert.equal(await h.api.write({col:'days',id:later,patch:{date:later,notes:'Saved after move, must survive'}}),true);
  assert.equal(h.api.S.days[later].notes,'Saved after move, must survive');
  h.remote.days[date].stools=[]; // Another device deletes the original while this device is offline.
  h.emit('days',h.remote.days);
  console.log('After app subscription callback removes the source stool:',JSON.stringify({queued:h.api.queuedWrites().length,laterLocalDay:h.api.S.days[later],status:h.api.S.status,banner:h.api.S.banner}));
  assert.equal(h.api.S.days[later],undefined,'A valid later queued entry disappears from the app projection');
  assert.equal(h.exported().days[later],undefined,'Full JSON backup silently omits this confirmed entry');
  await h.drain();
  await h.api.flushWrites();
  console.log('After two retry drains:',JSON.stringify({queued:h.api.queuedWrites().length,serverLaterDay:h.remote.days[later],status:h.api.S.status,banner:h.api.S.banner}));
  assert.equal(h.api.queuedWrites().length,2,'Both writes stay blocked');
  assert.equal(h.remote.days[later],undefined,'Independent later write never sent');
  const reloaded=makeHarness({server:h.remote,storage:[...h.storage],now:'2026-11-04T10:01:00Z'});
  reloaded.start(h.remote);
  await reloaded.drain();
  console.log('After reopen:',JSON.stringify({ready:reloaded.api.S.ready,queued:reloaded.api.queuedWrites().length,laterLocalDay:reloaded.api.S.days[later],status:reloaded.api.S.status}));
  assert.equal(reloaded.api.S.days[later],undefined);
  assert.equal(reloaded.exported().days[later],undefined,'Reopened JSON backup still omits it');
  const e=makeHarness({server:base,now:'2026-11-04T11:00:00Z'});
  e.start(base);
  await e.api.saveDay(date,{stools:[{...stool,bristol:4}]});
  e.remote.days[date].stools=[];
  e.remote.days[dest]={date:dest,stools:[stool]};
  e.emit('days',e.remote.days);
  await e.drain();
  console.log('Offline edit after another device moves stool:',JSON.stringify(e.remote.days));
  assert.deepEqual(e.remote.days[date].stools,[{id:stool.id,bristol:4}]);
  assert.equal(e.remote.days[dest].stools[0].id,stool.id,'Same stool now exists on both dates');
  assert.equal(e.api.queuedWrites().length,0,'The invalid duplicate is acknowledged as synced');
  const v=makeHarness({server:base,now:'2026-11-04T12:00:00Z'});
  v.start(base);
  await v.api.saveDay(date,{events:['lethargic']});
  v.remote.days[date].events=['vomited'];
  v.emit('days',v.remote.days);
  await v.drain();
  console.log('Concurrent offline clinical events:',JSON.stringify({events:v.remote.days[date].events,status:v.api.S.status,queue:v.api.queuedWrites().length}));
  assert.deepEqual(v.remote.days[date].events,['lethargic'],'Independent remote Vomited flag has been lost');
  const beforeClockCorrection=makeHarness({server:base,now:'2026-11-04T12:10:00Z'});
  beforeClockCorrection.start(base);
  await beforeClockCorrection.api.saveDay(date,{notes:'Earlier saved note'});
  const afterClockCorrection=makeHarness({server:base,storage:[...beforeClockCorrection.storage],now:'2026-11-04T12:05:00Z'});
  afterClockCorrection.start(base);
  await afterClockCorrection.api.saveDay(date,{notes:'Later corrected note'});
  assert.equal(afterClockCorrection.api.S.days[date].notes,'Later corrected note');
  await afterClockCorrection.drain();
  console.log('Clock rollback across restart:',JSON.stringify({notes:afterClockCorrection.remote.days[date].notes,status:afterClockCorrection.api.S.status,queue:afterClockCorrection.api.queuedWrites().length}));
  assert.equal(afterClockCorrection.remote.days[date].notes,'Earlier saved note','Queue sorting sends later correction before old pending note');
  assert.equal(afterClockCorrection.api.queuedWrites().length,0,'No retained correction remains after incorrect ordering is acknowledged');
  const undo=makeHarness({server:base,now:'2026-11-04T13:00:00Z'});
  undo.start(base);
  await undo.api.removeWithUndo({kind:'stool',date,record:stool,index:0,label:'Stool removed'},
    {col:'days',id:date,patch:{date,updatedAt:'2026-11-04T13:00:00Z'},stools:{put:[],drop:[stool.id]}});
  await undo.api.undoRemoval();
  undo.remote.days[date].stools=[];
  undo.remote.days[dest]={date:dest,stools:[stool]};
  undo.emit('days',undo.remote.days);
  await undo.drain();
  console.log('Known AG-04 undo after remote move:',JSON.stringify({source:undo.remote.days[date].stools,target:undo.remote.days[dest].stools,status:undo.api.S.status,queue:undo.api.queuedWrites().length}));
  assert.equal(undo.remote.days[date].stools[0].id,stool.id);
  assert.equal(undo.remote.days[dest].stools[0].id,stool.id);
  assert.equal(undo.api.queuedWrites().length,0);
  const eraseHarnessSource=harnessSource
    .replace('async deleteDoc(ref) {','async deleteDoc(ref) { if(controls.beforeDelete) await controls.beforeDelete(ref);')
    .replace("confirm: forbidden('confirmation'), prompt: forbidden('prompt'),","confirm: () => true, prompt: () => 'ERASE',");
  const loadErase=vm.compileFunction(eraseHarnessSource+'\nreturn {makeHarness};',['require','__dirname','process','console']);
  const {makeHarness:makeErase}=loadErase(require,path.join(repo,'tests'),process,console);
  const eraseBase={...empty(),days:{[date]:{date,notes:'first'},[dest]:{date:dest,notes:'second'},[later]:{date:later,notes:'third'}}};
  const erasing=makeErase({server:eraseBase,now:'2026-11-04T14:00:00Z'});
  erasing.start(eraseBase);await erasing.drain();
  let deletions=0, notifyBlocked;
  const blocked=new Promise(resolve=>notifyBlocked=resolve);
  erasing.controls.beforeDelete=async()=>{
    if(++deletions===2){notifyBlocked();await new Promise(()=>{});}
  };
  void erasing.ui.click('erase');
  await waitFor(blocked);
  assert.equal(erasing.api.S.erasing,true);
  assert.equal(erasing.remote.days[date],undefined);
  assert.equal(erasing.api.queuedWrites().length,0,'Erase intent is never queued durably');
  assert.equal(await erasing.api.saveDay(later,{notes:'Observation during pending delete'}),false,'Unacknowledged erase blocks a new save');
  assert.equal(erasing.api.S.banner.title,'Erasing log data…');
  const restartedErase=makeHarness({server:erasing.remote,storage:[...erasing.storage]});
  restartedErase.start(erasing.remote);await restartedErase.drain();
  console.log('Known AV-02 close after first deletion:',JSON.stringify({remaining:Object.keys(restartedErase.remote.days),erasing:restartedErase.api.S.erasing,status:restartedErase.api.S.status,queue:restartedErase.api.queuedWrites().length}));
  assert.equal(restartedErase.api.S.erasing,false,'Reopen forgets incomplete erase');
  assert.deepEqual(Object.keys(restartedErase.remote.days),[dest,later]);

  // External-review variants: independently run against the actual module, without
  // changing its code. "Remote" mutations stand in for another client's committed
  // data; these are not real two-client Firebase/emulator or iPhone lifecycle tests.
  const wedged=makeHarness({server:base,now:'2026-11-04T15:00:00Z'});
  wedged.start(base);
  await wedged.api.moveStool(date,dest,stool,stool);
  await wedged.api.saveDay(later,{events:['vomited']});
  wedged.remote.days[date].stools=[];
  wedged.emit('days',wedged.remote.days);
  assert.equal(wedged.api.S.days[later],undefined);
  await wedged.ui.click('event',{date:later,id:'lethargic'});
  wedged.remote.days[date].stools=[copy(stool)]; // Other client's Undo clears the move conflict.
  wedged.emit('days',wedged.remote.days);
  await wedged.drain();
  assert.deepEqual(wedged.remote.days[later].events,['lethargic'],'Actual event action used the truncated projection and lost the earlier queued Vomited flag');
  assert.equal(wedged.api.queuedWrites().length,0);
  assert.equal(wedged.api.S.status,'Synced');
  console.log('CL-01 AG-05 later overwrite after conflict clears:',JSON.stringify({events:wedged.remote.days[later].events,status:wedged.api.S.status}));

  const third=makeHarness({server:base,now:'2026-11-04T15:10:00Z'});
  third.start(base);
  await third.api.moveStool(date,dest,stool,stool);
  third.remote.days[date].stools=[];
  third.remote.days['2026-11-01']={date:'2026-11-01',stools:[copy(stool)]};
  third.emit('days',third.remote.days);
  await third.api.saveDay(later,{notes:'New entry while move is blocked'});
  assert.equal(third.api.S.days[later].notes,'New entry while move is blocked');
  third.emit('settings',{});
  assert.equal(third.api.S.days[later],undefined,'Even an unrelated settings snapshot hides the new note again');
  assert.equal(third.exported().days[later],undefined);
  await third.drain();
  assert.equal(third.api.queuedWrites().length,2);
  console.log('AG-05 third-date conflict and unrelated snapshot:',JSON.stringify({queued:2,noteVisible:false,noteExported:false}));

  const flag=makeHarness({server:base,now:'2026-11-04T15:20:00Z'});
  flag.start(base);
  await flag.api.saveDay(date,{stools:[{...stool,blood:true}]});
  flag.remote.days[date].stools=[];
  flag.emit('days',flag.remote.days);
  await flag.drain();
  assert.deepEqual(flag.remote.days[date].stools,[{id:stool.id,blood:true}]);
  const invalidBackup=flag.exported();
  assert.throws(()=>flag.api.validateBackup(copy(invalidBackup)),/Invalid backup: 2026-11-02\.stool\./);
  assert.ok(flag.api.vetItems(flag.api.S.days,later,[],flag.api.S.settings).some(item=>item.title==='Blood recorded'));
  assert.equal(flag.api.S.status,'Synced');
  console.log('CL-02 FR-01 flag-only edit prevents backup round trip:',JSON.stringify({stools:flag.remote.days[date].stools,backupImportable:false,status:flag.api.S.status}));

  const removed=makeHarness({server:base,now:'2026-11-04T15:30:00Z'});
  removed.start(base);
  await removed.api.removeWithUndo({kind:'stool',date,record:stool,index:0,label:'Stool removed'},
    {col:'days',id:date,patch:{date,updatedAt:'2026-11-04T15:30:00Z'},stools:{put:[],drop:[stool.id]}});
  removed.remote.days[date].stools=[];
  removed.remote.days[dest]={date:dest,stools:[copy(stool)]};
  removed.emit('days',removed.remote.days);
  await removed.drain();
  assert.equal(removed.remote.days[dest].stools[0].id,stool.id);
  assert.equal(removed.api.queuedWrites().length,0);
  assert.equal(removed.api.S.undo,null);
  assert.equal(removed.api.S.status,'Synced');
  console.log('CL-03 Delete is defeated by a remote move:',JSON.stringify({survivingDate:dest,undoAvailable:false,status:removed.api.S.status}));

  const eventBase={...empty(),days:{[date]:{date,events:['vomited']}}};
  const removedEvent=makeHarness({server:eventBase,now:'2026-11-04T15:40:00Z'});
  removedEvent.start(eventBase);
  await removedEvent.ui.click('event',{date,id:'vomited'});
  removedEvent.remote.days[date].events=['vomited','blood'];
  removedEvent.emit('days',removedEvent.remote.days);
  await removedEvent.drain();
  assert.deepEqual(removedEvent.remote.days[date].events,[]);
  assert.equal(removedEvent.api.S.status,'Synced');
  console.log('FR-02 remove-versus-add loses another observation:',JSON.stringify({events:[],status:removedEvent.api.S.status}));

  const sessionClock=makeHarness({server:base,now:'2026-11-04T16:10:00Z'});
  sessionClock.start(base);
  await sessionClock.api.saveDay(date,{notes:'First same-session note'});
  sessionClock.setNow('2026-11-04T16:05:00Z');
  await sessionClock.api.saveDay(date,{notes:'Second same-session note'});
  await sessionClock.drain();
  assert.equal(sessionClock.remote.days[date].notes,'Second same-session note');
  console.log('FR-03 safe control: same-session rollback preserves the latest note');

  const knownMove=makeHarness({server:base,now:'2026-11-04T16:20:00Z'});
  knownMove.start(base);
  await knownMove.api.removeWithUndo({kind:'stool',date,record:stool,index:0,label:'Stool removed'},
    {col:'days',id:date,patch:{date,updatedAt:'2026-11-04T16:20:00Z'},stools:{put:[],drop:[stool.id]}});
  knownMove.remote.days[date].stools=[];
  knownMove.remote.days[dest]={date:dest,stools:[copy(stool)]};
  knownMove.emit('days',knownMove.remote.days);
  assert.equal(knownMove.api.S.undo,null,'Known remote identity withdraws Undo before it can be queued');
  await knownMove.api.undoRemoval();
  await knownMove.drain();
  assert.equal(knownMove.remote.days[date].stools.length,0);
  assert.equal(knownMove.remote.days[dest].stools.length,1);
  console.log('AG-04 safe control: a known remote move prevents queuing Undo');

  const prepared=makeHarness({server:base,now:'2026-11-04T16:30:00Z'});
  prepared.start(base);
  await prepared.api.moveStool(date,dest,stool,stool);
  await prepared.api.saveDay(later,{notes:'Saved before cold reopen'});
  const cold=makeHarness({server:base,storage:[...prepared.storage],now:'2026-11-04T16:31:00Z'});
  cold.controls.onLine=false;
  cold.start(empty());
  assert.equal(cold.api.S.days[later],undefined);
  assert.equal(cold.exported().days[later],undefined);
  assert.equal(cold.api.queuedWrites().length,2,'An empty cached baseline has not deleted the queued records');
  cold.emit('days',base.days);
  assert.equal(cold.api.S.days[later].notes,'Saved before cold reopen');
  assert.equal(cold.exported().days[later].notes,'Saved before cold reopen');
  console.log('CL-04 empty cached baseline temporarily hides queued entries:',JSON.stringify({initiallyVisible:false,visibleAfterSourceSnapshot:true,queue:2}));

  // Antigravity's lexical-order edge: 12/13-digit epoch keys at the September 2001
  // boundary. This does not model an ordinary contemporary iPhone clock correction.
  const lexical=makeHarness({now:new Date(999999999999).toISOString()});
  lexical.start(empty());
  await lexical.api.saveDay('2001-09-08',{notes:'Earlier 12-digit-key note'});
  lexical.setNow(new Date(1000000000000).toISOString());
  await lexical.api.saveDay('2001-09-08',{notes:'Later 13-digit-key note'});
  const keyClocks=lexical.api.queuedWrites().map(([key])=>Number(key.slice(key.lastIndexOf(':')+1).split('-')[0]));
  assert.deepEqual(copy(keyClocks),[1000000000000,999999999999]);
  await lexical.drain();
  assert.equal(lexical.remote.days['2001-09-08'].notes,'Earlier 12-digit-key note');
  console.log('FR-03 extreme-clock variant: mixed-width epoch keys sort lexically:',JSON.stringify({keyClocks,finalNote:lexical.remote.days['2001-09-08'].notes}));
  console.log('Completed 15 offline review scenarios: 13 defect/edge cases and 2 safe controls; synthetic adapters only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
