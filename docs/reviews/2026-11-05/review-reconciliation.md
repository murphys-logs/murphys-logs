# Review reconciliation and 3.10.0 implementation

[Codex](https://github.com/murphys-logs/murphys-logs/pull/15#pullrequestreview-5777910770) (with three inline threads) and [Antigravity](https://github.com/murphys-logs/murphys-logs/pull/15#issuecomment-6646067302) (with one inline thread) independently reviewed [Claude's findings](claude-review.md) at PR head **`3d26a11`**. This document records how each point was handled, and what PR #15 now changes in the app (**3.10.0**).

**Firebase boundary.** None of these changes touch Firebase SDK imports or versions, `firebaseConfig`, initialisation, Auth calls (`signInWithEmailAndPassword`, `signOut`, `onAuthStateChanged`), Firestore collections, document schemas, `onSnapshot` registrations, `runTransaction` and `setDoc` calls, or any helper that runs inside a transaction callback (`stoolMerge`, `operationData`, `stoolMovePatches`, `stoolRecoveryPatch`). The new status logic only *reads* `snap.metadata.fromCache`, which the existing listeners already deliver. Outbox key formats and operation shapes are unchanged; a new `murphy-outbox-quarantine:` prefix holds entries the owner sets aside.

## Dispositions

| ID | Claude | Codex | Antigravity | Outcome | Implemented in 3.10.0 |
|---|---|---|---|---|---|
| CR-01 | P3 | Confirmed with correction (1.5 s delay is synthetic) | Confirmed with correction | **Fixed.** The language now says "for however long Auth takes" | The gate shows "Opening Murphy's Logs…". The form appears only when `onAuthStateChanged` reports no user, or after a 4 s shell fallback; a start-up failure always reveals it |
| CR-02 | P2 | Confirmed; warns that latest-date acknowledgement can hide backdated Blood | Confirmed | **Fixed, window-based.** No acknowledgement state, so a newly entered backdated Blood inside the window still alarms | Today's banner and the Review dot use vet items with a date inside `vetWindowDays` (90), or with no date. Review still lists Blood forever. **Owner policy decision:** confirm 90 days, or ask for per-item acknowledgement instead |
| CR-03 | P2 | Confirmed; expire only the sticky presentation | Confirmed | **Fixed** | The Undo notice is pinned for 15 minutes after removal. After that it appears under Settings › Sync & storage › Recently removed and still works. Legacy records without `createdAt` go straight to Settings |
| CR-04 | P3 | **Disputed**: artefact of the withheld lock | Confirmed | **Withdrawn**, replaced by CX-01. The probe keeps its 3.9.2 assertion and is annotated | The offline launch now says "Offline · saved records available" directly |
| CR-05 | P2 | Confirmed with correction: count operations accurately; "last synced" needs real acknowledgement evidence | Confirmed | **Fixed** with Codex's semantics | A 44 px status chip at 14 px+ with "N changes waiting" (operations, not observations) opens Settings › Sync & storage. That section shows the waiting count, the oldest entry's time, "Last confirmed with the server" (set only on an acknowledged send or all-listeners server snapshot), Retry sync now, and storage protection |
| CR-06 | P2 | Confirmed with correction: warn **before** `leaveDraft()`; lockout untested against the SDK | Confirmed | **Fixed** as Codex asked | With pending changes or `navigator.onLine===false`, Sign out first asks for confirmation (count, kept on the device, signal needed to sign back in). This happens before the draft-discard prompt. `signOut` itself is unchanged |
| CR-07 | P2 | Confirmed with correction; not P1 | Confirmed; borderline P1 | **P2, fixed.** Explicit Save is kept | (a) "Still to log" lists *Weight typed, not saved* (and the other field types), and the chip lands on Save. (b) On launch, when this window holds the `murphy-window` Web Lock (no other app window can own the draft), the newest earlier-session draft is restored automatically, still marked Unsaved changes, with a notice. Without the lock, or with Web Locks unsupported, the existing Restore entries prompt remains. This follows Codex's point that a missing BroadcastChannel reply is not proof: a suspended window still holds its lock |
| CR-08 | P3 | Confirmed with correction: the whole editor is replaced first (L2278–2282, L2291) | Confirmed | **Fixed** across all replacements | `sameMarkup()` compares each replacement (whole meal editor, plan fragment, supplement switches, context, Undo Fed, feeding controls) ignoring `open` state, and keeps unchanged nodes. Swallowed native taps remain unverified |
| CR-09 | P3 | Confirmed with correction: also invalid-shape JSON; Full backup holds zero days; preserve keys, order and raw data; copy before remove | **P2** | **P2, fixed** following Codex's recovery constraints and Antigravity's "syntactic quarantine only" distinction | Each outbox entry is parsed and shape-checked on its own. Unreadable entries stay at their original keys. Saved records and all readable work are projected (visible and in Full backup). Sending stops at the first unreadable entry, because its dependants are unknown. Status reads "Sync held · needs attention". The notice offers **Save recovery file** (raw unreadable, set-aside and pending entries) and **Set aside and continue syncing** (confirm, copy to `murphy-outbox-quarantine:`, verify, then remove the original). Full backup includes `unreadableOutbox`; erase treats it as pending. AG-05's semantic conflicts are **not** changed by this |
| CR-10 | P2 | Cannot verify; the Apple attribution is wrong; WebKit now calls `black-translucent` deprecated | Confirmed | **Not changed.** Device check first, as both reviewers advise | None. Test light, dark and system appearance on the owner's iPhone, then choose between removing the key and painting a strip |
| CR-11 | P2 | Confirmed with correction: a raw union of stores is unsafe | Confirmed with qualification | **Not implemented**; needs a design (stable IDs, tombstones, coordination, migration) | FR-04 storage protection was implemented instead: `navigator.storage.persisted()`, then `persist()` once per launch, with the result shown in Sync & storage |
| CX-01 (new, Codex) | P2 | Cache-only startup reports "Synced" | — | **Accepted, fixed** | "Synced" requires an acknowledged send in that flush, or server-backed (`fromCache:false`) snapshots from **all three** listeners. Otherwise: "Cached; checking sync", "Offline · saved records available", or the waiting status |
| AG-12 (new, Antigravity) | P2 | — | The probe's empty 404 fails on Windows Chromium | **Accepted, fixed** in `reproduce-friction.cjs` | — |
| AG-13 (new, Antigravity) | P2 | — | Unthrottled 15 s retry in poor signal | **Accepted, fixed** | After a failed flush, the periodic retry backs off (15 s doubling to 5 min, ±20% jitter). Lifecycle events (focus, visibility, online), new entries and Retry sync still try at once; a success resets the back-off |
| AG-14 (new, Antigravity) | P3 | — | An invalid or future stool date fails silently | **Accepted, fixed** | Save stool explains a missing time or an invalid/future date beside the form, and focuses the field |

Still open from 4 November and not addressed here: AG-05, FR-01, FR-02, FR-03, AG-04, AV-02, AG-01, AG-03, AG-09, AG-10, CL-03 and CL-05. CL-05's notice stack is smaller in practice now that CR-03's Undo leaves the pinned area after 15 minutes, but the sticky-region cap is unchanged. Several of these need explicit authorisation because an atomic fix would change transaction behaviour.

## Test changes to existing suites

Each change below reflects deliberate new behaviour, not a loosened check:

- `restore-sync.test.cjs`: 10 CC3-02 scenarios end with one listener server-backed and the others cached, so they now expect **"Cached; checking sync"** (CX-01). Two CC4 escaping tests give their Undo a fresh `createdAt` so it is pinned (CR-03).
- `ui-ergonomics.test.cjs`: the Today-banner test now expects the 94-day-old Blood item in Review and not on Today, and adds an in-window control that still alarms (CR-02). Release identifiers move to 3.10.0. A new **AG-13** back-off test brings the Node suite to 180.
- `history-review.browser.cjs`: CC-D1's bounded-banner check moves its latest Blood date inside the vet window, so the compact multi-date banner is still tested (CR-02).
- `settings-exports.browser.cjs`: the old "Sign out must not add a guard" assertion now checks the CR-06 guard. With unsynced changes, one confirmation appears; declining never calls `signOut` and keeps the queue. The no-pending case is covered in the new suite. The backup version moves to 3.10.0.
- `sw-assets.test.cjs`: the upgrade scenario becomes 3.9.2 → 3.10.0.
- New `offline-friction.browser.cjs`: 9 scenarios covering CR-01 to CR-03, CR-05 to CR-09, CX-01 with the CR-04 wording, FR-04 and AG-14. These include controls for the in-window Blood alarm, the no-pending sign-out, and the prompt path when another window may own the draft.

## Validation at the new head

| Check | Result |
|---|---|
| `node --test --experimental-test-isolation=none tests/*.test.cjs` (Node 22.23.4) | **180/180 pass** |
| Six browser suites (pre-installed Chromium) | **78/78 pass** (21 + 6 + 26 + 9 + 5 + 11); no page errors or external requests |
| `APP_HTML=<3.9.2 index.html> node docs/reviews/2026-11-05/reproduce-friction.cjs` | 9/9 probes still reproduce on the baseline |
| The same probes against 3.10.0 | Fail at CR-01, as expected for fixed behaviour |

**Still not verified:** a physical iPhone (Home Screen cold launch, Web Locks lifetime across suspension, status-bar rendering, keyboard, VoiceOver, `persist()` grant), the real Firebase SDK, and production data.
