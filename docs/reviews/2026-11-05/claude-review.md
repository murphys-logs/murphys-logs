# Full review: iPhone friction, UI and poor-signal data safety

**Reviewed:** `main` at [`5590437`](https://github.com/murphys-logs/murphys-logs/tree/5590437056ed12a3210f69029fef33e8379c6060), application **3.9.2**, 5 November 2026. Reviewer: Claude (Claude Code). The runtime files (`index.html`, `sw.js`, `manifest.webmanifest`, `icon-180.png`) are byte-identical to the 3.9.2 baseline that the [4 November review](../2026-11-04/full-review.md) examined. That review was merged as findings only, so all of its findings are still open.

**Scope:** I read every line of `index.html` (shell bootstrap, CSS, markup, calculations, outbox and sync, rendering, drafts, events, exports and import) and `sw.js`, plus the manifest, the test suites and the earlier review documents. My priorities were the ones the owner set: (1) once the app has been opened from the Home Screen and the user is signed in, observations must survive until signal returns; (2) less friction and a better UI on iPhone; (3) no change to the Firebase integration.

**This PR is findings only.** It changes no application code, Firebase SDK import, configuration, initialisation, Auth flow, Firestore collection, schema, transaction, listener, service worker or release identifier. Every recommendation below can be built without touching the Firebase integration. Where one comes close (CR-09, CR-11), the boundary is stated.

## Bottom line for poor-signal use

For one person on one iPhone, **the normal path is sound.** Every confirmed tap or Save is written synchronously to a per-account `localStorage` outbox ([`write`, L1202–1218](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1202-L1218)) before the UI reports "saved on this device". The outbox is replayed over the cached Firestore snapshot on every launch and drained in order when connectivity allows. The service worker serves a version-checked shell and the pinned SDK modules from cache, so an installed app opens with no signal. My probes confirm that queued entries survive a relaunch, a change of day and even sign-out (CR-03, CR-05, CR-06).

The gaps that matter most for this owner are not in the outbox itself. They are at its edges:

1. **An entry that was typed but not yet saved is only a draft.** After iOS ends the app, it comes back hidden behind a "Restore entries" prompt and is not in the log (CR-07).
2. **Signing out with no signal locks the user out of logging** until they can sign in again, with no warning, even though their queued entries are kept (CR-06).
3. **There is no way to tell how much is still waiting to sync, or for how long** (CR-05, CR-04). The status text is 12 px grey.
4. **Storage durability is assumed rather than secured.** Persistent storage is never requested (FR-04, already tracked). WebKit's `localStorage` commit timing on a force-quit has not been verified (CR-11). A single unreadable outbox entry hides every saved record (CR-09).
5. **Conflicts between devices** (AG-05, FR-01, FR-02, AG-04, CL-03 from the earlier review) remain open. They need a second client, so for a single phone they are less likely than items 1–4.

## New findings

Priorities follow the earlier review's scale. P1: silent loss or corruption, or blocked recovery, of wanted observations. P2: meaningful friction, a visible inconsistency, or hardening. P3: lower frequency or secondary. "Reproduced" means reproduced by a synthetic local probe in [`reproduce-friction.cjs`](reproduce-friction.cjs), not on a physical iPhone.

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| CR-07 | P2 | An entry typed but not saved before iOS ends the app is not in the log, and comes back only behind a "Restore entries" tap | Reproduced |
| CR-06 | P2 | Sign out goes ahead offline with unsent entries; no warning, and the user then needs signal to sign back in | Reproduced |
| CR-05 | P2 | Sync status shows no pending count or age, at 12 px in grey | Reproduced and measured |
| CR-11 | P2 | The outbox relies on `localStorage` alone; WebKit's commit timing on a force-quit or crash is unverified | Source and platform; not reproduced |
| CR-02 | P2 | One historical Blood record keeps a red banner at the top of Today and the Review attention dot on permanently | Reproduced |
| CR-03 | P2 | A delete's Undo notice never expires. It reappears in the sticky region across relaunches and days, which adds to CL-05 crowding | Reproduced and measured |
| CR-10 | P2 | The `black-translucent` status-bar style draws white status-bar text, which is likely unreadable over the light theme's `#f4f4f4` top bar (including the signal indicator) | Source and Apple's documented behaviour; device check needed |
| CR-09 | P3 | One unparsable outbox entry stops replay at launch. Every saved record disappears from the screen and the status says "Not saved" | Reproduced; no current code path writes such an entry |
| CR-01 | P3 | A signed-in cold launch first shows the sign-in form, enabled, until Auth restores the session | Reproduced (timing depends on the device) |
| CR-04 | P3 | A launch with no signal reports "Cached; checking sync" indefinitely; offline wording appears only after a later `offline` event | Reproduced |
| CR-08 | P3 | While any draft is open, each deferred render replaces Today's "Mark as fed" button node even when its markup is unchanged | Reproduced |

### CR-07: typed-but-unsaved values come back only behind a prompt

**Where:** draft persistence and recovery, [`loadDrafts`, L3156–3175](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L3156-L3175), and the recovery notice at [L1814](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1814).

**Reproduce:** type `19.2` into Today's weight field and don't press Save. Open a new window, as a Home Screen cold launch does (sessionStorage is not kept, as the code comment at L3165 acknowledges).

**Actual:** the field is empty, the outbox is empty, "Still to log" still says *no weight*, and a notice reads "Unfinished entries available … Restore entries / Later". Choosing Later hides the draft until a later launch. On the iOS decimal keypad there is no Return key, so the only commit path is the Save button that appears under the field. Tapping *Done* on the keyboard bar or locking the phone leaves a value that looks saved but isn't.

**Why it matters:** for one user on one phone, this is the most likely way for an observation never to reach the log. Weigh-ins and walk minutes are typed outdoors, often one-handed, where interruptions and app kills are common.

**Recommendation (no Firebase change):** keep explicit Save, but:
- auto-restore same-account drafts on launch when no other window holds them. `navigator.locks.request('murphy-window:'+uid,{ifAvailable:true})` or a BroadcastChannel can establish that there is a single window.
- list unsaved drafts in "Still to log", for example *Weight typed, not saved*, with a jump to the Save button.
- consider a gentle "Not saved yet" outline on a dirty field once it loses focus.

**Acceptance:** type a value, kill and relaunch. The value is visible in its field, flagged unsaved, and listed in "Still to log". With two open windows, neither takes over the other's draft. The existing tests in `navigation-drafts.browser.cjs` still pass.

### CR-06: offline sign-out locks the user out of logging

**Where:** [`signout` action, L3368](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L3368). The only guards are for drafts (`leaveDraft`) and an import in progress.

**Reproduce:** offline, record three observations, then open Settings and tap Sign out. **Actual:** no dialog appears, `signOut` is called, and the three outbox entries remain under the old account's prefix. Sign-in needs a network round trip ("A first sign-in on a device needs one"), so with no signal the user cannot log anything until they reach coverage. The entries are not lost; they sync after the next sign-in.

**Recommendation:** when `queuedWrites().length>0` or `navigator.onLine===false`, show a confirmation: *"3 entries haven't synced yet. If you sign out now you'll need signal to sign back in. Stay signed in / Sign out anyway."* This is UI only and leaves the Auth call unchanged.

### CR-05: no pending count or age in the sync status

**Where:** [`.topbar .state`, L105](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L105) and the status strings in `write`/`flushWrites`.

**Measured:** with three entries queued offline, the status reads "Offline · saved on this device" at 12 px in `--ink-3`. Nothing distinguishes one entry from fifty, or "syncing now" from "a plain `setDoc` has been waiting on a weak connection for an hour". In poor signal, `navigator.onLine` usually stays `true`, so the status stays at "Saved locally; syncing" for the whole wait.

**Recommendation:** replace the text with a status chip, at least 15 px with an icon: *Synced* / *3 waiting · last synced 14:02* / *3 waiting · offline*. Tapping it opens a small sheet with the pending count, the oldest entry's age, Retry sync and a Full backup shortcut. All of this comes from the existing outbox keys, which hold a timestamp, so no Firebase change is needed. It also gives AG-05's conflict explanation a natural place to live later.

### CR-11: `localStorage` is the only durable copy while offline

**Where:** [L1211](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1211). While `navigator.onLine===false`, `flushWrites` returns early, so Firestore's own IndexedDB mutation queue never sees the write. The `localStorage` entry is the only copy.

**Risk (not reproduced):** WebKit hands `localStorage` writes to its storage process and commits them to SQLite in batches. A force-quit (swipe up), a crash or a jetsam kill moments after a tap may lose the newest entries before they reach disk, even though the UI already said "saved on this device". The window is probably short, and I have not measured it on a device. Together with FR-04 (no `navigator.storage.persist()`), the outbox's durability is assumed rather than verified.

**Recommendation (local outbox layer only):** mirror each outbox entry into an app-owned IndexedDB store, separate from Firestore's databases. Wait for the transaction's `complete` event (with `durability:'strict'` where supported) before showing "saved on this device", and treat the union of both stores as the outbox on launch. Pair this with FR-04's `persist()` request and status. **Device acceptance:** on an installed iPhone in Airplane Mode, tap an observation and force-quit within 0.2 s, 0.5 s and 1 s, 20 times each; relaunch and count entries kept.

### CR-02: a historical Blood record keeps Today red and the Review dot on

**Where:** [Today banner, L1883](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1883) and the [attention dot, L1829](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1829). By design, `vetItems` never ages out Blood.

**Reproduce:** a log with one blood-flagged stool on 1 March 2026 and seven clean, fully recorded days. **Actual:** on 5 November, Today opens with a 126 px red "One vet item · Blood recorded (Historical · 1 Mar 2026). Open Review" note above "Still to log", and the Review tab's dot and its "needs attention" VoiceOver suffix are on. They stay on for the life of the log. Once the alarm is always on, it no longer flags anything new.

**Recommendation:** keep Blood permanently in the Review list (that is a deliberate clinical choice), but drive Today's banner and the dot from items that are **within the vet window, or not yet acknowledged**. "Acknowledged" can be a per-device record of the latest date seen, stored like the existing `murphy-device:*` keys. This is an owner policy decision and needs no Firebase change.

### CR-03: Undo never expires and stays sticky

**Where:** [`loadDeviceState`, L1452–1459](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1452-L1459) reloads the Undo record from `localStorage` on every snapshot, for as long as the record is still missing.

**Reproduce:** delete a stool on 5 November, then relaunch on 8 November. **Actual:** "Stool removed · 5 Nov at 07:30 — Undo / Dismiss" is still pinned at the top. The feedback region is 169 px tall at 390×844 with only that notice. With a sync notice and an update notice it reaches the 45 dvh cap that CL-05 measured.

**Recommendation:** keep the durable recovery copy, but show the sticky notice for one session or a short time (for example until the next launch, or 10 minutes). After that, offer it from a quieter place: the status sheet from CR-05, or a "Recently removed" row in History for that date. Fold this into CL-05's notice consolidation.

### CR-10: status-bar text is likely invisible in the light theme

**Where:** [L12](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L12) `apple-mobile-web-app-status-bar-style="black-translucent"`, with the top bar painting `--paper` under the safe area ([L98–103](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L98-L103)). In the light theme, `--paper` is `#f4f4f4`, and that theme is the default whenever iOS itself is in light mode.

**Risk:** Apple documents `black-translucent` as drawing white status-bar text over the page. Over `#f4f4f4`, the clock, battery and **signal-strength indicator** would be nearly invisible, and the signal indicator is exactly what a poor-signal user glances at. The `theme-color` meta that `applyTheme()` updates does not control a standalone app's status bar. **Not checked on a device.**

**Recommendation:** verify on an installed iPhone in light mode. If confirmed, paint the safe-area strip above the top bar a constant dark colour in both themes, for example a `::before` of height `env(safe-area-inset-top)` in `#101010`, and keep `black-translucent`. The alternative is `default`, which is wrong for the dark theme. The meta tag can't be switched reliably at runtime.

### CR-09: one unparsable outbox entry hides every saved record

**Where:** [`queuedWrites`, L1085](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1085) parses each entry without isolation. [`received`, L1515](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1515) catches the error before `replayQueuedWrites` runs.

**Reproduce:** a log with a saved weight and BCS today, plus one outbox value of `{not json`. **Actual:** `S.ready` is true but `S.days` is empty, so Today shows no saved data. The status reads "Not saved" and the banner reads "Could not save locally". The same exception also stops every later sync attempt.

**Likelihood:** the app always writes `JSON.stringify(op)`, so no current code path produces such an entry. Possible sources are storage corruption, manual tampering, or a future version's mistake. That makes this P3 hardening: when it does happen, it blocks recovery completely.

**Recommendation:** parse each entry inside its own `try`. Move an unreadable entry to a `murphy-outbox-quarantine:*` key, never deleting it, and continue replay. Surface the quarantine in the CR-05 status sheet and include it in the Full backup. This is local outbox code only.

### CR-01: the sign-in form flashes on every signed-in cold launch

**Where:** `#gate` is visible by default ([L452](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L452)). `AppShell.ready()` at [L3819](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L3819) enables "Sign in" as soon as the module has loaded, before `onAuthStateChanged` ([L3775](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L3775)) reports the persisted user.

**Reproduce:** with Auth delayed by 1.5 s, the email and password fields and an enabled Sign in button are visible, and then replaced by the app. On a device, the delay is however long IndexedDB-backed Auth takes to restore. That is usually short, but long enough to read as "I've been logged out", and it invites a password autofill prompt.

**Recommendation:** start with a neutral "Opening Murphy's Logs…" state, and reveal the form only once `onAuthStateChanged` reports no user, or after a timeout of a few seconds as a fallback. This is presentation only and leaves the Auth calls unchanged.

### CR-04: an offline launch never says it is offline

**Where:** [L1518](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L1518). The `offline` listener ([L3784](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L3784)) fires only on a transition. **Reproduce:** launch with `navigator.onLine===false` and nothing pending. **Actual:** "Cached; checking sync" persists. **Recommendation:** at launch, and in `received()`, use the same offline wording as the `offline` handler: *Offline · showing saved records*. Merge this into the CR-05 chip.

### CR-08: Mark as fed is rebuilt on every deferred render

**Where:** [`refreshMealPlans`, L2300–2305](https://github.com/murphys-logs/murphys-logs/blob/5590437056ed12a3210f69029fef33e8379c6060/index.html#L2300-L2305) assigns `innerHTML` unconditionally, unlike the neighbouring fragments, which compare first. **Reproduce:** start typing a weight, then trigger a render. **Actual:** the button's markup is identical, but it is a new node. A sync or metadata snapshot that arrives between touchstart and touchend can swallow a tap on the main evening action, and it can move VoiceOver's cursor. **Recommendation:** compare before replacing, as in the surrounding loops.

## Previously tracked findings: re-verified, all still open

I ran the three probe scripts from 4 November against the current `main`. They all still pass, which confirms the defects are still present: offline 15/15, domain 6/6, UI 6/6. The runtime code is unchanged, so their priorities and directions stand. I agree with the reconciled priorities in [review-reconciliation.md](../2026-11-04/review-reconciliation.md), with two remarks:

- **CL-05 is a bigger problem than it looks, because of CR-03.** The Undo notice that makes up much of the measured stack doesn't expire. The notice stack in daily use is therefore larger and longer-lived than the synthetic three-notice case suggests. I'd move CL-05 and CR-03 together ahead of AG-01, AG-03, AG-09 and AG-10.
- **AG-05 and CR-09 are the same class of failure.** Both are a single bad entry stopping replay of everything after it. One local design (isolate, quarantine, keep visible, keep in backup) should cover both. Note that AG-05's dependent-ordering constraint still applies: quarantining a failed *move* must not let a dependent later edit go out ahead of it.

## Strengths to keep

- A synchronous, durable outbox write comes before any "saved" claim. Undo copies are prepared before a removal, and replay is idempotent.
- A version-checked shell and pinned SDK cache let the app open with no signal. A failed update never replaces a working release.
- Type-first stool logging (two taps), inline Edit and Delete with Undo, a one-tap bowl prompt and amounts placed directly above Mark as fed.
- Careful focus management for iOS pickers (`replaceRenderedHtml` keeps the recipe `<select>` connected), Dynamic Type through `-apple-system-body`, 16 px minimum field text (no zoom on focus), and 44 px targets.
- Escaping is consistent throughout the rendering code, the backup validator is strict, and CSV formula injection is guarded.

## Recommended order of work

Everything here leaves the Firebase integration unchanged.

1. **Quick, high-value UI fixes:** a sign-out guard (CR-06); a sync status chip with pending count and offline wording (CR-05, CR-04); a launch splash instead of the sign-in flash (CR-01); a node-stable Mark as fed (CR-08).
2. **Calmer Today:** limit the Today vet banner and the dot to items in the window or not yet acknowledged (CR-02, after the owner decides the policy); an Undo that expires, plus one consolidated notice tray (CR-03 with CL-05).
3. **Drafts that survive kills:** auto-restore a single window's drafts and list unsaved drafts in "Still to log" (CR-07).
4. **Durability hardening:** isolate and quarantine unreadable outbox entries (CR-09, designed with AG-05); request and show persistent storage (FR-04); mirror the outbox in IndexedDB (CR-11); run the device force-quit test.
5. **Device check:** status-bar legibility in light mode (CR-10).
6. **Conflict model:** the existing AG-05, FR-01, FR-02, AG-04 and CL-03 plan, under the boundaries recorded on 4 November. Several of these need explicit authorisation, because an atomic fix would change transaction behaviour.

## Validation

| Check | Result |
|---|---|
| `node --test --experimental-test-isolation=none tests/*.test.cjs` (Node 22.23.4) | **179/179 pass** |
| Five browser suites (`tests/*.browser.cjs`, pre-installed Chromium) | **69/69 scenarios pass** (21 + 6 + 26 + 5 + 11); no page errors or external requests |
| `docs/reviews/2026-11-04/reproduce-{offline,domain,ui}.cjs` | All pass, so the 13 tracked findings are still present |
| `docs/reviews/2026-11-05/reproduce-friction.cjs` (new) | **9/9 probes pass** (CR-01 to CR-09); no page errors, dialogs or external requests |

Run the new probes with:

```bash
node docs/reviews/2026-11-05/reproduce-friction.cjs
```

**Not verified:** physical iPhone behaviour (status-bar rendering, the native keyboard, VoiceOver, Home Screen cold-launch timing, WebKit `localStorage` commit timing, storage eviction), the real Firebase SDK's reconnect and transaction behaviour, deployed security rules, and production data. None was accessed. Chromium probes stand in for WebKit only for the DOM and logic behaviour they assert.
