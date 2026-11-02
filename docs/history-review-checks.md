# Phone History diary, Review screen, and four-destination navigation

Release 3.8.0. Implements Phase D of [the iPhone usability review](iphone-usability-review-2026-11-01.md): turning History into a stacked iPhone diary, combining Status and Data analytics into Review, and completing the four primary destinations (`Today / History / Review / Settings`).

## Internal route mapping (`v3.7.0` → `v3.8.0`)

| Legacy `S.tab` | Phase D `S.tab` | `#tabbar` active destination | Screen rendered | Notes & draft compatibility |
|---|---|---|---|---|
| `'today'` | `'today'` | `Today` (`aria-current="page"`) | `viewToday()` | Unchanged daily logging entry screen; top alert links now open `Review` (`data-tab="review"`). |
| `'history'` (was *Data*) | `'history'` | `History` (`aria-current="page"`) | `viewHistory()` | Stacked daily diary summaries (replacing the wide mobile table from *Data*), range chips (`14 / 28 / 56 / All`), and inline `Choose date…` picker (`#history-list-date`). |
| `'day'` (was *History* tab) | `'day'` | `History` (`aria-current="true"`) | `viewDay()` | Single-day editor for `S.cursor` inside History, with explicit full date, prev/next buttons, inline date picker (`#history-date`), and `← All days` (`#history-back`). Preserves `S.tab === 'day'` for stool move-follow, bowl shortcuts, and dated draft recovery. |
| `'status'` | `'review'` | `Review` (`aria-current="page"`) | `viewReview()` | Normalized via `normalizeTab('status') === 'review'` (`viewStatus` retained as an alias). Persisted `v1`/`v2` drafts saved on `'status'` restore cleanly onto `Review`. |
| `'more'` | `'settings'` | `Settings` (`aria-current="page"`) | `viewSettings()` | Normalized via `normalizeTab('more') === 'settings'` (`viewMore` retained as an alias). Persisted `setnum` drafts resume cleanly onto `Settings` without altering `S.cursor`. |

## What changed

### 1. History (`viewHistory()` + `viewDay()`)
- **Stacked daily summaries (`viewHistory`):** Moved the daily-record list from the former *Data* tab into *History* and removed the horizontal-scrolling `.log-table` layout.
- **Complete core summary without sideways scrolling:** Each `.diary-card` displays:
  - Full date including weekday and 4-digit year (`historyDateLabel(iso)`), relative tag (`Today` / `Yesterday`), and an `Unsaved changes` badge when a hidden local draft exists for that date.
  - Stool count, Bristol type/range, tone dot, and explicit **Blood** / **Mucus** flags (or `No stools logged`).
  - Weight (`kg` + target range label, `Missed`, or `Not recorded`) and body condition (`BCS` or `Not recorded`).
  - Recorded observations/symptoms (`Vomited`, `Blood`, `Lethargic`, `Off food`, `Vacant episode`) in bold watch styling for forced-colors clarity.
  - Preceding confirmed meal (`trackingMeal(iso)`): date with year, feeding time, recipe, DARF grams, bowl outcome, and an expandable **Meal details** section (`mealSummary`) with an **Edit `<date>` meal** button that opens the preceding day focused on `#meal-section-<prevIso>`. Unfed meal plans show `Not recorded as fed`.
- **Tomorrow preview & imported future records:** When today's evening meal is marked fed, tomorrow's tracking group appears at the top as a non-opening preview (`Tomorrow’s tracking` / `Opens tomorrow`) without creating or opening a future daily record. Saved future-date records from imports remain hidden in 14/28/56-day views and inspectable under **All** (`9999`) without moving or mutating them (and any synthetic tracking preview after a fed future import is labelled `Future tracking` rather than `Tomorrow’s tracking`).
- **Single-day editor (`viewDay`) & return flow:** Every openable summary opens the existing daily editor for that date (`#open-day-<iso>`) and focuses `#history-date-label`. `← All days` (`#history-back`) or tapping `History` in `#tabbar` returns to the diary list and restores focus to `#open-day-<iso>` (falling back to `#main h2.screen` if `S.cursor` lies outside the active range).

### 2. Review (`viewReview()`)
- **Actionable results first:** Leads with **Vet items**, **This week’s ration** (`Apply` / `Keep current ration this week`, held notice, or no-change summary), and **Pro-Fibre** (`Apply` / `Not now` / `Review with the vet`).
- **Clearer item-6 labels (`CC-D4`):** Uses `Keep current ration this week` for weekly ration refusal (`data-act="refuseadv"`), `Current DARF adjustment` (`g current adjustment`) for the cumulative offset explanation, and `Diet or routine changed <date>` in ration alert headings while keeping pure calculation strings and saved payloads unchanged.
- **Expandable explanations, trends, charts, and comparisons:** Supporting ration window/adjustment details (`#review-ration-details`), clean-day streak rules (`#review-fibre-details`), **Weight & condition** with 14- and 28-day means (`#review-weight-condition`), **This week against last** (`#review-week-context`), **Trends & charts** (`#review-trends`), and **Food & recipe comparisons** (`#review-comparisons`: *By recipe*, *By extra*, *Tonight by recipe*) are organized as `<details>` disclosures whose open state is preserved across in-place range updates. Range chip groups in `Trends & charts` and `Food & recipe comparisons` note `Applies to History and Review.` (`CC-D5`).
- **Full dates with year, bounded Today summary, & current-day advice dating (`CX-D1`, `CC-D1`, `CC-D3`):** Shared helpers (`fmtShortYear`, `formatAlertDates`, `formatVetAlertHeadline`, `rationAlertDateText`) display the 4-digit year on every Today alert banner, Review alert, comparison window, Pro-Fibre schedule date, chart summary, chart axis endpoint, and accessible chart-value table without altering pure calculation outputs:
  - When a recovered earlier-date Today draft is open (`draftToday`), Today retains the draft's original date for the heading and logging inputs while dating current Pro-Fibre advice and vet historical classification against `localToday()` (`CX-D1`), with `dose since <date>` placed in the `<b>` heading (`CC-D3`).
  - Multi-date vet alerts stay bounded to `latest <date> · <N> dates` on Today (`CC-D1`) while Review displays every recorded date in full (`Historical · <dates>` when all dates precede `vetWindowDays`).
- **Accessible chart-value tables preserved:** Retains all five semantic `<table>` disclosures (`#chart-values-weight`, `#chart-values-weight-weekly-average`, `#chart-values-condition`, `#chart-values-condition-weekly-average`, `#chart-values-stool`).

## What did not change

- Firebase Authentication, Firebase SDK (`12.19.0`), `firebaseConfig`, Firestore collection paths and document shapes, `onSnapshot` listeners, and durable outbox ordering, sending, reconciliation, retries, and transactions.
- Pure calculations (`bowlFor`, `computeDarfAdjustment`, `fibreAdvice`, `vetItems`, `attributionFor`), historical meal snapshots, backup validation/import, erase confirmations, and CSV/Markdown/JSON export schemas.
- Service-worker caching and Firebase network exclusions (`sw.js`), bumped in lockstep with `index.html` (`data-version` and `APP_VERSION`) to `3.8.0`.
- Opening any screen, day summary, range filter, chart, or `<details>` disclosure creates **zero** recorded-data, outbox, or Firebase writes.

## Measurements (`v3.7.0` `6ebf489` vs `v3.8.0`)

Measured using the shared Firebase-stubbed synthetic fixture from `tests/draft-input.browser.cjs` in headless Chromium mobile emulation (`overflowX = 0 px` on every screen and viewport). Frozen PR #6 baseline (`9cc5743`) `index.html` size: `211,199` bytes.

| Metric | `v3.7.0` (`6ebf489`) | `v3.8.0` (Phase D) | Delta |
|---|---:|---:|---:|
| `index.html` size (LF bytes / lines) | 234,584 B / 3,597 | 244,550 B / 3,678 | +9,966 B (+4.2%) |
| Initial DOM elements (`Today` on boot) | 355 | 352 | −3 (−0.8%) |
| `Today` height (`390×844` / `375×667`) | 2,851 px / 2,851 px | 2,851 px / 2,851 px | 0 px / 0 px |
| `History` list DOM elements (14-day view vs old `Data`) | 553 | 370 | −183 (−33.1%) |
| `History` list height (`390×844` / `375×667`) | 3,928 px / 3,950 px | 4,301 px / 4,301 px | +373 px / +351 px (zero horizontal scroll) |
| Single-day editor (`day`) DOM / height (`390×844` / `375×667`) | 252 / 3,509 px / 3,595 px | 251 / 3,509 px / 3,594 px | −1 el / 0 px / −1 px |
| `Review` initial height (`390×844` / `375×667`) vs old `Status` | 2,745 px / 2,766 px (`Status` alone; +3,928 px `Data`) | 1,343 px / 1,343 px | −1,402 px (−51.1% vs `Status`; −79.9% vs `Status + Data`) |
| `Settings` DOM / height (`390×844` / `375×667`) | 202 / 4,150 px / 4,194 px | 199 / 4,150 px / 4,194 px | −3 els / 0 px |
| Forced render cost (`390×844`, 10-run mean) | 0.40–1.60 ms | 1.07–1.81 ms | Sub-2 ms across all destinations |
| Forced render cost (`375×667`, 10-run mean) | 0.43–1.57 ms | 0.40–1.56 ms | Sub-2 ms across all destinations |

## Automated checks

```text
node --test tests/*.test.cjs
node tests/draft-input.browser.cjs
node tests/navigation-drafts.browser.cjs
node tests/today-layout.browser.cjs
node tests/history-review.browser.cjs
```

- **Results:** 167 unit tests (`import-backup`, `restore-sync`, `sw-assets`, `ui-ergonomics`) and 64 browser scenarios (`21` in `draft-input`, `26` in `navigation-drafts`, `11` in `today-layout`, `6` in `history-review`) pass with **0 external requests** and **0 page errors**.
- **Phase D coverage (`tests/history-review.browser.cjs` + `tests/ui-ergonomics.test.cjs`):**
  - Viewports `375×667`, `390×844`, and `320×568`, light and dark themes, `forced-colors: active`, and `200%` root font scaling.
  - Empty, partially completed (`Missed` weight, unrecorded BCS, planned-only meal), completed, tomorrow-preview, offline, failed-save (`QuotaExceededError` on outbox), multi-year historical (`2025-12-30` → `2026-11-01`), and imported future-date (`2026-12-15` under `All`) records.
  - `≥44×44 px` tap targets on tab bar, diary summary cards, date jump, single-day navigation (`← All days`, prev/next, inline date picker), range chips, Review actions, and disclosures; `≥16 px` input text.
  - Legacy `v1` and `v2` local draft recovery from `'status'`, `'more'`, and `'day'`, plus zero outbox writes when opening screens, charts, range chips, or disclosures.

## Physical iPhone checks

**Status: Pending physical iPhone verification** (not yet performed on hardware for `3.8.0`). Note per `docs/today-layout-checks.md`: VoiceOver checks are not applicable to the owner's personal workflow unless desired, though accessible names, focus restoration, and chart-value tables are preserved and verified in automated browser checks.

1. **History stacked diary (`History`):** Scroll 14-day and `All` views on physical iPhone Safari and installed Home Screen web app; confirm comfortable reading, zero horizontal scroll, accurate preceding meal attribution, and `Meal details` → `Edit <date> meal` jump.
2. **List ↔ day editor navigation:** Open several dates from History cards and via `Choose date…` native iOS date picker; tap `← All days` and `History` in the bottom tab bar; confirm smooth focus/scroll behaviour and safe-area clearance above the 4-tab bar.
3. **Review disclosures & actions:** Open `Review`, inspect actionable alerts (confirming full dates with years), expand ration/Pro-Fibre explanations, `Trends & charts` (including chart-value tables), and `Food & recipe comparisons` across `14 / 28 / 56 / All` ranges.
4. **Draft preservation:** Leave an unsaved note on a historical date, navigate across `Today / History / Review / Settings`, confirm the `Unsaved changes` badge on that date's History card, and verify explicit `Save` and `Cancel`.
5. **Dynamic Type & themes:** Check light and dark themes and enlarged iOS Dynamic Type sizes across `History` and `Review`.

## Not in this change (deferred to Phase E after Phase D integration)

- Settings reorganization (`Account`, `Appearance`, `Feeding Plan`, `Backup/Export`, `Advanced`) and unified month + format export selector.
