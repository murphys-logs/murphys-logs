# PR #5: state, input and execution audit

Reviewer: Codex. Baseline: `6ebf856`. Integrated code tested at `fc03e63`; subsequent documentation cleanup does not change executable code.

## Implemented behavior

- **Durable drafts:** account/tab-owned localStorage records preserve notes, numbers, explicit feeding times and complete stool edits. Input writes debounce at 250 ms; hidden/pagehide capture immediately. Same-session recovery is automatic; a fresh session offers restoration. Original dates survive midnight. Recovery never auto-submits or autofocuses native inputs. Save/Cancel removes completed input. Storage failures leave input open with an explanation.
- **Input confirmation:** numeric Enter and explicit Save share existing validation/save functions and an in-flight guard. Notes retain newlines and IME input is respected. Incomplete numbers and invalid steps stay inline; unusual-weight confirmation remains intact.
- **Calendar work:** minute-cached London time and minute polling plus focus/foreground refresh replace repeated formatting and one-second polling. The 1,000-read same-minute probe incurred zero additional Intl formatting calls.
- **Logging integration:** Claude's Today card, tapped-type quick stool entry, inline Edit/Delete, bowl prompt and History picker retain durable drafts and explicit confirmation. Shortcuts capture each card's date before discard cleanup, preserving in-place focus and the bowl History destination after midnight. No stool type or meal consumption is guessed automatically.
- **Completed-month exports:** last-month CSV and Markdown actions retain this-month defaults and existing columns. Month/year rollovers and leap years are covered.
- **Worker integration:** responses are cloned before consumption, cache writes retained with event.waitUntil, and lookups use the scoped release cache. Core shell/SDK readiness is unchanged; icon/manifest downloads are optional install metadata.
- **Rendering integration:** retained measured safe-area sizing, landscape behavior, field sizing, touch feedback and visualViewport keyboard handling. Removed duplicate insets, portrait lock, permanent compositing hints and the legacy scroll hint. Retained Claude's forced-colors opacity correction.

No runtime dependency or build step added. HTML/worker identifiers match at **3.6.0**. Home Screen metadata and explicit destructive confirmations remain intact.

## Verification

- **143/143 Node tests**, including the original 62 calculation checks, worker tests, UI ergonomics and completed-month exports.
- **14/14 browser scenarios**, repeated **14/14** against uppercase SCRIPT-tag HTML. Covers recovery, dates, account/tab isolation, keyboard validation, quick-entry focus, History commit/bounds/discard handling, storage failures and clock behavior. Synthetic SDK modules, held sync locks, zero external requests/page errors.
- Compared SDK imports, Firebase config/init, complete store/outbox/subscription block, auth callback, erase handler and every Firebase API call line against baseline: unchanged. No production Firebase access.
- CodeQL's tag-filter finding is addressed using Claude's case-insensitive bootstrap guard and case-insensitive module instrumentation. Current-head CI is recorded on the PR rather than assumed from an earlier commit.

## Review provenance and merge status

- **Claude Code:** independent re-review and implementation/testing through `aeeb0f4`. Approves the code conditional on an iPhone smoke test; [review](https://github.com/murphys-logs/murphys-logs/pull/5#issuecomment-6563797043).
- **Antigravity:** independent re-review and positive merge recommendation at `dd83366`; [review](https://github.com/murphys-logs/murphys-logs/pull/5#issuecomment-6563773580).
- **Codex:** integrated peer corrections, retained Claude's explicit date contract/bootstrap guard, added completed-month exports and expanded tests. No remaining blocking code defect found in this pass; [re-review](https://github.com/murphys-logs/murphys-logs/pull/5#issuecomment-6563804020).

**Recommendation: not yet ready for merge approval.** Relevant independent re-review of the final code changes, especially completed-month exports, remains pending. `docs/review-handoff.md` requires all three actual reviewers on current changes. Keep the final-review checklist pending until these deltas are covered.

Native iPhone keyboard reveal, standalone date picker, Dynamic Type, termination/reopening, and installed-client update/offline behavior remain unverified. Use a preview with synthetic data for device checks. Chromium emulation does not establish these results, guaranteed zero data loss or a universal sub-16ms frame budget.

Deferred follow-ups: keeping multiple views' drafts across navigation, mobile Data rows and larger Chromium-specific icons. This PR retains explicit draft-discard confirmation and the iPhone icon scope.
