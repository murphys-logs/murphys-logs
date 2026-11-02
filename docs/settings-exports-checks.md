# Settings organization and unified monthly export

Release 3.9.0. Implements Phase E of [the iPhone usability review](iphone-usability-review-2026-11-01.md): reorganizing Settings into five clear groups (`Account`, `Appearance`, `Feeding plan`, `Backup & export`, and `Advanced`) and replacing the four monthly export buttons with month selection, format selection, and one `Export` action while keeping `Full backup (JSON)` separate and retaining existing JSON import.

## What changed

### 1. Settings five-group organization (`viewSettings()`)
- **`Account` (`#settings-account`):**
  - Shows signed-in account email and `Sign out` (`#signout-btn`, `data-act="signout"`, preserving existing behaviour with **no new sign-out guard**).
  - Shows `Version 3.9.0` and the **App updates & offline access** subsection (`Update app` when ready and `Check offline access` via `#settings-check-offline`, updating the `Check app files` label per item 6 of the usability review).
- **`Appearance` (`#settings-appearance`):**
  - Dedicated segmented control (`System`, `Light`, `Dark`) with `role="group" aria-label="Appearance"` and `aria-pressed` state sync.
- **`Feeding plan` (`#settings-feeding-plan`):**
  - Keeps everyday ration inputs (`Daily target, kcal` `#in-setnum-targetKcal` and `Bella & Duke, g` `#in-setnum-bdGrams`) directly accessible.
  - **Supplements:** Displays current daily amounts (`Salmon oil today`, `Pro-Fibre today`), manual Pro-Fibre dose buttons (`Set 2.5 g today`, `Set 5 g today`, `Set 7.5 g today`, `Set 10 g today`, preserving the ceiling `confirm(...)` above `fibreRestG`), and an expandable **Supplement schedule history** disclosure (`#settings-schedules`) with year-inclusive schedule dates (`fmtShortYear`).
  - **Diet or routine changes:** Updates item-6 wording from `Regime changes` / `+ Mark today as a regime change` to `Diet or routine changes` / `+ Record diet or routine change today` (plus dated confirmation and Undo copy `Diet or routine change removed · <date>`) while keeping `data-act="addregime"`, `data-act="delregime"`, `kind: 'regime'`, and Firestore `settings/main.regimeChanges` unchanged.
- **`Backup & export` (`#settings-backup-export`):**
  - **Monthly export:**
    - `Month` `<select>` (`#export-month`, `data-act="exportmonthselect"`) listing the current month (`<Mon> <YYYY> (this month)`), the completed previous calendar month (`<Mon> <YYYY> (last month)`), recent calendar months since `startDate`, and any historical or imported months present in `S.days` or `S.changes` (newest first, bounded at 10 years of gap-filling so extreme ancient dates remain lightweight while still selectable).
    - `Export format` segmented control (`CSV` `#export-fmt-csv`, `Markdown` `#export-fmt-md`, `data-act="exportfmt"`).
    - Single `Export` button (`#export-run`, `data-act="exportrun"`, `aria-describedby="export-output-note"`) calling the existing `exportMonthCsv(ym)` or `exportMonthMd(ym)` functions.
    - Explicit filename output note (`#export-output-note`) naming both CSV outputs (`Murphy_Log_<YYYY-MM>.csv` and delayed `Murphy_Log_<YYYY-MM>_stools.csv`) or the Markdown output (`Murphy_Log_<YYYY-MM>.md`).
    - Protects `<select id="export-month">` in `replaceRenderedHtml` and updates export controls in place (`refreshExportControls`) so dismissing the native iOS `<select>` picker never reopens it and dirty Settings drafts are never disturbed.
  - **Full backup & restore (kept separate):**
    - Separate `Full backup (JSON)` button (`#export-all`, `data-act="exportall"`, calling `exportAll()`).
    - Retains existing `Import JSON` file input (`#backup-file`, `data-act="import"`, calling `importJson()` directly with **no import preview added**).
- **`Advanced` (`<details class="card" id="settings-advanced">`):**
  - Houses **Food & portion constants** (`kcalPerGDarf`, `kcalPerMlOil`, `darfMinG`), **Weekly ration rule** constants (`deadbandPct`, `damping`, `maxStepG`, `maxCumulativeG`, `minWeighIns`, `kcalPerKgTissue`, `bcsHoldAtOrBelow`), **Adjustment log** (year-inclusive dates, confirmation, Undo, and `#undo-removal` focus restoration), **When to call the vet** clinical/emergency guidance, **Diagnostics** (`Run self-tests` `#run-selftest` + `#selftest-out`), and **Erase log data** (`#erase-log`, preserving both `confirm(...)` and `prompt('Type ERASE to confirm') === 'ERASE'`).
  - Integrates with existing draft markers and recovery: an unsaved input inside collapsed `Advanced` shows `Unsaved changes` on the `Advanced` summary, and navigating back or reloading automatically reopens `#settings-advanced` with the draft intact.

## What did not change

- Firebase Authentication, Firebase SDK (`12.19.0`), `firebaseConfig`, Firestore collection paths and document shapes (`days`, `changes`, `settings/main`), `onSnapshot` listeners, and durable outbox ordering, sending, reconciliation, retries, and transactions.
- Pure calculations (`bowlFor`, `computeDarfAdjustment`, `fibreAdvice`, `vetItems`, `attributionFor`), in-app `selfTest()` assertions (`62 passed, 0 failed`), historical meal snapshots, `validateBackup()` / `importJson()` merge semantics, erase logic, and CSV/Markdown/JSON export schemas (`exportMonthCsv`, `exportMonthMd`, `exportAll`).
- Service-worker caching and Firebase exclusions (`sw.js`), bumped in lockstep with `index.html` (`data-version` and `APP_VERSION`) to `3.9.0`.
- Opening Settings, expanding `Supplement schedule history` or `Advanced`, or changing export month or format creates **zero** localStorage, outbox, or Firebase writes.
- No import preview and no new sign-out guard were added.

## Measurements (`v3.8.0` `d79d920` vs `v3.9.0`)

Measured using the shared Firebase-stubbed synthetic fixture from `tests/draft-input.browser.cjs` in headless Chromium mobile emulation (`overflowX = 0 px` on every screen and viewport). Frozen PR #6 baseline (`9cc5743`) `index.html` size: `211,199` bytes.

| Metric | `v3.8.0` (`d79d920`) | `v3.9.0` (Phase E) | Delta |
|---|---:|---:|---:|
| `index.html` size (LF bytes / lines) | 244,550 B / 3,678 | 250,310 B / 3,778 | +5,760 B (+2.4%) |
| Initial DOM elements (`Today` on boot) | 352 | 352 | 0 (0.0%) |
| `Today` height (`390×844` / `375×667`) | 2,851 px / 2,851 px | 2,851 px / 2,851 px | 0 px / 0 px |
| `History` list DOM / height (`390×844` / `375×667`) | 370 / 4,301 px / 4,301 px | 370 / 4,301 px / 4,301 px | 0 els / 0 px |
| Single-day editor (`day`) DOM / height (`390×844` / `375×667`) | 251 / 3,509 px / 3,594 px | 251 / 3,509 px / 3,594 px | 0 els / 0 px |
| `Review` DOM / height (`390×844` / `375×667`) | 419 / 1,343 px / 1,343 px | 419 / 1,343 px / 1,343 px | 0 els / 0 px |
| `Settings` DOM elements | 199 | 231 | +32 els (structured groups + month/format controls) |
| `Settings` initial height (`390×844` / `375×667`) | 4,150 px / 4,194 px | 2,551 px / 2,572 px | −1,599 px / −1,622 px (−38.5% / −38.7%) |
| `Settings` forced render cost (`390×844` / `375×667`, 10-run mean) | 0.41 ms / 0.40 ms | 0.78 ms / 0.63 ms | Sub-1 ms on both viewports |

## Automated checks

```text
node --test tests/*.test.cjs
node tests/draft-input.browser.cjs
node tests/navigation-drafts.browser.cjs
node tests/today-layout.browser.cjs
node tests/history-review.browser.cjs
node tests/settings-exports.browser.cjs
```

- **Results:** 169 unit tests (`import-backup`, `restore-sync`, `sw-assets`, `ui-ergonomics`) and 68 browser scenarios (`21` in `draft-input`, `26` in `navigation-drafts`, `11` in `today-layout`, `6` in `history-review`, `4` in `settings-exports`) pass with **0 external requests** and **0 page errors**.
- **Phase E coverage (`tests/settings-exports.browser.cjs` + `tests/ui-ergonomics.test.cjs`):**
  - Viewports `375×667`, `390×844`, and `320×568` (with `Advanced` and `Supplement schedule history` both closed and expanded), light and dark themes, `forced-colors: active`, and `200%` root font scaling.
  - `≥44×44 px` tap targets and `≥16 px` input/select text across all five Settings cards; zero horizontal overflow.
  - Month and year boundaries: October (`2026-10`) export on `1 November 2026` (`2026-11-01`), December (`2026-12`) on `1 January 2027` (`2027-01-01`), leap-year February (`2024-02`) on `1 March 2024` (`2024-03-01`), empty accounts on the 1st of the month, multi-year historical months (`2025-12`), and ancient imported dates (`1980-05`).
  - End-to-end Playwright browser download verification on `1 November` for **both** `Murphy_Log_2026-10.csv` and the 400 ms delayed `Murphy_Log_2026-10_stools.csv`, plus `Murphy_Log_2026-10.md` and separate `Murphy_Log_backup_2026-11-01.json`, and direct `Import JSON` merge updating selectable months immediately while preserving dirty Settings drafts.
  - Preserved confirmations and Undo focus restoration across manual Pro-Fibre (`> fibreRestG`), `Diet or routine changes`, `Adjustment log`, `Run self-tests`, double-confirmed `Erase all log data`, direct `Sign out` (no new guard), offline status, and failed local outbox save (`QuotaExceededError`).

## Physical iPhone checks

**Status: Pending physical iPhone verification** (not yet performed on hardware for `3.9.0`). Note per `docs/today-layout-checks.md`: VoiceOver checks are not applicable to the owner's personal workflow unless desired, though accessible names, `aria-describedby` export output announcements, and focus restoration are preserved and verified in automated browser checks.

1. **Both CSV downloads on physical iPhone (critical):** In both iPhone Safari and the installed Home Screen web app, open `Settings` → `Backup & export`, select `Oct 2026` (or another recorded month) and `CSV`, tap `Export`, and confirm iOS presents/saves **both** `Murphy_Log_<YYYY-MM>.csv` and the 400 ms delayed `Murphy_Log_<YYYY-MM>_stools.csv` without Safari or standalone WebKit blocking the second download.
2. **Month picker & Markdown / Full backup exports:** Open the native iOS `<select>` wheel on `#export-month`, confirm dismissing it does not reopen the wheel, verify `Markdown` export (`Murphy_Log_<YYYY-MM>.md`) and `Full backup (JSON)` (`Murphy_Log_backup_<YYYY-MM-DD>.json`), and test `Import JSON` from the Files picker.
3. **Five-group Settings & `Advanced` fold:** Scroll `Settings` in portrait (`Account`, `Appearance`, `Feeding plan`, `Backup & export`, `Advanced`), expand `Supplement schedule history` and `Advanced`, test keypad clearance above the bottom tab bar when editing an `Advanced` constant, and confirm `Unsaved changes` appears when collapsing `Advanced` with an unfinished edit.
4. **Offline check & confirmations:** Tap `Check offline access` under `Account` when online and offline; verify confirmation prompts on `Set 7.5 g today`, removing a diet/routine change, and cancelling `Erase all log data`.
5. **Dynamic Type & themes:** Check `System`, `Light`, and `Dark` themes and enlarged iOS Dynamic Type sizes on `Settings`.
