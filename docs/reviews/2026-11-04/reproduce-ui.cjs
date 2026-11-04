'use strict';
// Review-only probes: passing assertions confirm focus defects and layout measurements.
// Uses the repository's synthetic records; blocks every external URL.
// PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE use the existing browser-suite options.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
process.env.APP_HTML = path.join(root, 'index.html');
const { chromium, html, stub, origin } = require(path.join(root, 'tests/draft-input.browser.cjs'));
const fixtureSource = fs.readFileSync(path.join(root, 'tests/history-review.browser.cjs'), 'utf8');
const buildDays = new Function("const TODAY='2026-11-01',YESTERDAY='2026-10-31';\n" +
  fixtureSource.slice(fixtureSource.indexOf('function buildFixtureDays'), fixtureSource.indexOf('async function main')) +
  '\nreturn buildFixtureDays();');
const errors = [], external = [], results = [];

async function main() {
  const browser = await chromium.launch({headless:true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  async function open(viewport={width:375,height:667}) {
      const context = await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block'});
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== origin) { external.push(u.href); return route.abort(); }
        if (u.pathname === '/index.html') return route.fulfill({contentType:'text/html',body:html});
        if (u.pathname === '/firebase-stub.js') return route.fulfill({contentType:'application/javascript',body:stub});
        return route.fulfill({status:404,body:''});
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin+'/index.html');
      await page.waitForFunction(() => window.testApp?.S.ready);
      await page.evaluate(days => {
        testApp.S.days=days;
        testApp.S.settings={...testApp.S.settings,startDate:'2025-12-20',fibreSchedule:[{from:'2026-10-01',g:2.5},{from:'2026-10-28',g:5}]};
        testApp.S.changes=[{id:'chg-1',date:'2026-10-05',deltaG:-5,source:'rule',reason:'Prior adjustment'}];
        testApp.render(true);
      }, buildDays());
      return {context,page};
  }
  try {
    for (const action of ['applyadv','refuseadv','applyfibre','dismissfibre']) {
      const {context,page} = await open();
      await page.locator('#tabbar [data-tab="review"]').click();
      const button = page.locator('[data-act="'+action+'"]');
      await button.focus();
      assert.equal(await page.evaluate(() => document.activeElement.dataset.act), action);
      // Keyboard activation demonstrates the loss of place without pointer ambiguity.
      await button.press('Enter');
      await page.waitForFunction(() => document.querySelector('#feedback').textContent.trim().length > 0);
      const after = await page.evaluate(() => ({tag:document.activeElement.tagName,id:document.activeElement.id,
        notice:document.querySelector('#feedback').textContent,queue:testApp.queuedWrites().length}));
      assert.equal(after.tag, 'BODY', action+' loses focus after its control is replaced');
      assert.equal(after.queue, action==='dismissfibre' ? 0 : 1);
      results.push({action,after});
      await context.close();
    }

    // CL-05: measure the real sticky region, including a compact-notice control.
    // This is Chromium layout evidence with a mocked update-ready state, not
    // a Safari/VoiceOver/native-keyboard test or an assertion of a platform bug.
    for (const viewport of [{width:375,height:667},{width:390,height:844}]) {
      const {context,page} = await open(viewport);
      const measurements = [];
      for (const state of ['none','full','compact']) {
        await page.evaluate(state => {
          testApp.S.banner=state==='none'?null:{kind:'warn',source:'sync',retry:true,compact:state==='compact',
            title:'Sync pending',text:'Your confirmed entries are saved on this device and will sync automatically once connected.'};
          testApp.S.undo=state==='none'?null:{kind:'stool',label:'Stool removed · 1 Nov at 08:00'};
          window.AppShell.state.updateReady=state!=='none';
          testApp.setStatus(state==='none'?'Synced':'Saved locally; retry sync',state==='none'?'':'warn');
          testApp.renderFeedback();
        }, state);
        // ResizeObserver sets the sticky offsets; wait for two animation frames.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        measurements.push(await page.evaluate(state => {
          const feedback=document.querySelector('#feedback'), header=document.querySelector('.topbar'),tabs=document.querySelector('#tabbar');
          const f=feedback.getBoundingClientRect(),h=header.getBoundingClientRect(),t=tabs.getBoundingClientRect();
          return {state,noticeCount:feedback.querySelectorAll('.note').length,feedbackHeight:f.height,
            feedbackScrollHeight:feedback.scrollHeight,headerHeight:h.height,tabHeight:t.height,
            formArea:t.top-(h.bottom+f.height),viewportHeight:innerHeight,
            maxHeight:getComputedStyle(feedback).maxHeight,position:getComputedStyle(feedback).position};
        }, state));
      }
      const [none,full,compact]=measurements;
      assert.equal(none.noticeCount,0);
      assert.equal(full.noticeCount,3);
      assert.equal(compact.noticeCount,3);
      assert.equal(full.position,'sticky');
      assert.ok(full.feedbackHeight>viewport.height*.4,'Three notices occupy more than 40% of the viewport');
      assert.ok(full.feedbackScrollHeight>full.feedbackHeight,'The capped notice stack also scrolls internally');
      assert.ok(full.formArea<none.formArea-viewport.height*.4,'The sticky stack materially reduces usable form height');
      assert.ok(compact.feedbackHeight<=full.feedbackHeight+.5,'Compact notice does not expand the stack');
      results.push({case:'CL-05 sticky notice stack',viewport,measurements});
      await context.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({results,errors,external}, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
