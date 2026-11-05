# Full code review: iPhone usability and poor-signal data safety

**Reviewed:** `main` at [`2646239395ddb6369eb6a940fab0a66db2259004`](https://github.com/murphys-logs/murphys-logs/tree/2646239395ddb6369eb6a940fab0a66db2259004), application **3.9.2**, 4 November 2026. Reviewer: Codex, with separate internal passes over persistence, PWA loading, UI and calculations. These are not reviews by Claude or Antigravity.

**External review incorporated:** [Claude](https://github.com/murphys-logs/murphys-logs/pull/14#issuecomment-6645285799) and [Antigravity](https://github.com/murphys-logs/murphys-logs/pull/14#issuecomment-6645310116) independently reviewed the original report at `073631b`. This revision corrects priorities and implementation boundaries and expands the evidence. [Review reconciliation](review-reconciliation.md) records accepted changes and claims we did not adopt. Focused review of this revision remains pending.

**Conclusion:** the normal local-first save path is well designed, and all existing automated checks pass, but the current application cannot yet be described as reliably preserving every observation through poor-signal, cross-device use. Confirmed conflict and ordering defects remain. Some were already recorded in the original backlog and have been reproduced again against current main. This review retains their IDs instead of presenting them as new discoveries.

This is a **findings-only PR**. Application code, Firebase SDK imports/configuration/initialization, Auth, Firestore collections and schemas, transactions, listeners, security rules, service worker and release identifiers are unchanged. No production Firebase account or data was accessed. Recommendations are proposals for separately reviewed fixes; merging these documents does not fix the defects or establish offline safety.

## Evidence and scope

The review covers every runtime source file, all nine test scripts and their fixture, all twelve existing review/check documents, README and `.gitattributes`; the icon's format/dimensions were checked. The app consists of inline CSS and JavaScript in `index.html`, the classic bootstrap, `sw.js` and `manifest.webmanifest`. There is no separate backend or deployed Firebase rules definition in this repository.

- **179/179 Node tests passed**, including the existing 62 calculation self-checks and 9 worker checks.
- **69/69 browser scenarios passed** across the five browser suites, using synthetic data and headless Edge at phone-sized viewports; no page errors or external requests were reported.
- Additional probes execute the actual module through the repository's local test harnesses. They reproduce defects which the passing regression suite does not cover, and include safe controls to check the stated preconditions. Passing defect assertions mean **the reported defect is present**, not that the app is correct.
- Physical iPhone v3.9.2 Home Screen cold launch, real SDK persistence/reconnect and current native keyboard/VoiceOver behavior were **not** verified. Existing older owner device checks are acknowledged in [validation and device checks](validation-and-device-checks.md).

The companion [validation plan](validation-and-device-checks.md) records the complete coverage boundary, commands and device acceptance matrix. All source links below are pinned to the reviewed commit.

## Findings and priorities

P1 = silent loss/corruption or blocked recovery of wanted observations; P2 = meaningful friction, visible inconsistency or hardening; P3 = lower-frequency or secondary correctness issue. “Reproduced” refers to synthetic local tests, not a production incident. These are remediation priorities, not claims about observed incident frequency.

The concurrent-edit reproductions use independent client views/local stores with overlapping records and unsent work. Their likelihood depends on how many clients edit the log. Ordinary shared-origin tabs share an outbox, so they are not equivalent to the independent stores in these probes; this is not proof that every same-device race is impossible. Normal uncontested offline saving, cross-client conflicts, unsaved drafts and browser eviction are separate assurance questions. The clock-restart, erase, empty-cache and notice-stack cases do not inherently require a second physical device.

| ID | Priority | Current finding | Evidence / provenance |
|---|---|---|---|
| AG-05 | P1 | A conflicted move hides later entries; further editing can lose observations when the queue resumes | Reproduced; includes Claude CL-01 and CL-04 extensions |
| FR-01 | P1 | A partial stool recreation can make the exported backup unimportable | Reproduced; includes Claude CL-02 consequence |
| FR-02 | P1 | Concurrent symptom selections silently replace one another | Reproduced; whole-array conflict |
| FR-03 | P3 | A clock rollback across restart reverses pending edits | Reproduced; same-session rollback control remains ordered |
| AG-04 | P2 | Undo queued before learning of a remote move can recreate a complete duplicate | Reproduced; known-move guard works before Undo is queued |
| AV-02 | P2 | Rare, confirmed erase has no durable continuation and can block new logging while awaiting acknowledgement | Reproduced; intentional partial erasure, not corruption |
| AG-01 | P2 | Review advice actions lose keyboard focus after completion | Reproduced; remaining scope of earlier focus finding |
| AG-03 | P2 | Meal summaries mix planned and fed data; bowl-refusal policy needs separate treatment | Reproduced; weekly counts, recent recipes and Markdown |
| AG-09 | P3 | Daily CSV's `worstBristol` hides hard-stool extremes | Reproduced; detailed stool export retains entries |
| AG-10 | P3 | Future-dated observations trigger current-window warnings | Reproduced; requires future-dated data |
| FR-04 | P2 | Persistent browser storage is neither requested nor verified | Source/platform hardening gap; eviction not reproduced |
| CL-03 | P2 | A queued Delete is silently ineffective after a remote move | Reproduced; new identity-conflict case from Claude |
| CL-05 | P2 | Stacked notices consume much of a small phone's usable form area | Measured in Chromium; native keyboard overlap unverified |

There are **13 tracked findings: 12 reproduced defects/friction cases and one platform hardening gap**. CL-01/CL-02/CL-04 extend existing findings rather than inflating the count. AG-01 remains P2 as a keyboard-accessibility defect; the owner's lack of VoiceOver use reduces its personal urgency but does not resolve it.

### AG-05 — A conflicting move blocks later saves and their backup visibility

**Where:** [`replayQueuedWrites`, lines 1090–1101](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1090-L1101), [`stoolMovePatches`, 1123–1133](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1123-L1133), [`flushWrites`, 1341–1363](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1341-L1363).

**Reproduce:** device A queues a stool move from 2 to 3 November, then saves a note on 4 November while its sender is paused. Device B deletes the original stool before A reconnects. Deliver B's snapshot, retry sync twice, then recreate A from its retained local storage.

**Actual:** the move throws because its source no longer exists. Replay has already reset `S.days` to the saved baseline and stops before applying the later note. Both operations remain in the outbox, but the later note disappears from the screen's data and **Full JSON backup**, including after reopening. Retry meets the same permanent conflict; the unrelated note never reaches the server. This is not physical deletion of the outbox: it is stranded data, incomplete export and no usable recovery action. The “Could not save locally” message also misdiagnoses a conflict in an already-stored operation.

**Extended consequence (CL-01):** while replay hides an earlier queued Vomited flag, a later Lethargic tap is calculated from the incomplete view and queues only `['lethargic']`. If the remote source is subsequently restored and the move can finish, the queue drains and the later array overwrites Vomited. The final state says Synced with the earlier observation lost. **Empty-cache variant (CL-04):** a first cached days snapshot without the move source can also stop replay and hide later entries on one device; a complete later snapshot restores visibility. The missing source is not necessarily proof of a permanent remote conflict.

**Direction:** retain and expose the conflicting payload, keep later valid entries represented/exportable, and offer explicit resolve/rebase/cancel handling for the failed move. Preserve ordering for dependent edits; do not indiscriminately skip failed commands or silently discard them. A recovery export must preserve unresolved work as well as the projected records.

**Acceptance:** repeat the sequence, resolve it entirely through the UI, and verify later entries remain visible, are recoverable from backup and eventually sync. Cover reload, remote move to a third date, dependent edits, further editing during a blocked queue, recovery after remote restoration, and incomplete cached snapshots. Distinguish incomplete cache from authoritative conflict before quarantining anything. See [offline probes](reproduce-offline.cjs).

### FR-01 — Offline stool edits can create incomplete duplicates

**Where:** [`stoolMerge`, 1102–1106](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1102-L1106), [`saveDay`, 1384–1404](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1384-L1404), [`sendOperation`, 1317–1324](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1317-L1324).

**Reproduce:** A changes an existing stool from type 3 to 4 while disconnected. Before that edit sends, B moves the stool to another date. Deliver the changed snapshot and drain A's queue.

**Actual:** `saveDay` stores only changed stool fields. When the original ID is absent, `stoolMerge` appends that partial update as if it were an insertion. The old date receives `{id: 'conflict-stool', bristol: 4}` without its time or flags, while the destination still contains the complete original stool. The queue empties and the app says **Synced**. Deletion instead of movement similarly resurrects a partial entry.

**Backup consequence (CL-02):** a Blood-only edit against a remotely deleted stool creates `{id, blood:true}` without `bristol` or `time`. The missing required Bristol score makes the app's own Full JSON export fail `validateBackup`; the whole import is rejected. Missing `time` alone is not the validator's rejection condition. The fragment also raises a Blood-recorded item, although its other stool fields were lost.

**Direction:** distinguish creation from editing in local commands and retain enough original information to explain/recover a conflict. An update whose target disappeared must become an explicit conflict, not an incomplete insert. Coordinate the design with AG-04/AG-05; do not silently move observations or alter Firebase contracts.

**Firebase boundary correction:** `stoolMerge` is called inside the existing stool-delta transaction through `operationData`. Changing its missing-target behavior changes that transaction callback even if its function name and the stored schema stay the same. An atomic fix therefore needs explicit authorization under the no-integration-change constraint. A local pre-send guard can detect a known conflict but cannot close the race. This report does not authorize either transaction changes or a claim of atomic safety from a local scan.

**Acceptance:** edit-versus-delete and edit-versus-move tests for time, Bristol, mucus and blood individually leave no incomplete record or accidental duplicate, preserve the attempted edit for user resolution, and remain correct after retry/restart. Every export produced by those supported actions must re-import successfully. See [offline probes](reproduce-offline.cjs).

### FR-02 — Concurrent symptom edits overwrite independent observations

**Where:** [`event` action, 3421–3423](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3421-L3423) and [ordinary merged writes](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1310-L1316).

**Reproduce:** starting with no symptoms, A records Lethargic while disconnected; B records Vomited on the same day. A then receives B's snapshot and sends its pending operation.

**Actual:** A's operation contains the complete `events: ['lethargic']` array. It replaces B's `['vomited']`; final data contains only Lethargic, the queue empties and status is Synced. These are separate flags, so a user reasonably expects both observations to survive. The probe does not claim a policy for conflicting edits to the same scalar value.

The removal variant is also lossy: A clears its observed Vomited flag while B adds Blood; A's queued empty array removes B's addition. This strengthens the need for explicit add/remove intent, not unconditional array union.

**Direction:** preserve per-flag intent and the observed baseline locally, surface conflicting edits and define explicit reconciliation. Do not “fix” this by always unioning arrays, which would undo intentional removals. A fully atomic cross-client merge may require changes to the sender's transaction behavior; that would need a separately authorized integration design. This PR makes none. At minimum, make conflict detection/recovery visible rather than claiming a lossless merge.

**Acceptance:** two clients add different symptoms; add/remove races; offline restart; replay after acknowledgement. Independent additions survive, intentional removals are respected and unresolved conflicts retain recoverable payloads. See [offline probes](reproduce-offline.cjs).

### FR-03 — Restart plus clock rollback can restore an older pending value

**Where:** [`writeClock=0`, 1035](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1035), [queue ordering, 1088](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1088), [clock increment, 1207](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1207).

**Reproduce:** save a note offline at 12:10. Reopen with retained storage after the device clock is corrected back to 12:05, edit the note, then drain the queue.

**Actual:** the in-memory clock restarts at zero. The new correction receives an earlier queue key and is sent before the old note; the old note wins, both keys are removed and the app reports Synced. `Math.max(Date.now(), writeClock+1)` is monotonic only inside one running module, not across restarts.

A rollback within one still-running module retains write order in the control probe. The reproduced failure requires a restart, an older unsent edit, and a sufficiently earlier wall clock for the later edit's key to sort first. Its narrow clock-correction precondition makes it P3, while the silent overwrite still warrants a test and a fix.

**Edge variant:** lexical sorting also reverses numeric order across a timestamp digit-width boundary. Antigravity's case is reproduced at `999999999999` to `1000000000000` milliseconds (September 2001). It is an extreme-clock edge, not an additional routine contemporary-device failure or a separate finding.

**Direction:** derive the next local sequence from existing durable operations as well as the wall clock, with coordination for multiple writers. Compare sequence values numerically across all three supported queue-key prefixes; padding only new keys is unsafe with mixed legacy/new formats. A shared `localStorage` get/set counter alone is not atomic across writers. This can be addressed at the local outbox layer without changing Firebase configuration or schema.

**Acceptance:** advance/rewind the device clock across restart and between tabs; the last intentional edit remains last after replay and sync. See [offline probes](reproduce-offline.cjs). The prior report's “Clock Rollback Protection” claim is too broad.

### AG-04 — Undo's remote identity check is limited to the original day

**Where:** [local `recoveryMissing`, 1447–1450](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1447-L1450), [recovery sender, 1268–1284](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1268-L1284), [`stoolRecoveryPatch`, 1135–1142](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1135-L1142).

The local guard scans loaded days, but the remote recovery checks only its original day. The [offline probe](reproduce-offline.cjs) queues the real Delete/Undo operations, moves the identity remotely, delivers that snapshot and drains the queue. Both dates end with a complete copy of the stool, the queue is empty and status is Synced. A fresh local snapshot is not an authoritative cross-client identity lock. Preserve the attempted recovery and make the conflict understandable; a complete atomic identity solution crosses transaction/schema design and must not be smuggled into a UI-only or no-integration-change patch. The desired end state is one winning identity/location and an explanation that the record already exists elsewhere.

The timing matters: Undo must already be queued before the client learns of the move. If the move snapshot arrives before the user requests Undo, the local guard withdraws recovery and prevents this reproduction. The resulting duplicate is complete and visible, which supports P2 rather than the original P1 rating. A cached pre-check remains a mitigation, not a global identity guarantee.

### AV-02 — Erase remains an exception to durable local commands

**Where:** [erase handler, 3656–3681](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3656-L3681).

After two confirmations and draining existing writes, the handler directly awaits sequential `deleteDoc` calls. No durable erase intent, target inventory or progress record is stored. The [offline probe](reproduce-offline.cjs) pauses the second deletion after the first succeeds, then recreates the module from durable state. Two of three records remain, `erasing=false`, status is Synced and there is no resume notice. A caught failure does truthfully warn that some records may have been erased; this is incomplete erasure, not proof of database corruption. During loss of signal, the pending promise can also keep the global `S.erasing` gate active and prevent new logging.

The pending-delete probe also confirms `saveDay` is rejected while the acknowledgement is withheld. This is an unresolved promise, not an unhandled rejection: an actual rejection reaches the existing catch/finally. The pending-outbox guard does not universally block offline erase; with an empty outbox, the handler can reach `deleteDoc` while offline. P2 reflects a rare administrative operation behind two confirmations, which leaves some deliberately targeted records unerased rather than deleting unrelated wanted records.

Defer starting destructive maintenance while offline/pending and explain the consequence. A resumable local erase could reuse the existing `{col,id,erase:true}` sender contract instead of introducing new Firebase calls. It still needs correct local deletion projection (`applyOperation` currently ignores `erase` for days), durable target/progress tracking, concurrency policy and restart tests. Enqueueing deletes alone is not a complete design or an atomic whole-log erase. Verify termination and acknowledgement timing, settings preservation and subsequent normal logging.

### AG-01 — Review actions discard keyboard focus

**Where:** [advice buttons, 2382–2384 and 2412–2413](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2382-L2413), [focus restoration, 1849–1859](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1849-L1859), [handlers, 3606–3632](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3606-L3632).

Focus the Review **Apply** ration, **Keep current ration this week**, **Apply** fibre or **Not now** button and activate it. In all four local browser cases, the action and notice were correct but focus became `BODY`. These buttons lack stable IDs and disappear when the advice changes; simply adding an ID to a disappearing button is insufficient.

Hand focus to a stable result/confirmation or the next relevant action and preserve disclosure state. Test keyboard activation as well as pointer input. This is reproduced DOM focus loss; the effect on actual iPhone VoiceOver still needs device verification. Settings focus improvements already covered by the suite should remain intact. See [UI probe](reproduce-ui.cjs).

### AG-03 — Weekly context counts plans as consumed

**Where:** [`weekContext`, 2443–2470](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2443-L2470).

A meal with recipe, Egg/Fibre/Oil selected but no `fedAt` contributes one egg night and one confirmed fibre/oil night. The counters never check `isFedMeal`, although food attribution correctly does elsewhere. The expanded [domain probes](reproduce-domain.cjs) also show unfed recipes in “Last six” (`mealContext`, 2266) and identical unlabeled DARF cells for planned and fed meals in Markdown (`exportMonthMd`, 2840).

Gate confirmed consumption/supplement counts on feeding, distinguish planned versus fed recipes, and label planned/actual export amounts. Before Fed, after Fed and after Undo Fed should contribute zero, one and zero to consumed supplement counts without deleting plans or inventing observations.

**Bowl policy correction:** do not automatically apply that gate to every bowl outcome or refusal alert. History explicitly allows “Refused” without a feeding time (`mealEditor`, 2132–2148); this may describe an offered but uneaten bowl. Preserve that observation and decide its counting policy separately. The original blanket recommendation would have hidden potentially intentional refusal records. Activity and treat measurements remain independent.

### AG-09 — CSV summary calls the highest score “worst”

**Where:** [`exportMonthCsv`, 2802–2806](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2802-L2806).

For stools of types 1 and 4, the daily CSV reports `worstBristol=4`, although the app's own bands classify 1 as red and 4 as green. History correctly shows `Types 1–4`, and the separate stool CSV retains both entries; the defect is the misleading daily summary.

Export both extrema/range with a documented compatibility change, or accurately rename the numerical maximum. Test `[1,4]`, `[2,3]`, `[1,7]` and no stools. This is a consistency issue within the programmed scale, not a new clinical ranking. See [domain probes](reproduce-domain.cjs).

### AG-10 — Current-window warnings include future observations

**Where:** [`vetItems`, 924–950](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L924-L950).

With today fixed to 4 November, accepted observations dated 1 and 2 December produce “Vomited on two or more days this week” and “Bowl refused twice this week”; future lethargy is also shown. `within()` checks only the oldest allowed date. Future imported records are intentionally inspectable in History, so this is reachable without changing application code.

Bound rolling windows by the as-of date as well as the lower limit: preserve `toDay(iso) > toDay(todayIso) - n` and add `toDay(iso) <= toDay(todayIso)`. Changing the first comparison to `>=` would widen an n-day window to n+1 days. Keep future data available for correction; do not silently redraft dates or alter the historical blood-retention policy. Test each rolling warning at both boundaries and across year changes. See [domain probes](reproduce-domain.cjs). P3 reflects the required future-dated import/incorrect-clock data; ordinary date entry is capped at today.

### FR-04 — App-file readiness does not verify storage protection

**Where:** [outbox write, 1211](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1211) and [readiness UI, 2679–2683](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L2679-L2683).

No `navigator.storage.persisted()`/`persist()` check exists. WebKit documents best-effort storage by default, possible automatic origin eviction and a persistent-mode request whose grant uses heuristics such as Home Screen installation. Cache readiness is therefore not evidence that persistent mode was granted. Feature-detect, request and verify persistence, and show a qualified result separately from app-file readiness and sync status. Continue graceful saving/failure handling if unavailable or denied. Persistence is not protection from deliberate clearing or device loss. **Eviction was not reproduced here.** [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

### CL-03 — Delete can become a silent no-op after a remote move

**Where:** [Delete action, 3530–3535](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L3530-L3535), [`stoolMerge`, 1102–1106](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1102-L1106), [Undo availability, 1447–1455](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1447-L1455).

**Reproduce:** A queues Delete for a stool on its old date. B moves the same identity to another date before A's command sends. Deliver the move snapshot and drain A's queue. **Actual:** the old-date drop succeeds without removing anything; the stool survives on the destination date, the queue empties, status says Synced and Undo is withdrawn because that identity exists elsewhere. The requested deletion did not happen and there is no conflict explanation. This differs from AG-04: no Undo was queued, and no duplicate was created.

**Direction/acceptance:** define whether Delete addresses the observed dated record or its identity across dates. Surface a known move conflict with a route to the surviving record and preserve the user's intent for resolution. A cached cross-date scan cannot guarantee atomic identity-wide deletion; that requires separately authorized integration design. Test move-before-send, move-before-acknowledgement and restart, with an explicit outcome rather than silently equating queue acknowledgement with deletion. See [offline probes](reproduce-offline.cjs).

### CL-05 — Multiple sticky notices substantially reduce the logging area

**Where:** [sticky feedback cap, 110](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L110), [feedback rendering, 1807–1818](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L1807-L1818), [existing scroll offsets, 61–86](https://github.com/murphys-logs/murphys-logs/blob/2646239395ddb6369eb6a940fab0a66db2259004/index.html#L61-L86).

**Measured:** with sync-pending, Undo and update-ready notices together, the sticky region reaches its `45dvh` cap and scrolls internally. At a 375×667 Chromium viewport, it occupies 300.14 px and leaves about 258.86 px between the top regions and bottom tabs, versus 559 px without notices. At 390×844 it occupies 379.80 px and leaves 356.20 px, versus 736 px without notices. The compact-sync variant reduces internal content but still reaches the cap in both cases. These are synthetic layout measurements, not a physical iPhone or keyboard-overlap reproduction.

**Direction/acceptance:** consolidate persistent status, retain an accessible Undo and recovery action, and defer low-urgency update detail while entering data. Keep details discoverable without occupying nearly half the viewport. Repeat both sizes with normal/enlarged text and full/compact notices; verify on an installed iPhone with the keyboard and home indicator. Existing `scroll-padding-top` and control `scroll-margin` already account for header/feedback height: a missing top check in the JavaScript reveal helper alone does not establish that all focus revealing is broken. See [UI probes](reproduce-ui.cjs).

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

1. Agree the recoverable local conflict model for AG-05, including incomplete-cache handling and recoverable export, and repair FR-03 ordering with meaningful regression tests. Preserve dependent operation order and existing sender behavior.
2. Design FR-01/FR-02/AG-04/CL-03 separately wherever an atomic solution changes transaction or identity semantics. FR-01's helper executes inside a transaction, so even that small-looking change crosses the constraint. The no-Firebase-change instruction remains in force; local detection is only a mitigation.
3. Reduce notice crowding (CL-05), repair focus and confirmed summary defects (AG-01/03/09/10), then add storage-persistence status and a pending-work sign-out guard. Decide bowl/refusal semantics explicitly. Address AV-02's local erase intent/projection/restart behavior without assuming the existing erase sender alone makes the workflow resumable.
4. Execute the current-version iPhone acceptance matrix using synthetic data in an isolated environment. A safe normal offline save is already supported, but it is not a substitute for conflict, restart, storage-failure and lifecycle acceptance.

The independent **Claude** and **Antigravity** reviews of `073631b` have been incorporated as recorded in [review reconciliation](review-reconciliation.md). Obtain focused reviews of the revised report and evidence, with the exact new reviewed head stated in GitHub comments. The older reviews do not approve this revision, and internal Codex agents do not fulfill those external review slots. No merge or deployment is requested by this review.
