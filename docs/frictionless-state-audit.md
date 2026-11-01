# PR #5: state, input and execution audit

Reviewer: Codex. Baseline: `6ebf856`. Scope: local state, input events and execution; no Firebase changes.

## Findings and implementation plan

1. **P1 — Drafts live only in the DOM and module memory.** iOS may terminate a backgrounded Home Screen app. Persist unfinished numeric/text fields, explicit feeding times and complete stool drafts in an account-scoped, tab-owned localStorage record. Restore their original dates and view after authenticated cached records load. Flush on `visibilitychange` and `pagehide`, debounce ordinary input, and clear saved drafts after confirmation or cancellation. Never place drafts in the write outbox or auto-submit recovered observations.
2. **P2 — Numeric inputs require an extra Save tap.** Add `enterkeyhint="done"` and a delegated Enter handler that uses the existing validation and save functions. Preserve multiline notes and IME composition. Guard repeated submissions until local confirmation completes; retain explicit Save buttons.
3. **P2 — A native number input's incomplete value can look blank.** Keep bad input in the editor and validate with inline feedback before any existing save call. Preserve explicit blank-to-clear behavior.
4. **P2 — Local calendar work repeats on every derived-cache lookup.** Cache the London clock within the current minute; replace one-second midnight polling with a minute check plus the existing focus/foreground refresh. Keep the date-keyed derived cache and preserve drafts over midnight.

## Collaboration boundaries

- Claude: preserve `data-form`, `data-feeding`, `data-stool`, stable input IDs, rendered `data-date` values and explicit stool confirmation while changing layouts. No automatic Bristol selection or automatic meal consumption.
- Antigravity: preserve connected native inputs while pickers/drafts are active, persistent feedback regions and Home Screen metadata. Coordinate matching `APP_VERSION`/worker release identifiers.
- Existing optimistic `write()` already persists locally before rendering and sending. Keep its queue, Firebase calls, configuration, paths, subscriptions and payload contracts unchanged. Do not add speculative Firebase reads or runtime dependencies.

## Validation and review status

Implemented: per-tab durable draft records, 250 ms input debounce plus immediate hidden/pagehide capture, numeric Enter confirmation with an in-flight guard, inline number errors, minute-cached London time and minute-level midnight polling. Same-session drafts restore automatically; a fresh session offers recovery before taking over another tab's saved copy. Recovered Today entries retain their original date, including yesterday's activity and explicit feeding times; settings survive date changes. Confirmation/cancellation removes the corresponding durable input. Native inputs are never automatically focused during recovery.

Validation: all **115** existing Node import/restore/Undo tests pass (including 62 calculation checks), plus **7** new worker asset regressions (**122 total**). `tests/draft-input.browser.cjs` adds **11** real-DOM browser scenarios with synthetic SDK modules, held sync locks and all external requests blocked: reload/background/cold-session recovery; midnight and settings dates; account/tab isolation; Enter deduplication, multiline notes, IME and incomplete-number validation; successful stool cleanup; unavailable/corrupt storage; minute caching and clock rollback. Zero page errors and zero external requests. The 1,000 same-minute clock reads performed zero additional Intl formatting calls.

Compared the SDK imports, Firebase configuration/initialization, complete store/outbox/subscription block, auth block and destructive backend calls with baseline: unchanged. No runtime dependency or build step added. App/worker release identifiers are aligned at **3.6.0**.

- [x] Codex implementation and validation completed
- [ ] Independent Claude Code review of final changes
- [ ] Independent Antigravity review of final changes

Physical iPhone lifecycle behavior and a universal sub-16ms frame budget require device measurement; do not infer either from Node tests.

## Cross-agent integration

Merged Antigravity's `24c5d63` without conflicts. Reproduced and fixed an asset-cache race: cloning a response after the browser consumes it silently prevented caching. Asset loading now clones before returning, retains the cache write through `event.waitUntil`, and reads only the current scoped release cache. Seven Node worker regressions cover consumption/lifetime, offline cached assets, unavailable storage, missing assets, and unchanged Firebase/non-GET routing. Removed duplicate safe-area additions because the existing measured `--tabh` already includes the inset; kept Antigravity's chosen content gap.

The core shell/SDK readiness check retains its original contract; icons and manifest are optional cached install metadata, and their download failure does not prevent opening saved logs. Permanent compositing hints and native keyboard/frame-time claims still require independent device review. Independent final reviews remain pending; the draft PR is not a merge recommendation. No Claude proposal was present at the time of this integration check.

## Re-review after Claude's integration

Reviewed Claude's implementation and cross-review at `46cbb95` against the combined branch. Applied these suggestions:

- Removed the manifest's portrait lock to retain landscape behavior; declared the existing 180 px icon as `any`, without claiming maskable artwork. Larger Chromium-specific icons remain follow-up work for this iPhone-focused app.
- Removed permanent `translateZ`/`will-change` promotion and the legacy scrolling hint. Kept native input sizing, touch feedback, measured safe-area sizing and `visualViewport` keyboard handling. No claim of verified iPhone frame timing or keyboard behavior.
- Fixed CodeQL's uppercase-SCRIPT finding in the local browser fixture, including case-insensitive bootstrap replacement and module instrumentation. Ran the real browser scenarios against both normal and uppercase-tag HTML.
- Addressed Claude's D-1 / BUG-01 with explicit **last month** CSV and Markdown actions. This-month defaults, exported columns, historical data and Firebase access stay unchanged. Added month/year rollover, leap-year and export-content coverage.
- Found and fixed a midnight integration regression: recovered Today's shortcuts used the current day, and a bowl shortcut could lose its original day when `leaveDraft()` cleared recovery state. Capture the displayed date before cleanup. Covered both in-place focus and the History destination in the real DOM.

Validation: **142/142 Node tests** and **14/14 browser scenarios**, repeated successfully with uppercase SCRIPT tags; zero page errors and external requests. Recompared Firebase imports, configuration/initialization, complete store/outbox/subscription block, auth callback, erase handler and all Firebase API call lines against `6ebf856`: unchanged.

Claude's D-3 (keep drafts while switching tabs), mobile Data rows and other deferred component work remain separate follow-ups. Retaining multiple views' drafts needs a deliberate storage/navigation design; the existing explicit discard confirmation remains intact in this PR.

**Merge recommendation: not yet.** Claude reviewed `aedcd9c` and tested the combined `46cbb95` tree, but the subsequent corrections still need relevant independent re-review, and Antigravity has not reviewed the final integrated tree. The repository's `docs/review-handoff.md` requires all three actual reviewers on current changes. Keep both final-review checklist entries pending. Native iPhone keyboard reveal, date picker, Dynamic Type and lifecycle checks are still outstanding; Chromium emulation does not establish those results.
