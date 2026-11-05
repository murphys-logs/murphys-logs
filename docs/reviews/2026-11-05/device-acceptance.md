# 3.10.0 physical-iPhone acceptance checklist

Both re-reviews agree that the remaining evidence can only come from a real iPhone with the app added to the Home Screen. Use a **synthetic test account or a fresh test log**, not Murphy's real record, for the destructive and corrupt-data steps. For every row, note the iOS version, the iPhone model, and pass or fail with a screenshot.

## Setup

1. Install 3.10.0 from the deployed preview URL, add it to the Home Screen, open it once with signal, and sign in.
2. In **Settings › App updates & offline access**, wait for "App files are ready for offline opening".
3. Note what **Settings › Sync & storage** says about storage protection (FR-04): *protected* or *not protected*.

## Poor-signal data safety

| # | Steps | Expected |
|---|---|---|
| 1 | Turn on Airplane Mode. Force-quit, then cold-launch from the Home Screen | "Opening Murphy's Logs…", then Today, with no sign-in form flash (CR-01). Status reads *Offline · saved records available* (CX-01) |
| 2 | Still offline: record a stool, tap two observations, save a weight | Status chip shows *Offline · saved on this device* and *4 changes waiting* (CR-05) |
| 3 | Force-quit immediately after the last tap; relaunch, still offline | All four entries visible; count unchanged. (Repeat 10 times at about 0.2 s, 0.5 s and 1 s after the tap; count any lost entry. This is CR-11 evidence.) |
| 4 | Type a weight but **don't** press Save. Lock the phone, force-quit, relaunch | Weight is back in the field, marked *Unsaved changes*; notice *Unsaved entries restored*; chip *Weight typed, not saved* in Still to log jumps to Save (CR-07). Nothing is added to the count until Save. (If lock is held by another window, prompt *Unfinished entries available* appears instead) |
| 5 | Tap the status chip | Opens Settings › Sync & storage: count, the oldest entry's time, *Not yet confirmed…* or the last confirmed time |
| 6 | Settings › Sign out while offline | Confirmation names the waiting count and the need for signal. Cancel keeps you signed in, with entries intact (CR-06) |
| 7 | Restore signal (Airplane Mode off) and return to the app | Returning to the app triggers immediate resync; status reaches *Synced*, count clears, and *Last confirmed* updates. Entries appear on a second device or in the console |
| 8 | Weak signal (one bar, or Low Data Mode plus a lift or basement) for 10 minutes with one change waiting | No visible churn. The status stays *Saved locally; retry sync* or *syncing*; back-off doubles up to 5 min with jitter; battery use is not noticeably raised (AG-13). Returning to the app or tapping *Retry sync now* in Sync & storage retries at once |

## iPhone UI

| # | Steps | Expected |
|---|---|---|
| 9 | Light, Dark and System appearance, each with a cold launch | **CR-10:** are the clock, signal and battery icons legible over the top bar in light mode? Record a screenshot for each. This decides the status-bar fix |
| 10 | Delete a stool; verify immediate Undo, and wait 16 minutes with the app open or background it and return | Tapping Undo immediately restores the stool with *Restored on this device*. If left for 16 minutes, the pinned Undo notice leaves; *Recently removed* in Sync & storage still restores it (CR-03, R5) |
| 11 | A Blood stool dated more than 90 days ago, nothing recent | No red Today banner and no Review dot; Review still lists it. A Blood stool from this week does raise both (CR-02) |
| 12 | Start typing a weight, then wait on Today during sync | Mark as fed responds on the first tap (CR-08) |
| 13 | Future-dated stool: open a stool, choose tomorrow, Save | Message *Choose a date on or before today.* beside the form; the date field is focused (AG-14) |
| 14 | VoiceOver on: move to the status chip, the waiting count and *typed, not saved* chips | Each is read with a sensible name; the status change is announced once, not repeatedly |
| 15 | Save recovery file (with unreadable or quarantined outbox entry) and Settings › Backup & export › Full backup | *Save recovery file* appears in Sync & storage when an unreadable or quarantined entry exists; Full backup is in Backup & export. Both files reach Files or the share sheet (CR-09, R3, R4) |

## Owner decisions to record

- **CR-02:** keep the 90-day window rule for Today's vet banner, or ask for per-item acknowledgement.
- **CR-10:** the fix to choose, based on row 9.
- **CR-11:** whether row 3 lost anything, which decides whether the IndexedDB outbox design is worth its complexity.
