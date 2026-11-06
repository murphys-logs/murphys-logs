# Whole-app review and focused fixes (Claude Code), 6 November 2026

**Base:** `main` at `ee42092658259605f56ef3cc9281418bb43b69f5` (app 3.12.3, after PR #21). **Result:** app 3.12.4: two CSS-only accessibility fixes, matching release IDs, two new browser regression suites and a reproducible boundary audit. The PR description records the final head SHA. Nothing is merged or deployed.

## Scope and method

I read the repository instructions (`docs/review-handoff.md` §6, `docs/ux-review.md` §2–§4), the consolidated backlog (`docs/review-merged.md`) and the 4–6 November review reports, so known findings are cited rather than rediscovered. I then reviewed `index.html` (styles, shell bootstrap, calculations, outbox/sync, rendering, drafts, handlers, boot), `sw.js` and `manifest.webmanifest`. Before changing anything I ran the complete existing suites on the base: **220/220 Node tests and 124/124 browser scenarios**.

There were no open PRs at the start. Everything used synthetic data through the repository's Firebase-blocked fixture. No production account, Firebase project, rules or data were read, probed or modified.

**Environment:** Linux, Node 22.23.4, Playwright's bundled Chromium 153.0.8010.12. WebKit was not available. "iPhone 16" and "iPhone 17 Pro Max" below mean **Playwright's device descriptors in Chromium**: the viewport, device pixel ratio, touch input and user agent are emulated, but the rendering engine is not Safari. No physical iPhone, Safari, Home Screen install, VoiceOver, Dynamic Type, native keyboard or Windows/Brave run was available.

Severity follows the repository's scale: **P1** daily impact or data risk, **P2** noticeable friction, **P3** polish.

## 1. iPhone usability and accessibility

### CC-K1 · P2 · fixed · Field being typed in hidden between the notices and the keyboard

- **Impact:** When notices are showing, typing on a phone can happen into a field the user cannot see. Two ordinary notices are enough, for example *Sync pending* on a walk with no signal plus a recent *Undo*. iOS keeps the layout viewport full height behind the keyboard and only shrinks the visual viewport (the app's own `revealAboveKeyboard` comment relies on this), so the sticky top bar and notice region stay pinned over the small visible area.
- **Evidence:** The pinned top bar plus two notices measure **352 px** at the iPhone 16 Safari viewport (393×659), against about 330 px visible above the keyboard. The figures are **359/400 px** at the iPhone 17 Pro Max viewport (440×763) and **311/270 px** at 320×568. On the base commit the focused field ends either under the notices or below the keyboard. `tests/keyboard-reveal.browser.cjs` fails on `ee42092` with *"Today: Minutes walked stays above the 330px keyboard viewport"*.
- **Fix (CSS only):** On touch devices (`hover:none` and `pointer:coarse`), while a keyboard field in `#main` is focused, **or a visible entry is unsaved** (a `[data-dirty]` form outside any collapsed section, so its Save/Cancel row is showing):
  - the notice region scrolls with the page instead of staying pinned;
  - focus scrolling reserves only the top bar's height.

  *Revised after review (CX22-01):* the first version keyed only on field focus, so a Save/Cancel tap moved focus away, pinned the notices over the button and swallowed the tap. Unsaved state, rather than button focus, now carries the notices through the tap. That matters because Safari does not focus a tapped button; it only blurs the field. See [the reconciliation](review-reconciliation.md).

  A sticky element already holds its normal-flow space, so the page content does not move when editing starts or ends. The new test checks there is no shift. Date, time and file inputs open pickers rather than the keyboard, so they keep the notices pinned, as does every desktop browser. Notices stay in the page and in their live region; the top bar's sync status stays pinned. Save, draft, outbox and sync code is untouched.
- **Residual (first tap):** If a field is focused but nothing has been typed, and the user taps an unrelated control in the band the notices will cover, the notices pin during the tap. In Chromium, with and without a Safari focus model, that tap is swallowed: nothing activates, including any notice button, and nothing is written. A second tap works. Before this PR those controls were hidden under the notices.
- **Residual (failed save, CC-K2 · P3 · accepted):** If saving locally fails while the entry is open, the *Could not save locally* alert sits with the other notices at the top of the page, outside the keyboard viewport. The failure is not silent:
  - the pinned status line reads *Not saved*;
  - the alert keeps `role="alert"`, so it is announced;
  - the entry and its value stay open, with Save focused and visible for a retry;
  - nothing is queued.

  Pinning alert-level notices instead would cover the field and Save again. A field-level message would need a script change in the save path, which this CSS-only change avoids. Tested in `keyboard-reveal.browser.cjs`.
- **Residual (space):** At 320 px, a field with long help text (Active minutes) cannot fit its field, help and Save row in about 215 px. The typed field stays visible and Save is one scroll below (Return also saves numeric fields). The test records this case rather than counting it as a pass. When editing, a new notice (for example a local save failure) appears at the top of the page rather than pinned. It is still announced, and the pinned status reads *Not saved*.
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

No performance code was changed: the only measured bottleneck needs a design that can't be verified here. Measurements are on unthrottled local hardware with a synthetic SDK, and the raw output is in `evidence/`.

**Daily interactions are frame-bound at all history sizes.** `interaction-probe.cjs` times each action from dispatch to the next frame on the iPhone viewport:

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
- **Verified:** `offline-launch.browser.cjs` (6) and `offline-friction.browser.cjs` (24) pass on the final tree. They cover worker install, offline shell reload, outbox survival across reopening, replay without duplicates, draft retention and an incomplete release being rejected.
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

- `tests/keyboard-reveal.browser.cjs`: 41 scenarios. These are 24 Save/Cancel activations (touch, mouse, Tab+Enter and a Safari focus model, × Save/Cancel, × three phone geometries), 12 visibility cases, 3 collapsed-section cases, 1 failed-local-save case and 1 desktop case. It fails on base `ee42092`, on the first PR head `d0aa02f` (first touch Save) and on `3bb4c65` (first Safari-model Save).
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

Final tree results:

- **220/220 Node tests.**
- **177/177 browser scenarios:** 124 existing + 41 + 12 (after the review follow-ups).
- **240/240 layout combinations.**
- **19/19 conditional-state configurations** with no problems.
- **No page errors and no external requests** in any browser suite.
- Both new suites were also run against `ee42092` (`APP_HTML=<base index.html>`) and fail there, as intended. The keyboard suite also fails against the earlier PR heads `d0aa02f` and `3bb4c65`, as described above.

## Firebase and protected-data diff audit

`audit-boundaries.cjs` compares the working tree with `ee42092` and passes. A deliberate one-line change to the Firestore cache options was rejected by it, then restored. It checks that:

- `index.html` changes only inside its `<style>` block and in `data-version` / `APP_VERSION`;
- the markup and all scripts after `</style>` are identical, including every Firebase import, the configuration, initialisation, Auth, listeners, transactions, outbox, drafts, saving, calculations and import/export;
- `sw.js` changes only `VERSION`;
- `manifest.webmanifest`, `icon-180.png` and `.gitattributes` are byte-identical.

No dependency, SDK version, configuration, rules, cloud resource, database structure, local storage format or save/sync/outbox semantics changed. No data was reset, migrated or reinterpreted.

**Remaining risk:**

- The P1 data-integrity defects above remain and prevent a data-safety or production-readiness claim.
- The fixes are verified in Chromium emulation only.
- CC-K1 rests on iOS keeping sticky elements pinned to the top of the visual viewport while the keyboard is open, and the Safari focus model is emulated. Both need confirming on an iPhone, including a single Save/Cancel tap with two notices showing.

Under `docs/review-handoff.md` §6, Codex, Claude Code and Antigravity must each review this change independently before merge. This report is the authoring session's review, not an independent one.
