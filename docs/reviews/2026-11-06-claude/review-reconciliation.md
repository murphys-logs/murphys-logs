# PR #22 review reconciliation

Rounds 1 and 2 below retain their historical validation results. The final section
records the Codex clean-field and CC-R7 follow-ups of 7 November and the current merge gate.

**Reviews received:**

| Reviewer | Reviewed | Result |
|---|---|---|
| [Antigravity](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808369935) | `d0aa02f` | No findings |
| [Codex](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808411982) | `d0aa02f` | Two findings; fixes pushed as `3bb4c65` ([report](codex-follow-up.md)) |

Base is unchanged at `ee42092658259605f56ef3cc9281418bb43b69f5`. The first two rounds record the author's (Claude Code) dispositions; the final section records Codex's subsequent implementation follow-up. No earlier review counts as approval of a later runtime change. No merge or deployment is authorised.

## Dispositions

### CX22-01 · P2 · Notices repin over Save/Cancel and swallow the tap

**Accepted; Codex's fix refined.**

- **Finding verified:** this was a regression introduced by CC-K1. It still fails on `d0aa02f` at the first touch Save.
- **Gap in `3bb4c65`:** that fix keeps notices unpinned while a `[data-confirm] button` has focus. Safari (iOS and macOS) does not focus a tapped or clicked button; it only blurs the field, so focus goes to `body`. Under a Safari focus model, the notices repin mid-tap exactly as before. Evidence: the keyboard suite with a capturing `mousedown` that blocks button focus and blurs the field passes touch, mouse and Tab+Enter on `3bb4c65` (6 cases), then times out on the first Safari-model Save (393×659, 330 px).
- **Refined fix (CSS only):**
  - **Condition:** notices stay unpinned while a keyboard field is focused **or** a visible entry is unsaved: `#main [data-dirty]:not(details:not([open]) *)`.
  - **Why this holds through a tap:** Save/Cancel exist only while an entry is unsaved, and the unsaved state lasts through the tap whatever the browser does with focus.
  - **When they pin again:** after Save or Cancel, with no content shift (asserted).
  - **Collapsed sections:** an unsaved entry inside a collapsed Today section leaves notices pinned, since there is nothing visible to tap.
  - **Scope, corrected after review:** desktop behavior and clean picker focus are unchanged. An edited feeding-time form gains `[data-dirty]` and unpins notices after blur; restored expanded drafts can also unpin them without focus. The exclusion is collapsed sections, not elements outside the viewport.
- **Tests:** 24 activation cases (touch, mouse, Tab+Enter, Safari-model touch; × Save/Cancel; × 393×659/330, 440×763/400 and 320×568/270). They now run first, so failures on older heads are the user-visible tap failures. Three cases cover collapsed sections.
- **Revised assertion, attribution corrected:** "pinned again on blur" became "still unpinned while unsaved; pinned again after Cancel". The no-shift check isolates repinning. At `3bb4c65` and `af00e4c`, the measured 23 px field movement on Cancel comes from the Activity summary losing its *Unsaved changes* marker. *Still to log* separately shrinks 44 px, offset by scroll anchoring in that fixture; repinning adds zero field movement. Both content updates predate this PR refinement.
- **Historical clean-field residual, subsequently escalated to P2:** on `af00e4c` and earlier, focusing without typing then tapping a control in the returning notice band swallowed the first tap. A second tap at unchanged coordinates could activate Dismiss instead of the intended BCS control, with no record writes. The original first-tap-only acceptance did not verify that retry. See the final section for the corrective follow-up; a second tap cannot be described as reliable without moving the target clear on those older heads.

### CX22-02 · P3 · Forced-colours test skipped every gauge fill

**Accepted; verified.**

The fixture always had a zero adjustment, so the fill was always skipped. Codex added real +20 g and −20 g adjustments in all four appearance configurations (12 scenarios). Independently checked: removing only the `.gauge .fill` forced-colours rule from a copy of the current HTML fails with `rgb(255,255,255) on rgb(255,255,255)`.

### Antigravity review

**No findings; claims qualified.**

- The review covered `d0aa02f` only. It predates both follow-ups and does not cover CX22-01.
- *"Multi-Year History Benchmark 3/3 runs passed"* refers to `interaction-probe.cjs`, which records timings and has no pass/fail assertions. It is evidence, not a passing test.
- *"Recommend merge"* does not override `docs/review-handoff.md` §6: all three named reviewers must review the current changes, and the physical-device check is still open.
- Agreed: no Firebase or data-boundary change; personal readings stay transient.

## Historical round-1 validation at `c989afa`

Linux, Node 22.23.4, Playwright Chromium 153.0.8010.12, synthetic data:

- **220/220 Node tests.**
- **176/176 browser scenarios:** 124 existing + 40 keyboard + 12 forced-colours.
- **240/240 layout combinations.**
- **19/19 conditional-state configurations.**
- **Boundary audit passes;** `git diff --check` is clean.
- **Counterfactuals:** the keyboard suite fails on `ee42092`, `d0aa02f` and `3bb4c65`; the forced-colours suite fails without the gauge-fill rule.
- **Not rerun:** `history-benchmark.cjs` and `interaction-probe.cjs`. The runtime delta is a CSS selector; their earlier outputs remain historical evidence for `d0aa02f`.

The runtime delta from base remains CSS inside `<style>` plus the aligned 3.12.4 release IDs. Firebase SDK/configuration/Auth/listeners/transactions, outbox, drafts, saving, calculations, import/export, storage formats and personal-weight handling are unchanged.

## Gate recorded at round 1

- **Independent re-review** of the current head by Codex, Claude Code and Antigravity ([prompts](prompts/)). The Claude Code reviewer must be a separate session from the author's.
- **Physical iPhone check in Safari and the Home Screen app:**
  - two notices showing, keyboard open;
  - type, then a single tap on Save, and separately on Cancel;
  - confirm the notices stay out of the way and then pin again without the page jumping.
- **Pre-existing documented P1 data-integrity risks remain.**

# Round 2: re-reviews of `c989afa`

**First posted for this round:** [Antigravity's re-review](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808588395) of `c989afaf3c34f29a5daaae916cabe0e290386bec` (Windows 11, Node 20.18.0, Edge 157). Codex and Claude Code reviews arrived later and are listed in the current review history below; the original statement that they had not been posted is no longer current.

## Antigravity dispositions

**No new findings, accepted.** Antigravity reproduced CX22-01 on `d0aa02f`, and the Safari-model failure on `3bb4c65`. It confirmed CX22-01 and CX22-02 as fixed on `c989afa`, judged the residual tap acceptable, and agreed with both round-1 wording qualifications. It reported 220 Node tests, 176 browser scenarios, 240 layout combinations, 19 state configurations, a clean audit and a clean `git diff --check`.

**One claim corrected, which led to CC-K2.** The review says that after a failed save *"S.error displays inline at the field level"*. The app has no `S.error`, and a failed local save shows no field-level message. The 393×659 / 330 px modeled-keyboard storage-failure probe retained the *Could not save locally* alert with `role="alert"` at the top of the page, outside the keyboard viewport. The pinned status reads *Not saved*, the entry and value stay open with Save visible and reachable, and nothing is queued. Focus retention is not portable: Save can blur while disabled or never take focus on Safari. `role="alert"` establishes markup semantics, not a verified VoiceOver announcement. On `main` the alert was pinned and visible, but the field was the part hidden.

## CC-K2 · P3 · accepted trade-off, now tested

Pinning alert-level notices while an entry is open would cover the field and Save again, which is CC-K1. A field-level message would need a script change in the save path, outside that original CSS-only scope and the current protected save boundary. The trade-off is documented in the report. A new keyboard-suite scenario pins down the signals that remain: *Not saved* visible, the alert present, the entry kept, Save reachable, nothing queued.

## Historical round-2 validation at `b5476b2` (test and documentation change only)

- **No runtime change since `c989afa`:** `index.html` and `sw.js` are byte-identical to it.
- **220/220 Node tests.**
- **177/177 browser scenarios:** 124 + 41 + 12.
- **240/240 layout combinations; 19/19 state configurations.**
- **Boundary audit passes;** `git diff --check` is clean.

## Gate recorded at round 2

- At this point the author awaited the Codex and separate-session Claude Code reviews. They have since arrived, as recorded below. Antigravity also confirmed `b5476b2`.
- The physical iPhone check is open.
- The documented P1 data-integrity risks still rule out a production-readiness claim.

# Current follow-up: clean-field tap, CC-R7 narrowing and review reconciliation

## Reviews received since round 2

| Reviewer | Reviewed | Result |
|---|---|---|
| [Codex](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808651151) | `c989afa` | Dirty Save/Cancel and forced colours verified; clean-field tap P2 and picker wording P3 remain |
| [Antigravity confirmation](https://github.com/murphys-logs/murphys-logs/pull/22#issuecomment-6699114953) | `b5476b2` | Test/documentation delta confirmed; 177 browser scenarios reported |
| [Codex](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808708928) | `b5476b2` | Failed-save focus assertion P2; custom-browser offline validation gap |
| [Claude Code, separate session](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808717249) | `b5476b2` | Original fixes verified; clean-field/docs corrections and CC-R1–R6 feedback |
| [Codex re-review](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808790820) | `af00e4c` | Failed-save and offline-test changes verified; clean-field second-tap P2 reproduced; merge gate remains open |
| [Antigravity](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5809039797) | `5fccd69` | Full positive checks and six counterfactuals reported; no new findings |
| [Claude Code, separate session](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5809044025) | `5fccd69` | Full checks and clean-field fix verified; new CC-R7 P2 for ordinary-gesture notice flicker and CC-R8 P3 for header-height lag |

The `af00e4c` test-only follow-up passed 220 Node tests, 179 browser scenarios,
240 layout checks and 19 inspected state configurations on matching Playwright
Chromium 156.0.8078.4. Its independent Codex pass reran the 43 keyboard and six
offline scenarios. These results are historical evidence for that exact head;
they do not validate later runtime changes automatically. Both external reviews
of `5fccd69` are now received. That head's 220 Node / 203 browser / 240 layout /
19 inspected-state results are historical evidence for the broad pointer guard.
The current narrowing needs its own validation and relevant re-review.

## Distinguishing the two CX22-03 identifiers

Two independent reviews used the same identifier for different findings:

- **CX22-03, clean-field tap P2:** the first review's returning-notices finding,
  linked from [the inline thread](https://github.com/murphys-logs/murphys-logs/pull/22#discussion_r4498901219).
  It remained in `af00e4c`, was corrected in `5fccd69`, and must stay fixed while
  the current CC-R7 change narrows the guard's scope.
- **CX22-03, failed-save focus-test P2:** the later assertion finding, fixed in
  `af00e4c`. Tests now verify enabled/visible/hittable Save and one actual retry
  instead of assuming the button keeps focus. The queue and saved record remain
  unchanged on failure; a successful retry queues exactly one correct operation.

Resolving the failed-save test did not resolve the clean-field interaction.

## Current dispositions

| Finding | Disposition |
|---|---|
| Clean-field tap CX22-03 / CC-R1 | Implemented at `5fccd69` and verified by both external reviewers in Chromium. The notice region stays sticky with an offscreen offset while editing; the pointer hold and zero-duration 600 ms delay protect first/repeated taps, long holds and contacts across the repin deadline. The CC-R7 narrowing must retain those outcomes. Physical-device acceptance remains pending. |
| CC-R7, ordinary-gesture notice flicker | P2 accepted for correction. At `5fccd69`, every main-area press hid already-pinned notices. The guard now starts a hold only if a keyboard input/textarea in `#main` is focused or the feedback region is already unpinned (`top < 0`). Ordinary pinned taps, scrolls and summary presses must remain pinned. Cancellation is exercised from an existing qualifying state. The exact guard hash and regression coverage are updated. Full validation passes as recorded below; final-head re-review remains pending. |
| CC-R8, header-height lag | Non-blocking P3, deferred. The existing `top` delay also delays header-height changes; Claude measured a temporary 22 px overlap for about 600 ms at `5fccd69`. Narrowing pointer activation does not fix this separate behavior. Record it for layout/device follow-up, without changing save/sync code. |
| Failed-save focus-test CX22-03 | Fixed and re-reviewed at `af00e4c`; retained in current coverage. Touch, keyboard and Safari-model input cover the initial failure; successful retry uses a coordinate-based touch tap in each case. |
| CX22-04 / CC-R3, picker and restored-draft scope | Accepted documentation correction. Clean picker focus alone keeps notices pinned; edited feeding-time forms and restored expanded drafts can unpin notices with no keyboard focus. "Expanded" excludes closed sections, not offscreen content. |
| CC-R2, scroll-margin coverage | Non-blocking P3. Existing coverage did not isolate that CSS declaration. Retain as explicit follow-up unless the current regression suite adds a declaration-dependent case; do not claim the mutation was previously caught. |
| CC-R4, viewport/device wording | Accepted documentation correction. Descriptor geometry is Chromium emulation, visible heights are assumptions, and offset-zero document scrolling does not cover native iOS viewport panning. |
| CC-R5, performance provenance | Accepted documentation correction. Existing interaction/performance evidence is labelled `d0aa02f`; it is not measurement of the final CSS selector/transition. No new phone performance claim. |
| CC-R6, audit version self-containment | Non-blocking P3, deferred. The audit checks agreement while current release tests pin 3.12.4; extending it to prove movement from base is a separate audit-hardening task. No runtime or release-identifier gap is claimed for this PR. |
| CC-K2, offscreen failed-save detail | Accepted scoped trade-off. The pinned Not saved status, retained value and retry are tested. The detailed alert's real VoiceOver announcement remains unverified. A field-level message would require protected save-path work, outside this change. |

The 23 px Cancel explanation is also corrected: the Activity summary loses its
Unsaved changes marker; Still to log separately shrinks with compensating scroll
anchoring in the measured fixture. The notice repinning step itself adds no field
movement. Other draft content updates are not described as motion-free.

The implementation is not CSS-only. A reviewed CSS `#main:active` hold did not
remain true throughout touch contact; a touch starting near the end of the delay
could cross the repin boundary and lose its action. The isolated inline
`notice-pointer-guard` script, after the existing classic shell and outside the
application module, tracks pointer IDs in a Set and sets `data-notice-press` on
the document root. Following CC-R7, it adds a main-area pointer only while a
keyboard field in `#main` is focused or the feedback region's computed `top` is
negative. It does not unpin settled notices for ordinary gestures. It removes
pointers on up/cancel and clears the marker on
window blur or pagehide. It has no event suppression and no application rendering,
save, sync, Firebase or storage calls. The boundary audit allows only the exact
hash-pinned new UI block, removes it, then compares every pre-existing script and
markup byte with base after release normalization.

## Historical validation at `5fccd69`

- **220 Node, 203 browser (67 keyboard), 240 layout checks and 19 state configurations.**
- **Boundary audit and diff check passed.** Six browser negative controls failed for the expected behavioral reasons, and three audit mutations were rejected.
- The implementation run used Windows x64, Node 20.18.0, Playwright 1.64.1 and matching Chromium 156.0.8078.4. Claude's separate posted review used Linux, Node 22.23.4, matching Playwright 1.63.0 / Chromium 153.0.8010.12. Antigravity's posted review reported Edge 157.
- These results and received external reviews cover the earlier broad guard only. The posted Claude CC-R7 and CC-R8 findings above are authoritative; similarly named unposted drafts are not additional findings.

## Current validation and merge checklist

The final implementation working tree passed **220/220 Node tests,
221/221 browser scenarios** across all 11 suites (124 existing + **85 keyboard** + 12 forced colours),
**240/240 layout checks** and **19 inspected state
configurations** with all reported problems/errors empty. Browser suites reported
zero page errors and zero external app requests. The protected-boundary audit
passes and `git diff --check` is clean.

Environment: Windows x64, Node 20.18.0, Playwright 1.64.1 and matching bundled
Chromium headless shell 156.0.8078.4; synthetic data and local fixtures only.
The PR description records the resulting published head.

The 85 keyboard cases retain the earlier 67 behaviors and add 18 ordinary-gesture
cases across three widths and both motion settings. They sample pointer events
and animation frames through 800 ms to catch transient hiding. Cancellation
coverage focuses a qualifying field before the cancelled contact.

**Seven browser negative controls failed for the expected reasons:** exact
`5fccd69` fails ordinary-meal notice visibility after 63 passes; exact `af00e4c`
fails the first clean-field BCS activation; exact `3bb4c65` fails Safari-model
Save completion; removing the guard fails the held-press check; removing the
repin delay fails the first activation; removing its reduced-motion override
fails the first reduced-motion activation; removing the gauge-fill rule produces
white-on-white paint. **Three in-memory audit mutations were rejected:** changed
guard, Firebase import and existing save logic. No tracked source was changed
to make a negative control pass.

Release IDs remain aligned at 3.12.4; Firebase and save/sync/outbox behavior are
unchanged. Existing application and shell scripts are unchanged apart from the
release identifier; the isolated UI pointer guard is the only added script and
only its exact reviewed hash is permitted by the audit.

- [x] Claude Code and Antigravity reviews of `5fccd69` received and their findings recorded above.
- [x] Final complete validation recorded for the CC-R7 implementation.
- [ ] [Codex independent re-review](prompts/codex-rereview.md) of the final changes.
- [ ] [Claude Code relevant re-review](prompts/claude-rereview.md) in a separate session, including CC-R7 and the retained clean-field protection.
- [ ] [Antigravity relevant re-review](prompts/antigravity-rereview.md) of the final changes.
- [ ] Physical iPhone Safari and Home Screen check with two notices and native keyboard: one Save and one Cancel tap; clean-field first/repeated tap and long press; ordinary pinned taps/scrolls/summary presses keep notices visible; repinning without a jump.
- [ ] Final reviewer dispositions reconciled and the PR checklist updated.

The user requested the corrective implementation, not a merge. Earlier reviews
cover their stated SHAs only. VoiceOver, real Firebase/SDK behavior, the protected
P1 backlog and overall production readiness remain outside the synthetic checks.
