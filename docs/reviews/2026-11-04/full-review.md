# Full code review: iPhone usability and poor-signal data safety

**Reviewed:** `main` at [`2646239395ddb6369eb6a940fab0a66db2259004`](https://github.com/murphys-logs/murphys-logs/tree/2646239395ddb6369eb6a940fab0a66db2259004), application **3.9.2**, 4 November 2026. Reviewer: Codex, with separate internal passes over persistence, PWA loading, UI and calculations. These are not reviews by Claude or Antigravity.

**Conclusion:** the normal local-first save path is well designed, and all existing automated checks pass, but the current application cannot yet be described as reliably preserving every observation through poor-signal, cross-device use. Confirmed conflict and ordering defects remain. Some were already recorded in the original backlog and have been reproduced again against current main. This review retains their IDs instead of presenting them as new discoveries.

This is a **findings-only PR**. Application code, Firebase SDK imports/configuration/initialization, Auth, Firestore collections and schemas, transactions, listeners, security rules, service worker and release identifiers are unchanged. No production Firebase account or data was accessed. Recommendations are proposals for separately reviewed fixes; merging these documents does not fix the defects or establish offline safety.

## Evidence and scope

The review covers every runtime source file, all nine test scripts and their fixture, all twelve existing review/check documents, README and `.gitattributes`; the icon's format/dimensions were checked. The app consists of inline CSS and JavaScript in `index.html`, the classic bootstrap, `sw.js` and `manifest.webmanifest`. There is no separate backend or deployed Firebase rules definition in this repository.

- **179/179 Node tests passed**, including the existing 62 calculation self-checks and 9 worker checks.
- **69/69 browser scenarios passed** across the five browser suites, using synthetic data and headless Edge at phone-sized viewports; no page errors or external requests were reported.
- Additional probes execute the actual module through the repository's local test harnesses. They reproduce defects which the passing regression suite does not cover. Their success means **the reported defect is present**, not that the app is correct.
- Physical iPhone v3.9.2 Home Screen cold launch, real SDK persistence/reconnect and current native keyboard/VoiceOver behavior were **not** verified. Existing older owner device checks are acknowledged in [validation and device checks](validation-and-device-checks.md).

The companion [validation plan](validation-and-device-checks.md) records the complete coverage boundary, commands and device acceptance matrix. All source links below are pinned to the reviewed commit.

## Findings and priorities

P1 = data integrity or recovery risk; P2 = meaningful friction/correctness/hardening. “Reproduced” refers to synthetic local tests, not a production incident.

| ID | Priority | Current finding | Evidence / provenance |
|---|---|---|---|
| AG-05 | P1 | A permanently conflicted stool move blocks sync and hides subsequent confirmed entries from UI and backup | Reproduced; existing backlog, stronger current evidence |
| FR-01 | P1 | An offline edit recreates a moved/deleted stool as an incomplete record | Reproduced; related to the existing identity-conflict backlog |
| FR-02 | P1 | Concurrent symptom selections silently replace one another | Reproduced; whole-array conflict |
| FR-03 | P2 | A clock rollback across restart reverses pending edits | Reproduced; local ordering defect |
| AG-04 | P1 | Queued Undo can recreate a stool at its old date after another device moves it | Reproduced; existing identity-conflict finding |
| AV-02 | P1 | Whole-log erase has no durable continuation | Reproduced; existing destructive-operation finding |
| AG-01 | P2 | Review advice actions lose keyboard focus after completion | Reproduced; remaining scope of earlier focus finding |
| AG-03 | P2 | Review counts an unfed plan as consumed food/supplements | Reproduced; existing backlog |
| AG-09 | P2 | Daily CSV's `worstBristol` hides hard-stool extremes | Reproduced; existing backlog |
| AG-10 | P2 | Future-dated observations trigger current-window warnings | Reproduced; existing backlog |
| FR-04 | P2 | Persistent browser storage is neither requested nor verified | Source/platform hardening gap; eviction not reproduced |

### AG-05 — A conflicting move blocks later saves and their backup visibility

**Where:** [`replayQueuedWrites`, lines 1090–1101](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1090-L1101), [`stoolMovePatches`, 1123–1133](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1123-L1133), [`flushWrites`, 1341–1363](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1341-L1363).

**Reproduce:** device A queues a stool move from 2 to 3 November, then saves a note on 4 November while its sender is paused. Device B deletes the original stool before A reconnects. Deliver B's snapshot, retry sync twice, then recreate A from its retained local storage.

**Actual:** the move throws because its source no longer exists. Replay has already reset `S.days` to the saved baseline and stops before applying the later note. Both operations remain in the outbox, but the later note disappears from the screen's data and **Full JSON backup**, including after reopening. Retry meets the same permanent conflict; the unrelated note never reaches the server. This is not physical deletion of the outbox: it is stranded data, incomplete export and no usable recovery action. The “Could not save locally” message also misdiagnoses a conflict in an already-stored operation.

**Direction:** retain and expose the conflicting payload, keep later valid entries represented/exportable, and offer explicit resolve/rebase/cancel handling for the failed move. Preserve ordering for dependent edits; do not indiscriminately skip failed commands or silently discard them. A recovery export must preserve unresolved work as well as the projected records.

**Acceptance:** repeat the sequence, resolve it entirely through the UI, and verify later entries remain visible, are recoverable from backup and eventually sync. Cover reload, another move to a third date, and a dependent edit following the move. See [offline probes](reproduce-offline.cjs).

### FR-01 — Offline stool edits can create incomplete duplicates

**Where:** [`stoolMerge`, 1102–1106](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1102-L1106), [`saveDay`, 1384–1404](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1384-L1404), [`sendOperation`, 1317–1324](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1317-L1324).

**Reproduce:** A changes an existing stool from type 3 to 4 while disconnected. Before that edit sends, B moves the stool to another date. Deliver the changed snapshot and drain A's queue.

**Actual:** `saveDay` stores only changed stool fields. When the original ID is absent, `stoolMerge` appends that partial update as if it were an insertion. The old date receives `{id: 'conflict-stool', bristol: 4}` without its time or flags, while the destination still contains the complete original stool. The queue empties and the app says **Synced**. Deletion instead of movement similarly resurrects a partial entry.

**Direction:** distinguish creation from editing in local commands and retain enough original information to explain/recover a conflict. An update whose target disappeared must become an explicit conflict, not an incomplete insert. Coordinate the design with AG-04/AG-05; do not silently move observations or alter Firebase contracts.

**Acceptance:** edit-versus-delete and edit-versus-move tests leave no incomplete record or accidental duplicate, preserve the attempted edit for user resolution, and remain correct after retry/restart. See [offline probes](reproduce-offline.cjs).

### FR-02 — Concurrent symptom edits overwrite independent observations

**Where:** [`event` action, 3421–3423](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3421-L3423) and [ordinary merged writes](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1310-L1316).

**Reproduce:** starting with no symptoms, A records Lethargic while disconnected; B records Vomited on the same day. A then receives B's snapshot and sends its pending operation.

**Actual:** A's operation contains the complete `events: ['lethargic']` array. It replaces B's `['vomited']`; final data contains only Lethargic, the queue empties and status is Synced. These are separate flags, so a user reasonably expects both observations to survive. The probe does not claim a policy for conflicting edits to the same scalar value.

**Direction:** preserve per-flag intent and the observed baseline locally, surface conflicting edits and define explicit reconciliation. Do not “fix” this by always unioning arrays, which would undo intentional removals. A fully atomic cross-client merge may require changes to the sender's transaction behavior; that would need a separately authorized integration design. This PR makes none. At minimum, make conflict detection/recovery visible rather than claiming a lossless merge.

**Acceptance:** two clients add different symptoms; add/remove races; offline restart; replay after acknowledgement. Independent additions survive, intentional removals are respected and unresolved conflicts retain recoverable payloads. See [offline probes](reproduce-offline.cjs).

### FR-03 — Restart plus clock rollback can restore an older pending value

**Where:** [`writeClock=0`, 1035](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1035), [queue ordering, 1088](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1088), [clock increment, 1207](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1207).

**Reproduce:** save a note offline at 12:10. Reopen with retained storage after the device clock is corrected back to 12:05, edit the note, then drain the queue.

**Actual:** the in-memory clock restarts at zero. The new correction receives an earlier queue key and is sent before the old note; the old note wins, both keys are removed and the app reports Synced. `Math.max(Date.now(), writeClock+1)` is monotonic only inside one running module, not across restarts.

**Direction:** derive the next local sequence from existing durable operations as well as the wall clock, with coordination for multiple writers. This can be addressed at the local outbox layer without changing Firebase configuration or schema.

**Acceptance:** advance/rewind the device clock across restart and between tabs; the last intentional edit remains last after replay and sync. See [offline probes](reproduce-offline.cjs). The prior report's “Clock Rollback Protection” claim is too broad.

### AG-04 — Undo's remote identity check is limited to the original day

**Where:** [local `recoveryMissing`, 1447–1450](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1447-L1450), [recovery sender, 1268–1284](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1268-L1284), [`stoolRecoveryPatch`, 1135–1142](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1135-L1142).

The local guard scans loaded days, but the remote recovery checks only its original day. The [offline probe](reproduce-offline.cjs) queues the real Delete/Undo operations, moves the identity remotely, delivers that snapshot and drains the queue. Both dates end with a complete copy of the stool, the queue is empty and status is Synced. A fresh local snapshot is not an authoritative cross-client identity lock. Preserve the attempted recovery and make the conflict understandable; a complete atomic identity solution crosses transaction/schema design and must not be smuggled into a UI-only or no-integration-change patch. The desired end state is one winning identity/location and an explanation that the record already exists elsewhere.

### AV-02 — Erase remains an exception to durable local commands

**Where:** [erase handler, 3656–3681](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3656-L3681).

After two confirmations and draining existing writes, the handler directly awaits sequential `deleteDoc` calls. No durable erase intent, target inventory or progress record is stored. The [offline probe](reproduce-offline.cjs) pauses the second deletion after the first succeeds, then recreates the module from durable state. Two of three records remain, `erasing=false`, status is Synced and there is no resume notice. A caught failure does truthfully warn that some records may have been erased; this is incomplete erasure, not proof of database corruption. During loss of signal, the pending promise can also keep the global `S.erasing` gate active and prevent new logging.

For this iPhone-first, poor-signal product, defer starting destructive maintenance while offline/pending and explain the consequence. Durable resumable erasure is a separate design task, with scope for concurrent records and settings preservation explicitly defined. Do not introduce new Firebase batching or deletion semantics in an unrelated usability change. Verify failure/termination before, during and after each acknowledgement, including a restart and subsequent normal save.

### AG-01 — Review actions discard keyboard focus

**Where:** [advice buttons, 2382–2384 and 2412–2413](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2382-L2413), [focus restoration, 1849–1859](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1849-L1859), [handlers, 3606–3632](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3606-L3632).

Focus the Review **Apply** ration, **Keep current ration this week**, **Apply** fibre or **Not now** button and activate it. In all four local browser cases, the action and notice were correct but focus became `BODY`. These buttons lack stable IDs and disappear when the advice changes; simply adding an ID to a disappearing button is insufficient.

Hand focus to a stable result/confirmation or the next relevant action and preserve disclosure state. Test keyboard activation as well as pointer input. This is reproduced DOM focus loss; the effect on actual iPhone VoiceOver still needs device verification. Settings focus improvements already covered by the suite should remain intact. See [UI probe](reproduce-ui.cjs).

### AG-03 — Weekly context counts plans as consumed

**Where:** [`weekContext`, 2443–2470](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2443-L2470).

A meal with recipe, Egg/Fibre/Oil selected but no `fedAt` contributes one egg night and one confirmed fibre/oil night. A retained bowl outcome after Undo Fed is counted too. The meal counters never check `isFedMeal`, although food attribution correctly does elsewhere.

Gate consumed-meal/supplement/bowl counters on confirmed feeding; keep activity and treat measurements independent. Before Fed, after Fed and after Undo Fed must respectively contribute zero, one and zero without deleting the plan or inventing observations. See [domain probes](reproduce-domain.cjs).

### AG-09 — CSV summary calls the highest score “worst”

**Where:** [`exportMonthCsv`, 2802–2806](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2802-L2806).

For stools of types 1 and 4, the daily CSV reports `worstBristol=4`, although the app's own bands classify 1 as red and 4 as green. History correctly shows `Types 1–4`, and the separate stool CSV retains both entries; the defect is the misleading daily summary.

Export both extrema/range with a documented compatibility change, or accurately rename the numerical maximum. Test `[1,4]`, `[2,3]`, `[1,7]` and no stools. This is a consistency issue within the programmed scale, not a new clinical ranking. See [domain probes](reproduce-domain.cjs).

### AG-10 — Current-window warnings include future observations

**Where:** [`vetItems`, 924–950](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L924-L950).

With today fixed to 4 November, accepted observations dated 1 and 2 December produce “Vomited on two or more days this week” and “Bowl refused twice this week”; future lethargy is also shown. `within()` checks only the oldest allowed date. Future imported records are intentionally inspectable in History, so this is reachable without changing application code.

Bound rolling windows by the as-of date as well as the lower limit. Keep future data available for correction; do not silently redraft dates or alter the historical blood-retention policy. Test each rolling warning at both boundaries and across year changes. See [domain probes](reproduce-domain.cjs).

### FR-04 — App-file readiness does not verify storage protection

**Where:** [outbox write, 1211](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1211) and [readiness UI, 2679–2683](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2679-L2683).

No `navigator.storage.persisted()`/`persist()` check exists. WebKit documents best-effort storage by default, possible automatic origin eviction and a persistent-mode request whose grant uses heuristics such as Home Screen installation. Cache readiness is therefore not evidence that persistent mode was granted. Feature-detect, request and verify persistence, and show a qualified result separately from app-file readiness and sync status. Continue graceful saving/failure handling if unavailable or denied. Persistence is not protection from deliberate clearing or device loss. **Eviction was not reproduced here.** [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

## iPhone friction: retain the improvements already working

The correct direction is incremental improvement, not a wholesale redesign. The existing tested behavior includes logging before the assessment, type-first stool entry with explicit Save, inline Edit/Delete and Undo, a direct previous-evening bowl prompt, compact meal amounts above Mark as fed, optional sections with recorded/draft summaries, four primary destinations, year-qualified History and chart values, and grouped Settings. Narrow-screen, forced-color and enlarged-root-text tests pass; these simulations do not replace native Dynamic Type or VoiceOver testing.

Further UI proposals, distinct from proven defects:

1. Show pending-operation count and a concise recovery reason beside local/synced status; offer conflict details only when needed. Keep background retry banners compact and stable while typing.
2. Before sign-out when offline or work is pending, offer **Stay signed in** and explain that reconnection/sign-in will be required to resume. Current nearby copy already says to keep signed in, and queues are account-scoped; do not describe this as proven deletion of saved records. Capture outstanding drafts before an intentional sign-out. Preserve the Auth integration.
3. Keep destructive maintenance under Advanced and discourage it during a walk/poor signal. Preserve explicit confirmations; avoid generic confirmation dialogs on routine logging.
4. Retain explicit field Save/Cancel and validation. A 250 ms draft debounce plus lifecycle capture is not a guarantee against immediate process/power loss before persistence. Do not replace clear saved/draft distinctions with reassuring but inaccurate copy.
5. Validate the two-file CSV action on installed iOS. The current browser tests validate generated content, not successful delivery of both files to Files/Share. Offer individual download/share actions only if device evidence warrants it.

## Reconciliation and implementation order

The historical review documents remain unchanged. AG-05/AG-04/AG-03/AG-09/AG-10 and AV-02 are still open in the current source; AG-01 has improved in Settings but remains in Review actions. The newer regression suite gives substantial evidence for AG-06/AG-07/AG-08/AG-11 fixes (restore reconciliation, imported IDs/settings and Undo timestamps), and for the completed Today/History/Settings improvements. It does not close the separate conflicts described here.

The v3.9.2 report's “absolute data safety”, “Data Safety Proof”, “Clock Rollback Protection”, guaranteed keyboard visibility and blanket “strictly verified” claims in `docs/review-iphone-offline-ux.md` must not be used as release acceptance evidence. This review and its validation matrix provide the narrower, current assessment. Keep code-derived findings separate from clinical validation and from uninspected deployed authorization rules.

Recommended next work:

1. Agree the recoverable local conflict model and fix AG-05/FR-01/FR-03 with meaningful regression tests, preserving existing remote contracts.
2. Review FR-02/AG-04 separately where a true atomic resolution could require transaction changes. The no-Firebase-change constraint remains in force; do not disguise those changes as UI work.
3. Repair remaining focus and summary defects (AG-01/03/09/10), then add storage-persistence status and a pending-work sign-out guard.
4. Execute the current-version iPhone acceptance matrix using synthetic data in an isolated environment. A safe normal offline save is already supported, but it is not a substitute for conflict, restart, storage-failure and lifecycle acceptance.

Obtain independent **Claude** and **Antigravity** reviews of this report and evidence on the PR. Ask each to challenge severity, prove or refute reproductions, distinguish already-fixed work from open findings, and comment on GitHub with the exact reviewed head. Internal Codex agents do not fulfill those external review slots. No merge or deployment is requested by this review.
