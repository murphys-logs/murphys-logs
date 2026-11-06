# PR #22 review reconciliation (round 1)

**Reviews received:**

| Reviewer | Reviewed | Result |
|---|---|---|
| [Antigravity](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808369935) | `d0aa02f` | No findings |
| [Codex](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808411982) | `d0aa02f` | Two findings; fixes pushed as `3bb4c65` ([report](codex-follow-up.md)) |

Base is unchanged at `ee42092658259605f56ef3cc9281418bb43b69f5`. This document records the author's (Claude Code) dispositions and the follow-up commit. It does not count any earlier review as approval of the new head. No merge or deployment is authorised.

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
  - **Scope:** desktop browsers and picker inputs are unchanged.
- **Tests:** 24 activation cases (touch, mouse, Tab+Enter, Safari-model touch; × Save/Cancel; × 393×659/330, 440×763/400 and 320×568/270). They now run first, so failures on older heads are the user-visible tap failures. Three cases cover collapsed sections.
- **Revised assertion:** "pinned again on blur" became "still unpinned while unsaved; pinned again after Cancel". The no-shift check now covers only the repin step. Cancelling already updates *Still to log* above the field: its *typed, not saved* chip goes. That existing behaviour moves the field by about 23 px at 393 px, independently of the notices.
- **Residual (P3, device check):** a focused field with nothing typed, followed by a tap on an unrelated control in the band the notices will cover. The tap is swallowed in Chromium with and without the Safari model: the click lands on a shared container, so no action fires, no notice button activates and nothing is written. Before this PR those controls were under the notices and not visible.

### CX22-02 · P3 · Forced-colours test skipped every gauge fill

**Accepted; verified.**

The fixture always had a zero adjustment, so the fill was always skipped. Codex added real +20 g and −20 g adjustments in all four appearance configurations (12 scenarios). Independently checked: removing only the `.gauge .fill` forced-colours rule from a copy of the current HTML fails with `rgb(255,255,255) on rgb(255,255,255)`.

### Antigravity review

**No findings; claims qualified.**

- The review covered `d0aa02f` only. It predates both follow-ups and does not cover CX22-01.
- *"Multi-Year History Benchmark 3/3 runs passed"* refers to `interaction-probe.cjs`, which records timings and has no pass/fail assertions. It is evidence, not a passing test.
- *"Recommend merge"* does not override `docs/review-handoff.md` §6: all three named reviewers must review the current changes, and the physical-device check is still open.
- Agreed: no Firebase or data-boundary change; personal readings stay transient.

## Validation of this follow-up

Linux, Node 22.23.4, Playwright Chromium 153.0.8010.12, synthetic data:

- **220/220 Node tests.**
- **176/176 browser scenarios:** 124 existing + 40 keyboard + 12 forced-colours.
- **240/240 layout combinations.**
- **19/19 conditional-state configurations.**
- **Boundary audit passes;** `git diff --check` is clean.
- **Counterfactuals:** the keyboard suite fails on `ee42092`, `d0aa02f` and `3bb4c65`; the forced-colours suite fails without the gauge-fill rule.
- **Not rerun:** `history-benchmark.cjs` and `interaction-probe.cjs`. The runtime delta is a CSS selector; their earlier outputs remain historical evidence for `d0aa02f`.

The runtime delta from base remains CSS inside `<style>` plus the aligned 3.12.4 release IDs. Firebase SDK/configuration/Auth/listeners/transactions, outbox, drafts, saving, calculations, import/export, storage formats and personal-weight handling are unchanged.

## Remaining gate

- **Independent re-review** of the current head by Codex, Claude Code and Antigravity ([prompts](prompts/)). The Claude Code reviewer must be a separate session from the author's.
- **Physical iPhone check in Safari and the Home Screen app:**
  - two notices showing, keyboard open;
  - type, then a single tap on Save, and separately on Cancel;
  - confirm the notices stay out of the way and then pin again without the page jumping.
- **Pre-existing documented P1 data-integrity risks remain.**
