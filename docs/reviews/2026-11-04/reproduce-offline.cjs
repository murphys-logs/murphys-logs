'use strict';
// Review-only reproduction: passing assertions confirm the observed defects.
// Synthetic adapters only; no network, account, or production writes.
// Run: node docs/reviews/2026-11-04/reproduce-offline.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../..');
process.env.APP_HTML = path.join(repo, 'index.html');
const harnessSource = fs.readFileSync(path.join(repo,'tests/restore-sync.test.cjs'),'utf8').split("const date = '2026-10-27';")[0].replace('oilMlOn, removeWithUndo, undoRemoval };','oilMlOn, removeWithUndo, undoRemoval, saveDay };');
const load = vm.compileFunction(harnessSource+'\nreturn {makeHarness, empty, copy};', ['require','__dirname','process','console']);
const {makeHarness, empty, copy} = load(require,path.join(repo,'tests'),process,console);
const date='2026-11-02', dest='2026-11-03', later='2026-11-04';
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
  console.log('After real subscription removes the source stool:',JSON.stringify({queued:h.api.queuedWrites().length,laterLocalDay:h.api.S.days[later],status:h.api.S.status,banner:h.api.S.banner}));
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
  await blocked;
  assert.equal(erasing.api.S.erasing,true);
  assert.equal(erasing.remote.days[date],undefined);
  assert.equal(erasing.api.queuedWrites().length,0,'Erase intent is never queued durably');
  const restartedErase=makeHarness({server:erasing.remote,storage:[...erasing.storage]});
  restartedErase.start(erasing.remote);await restartedErase.drain();
  console.log('Known AV-02 close after first deletion:',JSON.stringify({remaining:Object.keys(restartedErase.remote.days),erasing:restartedErase.api.S.erasing,status:restartedErase.api.S.status,queue:restartedErase.api.queuedWrites().length}));
  assert.equal(restartedErase.api.S.erasing,false,'Reopen forgets incomplete erase');
  assert.deepEqual(Object.keys(restartedErase.remote.days),[dest,later]);
})().catch(error => { console.error(error); process.exitCode = 1; });
