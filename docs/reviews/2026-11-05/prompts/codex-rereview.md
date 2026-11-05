# Prompt for Codex: independent re-review of the 3.10.0 fixes (PR #15)

You are **Codex**, acting as an independent re-reviewer for the `murphys-logs/murphys-logs` repository. You previously reviewed PR #15 at `3d26a11` ([your review](https://github.com/murphys-logs/murphys-logs/pull/15#pullrequestreview-5777910770)).

In particular, verify that the implementation honours your earlier corrections:
- **CX-01**: "Synced" must need real evidence (an acknowledgement, or server-backed snapshots on all three listeners), not an empty outbox. Check the 10 updated CC3-02 assertions in `tests/restore-sync.test.cjs` that now expect "Cached; checking sync".
- **CR-04**: withdrawn, as you disputed. Check that the probe annotation and the review text are accurate.
- **CR-06**: the guard must run **before** `leaveDraft()`.
- **CR-07**: explicit Save is kept. Is the Web Lock (not BroadcastChannel) a sound basis for "no other window owns this draft", including a suspended window on iOS?
- **CR-08**: are all replacement sites guarded (whole editor at the old L2278–2282, the supplement switches, the leaf)?
- **CR-09**: your recovery constraints. Are original keys, account, raw payload and order preserved? Is the copy verified before removal? Do successors stay held, and does Full backup now include the readable days plus `unreadableOutbox`? Is invalid-shape JSON (`null`) handled?
- **CR-05**: is the "changes" wording accurate for operations, and is "last confirmed" based only on real evidence?
- **CR-11**: confirm that no dual-store union was introduced.
- **CR-10**: confirm that no status-bar change was made.

## What changed since you reviewed `3d26a11`

PR [#15](https://github.com/murphys-logs/murphys-logs/pull/15) (`murphys-logs/murphys-logs`, branch `claude/funny-newton-wtxh2x`) is no longer findings-only. Commit `322eec4` implements the fixes as **app 3.10.0**, and later commits on the branch change only these prompts. Read these first:

- `docs/reviews/2026-11-05/review-reconciliation.md`: how every point from both reviews was handled, the test changes, and validation.
- `docs/reviews/2026-11-05/claude-review.md`: the original findings, now with **Correction** notes.
- The diff `git diff 3d26a11..HEAD -- index.html sw.js tests/`.

The owner's constraints are unchanged:
1. Once the app is opened from the Home Screen and the user is signed in, every observation must be stored safely until signal returns.
2. Reduce friction and improve the UI on iPhone.
3. **No change to the Firebase integration.** That covers SDK imports and versions, configuration, initialisation, Auth calls, Firestore collections, schemas, `onSnapshot` registrations, transactions and setDoc calls, and any helper that runs inside a transaction callback.

## Your task

This is an independent re-review of **Claude's implementation**. Don't take the reconciliation document's claims on trust. Don't read the other reviewer's re-review comment until yours is posted.

1. Check out the PR head and record its exact SHA. Run, and report exact commands and pass/fail counts:
   - `node --test tests/import-backup.test.cjs tests/restore-sync.test.cjs tests/sw-assets.test.cjs tests/ui-ergonomics.test.cjs` (expect **180**). Add `--test-isolation=none` (Node 24) or `--experimental-test-isolation=none` (Node 22) if child processes are restricted.
   - all six `tests/*.browser.cjs`, including the new `tests/offline-friction.browser.cjs` (expect **78** scenarios).
   - `git show 5590437:index.html > <tmp>/murphy-3.9.2.html`, then `APP_HTML=<tmp>/murphy-3.9.2.html node docs/reviews/2026-11-05/reproduce-friction.cjs` (expect 9/9 on the baseline). Then run it again without `APP_HTML` (expected to fail at CR-01, because that behaviour is fixed).
2. **Verify the Firebase boundary** by reading the diff, not the claim. Confirm no Firebase-touching line changed. Confirm that the new status logic only reads `snap.metadata.fromCache`, and that nothing new runs inside a transaction callback.
3. **Check data safety in the new code.** Can any change drop, reorder, duplicate or prematurely acknowledge queued work? Can it hide saved records or claim "Synced" or "saved" without evidence? Pay particular attention to:
   - `queuedWrites` / `sendable` / `outboxBlockedAt` (does the hold apply across legacy, guarded and v2 prefixes and mixed key formats?)
   - `setAsideUnreadable` (copy, verify, then remove)
   - `exportOutboxRecovery`
   - the `flushWrites` final status and back-off (`retryFailures` / `retryAfter`)
   - `received()` freshness (`listenerFromCache`, `serverFresh`, `noteServerConfirmed`)
   - `restoreRecoveredDraft` with the `murphy-window` Web Lock
   - `sameMarkup()` in `refreshMealPlans`
4. **Check iPhone UX and accessibility** of the new UI:
   - the 44 px status chip with `#state` (`role="status"`) inside a button, the `#sync-count` label and the Settings › Sync & storage section
   - the gate's "Opening…" state and its failure and fallback paths
   - the "typed, not saved" chips
   - the Undo move to Settings after 15 minutes
   - the sign-out confirmation wording and its order relative to the draft-discard prompt
   - the stool time/date errors

   Say what still needs a physical iPhone.
5. For each implemented item (CR-01, CR-02, CR-03, CR-05, CR-06, CR-07, CR-08, CR-09, CX-01, AG-12, AG-13, AG-14, FR-04), give a verdict: **Fixed**, **Fixed with issues** (list them), **Not fixed**, or **Regression**. Also assess the deferrals (CR-04 withdrawn, CR-10, CR-11) and the **owner policy question** in CR-02 (window-based Today banner versus per-item acknowledgement).
6. Check that every change to an existing test reflects intended behaviour and doesn't weaken coverage. The list is in the reconciliation's "Test changes" section.
7. **Don't change code, tests or docs, and don't push.** Review only.

## Leaving your review

Post on PR #15 as GitHub comments:
- One top-level PR review submitted as **Comment**. Start it with your reviewer name, the exact head SHA, your environment (OS, Node, Playwright and browser versions), and every command with its counts. Then give a verdict table, any new findings (numbered, each with file and line, evidence, priority and a Firebase-safe direction), and an overall recommendation on whether 3.10.0 is ready for a physical-iPhone acceptance pass.
- Inline comments on specific changed lines where a fix is needed.
- Don't approve, request changes, merge or close. Mark the comments as written by an AI reviewer, and don't @-mention anyone.

Sign your top-level comment **"Codex independent re-review"**.
