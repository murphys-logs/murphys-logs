# Prompt for Codex: verify and fix what's left on PR #15 (data safety, R1–R4)

You are **Codex**, working on `murphys-logs/murphys-logs`, [PR #15](https://github.com/murphys-logs/murphys-logs/pull/15), branch `claude/funny-newton-wtxh2x`. In your re-review of `d467da7` you raised **R1–R7**. Commit `84076c7` addresses them; see the "Round two" table in `docs/reviews/2026-11-05/review-reconciliation.md`.

**Your scope is R1–R4 only:** draft ownership, outbox shape validation, the quarantine set-aside, and recovery or backup coverage. Antigravity is separately covering R5–R7 and the device checklist, and works only outside the code below. Don't edit their areas.

## Do

1. Check out the PR head and record the SHA. Reproduce your original R1–R4 cases against `84076c7`; they should now fail. Then try to break the fixes:
   - **R1** (`holdDraftLock`, `autoRestoreDraft`, and the `draftKey()` lock claim): live window B with its own session lock; legacy `murphy-draft:` keys; duplicate tabs sharing a sessionStorage session; the candidate changing during the lock wait; account switch during the wait; Web Locks unsupported or rejecting. **Required outcome:** a live window's draft is never moved; otherwise the prompt is the fallback; explicit Save is always kept.
   - **R2** (`validQueuedOp` and helpers): every operation shape the app writes must still pass, including legacy and guarded prefixes, `{move,items}`, imports with `restore`, `erase`, regime add/drop and both Undo kinds. Any shape that can throw in `applyOperation` or `sendOperation` must be rejected. Semantic conflicts (AG-05) must **not** be swallowed.
   - **R3/R4** (`setAsideUnreadable`, `setAsideOutbox`, `exportOutboxRecovery`, `exportAll`): collisions, repeated set-aside, a quota failure mid-loop, a source changed between read and copy, re-import of a Full backup containing `setAsideOutbox` (it must validate and not replay).
2. If you find a defect, **fix it** in `index.html`, keeping the change minimal. Add or extend a scenario in `tests/offline-friction.browser.cjs`, or a Node test, that fails before your fix and passes after.
3. Constraints: **no change to the Firebase integration.** That covers SDK imports and versions, config, initialisation, Auth calls, collections, schemas, `onSnapshot` registrations, `runTransaction` and `setDoc` calls, and the transaction-callback helpers `stoolMerge`, `operationData`, `stoolMovePatches`, `stoolRecoveryPatch`, `mergeData` and `pathValue`. Keep the release at 3.10.0. Don't touch the R5–R7 code (`scheduleUndoExpiry`, `noteServerConfirmed`, the `syncSectionBody` wording) or the docs, apart from adding one row per fix to the reconciliation.
4. Run everything before pushing: `node --test --test-isolation=none tests/*.test.cjs` (180+) and all six `tests/*.browser.cjs` (82+ scenarios).
5. Commit with a clear message, `git pull --rebase origin claude/funny-newton-wtxh2x`, rerun the tests if the rebase brought in changes, then `git push origin claude/funny-newton-wtxh2x`. Never force-push.

## Report

Post one PR comment, marked as written by an AI reviewer and with no @-mentions. Give the head SHA before and after, your environment, each R1–R4 verdict (**Verified fixed**, or **Fixed in `<sha>`** with what and why), the commands with counts, and whether you consider R1–R4 closed. Don't approve, merge or close. Sign it **"Codex R1–R4 verification"**.
