# Codex review and follow-up for PR #22

Reviewed `d0aa02f17d013607e4dceb2b2437f384fdc6a785` against `ee42092658259605f56ef3cc9281418bb43b69f5`. This report describes the subsequent fixes in the commit containing this file. The application release remains the unreleased **3.12.4**.

**Status: ready for re-review, not merge.** One reproducible interaction defect and one regression-coverage gap were fixed. The updated changes still require the independent reviews and physical iPhone check listed below.

## CX22-01 · P2 · Notices cover Save/Cancel before activation completes

- **Where on reviewed head:** `index.html:459–461`; `tests/keyboard-reveal.browser.cjs` did not activate either confirmation button.
- **Reproduction:** With Sync pending and Undo notices visible on a coarse-pointer phone, type into a walk-minutes field. The notices scroll away while the input has focus. Tap the visible Save button once. Focus transfers to the button, the CSS exemption stops applying, and the notices become sticky over the same tap coordinates before click dispatch. The draft stays open and no write is queued. Cancel has the same transition. Tabbing to the buttons can instead scroll them below the simulated keyboard viewport.
- **Measured evidence:** At 393×659 with a 330px visual viewport, Save occupied y=270–318 and the repinned notices covered y=55–352. At 320×568 with a 270px visual viewport, Save occupied y=150–198 and the notices covered y=55–311. Raw touch and mouse activation reproduced the missed save; no Playwright locator retry was involved.
- **Implemented:** Extend the existing three CSS predicates to include focused `[data-confirm] button` elements. The notices stay in normal flow through Save/Cancel activation. The coarse-pointer guard, picker exclusions, and all application scripts are unchanged.
- **Regression coverage:** Add 18 scenarios: three phone geometries × touch/mouse/Tab-and-Enter × Save/Cancel. Each checks the action is visible and hit-testable, activates it once, requires the confirm row to disappear, and asserts one queued Save or no Cancel write. Leaving the completed entry restores sticky positioning without shifting the field. Together with the original cases, the keyboard suite has **31 scenarios**.
- **Counterfactual:** The updated suite fails against the original `d0aa02f` HTML at the first touch Save because the confirm row remains. It passes with the CSS extension.

## CX22-02 · P3 · The forced-colors test skipped every gauge fill

- **Where on reviewed head:** `tests/forced-colours.browser.cjs:66` skipped the fill whenever its width was zero; the fixture always had zero cumulative adjustment.
- **Implemented:** Retain an explicit zero-state check and render real +20g and −20g changes in each of the four appearance configurations. Assert nonzero geometry, midpoint/direction, visible nontransparent paint, and the exact system `Highlight` color in forced colors or the normal accent otherwise. Existing status-mark and normal-theme token checks remain.
- **Platform detail:** Windows system `Highlight` legitimately computes with alpha 0.8 here. The test rejects fully transparent paint without requiring system colors to be opaque.
- **Regression coverage:** The suite now has **12 scenarios**. Removing only the `.gauge .fill` forced-colors rule from a temporary HTML copy makes the nonzero-fill assertion fail: white fill on white background. The unchanged production rule passes.

## Validation

Environment: **Windows 10 Home 22H2 x64, build 19045.7807; Node v20.18.0; Microsoft Edge 157.0.4341.42 (Chromium/Blink)**. All browser runs use synthetic Firebase fixtures and blocked external app requests.

| Check | Result |
|---|---:|
| Full Node suite, direct imports of all six `.test.cjs` files | 220/220 |
| draft-input | 22/22 |
| history-review | 6/6 |
| navigation-drafts | 26/26 |
| offline-friction | 24/24 |
| offline-launch | 6/6 |
| review-focus | 16/16 |
| settings-exports | 5/5 |
| today-layout | 11/11 |
| weigh-in | 8/8 |
| keyboard-reveal | 31/31 |
| forced-colours | 12/12 |
| **All 11 browser suites** | **167/167** |
| Existing layout matrix | 240/240 |

Browser suites report no page errors or external app requests. `git diff --check` and `docs/reviews/2026-11-06-claude/audit-boundaries.cjs` pass. Both counterfactual failures described above are expected defect-detection evidence, not product passes.

The runtime delta from the PR base remains confined to CSS and aligned release identifiers. The audit verifies that all markup/scripts after `</style>` are unchanged after release normalization: Firebase SDK 12.19.0, configuration, initialization, Auth, listeners, transactions, outbox, draft persistence, calculations, and import/export. The service worker differs only in its release identifier. Manual changed-file inspection also confirms no added runtime dependency or configuration. Personal-weight persistence and all existing data behavior remain unchanged.

The author's benchmark and conditional-state evidence remains historical evidence from the original PR head; it was not rerun as part of this follow-up. Chromium visual-viewport simulation does not establish Safari, native keyboard, Home Screen, VoiceOver, or real Firebase behavior.

## Remaining review gate

[`docs/review-handoff.md` §6](../../review-handoff.md) requires independent reviews from **Codex, Claude Code and Antigravity** on the current changes and relevant re-review after changes. This session independently reviewed the original PR and then implemented the follow-up; it does not stand in for the other named reviewers. Internal Codex cross-checks found no further blocker.

- Obtain relevant independent re-review of the updated commit, including Claude Code and Antigravity.
- Complete the PR's physical iPhone check in Safari and the Home Screen app: two notices, keyboard open, typing followed by one Save/Cancel tap.
- Retain the documented pre-existing data-integrity risks and remaining device/assistive-technology limitations.

Keep the PR review gate pending. Nothing was merged or deployed.

**Codex review and implementation**
