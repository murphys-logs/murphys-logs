# Antigravity: independent re-review of PR #22

You are Antigravity. Independently re-review https://github.com/murphys-logs/murphys-logs/pull/22, branch `claude/friendly-bardeen-wilio6`.

**Commits and scope:**

- Fetch and record the **actual current head and base**. The recorded base is `ee42092658259605f56ef3cc9281418bb43b69f5`; the expected release remains 3.12.4. If the head moves, state exactly what you reviewed and tested.
- Review the clean-field runtime/test/documentation delta after `af00e4ce4eb323077b39653c460f6d009b20276f` and the complete PR diff. Earlier reviews of `c989afa`, `b5476b2` or `af00e4c` do not approve this new runtime change.
- Historical anchors: `d0aa02f` (original CSS), `3bb4c65` (confirmation-button focus), `e7acf4f` (dirty-state refinement), and `af00e4c` (failed-save retry tests and matching-browser offline validation).
- Two reviews independently used **CX22-03**. Distinguish the **clean-field tap P2**, addressed by the new presentation fix, from the **failed-save focus-test P2**, fixed in `af00e4c`.

**Ground rules:**

- Use an isolated checkout and read `docs/review-handoff.md` and `docs/ux-review.md` §2–§4.
- Review only: do not modify tracked files, commit, push, approve, request changes, merge or deploy. Temporary probes may live outside the checkout.
- Write your own initial code judgment before reading other reviewers' new reviews or the reconciliation. The report, checklist and test output are claims to verify, not proof.
- Keep Firebase strictly unchanged: no SDK/version/configuration/Auth/rules/resource/database changes, no dependency update and no change to save, sync, outbox, drafts or storage semantics.
- Use synthetic data only. Never sign in to, read from, write to or probe the live Firebase project. Preserve calculations, records, history/export meaning and transient personal-weight readings. Publish no sensitive values or local paths.

**Check:**

1. **Clean-field tap CX22-03 / CC-R1.** Reproduce the old behavior on `af00e4c`: focus an empty field, place BCS 4 in the returning notice/Dismiss band, then issue two raw coordinate taps. The first can be swallowed and the second can activate Dismiss instead. Verify the new head activates the intended control on the first tap without changing notice state.
   - Inspect the offscreen sticky offset, root `data-notice-press` hold and zero-duration 600 ms repin delay. The new isolated `notice-pointer-guard` script sits after the existing classic shell, outside the application module. Verify its pointer-ID Set and cleanup on pointerup/pointercancel/window blur/pagehide; it must suppress no events and invoke no rendering, saving, sync, Firebase or storage code.
   - CSS `:active` alone did not reliably cover touch contact. Reproduce a CDP-dispatched touch beginning 450–550 ms into the grace period and held across the repin deadline. The intended action and notice state must survive; verify cleanup after cancellation and that a long hold cannot outlast the contact marker. This is browser emulation, not physical-device acceptance.
   - Exercise ordinary touch, the Safari no-button-focus model and a long mouse hold, across all three phone geometries and normal/reduced motion. Evaluate the intentional zero-motion transition override rather than assuming reduced motion disables the safety delay.
   - Confirm notices settle back to the header after interaction settles, without field movement attributable to repinning. Header-height changes may restart the short grace period; do not assert an exact 600 ms wall-clock deadline after pointer release.
   - Look for unintended consequences of **any main-area press** briefly unpinning notices, including clean pickers and disclosure summaries. Clean picker focus alone is excluded from the keyboard selector; an active pointer is a separate condition.
2. **Existing keyboard behavior and test strength.** Verify one-tap Save/Cancel by touch, mouse, Tab+Enter and the Safari focus model. Keep draft/collapsed-section/desktop checks meaningful after moving from `position:static` to sticky-offset/geometry checks. Do the negative controls fail for the intended behavioral reason? Check for vacuous hit tests or asynchronous timing assumptions.
   - Expanded dirty/restored drafts can unpin notices without keyboard focus; closed sections are excluded, offscreen expanded forms are not. Check History, weigh-in, Settings numbers and feeding-time forms.
   - The measured 23 px Cancel movement was the Activity summary losing its Unsaved changes marker; the separate Still to log height change had compensating scroll anchoring. Do not confuse those content updates with the isolated repinning step.
3. **Failed saves and offline coverage.** Confirm the three failed-save activation modes preserve the complete saved record/queue and typed value, provide enabled/visible/hittable Save, and complete one coordinate-touch retry with exactly one correct operation after storage recovers. Button focus is not guaranteed, and `role="alert"` does not prove VoiceOver announcement. Judge the CC-K2 offscreen-detail trade-off separately.
   - Run the offline suite with Playwright's matching browser. Its online positive control, actual `navigator.onLine` and uncached localhost fetch checks must validate emulation across reload/reopen without spoofing connectivity or weakening SDK-fixture outcomes.
4. **Forced colours, release and protected boundaries.** Retain the 12 forced-colour scenarios with real nonzero ± adjustment fills; remove only the gauge-fill rule in a temporary HTML copy and confirm failure. Release identifiers must agree at 3.12.4 and differ from base 3.12.3; worker runtime changes only `VERSION`.
   - This change is not CSS-only: the only added runtime JavaScript is the isolated pointer guard. Verify the audit allows only its exact hash-pinned block, removes that block and then compares all pre-existing application/shell scripts and markup against base after release normalization. No pre-existing Firebase, save/sync/outbox, draft, calculation, export or shell logic may change. Check that mutations of either the allowed block or protected existing code are rejected, using temporary copies outside the checkout.
5. **Documentation and dispositions.** After your own initial pass, reconcile the reported findings and new wording. Distinguish Chromium descriptor geometry, assumed keyboard-visible heights and offset-zero document scrolling from measured iOS/Safari behavior. Historical performance evidence is labelled `d0aa02f`; rerun and label measurements only if relying on a current performance claim. CC-R2/R4/R5/R6 are prior non-blocking P3 feedback, not automatic new runtime requirements.

**Run on the exact head:**

```text
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"
all tests/*.browser.cjs (11 suites)
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06-claude/states-probe.cjs
node docs/reviews/2026-11-06-claude/audit-boundaries.cjs
git diff --check <base>..<head>
APP_HTML=<temporary exact af00e4c HTML> node tests/keyboard-reveal.browser.cjs
APP_HTML=<temporary exact 3bb4c65 HTML> node tests/keyboard-reveal.browser.cjs
APP_HTML=<temporary head HTML without the pointer-guard block> node tests/keyboard-reveal.browser.cjs
APP_HTML=<temporary head HTML without the repin delay> node tests/keyboard-reveal.browser.cjs
APP_HTML=<temporary head HTML without the reduced-motion delay exception> node tests/keyboard-reveal.browser.cjs
APP_HTML=<temporary head HTML without only gauge-fill rule> node tests/forced-colours.browser.cjs
```

The six temporary counterfactual runs are expected to fail. Counts to verify:
**220 Node; 203 browser (124 existing + 67 keyboard + 12 forced colours); 240 layout; 19 inspected state configurations.**
Report real failures, skips and unexecuted scenarios; do not edit tests to reach these counts. Use the browser bundled for the installed Playwright version and record both versions; an arbitrary custom Chromium executable may not emulate offline state correctly.

**Submit** one GitHub review as **COMMENT**, explicitly marked AI-generated. Include:

- exact reviewed head/base SHAs, environment, commands and results;
- a separate disposition for clean-field tap CX22-03, failed-save test CX22-03, CX22-01, CX22-02, CX22-04 / CC-R3 and remaining CC-R feedback;
- actionable findings with severity, file:line and reproduction, avoiding duplicate finding identifiers;
- the Firebase/protected-boundary audit;
- separate conclusions for this change and overall production readiness;
- every missing physical-device or real-SDK check, including physical iPhone Safari/Home Screen single Save/Cancel and clean-field interaction acceptance.

No @-mentions, approval, merge or deployment. Existing protected P1 risks and a passing synthetic suite do not establish production readiness.

Sign **"Antigravity independent re-review — PR #22"**.
