# Prompt for Antigravity: verify and fix what's left on PR #15 (R5–R7, Windows run, device checklist)

You are **Antigravity**, working on `murphys-logs/murphys-logs`, [PR #15](https://github.com/murphys-logs/murphys-logs/pull/15), branch `claude/funny-newton-wtxh2x`. Your re-review of `d467da7` judged 3.10.0 ready for iPhone acceptance. Codex's re-review then found **R1–R7**, which your review did not catch. Commit `84076c7` addresses them; see the "Round two" table in `docs/reviews/2026-11-05/review-reconciliation.md`.

**Your scope:** R5–R7, a clean Windows run of every suite, and the new `docs/reviews/2026-11-05/device-acceptance.md`. Codex is separately covering R1–R4 (draft ownership and the outbox quarantine). Don't edit `holdDraftLock`, `autoRestoreDraft`, `validQueuedOp`, `setAsideUnreadable`, `setAsideOutbox` or `exportOutboxRecovery`.

## Do

1. Check out the PR head and record the SHA. On **Windows** Chromium, run `node --test tests/*.test.cjs` (180+) and all six `tests/*.browser.cjs` (82+). Report any platform-specific failure, and fix it if the cause is a test harness problem.
2. Try to break the fixes:
   - **R5** (`scheduleUndoExpiry`, and `onResumeOrReconnect` redrawing): expiry while idle, while backgrounded, across midnight, after Undo or Dismiss, and a new removal replacing the old one. No stale timer may hide a newer Undo early.
   - **R6** (`noteServerConfirmed(uid)`, the reset in `subscribe()`, `loadDeviceState`): account A to B to A on the same page; a flush for A finishing after the switch to B.
   - **R7** (`syncSectionBody`): held, set-aside, mixed and normal states. The wording must be accurate, readable at 375×667 and 200% text, and never promise automatic sync for held work.
3. If you find a defect, **fix it** with a minimal change. Add a scenario to `tests/offline-friction.browser.cjs` that fails before your fix and passes after.
4. Review `device-acceptance.md` against the code. Correct any step whose expected result doesn't match 3.10.0's actual wording or behaviour, and add any missing check that matters for one owner on one iPhone in poor signal. Keep it concise.
5. Constraints: **no change to the Firebase integration.** That covers SDK imports and versions, config, initialisation, Auth calls, collections, schemas, listeners, transactions and their callback helpers. Keep 3.10.0.
6. Run everything, commit, `git pull --rebase origin claude/funny-newton-wtxh2x`, rerun the tests if the rebase brought in changes, then `git push origin claude/funny-newton-wtxh2x`. Never force-push.

## Report

Post one PR comment, marked as written by an AI reviewer and with no @-mentions. Give the head SHA before and after, your Windows environment, the commands with counts, R5–R7 verdicts (**Verified fixed**, or **Fixed in `<sha>`**), the checklist changes, and your readiness statement for the owner's iPhone acceptance pass. Don't approve, merge or close. Sign it **"Antigravity R5–R7 verification"**.
