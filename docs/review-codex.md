# Independent AG review

- **PR:** https://github.com/murphys-logs/murphys-logs/pull/1
- **Branch:** `claude/gracious-clarke-w8ubgx`
- **Reviewed commit:** `d437d0471a9067b12f961e206b201970643623fc`
- **Review date:** 28 October 2026
- **Reviewer:** Codex, using the requested Antigravity filename and AG IDs.

## Method and limits

Read `index.html` and `sw.js` independently after reading the handoff and only §§2–4 of `ux-review.md`. Wrote the findings below before reading its existing findings. Inspected the app at 390×844 using a localhost harness with fake auth and Firestore modules, service workers disabled, and a Content Security Policy blocking network connections. All test records were synthetic. No live Firebase sign-in, reads or writes were performed.

Ran the app's calculation self-tests: **62 passed, 0 failed**. Additional Node probes executed extracted source functions with in-memory data/transaction stubs. These validate the code paths described below; they do not substitute for a two-client Firebase emulator test. Service-worker behavior was reviewed statically; offline installation and native iOS behavior were not browser-tested. No application files were changed.

## Independent findings

### AG-01 · P2 · Accessibility · Settings actions lose keyboard focus after rendering
- **Where:** `index.html:1548–1551`, `index.html:2140` (at `d437d047`).
- **Now:** In Settings, activate **Set 5 g today** using Enter. The schedule updates, but the focused button is replaced and focus lands on `BODY`; this was reproduced in the local browser. Rendering restores focus only when the previous control had an ID. Several disclosure summaries also lack IDs and have the same vulnerability when a snapshot changes the rendered HTML.
- **Change:** Give interactive controls stable focus keys/IDs and restore focus after replacement, or retain the focused node. Include disclosure summaries and settings actions.
- **Done when:** Keyboard activation of Set fibre keeps focus on the corresponding button; a changing snapshot while a chart/stool summary is focused preserves that summary's focus and expanded state.

### AG-02 · P2 · Data navigation · All-history dates omit the year
- **Where:** `index.html:1990–1991`, `index.html:2040`, `index.html:2076` (at `d437d047`).
- **Now:** Data → All renders month/day labels and accessible names without years, including imported or accumulated records spanning multiple years. Chart value tables omit years too. For example, the daily rows for 28 October 2025 and 28 October 2026 both display “28 Oct”; a user must open History to identify the year before choosing the correct record.
- **Change:** Include the year in All-view row labels and accessible names, and in chart dates whenever the selected interval spans years.
- **Done when:** Two records with the same month/day in different years are distinguishable in the table and chart values before opening either record.

### AG-03 · P2 · Status · Planned meals count as confirmed consumption
- **Where:** `index.html:1938–1940`, `index.html:2653` (at `d437d047`).
- **Now:** Choose today's recipe and turn Egg on without pressing Fed, then open Status. The local browser showed an egg night and counted today's planned fibre/oil as confirmed. With six earlier fed meals, the display was “Egg / broth nights 1 / 0” and “Fibre / oil confirmed 7 / 7”. Undo Fed also retains a previously selected bowl outcome, which these counters still include.
- **Change:** Gate meal, supplement and bowl counters on `isFedMeal(m)`; keep activity and treats independent.
- **Done when:** A planned meal contributes no consumed-meal counts; Fed adds it; Undo Fed removes it from these counts without deleting the saved plan.

### AG-04 · P1 · Data safety · Offline Undo can duplicate a stool moved by another device
- **Where:** `index.html:1059–1068`; compare `index.html:990–994` and `index.html:1204–1206` (at `d437d047`).
- **Now:** Device A goes offline, deletes stool `s1` from 27 October, then undoes. Device B moves `s1` to 28 October. On reconnect, A's deletion on the old date is a no-op, but its queued Undo checks only 27 October and recreates `s1` there. The source-function probe produced one copy during local replay but two copies after the remote transaction. The global local identity guard is absent from the remote recovery.
- **Change:** Coordinate moves and Undo with an authoritative transactional stool identity/location guard, so an identity already present on another date cannot be recreated. A client-side scan alone still races with another move.
- **Done when:** Run this sequence with two emulator clients, including retry/restart. Exactly one `s1` remains on B's selected date, and Undo reports that the record already exists.

### AG-05 · P1 · Sync · A conflicted stool move blocks every later queued write
- **Where:** `index.html:979–980`, `index.html:1087–1093`, `index.html:1121–1137` (at `d437d047`).
- **Now:** A queues a stool move while offline; B deletes that stool or moves it to a third date. When A reconnects, `stoolMovePatches` throws because the source is gone and the requested destination does not contain the ID. The failed item remains at the front of the outbox. Retry repeats the same permanent conflict; later weight/meal edits cannot sync. A source-function probe left both the failed move and a later weight edit queued. Snapshot replay can also throw on the same move at line 1260.
- **Change:** Preserve the conflicting payload and expose a resolve/discard-or-rebase action for that operation. Once resolved, drain later valid writes and replay snapshots without being blocked by the obsolete move.
- **Done when:** Queue the conflicting move followed by a weight edit. Resolve the conflict in the UI, then confirm the weight reaches the server and the queue empties without manually editing browser storage.

### AG-06 · P1 · Import · Rejected restores can remain visible as Synced
- **Where:** `index.html:1024`, `index.html:1101–1106`, `index.html:1124–1129` (at `d437d047`).
- **Now:** Import an 11:00 backup over an older cached day. Before its restore sends, receive the actual server day updated at 12:00. Optimistic replay overlays the backup without checking freshness. The transaction correctly skips the older backup, but removing the outbox item never rebases the UI. A stub transaction performed zero server writes while the screen retained the imported value and the server retained its newer value. The app can say Synced and export that stale local view until another subscription callback or reload.
- **Change:** Apply restore conflict rules during replay and rebase from the transaction's actual snapshot when a restore is skipped, including skipped settings and change records. The guarded Undo path at lines 1071–1076 already handles this class of no-op.
- **Done when:** Deliver a newer server day during a queued import. After draining, screen and export match the retained server data immediately, and Synced is shown only for that reconciled state.

### AG-07 · P1 · Import · Accepted stools without IDs cannot be corrected or deleted
- **Where:** `index.html:2274–2276`, `index.html:1739–1740`, `index.html:2564–2567`, `index.html:2612` (at `d437d047`).
- **Now:** Import `{"days":{"2026-10-28":{"stools":[{"time":"08:00","bristol":4}]}}}`. Validation accepts the missing ID. The action buttons render `data-id=""`, which cannot match the stored `undefined` ID. Delete silently does nothing; Edit starts a new stool and can add a duplicate instead of correcting the imported entry. The validator/matching behavior was reproduced with the actual functions.
- **Change:** Reject missing/null IDs with an actionable validation error, or assign stable unique IDs to legacy entries once before queuing the import, preserving existing identities.
- **Done when:** A missing-ID backup is rejected before writing, or two such imported records receive distinct stable IDs and can be edited/deleted independently through a backup round trip.

### AG-08 · P1 · Import · Numeric settings bypass the editor's safety limits
- **Where:** `index.html:2295`, `index.html:2316–2318`; compare `index.html:1181–1188` and `index.html:1580–1592` (at `d437d047`).
- **Now:** On an account without a saved `kcalPerGDarf`, import `{"days":{},"settings":{"kcalPerGDarf":0}}`. Validation accepts zero and imports directly through `write()`, bypassing `saveSettings()`. Executing `bowlFor` with that setting produces **Infinity g DARF and NaN kcal**. The ordinary settings editor rejects the same value.
- **Change:** Reuse numeric range/step validation for imported settings, with explicit bounds for hidden calculation settings and explicit rejection of null values where defaults cannot safely be overridden.
- **Done when:** Invalid zero/negative/null/out-of-range calculation settings fail before any import is queued; a normal exported backup still restores and all calculated amounts remain finite.

### AG-09 · P2 · Export · The daily CSV's “worstBristol” hides hard stools
- **Where:** `index.html:2189–2192` (at `d437d047`).
- **Now:** Export a day with Bristol 1 at 08:00 and Bristol 4 at 12:00. The daily CSV reports `worstBristol=4`, despite the app assigning type 1 to the red band and type 4 to green. The reproduced CSV begins `2026-10-28,4,2`. The separate stool-detail CSV retains both entries, but the daily summary misrepresents them.
- **Change:** Export minimum and maximum scores, consistent with the Data table, so both hard and loose extremes survive in the daily summary. Do not call the numerical maximum “worst”.
- **Done when:** Daily CSV rows for [1,4], [2,3] and [1,7] preserve both extremes without presenting a normal score as the worst observation.

### AG-10 · P2 · Status · Future observations trigger current-window alerts
- **Where:** `index.html:851`, `index.html:855–870` (at `d437d047`).
- **Now:** With today fixed to 28 October 2026, accepted imported vomiting observations dated 20 and 21 October 2027 produce “Vomited on two or more days this week”. The source-function probe reproduced this because `within()` checks only the lower date bound. Other rolling-window warnings share it.
- **Change:** Bound rolling-window observations by `todayIso` as well as the oldest included date. Preserve future records for inspection and correction.
- **Done when:** Future imported observations remain inspectable in History but do not trigger present-window warnings; they become eligible only as their dates enter the window.

### AG-11 · P1 · Backup recovery · Undo restores a stool without advancing the day's timestamp
- **Where:** `index.html:994`, `index.html:1068`; freshness checks at `index.html:2312` and `index.html:1102` (at `d437d047`).
- **Now:** Delete a stool, export a backup, then Undo and export again. The restored day retains the deletion's `updatedAt`, because neither the optimistic nor remote recovery updates it. Importing the later backup into a copy of the deleted day skips the restoration: both timestamps are equal. The restored stool is therefore absent after the merge despite being present in the newer backup.
- **Change:** Give an actual recovery a durable operation timestamp and update the day alongside the restored stool. A guarded no-op must leave the existing record and timestamp untouched.
- **Done when:** Compare deletion and post-Undo exports: the restored day has a later timestamp. Import the post-Undo backup into the deleted copy and verify the stool is restored once, including a retry of the same recovery operation.

## Cross-check with ux-review.md

Read §§5–6 only after the independent findings above were written. None of the retained AG findings duplicates an existing finding; overlapping UI observations are recorded only in this table.

| ID | Verdict | Note |
|---|---|---|
| UX-01 | Agree | `viewToday` places the full assessment before logging and the actionable missing-items list last (1571–1573). The local 390×844 view confirms substantial scrolling before the logging flow; the exact height depends on the available readings. |
| UX-02 | Refine | Agree on exposing editing and reducing date-field prominence (1738–1748). Keep an explicit Save after selecting type/flags: saving on the Bristol tap risks committing before mucus/blood or time are entered. The existing `removeWithUndo` path is a deletion mechanism, not an insertion-Undo mechanism. |
| UX-03 | Refine | Confirmed in the local browser: Enter in the weight field leaves its Save button and draft pending. Agree on an Enter handler. The current code has no durable draft store; an unload warning alone should not be treated as draft recovery. Simply backgrounding an app is not itself evidence that a draft has already been discarded. |
| UX-04 | Agree | Yesterday's editor is nested inside the collapsed disclosure at 1750; the missing-bowl shortcut navigates to History at 2514–2516. A direct prompt for a confirmed meal with no outcome would shorten this daily action. |
| UX-05 | Agree | At 1679–1687, the calculation details and four verbose switches precede Fed. Keep recipe, planned grams and Fed together, while retaining clear labels and the existing tap-target sizes. |
| UX-06 | Agree | At 390×844 the Daily records container measured 333 px wide for a 791 px table; Bristol began beyond its visible right edge. Preserve semantic labels and day/meal links when making the mobile layout compact. |
| BUG-01 | Agree | Both exporters select `localToday().slice(0,7)` (2188, 2207), so they cannot directly export the completed previous month on the 1st as the Settings copy suggests. A selectable month fixes the mismatch. The Safari multi-download concern was not tested here. |
| UX-07 | Refine | Distinct target styling and optional point inspection would help. Values are not available only through `title`: 2040/2060 generate expandable value tables, and I opened the condition values in the local browser. Preserve this accessible route; describe the gap as lack of direct point inspection. |
| UX-08 | Agree | Repeated guidance in 1611–1613, 1648 and 1918 adds substantial length. Keep essential units, the previous-day activity date and historical-correction consequences visible when moving secondary explanations into disclosures. |
| UX-10 | Refine | Agree on separating advanced constants and destructive actions. The weight target is explicitly a fixed monitoring target at 597–598; making it user-editable is a product decision, not necessary to fix settings organization. The oil schedule lacks an ordinary UI editor, although missing saved settings can be populated by import (2316–2318). |
| UX-11 | Refine | The Status dot is hidden from accessibility APIs (427) and conveys no reason; an accessible summary would help. Native dialogs, a password-reset flow and a different desktop navigation layout should be evaluated separately rather than treated as one required fix. |
| CODE-01 | Agree | Assessment copy, field help, hints and charts duplicate target values independently of `WEIGHT_TARGET`. Derive the strings from the existing constant even if the target remains fixed. |
| CODE-02 | Refine | The shared top-level collections are confirmed at 1267–1279, but repository code alone cannot establish which accounts the deployed rules authorize. Sharing may be intentional for Murphy's carers. Review rules in a separate authorized task; no live Firebase access was attempted here. |
| CODE-04 | Agree | Separating pure calculations/tests can improve maintainability, but is optional and should preserve offline precaching and synchronized release versions. It is not a prerequisite for fixing these findings. |
