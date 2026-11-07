# Whole-app review and focused fixes (Claude Code), 6 November 2026

**Base:** `main` at `ee42092658259605f56ef3cc9281418bb43b69f5` (app 3.12.3, after PR #21). **Result:** app 3.12.4: accessibility CSS, an isolated presentation-only pointer guard for notice timing, matching release IDs, browser regression coverage and a reproducible boundary audit. Existing application and shell logic is unchanged apart from the release identifier. The PR description records the final head SHA. Nothing is merged or deployed.

**Follow-up, 7 November (Codex):** the clean-field tap correction is implemented
with a repinning delay, isolated pointer guard and raw-coordinate regression coverage. The current
validation and merge checklist are recorded at the end of this report and in
[the reconciliation](review-reconciliation.md). Earlier measurements below are
labelled with their source revision; they are not approval of the latest changes.

## Scope and method

I read the repository instructions (`docs/review-handoff.md` §6, `docs/ux-review.md` §2–§4), the consolidated backlog (`docs/review-merged.md`) and the 4–6 November review reports, so known findings are cited rather than rediscovered. I then reviewed `index.html` (styles, shell bootstrap, calculations, outbox/sync, rendering, drafts, handlers, boot), `sw.js` and `manifest.webmanifest`. Before changing anything I ran the complete existing suites on the base: **220/220 Node tests and 124/124 browser scenarios**.

There were no open PRs at the start. Everything used synthetic data through the repository's Firebase-blocked fixture. No production account, Firebase project, rules or data were read, probed or modified.

**Original author-review environment:** Linux, Node 22.23.4, Playwright's bundled Chromium 153.0.8010.12. WebKit was not available. "iPhone 16" and "iPhone 17 Pro Max" below mean **Playwright's device descriptors in Chromium**: the viewport, device pixel ratio, touch input and user agent are emulated, but the rendering engine is not Safari. No physical iPhone, Safari, Home Screen install, VoiceOver, Dynamic Type, native keyboard or Windows/Brave run was available in that pass. The later Codex follow-up's Windows environment is recorded in the current validation section.

Severity follows the repository's scale: **P1** daily impact or data risk, **P2** noticeable friction, **P3** polish.

## 1. iPhone usability and accessibility

### CC-K1 · P2 · fixed · Field being typed in hidden between the notices and the keyboard

- **Impact:** When notices are showing, typing on a phone can happen into a field the user cannot see. Two ordinary notices are enough, for example *Sync pending* on a walk with no signal plus a recent *Undo*. The Chromium model keeps the layout viewport full height and reduces the modeled visual viewport with `offsetTop: 0`. It assumes the browser reveals the field by scrolling the document. Actual iOS viewport panning, native keyboard dimensions and page-end behavior remain unverified; sticky positioning is not a measurement of the visual viewport.
- **Evidence:** In Chromium using Playwright descriptor geometry, the pinned top bar plus two notices measure **352 px** at 393×659 (iPhone 16 descriptor), against an **assumed** 330 px visible above the keyboard. The measured/assumed pairs are **359/400 px** at 440×763 (iPhone 17 Pro Max descriptor) and **311/270 px** at 320×568. The notice-stack heights are measured; the visible heights are estimates, not physical-device measurements. On the base commit the focused field ends either under the notices or below the modeled keyboard. `tests/keyboard-reveal.browser.cjs` fails on `ee42092` with *"Today: Minutes walked stays above the 330px keyboard viewport"*.
- **Presentation fix:** On touch devices (`hover:none` and `pointer:coarse`), while a keyboard field in `#main` is focused, **or an expanded entry is unsaved** (a `[data-dirty]` form outside any collapsed section), notices stay out of the way:
  - the notice region retains its sticky, in-flow layout but uses an offscreen sticking offset while editing;
  - focus scrolling reserves only the top bar's height.

  *Revised after review (CX22-01):* the first version keyed only on field focus, so a Save/Cancel tap moved focus away, pinned the notices over the button and swallowed the tap. Unsaved state, rather than button focus, now carries the notices through the tap. That matters because Safari does not focus a tapped button; it only blurs the field. See [the reconciliation](review-reconciliation.md).

  *Clean-field follow-up:* ending the edit does not immediately return notices over a pointer interaction. An isolated inline UI script, `notice-pointer-guard`, follows the existing classic shell script and sits outside the application module. It tracks main-area pointer IDs in a Set and applies the root `data-notice-press` marker while contact is held. It removes completed/cancelled pointers and clears the marker on window blur or pagehide. It neither suppresses events nor invokes application rendering, saving, syncing or storage.

  CSS holds the offscreen sticky offset while that marker is present, then uses a zero-duration 600 ms delay before restoring the normal offset. This gives a short grace period after interaction settles; header-height changes can restart it, so 600 ms is not an exact wall-clock deadline after release. The delay is interaction protection, not animation, and also applies with reduced motion enabled. CSS `:active` alone did not reliably persist during touch contact: a touch beginning near the end of the grace period could lose its target while held. Regression coverage includes CDP-dispatched touch contact crossing that boundary and measures actual hit targets and notice state rather than requiring `position: static`.

  The notice region keeps its normal-flow space. Tests isolate the pin/unpin transition and check that it adds no field movement; existing draft-summary and *Still to log* updates on Cancel can change content height. Clean date/time/file picker focus does not itself unpin notices. Any main-area press, including a clean picker or disclosure summary, briefly unpins them through the separate pointer marker. Editing a feeding-time value marks its form dirty, so that expanded form keeps them unpinned after blur. Restored expanded drafts also unpin notices without keyboard focus; "expanded" does not mean currently inside the viewport. A collapsed dirty section is excluded. Desktop layout behavior remains unchanged because the CSS is limited to coarse, non-hover pointers. Notices remain in the page and their live region, and the top bar's sync status stays pinned. Existing save, draft, outbox and sync code is untouched.
- **Clean-field tap P2 (CX22-03 / CC-R1):** On `af00e4c` and earlier heads, focusing without typing and tapping an unrelated control inside the returning notice band swallowed the first tap. A second tap at the same coordinates could activate Dismiss instead of the intended BCS control; scrolling the intended control clear was required. This was not fixed by the failed-save test change, which independently reused the ID CX22-03. The presentation follow-up above addresses this transition; current validation is recorded below, and physical Safari/Home Screen acceptance remains open.
- **Residual (failed save, CC-K2 · P3 · accepted):** If saving locally fails while the entry is open, the *Could not save locally* alert sits with the other notices at the top of the page, outside the keyboard viewport. The failure is not silent:
  - the pinned status line reads *Not saved*;
  - the alert keeps `role="alert"`; actual VoiceOver announcement remains unverified;
  - the entry and its value stay open, with Save enabled, visible and hittable for a retry; it may lose focus while disabled during saving or never take focus on Safari;
  - nothing is queued.

  Pinning alert-level notices instead would cover the field and Save again. A field-level message would need a script change in the save path, which remains outside this presentation-only change. The three failed-save scenarios introduced in `af00e4c` exercise touch, Tab+Enter and the Safari focus model, then verify that one coordinate-based touch retry saves exactly once after synthetic storage recovers. They verify alert semantics, not assistive-technology speech.
- **Residual (space):** At 320 px, a field with long help text (Active minutes) cannot fit its field, help and Save row in about 215 px. The typed field stays visible and Save is one scroll below (Return also saves numeric fields). The test records this case rather than asserting that Save fits. When editing, a new notice (for example a local save failure) appears at the top of the page rather than pinned. Its live-region semantics remain, and the pinned status reads *Not saved*; actual announcement is unverified.
- **Relation to CL-05:** This addresses the worst case of CL-05 (sticky notices up to 45dvh) during text entry only. Outside text entry the cap is unchanged: two notices still take **297 of 659 px** at the iPhone 16 viewport and 154 of 343 px in iPhone 16 landscape. Consolidating notices still needs on-device priority decisions.

### CC-F1 · P3 · fixed · Status marks vanish with forced colours

- **Impact:** In Windows High Contrast (forced colours), marks drawn only as a fill take the page colour and disappear. Affected: the Review tab's *needs attention* dot, stool band dots on Today and History, the stool chart's points, and the ration gauge fill and midline. Each has a text or spoken equivalent, but sighted High Contrast users lose the attention cue on the tab bar.
- **Evidence:** With Chromium `forcedColors: 'active'`, each mark computes to `rgb(255,255,255)` with no border on a white Canvas. `tests/forced-colours.browser.cjs` fails on `ee42092` for the attention dot.
- **Fix:** Inside the existing `@media(forced-colors:active)` block these marks use `CanvasText`, and the gauge fill uses `Highlight`, with `forced-color-adjust:none`. Stool chart shapes (circle, square, diamond) still distinguish the bands. The test also asserts that normal light and dark appearances keep their tokens.

### Verified without a new finding

- **Conditional states:** `states-probe.cjs` covers the open stool editor, stacked notices, an invalid-field error, the History day editor, fully expanded Settings and the sign-in gate. It ran under iPhone 16, iPhone 17 Pro Max, iPhone 16 landscape, 320×568 and 1440×900, in light and dark, at 16 px and 32 px root text. In all **19 configurations** it found:
  - no horizontal overflow and no off-screen control;
  - every enabled control at least 44×44 px;
  - the last control clearing the tab bar at the page end;
  - invalid fields keeping focus with `aria-invalid` and a visible message;
  - no page errors.

  This complements the existing 240-combination `layout-checks.cjs`, which still passes.
- **Contrast:** Text tokens are ≥ 4.5:1 on every surface in both themes. Borders and the off switch are ≥ 3:1. Status uses text and shape as well as colour (Bristol words, *Above/Below range* labels, streak glyphs, *Blood*/*Mucus* text).
- **Already covered by existing suites:** `font:-apple-system-body`, 16 px minimum field text (no iOS focus zoom), safe-area padding, the tab bar's home-indicator handling, native date/time inputs and `aria-current` on tabs.

### Unresolved: device and AT acceptance

| ID | Sev | Note |
|---|---|---|
| CL-05 | P2 | Notice region still up to 45dvh when not typing; consolidation needs device acceptance |
| CC-A1 | P3, unverified | `#feedback` is `aria-live="polite" aria-atomic="true"`, so any notice change re-announces every notice. Possibly noisy in VoiceOver; needs an AT test before changing |
| CC-A2 | P3, unverified | `black-translucent` status bar in the light theme may give white system text on a light top bar in the Home Screen app. Changing it alters safe-area layout; needs a device |
| — | — | Physical Safari, Home Screen, VoiceOver, Dynamic Type, keyboard, zoom and browser-chrome checks remain open (`docs/reviews/2026-11-05/device-acceptance.md`) |

## 2. Performance and responsiveness

No performance code was changed: the only measured bottleneck needs a design that can't be verified here. The measurements in this section and the corresponding raw output in `evidence/` were collected at `d0aa02f`, on unthrottled local hardware with a synthetic SDK. They predate the unsaved-state selector in `e7acf4f` and the clean-field follow-up; they are historical measurements, not benchmarks of the current head (CC-R5).

**At `d0aa02f`, daily interactions were frame-bound at all measured history sizes.** `interaction-probe.cjs` times each action from dispatch to the next frame on the emulated phone viewport:

| History | Quick-log stool (whole save path) | Typing a note (median) | Tab switches |
|---|---:|---:|---:|
| 31 days | 14.8 ms | 16.7 ms | 12.6–15.1 ms |
| 365 days | 17.8 ms | 16.6 ms | 12.6–15.8 ms |
| 1,826 days | 24.6 ms | 16.7 ms | 7.3–20.0 ms |

Fixture to ready time: 68 / 76 / 122 ms.

**PERF-01 · P2 · remains:** The *All* range is the only heavy path. Five-year All History builds **71,311 nodes**, warm **593 ms** through layout (177 ms script); All Review takes 91 ms (`history-benchmark.cjs`, `evidence/history-benchmark-3.12.4.jsonl`). The default 14-day views take 5–10 ms. A phone CPU will be slower than this desktop.

I evaluated `content-visibility:auto` on diary cards and rejected it. Never-rendered cards above the viewport change height when they scroll into view; without scroll anchoring (not verified for Safari here) that is a visible jump, which this review is asked to avoid. **Next step:** render the first N cards with a *Show more* control, preserving find-in-page and focus return, and test on a device.

**Static cost:** 299 KB uncompressed (about 92 KB gzip, local estimate) HTML, one 2,960-byte PNG, three pinned Firebase modules served from the worker cache. No dependency was added.

## 3. Offline experience and resilience

- **CC-K1 applies here too.** *Sync pending* is the notice most likely to be showing when typing without signal.
- **Verified at `af00e4c`:** `offline-launch.browser.cjs` (6) and `offline-friction.browser.cjs` (24) passed with matching Playwright Chromium 156.0.8078.4. They cover worker install, offline shell reload, outbox survival across reopening, replay without duplicates, draft retention and an incomplete release being rejected. Offline emulation is now explicitly checked using real `navigator.onLine` and an uncached localhost request; it is still a synthetic SDK fixture, not real Firebase validation. Current follow-up results are recorded below.
- **Status wording:** The status line already distinguishes the states the implementation can establish:
  - *Saved locally; syncing*
  - *Offline · saved on this device*
  - *Saved locally; retry sync*
  - *Synced* (only with server evidence)
  - *Cached; checking sync*
  - *Sync held · needs attention*
  - *Not saved*

  Settings › Sync & storage gives the count and age of waiting changes and the last server confirmation, and avoids promising background sync or unlimited storage.
- **Worker:** It validates a complete release before caching, never forces a reload over unfinished entries, and clears only its own scoped caches. Its behaviour is unchanged; only `VERSION` moved.

**Unresolved:**

| ID | Sev | Status | Note |
|---|---|---|---|
| CC-O1 | P3 | **Blocked (protected)** | The *Sync pending* banner says entries "will sync automatically once connected". On an iPhone this holds only while the app is open (Settings already says so). The text lives inside `flushWrites`, protected sync code, so it is not edited. Next step: an authorised copy-only change there |
| CC-O2 | P3 | Unverified | If the browser cannot provide Firestore's persistent cache (memory fallback), what an offline launch shows was not establishable without the real SDK. Next step: real-SDK offline launch test with a synthetic project |
| AG-05 | P1 | **Blocked** | Reproduced again on this head by `docs/reviews/2026-11-04/reproduce-offline.cjs` (15 scenarios: 13 defect/edge cases, 2 safe controls). Unchanged from `docs/reviews/2026-11-06/whole-app-review.md` §3; each needs a separately authorised conflict, identity or recovery design in the protected outbox/transaction code |
| FR-01 | P1 | **Blocked** | As AG-05 |
| FR-02 | P1 | **Blocked** | As AG-05 |
| AG-04 / CL-03 | P2 | **Blocked** | As AG-05 |
| AV-02 | P2 | **Blocked** | As AG-05 |
| FR-03 | P3 | **Blocked** | As AG-05 |

## 4. Security and privacy

No new vulnerability was found.

- **Rendering:** I swept every interpolation of stored fields into HTML. Each is escaped (`esc`, `switchRow`, `mealSummary`) or constrained first (`validDate` keys, `Number.isFinite`, fixed enumerations). There are no anchors or external links, no `eval`, `new Function` or `document.write`, and the HTML insertions use escaped content.
- **Logging:** The two `console.warn` calls carry no record data.
- **Secrets:** A pattern scan for private keys and cloud/API tokens found nothing. The single `AIza…` value is Firebase's **public web client configuration**, not a secret; its values are not repeated here. Access control depends on deployed rules and Auth settings.
- **Personal weight readings:** The weigh-in fields keep `autocomplete="off"`, `autocorrect="off"` and `spellcheck="false"`. Readings stay transient, and only Murphy's net weight is saved (8 weigh-in scenarios pass). This change adds no logging and touches no weight code.
- **CODE-02 · P3 · blocked:** Deployed Firestore rules are not in the repository, so the shared `days`/`changes`/`settings/main` paths can't be confirmed as restricted to the intended accounts. Next step: an authorised rules review with emulator authorisation tests.

## 5. Correctness and regression coverage

No calculation, record format, backup/export schema, history interpretation or workflow changed. New coverage, plus the version updates:

- `tests/keyboard-reveal.browser.cjs`: `b5476b2` had 41 scenarios; `af00e4c` expanded failed-local-save coverage from one to three and passed 43. The current clean-field follow-up adds raw-coordinate interaction coverage; its final count is recorded below. The suite retains Save/Cancel activations, field visibility, collapsed-section, failed-save retry and desktop coverage.
- `tests/forced-colours.browser.cjs`: 12 scenarios, including real ±20 g gauge fills added by Codex (CX22-02). It fails on base, and also fails when only the gauge-fill rule is removed.
- Version assertions in `ui-ergonomics.test.cjs`, `settings-exports.browser.cjs` and `sw-assets.test.cjs` now expect 3.12.4; the worker upgrade fixture stages from main's 3.12.3.

Domain issues AG-03 (P2), AG-09 (P3) and AG-10 (P3) still reproduce with `docs/reviews/2026-11-04/reproduce-domain.cjs`. They are left unchanged because they would alter calculations or export meaning.

## Validation

```bash
node --test tests/*.test.cjs
```

```bash
for f in tests/*.browser.cjs; do node "$f" || exit 1; done
```

```bash
node docs/reviews/2026-11-06/layout-checks.cjs
```

```bash
node docs/reviews/2026-11-06/history-benchmark.cjs
```

```bash
node docs/reviews/2026-11-06-claude/states-probe.cjs
```

```bash
node docs/reviews/2026-11-06-claude/interaction-probe.cjs
```

```bash
node docs/reviews/2026-11-06-claude/audit-boundaries.cjs
```

Historical results reported for `b5476b2` in the author's Linux/Chromium 153 environment:

- **220/220 Node tests.**
- **177/177 browser scenarios:** 124 existing + 41 + 12 (after the review follow-ups).
- **240/240 layout combinations.**
- **19/19 conditional-state configurations** with no problems.
- **No page errors and no external requests** in any browser suite.
- Both new suites were also run against `ee42092` (`APP_HTML=<base index.html>`) and fail there, as intended. The keyboard suite also fails against the earlier PR heads `d0aa02f` and `3bb4c65`, as described above.

The later Windows validation of `af00e4c` passed **220 Node / 179 browser / 240 layout** checks and inspected **19 state configurations** with no reported problems or errors. See [the test-validation follow-up](codex-validation-fixes.md) for its matching-browser setup and the two negative controls. These historical numbers do not replace validation of the current CSS and pointer-guard change.

## Firebase and protected-data diff audit

The original `audit-boundaries.cjs` compared the tree with `ee42092`; its recorded negative control rejected a deliberate Firestore cache-option change. The current audit permits the new presentation-only script only by exact pinned hash, removes that exact block for comparison, and retains the protected-code comparison. It checks that:

- `index.html` changes only inside its `<style>` block, in `data-version` / `APP_VERSION`, and by the exact hash-pinned `notice-pointer-guard` block;
- after removing only that verified new block and normalizing release identifiers, all pre-existing markup and scripts after `</style>` are identical, including the classic shell, every Firebase import, configuration, initialisation, Auth, listeners, transactions, outbox, drafts, saving, calculations and import/export;
- `sw.js` changes only `VERSION`;
- `manifest.webmanifest`, `icon-180.png` and `.gitattributes` are byte-identical.

No dependency, SDK version, configuration, rules, cloud resource, database structure, local storage format or save/sync/outbox semantics changed. No data was reset, migrated or reinterpreted.

**Remaining risk:**

- The P1 data-integrity defects above remain and prevent a data-safety or production-readiness claim.
- The fixes are verified in Chromium emulation only.
- CC-K1 models document scrolling with visual-viewport offset zero; it does not model native iOS panning at the page end. The Safari focus model and delayed sticky-offset transition both need physical iPhone validation, including a single Save/Cancel tap and clean-field tap with two notices showing.

Under `docs/review-handoff.md` §6, Codex, Claude Code and Antigravity must each review this change independently before merge. This report is the authoring session's review, not an independent one.

## Current clean-field follow-up: validation and merge gate

The current runtime change is presentation CSS plus an isolated inline UI pointer
guard; release identifiers remain aligned at 3.12.4. All pre-existing application
and shell logic remains unchanged apart from the release identifier. Firebase,
save/sync/outbox, storage, calculations and export behavior are unchanged.
Validation below was run on the final implementation working tree before its
commit was created. The PR description records the resulting published head.
Environment: Windows x64, Node 20.18.0, Playwright 1.64.1 and matching Chromium
headless shell 156.0.8078.4; synthetic data and local fixtures only.

| Check | Result |
|---|---|
| Node suite | **220/220** |
| All 11 browser suites | **203/203**: 124 existing + 67 keyboard + 12 forced colours |
| Layout matrix | **240/240** |
| State probe | **19 inspected configurations**, no reported problems or errors |
| Protected-boundary audit | **Pass** against base, allowing only the exact hash-pinned pointer guard |
| Diff hygiene | **`git diff --check` clean** |
| Browser negative controls | **Six expected failures**, described below |
| Audit negative controls | **Three rejected mutations**: pointer guard, Firebase import and save logic |

The 67 keyboard scenarios retain the earlier 43 cases and add 24 clean-field
cases: 18 first/repeated/held-press cases across three widths, two motion settings
and ordinary touch/Safari-model touch/long mouse hold; plus six CDP-dispatched touch
cases crossing the repin deadline across three widths and both motion settings.
All browser suites reported zero page errors and zero external app requests.

The unchanged regression suite fails against `af00e4c` at the first clean-field
activation, and against `3bb4c65` after six cases at Safari-model keyboard/focus
visibility. Temporary current-HTML copies also fail when removing the pointer
guard (held press), the repin delay (first activation), the reduced-motion delay
exception (first activation in reduced motion), or the forced-colour gauge-fill
rule (white fill on white background). These negative controls verify the
regressions are detected rather than silently weakening the earlier assertions.

- [x] Final full Node, browser, layout, state and boundary checks recorded for the current implementation working tree.
- [ ] [Codex independent re-review](prompts/codex-rereview.md) of the final runtime and regression changes.
- [ ] [Claude Code independent re-review](prompts/claude-rereview.md) in a separate session.
- [ ] [Antigravity independent re-review](prompts/antigravity-rereview.md) of the final changes.
- [ ] Physical iPhone Safari and Home Screen acceptance: two notices, native keyboard, one Save and one Cancel tap; clean-field first/repeated tap, long press and repinning without a jump.
- [ ] Reconcile review findings on the final head and update the PR checklist.

All earlier reviews remain evidence for their recorded SHAs, not approval of this
new runtime change. VoiceOver, real Firebase and the protected P1 backlog remain
separate unverified or unresolved production-readiness limits.
