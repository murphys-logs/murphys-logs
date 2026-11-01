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

Planned: existing import/restore/Undo regression suites; synthetic lifecycle, recovery, account isolation, keyboard and interrupted-input checks; exact comparison of protected Firebase functions/configuration; local browser checks if available.

- [ ] Codex implementation and validation completed
- [ ] Independent Claude Code review of final changes
- [ ] Independent Antigravity review of final changes

Physical iPhone lifecycle behavior and a universal sub-16ms frame budget require device measurement; do not infer either from Node tests.
