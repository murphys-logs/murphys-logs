# Murphy’s Logs: Independent Code & Usability Review (Antigravity)

- **PR:** https://github.com/murphys-logs/murphys-logs/pull/1
- **Branch:** `claude/gracious-clarke-w8ubgx`
- **Reviewed commit:** `95a9cd7`
- **Reviewer:** Antigravity (using `AV-` finding IDs per `docs/review-handoff.md`)

Review of `index.html` and `sw.js` at commit `95a9cd7`. Conducted independently before cross-checking with `docs/ux-review.md` and `docs/review-codex.md`. No live Firebase sign-in or writes were performed, and no application files were modified.

---

## 1. Independent Findings

### AV-01 · P2 · Condition · BCS scale layout is staggered in an uneven zigzag on mobile portrait
- **Where:** `index.html:223-227` (at `95a9cd7`)
- **Now:** In portrait view on narrow screens (≤600 px), `.bcs-scale` is styled as an 8-column CSS grid (`grid-template-columns: repeat(8, minmax(0, 1fr))`). Buttons for scores 3, 4, 4.5, and 5 span 2 columns each, filling row 1. Row 2 holds the remaining three buttons (5.5, 6, 7), but button 5 (score 5.5) has `grid-column: 2 / span 2`. This indents row 2 by one column, producing an awkward diagonal zigzag alignment (3 sits over empty space, 4 sits over 5.5, 4.5 sits over 6, and 5 sits over 7). Additionally, the scale is purely numeric, lacking the visual silhouettes (overhead waist taper and abdominal tuck) recommended by the WSAVA standard.
- **Change:** Replace the staggered 8-column grid with a symmetric 7-column container or a clean 2-row layout with 4 buttons on row 1 (3, 4, 4.5, 5) and 3 centered buttons on row 2 (5.5, 6, 7) without column shearing. Consider adding compact canine silhouette icons above the numbers.
- **Done when:** On a 390×844 portrait screen, the BCS buttons form a clean, predictable grid where half-steps align logically without diagonal column offsets.

### AV-02 · P1 · Data safety · Erase data uses sequential unbatched deletes, risking partial erasure on network drop
- **Where:** `index.html:2724-2725` (at `95a9cd7`)
- **Now:** When the user confirms "Erase all log data", the handler iterates over `Object.keys(S.days)` and `S.changes` with sequential `await deleteDoc(doc(db, 'days', k))` and `deleteDoc(doc(db, 'changes', c.id))` calls. If Murphy has months of historical data, this requires hundreds of individual sequential network round-trips. If the network drops halfway through or rate-limits, the database is left in a corrupted half-erased state. The error message at line 2728 explicitly acknowledges: *"Some records may already have been erased."*
- **Change:** Import `writeBatch` from Firebase Firestore SDK (`index.html:543`). Execute deletions in atomic batches of up to 500 documents per `batch.commit()`. If an operation fails, the batch is rolled back atomically.
- **Done when:** The erase operation deletes documents in atomic Firestore batches rather than sequential one-by-one calls.

### AV-03 · P2 · Stools · Moving a stool to a previous date automatically navigates away from the Today screen
- **Where:** `index.html:2602` (at `95a9cd7`)
- **Now:** When adding or editing a stool on Today, if the user corrects the date to yesterday (e.g. for a late-night stool walked at 23:55) and taps Save, line 2602 runs `if(date!==originalDate&&!otherDrafts){S.cursor=date;S.tab='day';}`. This forcibly redirects the user away from the Today view to the History tab. If the owner was in the middle of their daily Today routine (e.g. preparing food or recording weight), their active workflow is interrupted.
- **Change:** When moving a stool to an earlier date from the Today tab, remain on Today and show a non-intrusive confirmation toast or banner: *"Stool saved for [date]. [View in History]"*.
- **Done when:** Correcting a stool date from Today persists the record to the target date while leaving the user on the Today tab.

### AV-04 · P2 · Usability · Daily completion check nags for a daily condition score, causing alert fatigue
- **Where:** `index.html:1439`, `1573`, `1854` (at `95a9cd7`)
- **Now:** In `missingFor(iso)`, line 1439 asserts `if (!Number.isFinite(d.bcs)) miss.push({k:'bcs', t:'no condition score'})`. This causes the "Still to log" note on Today and the "Incomplete" badge on History to report that condition score is missing every single day. Canine Body Condition Score is a visual assessment of fat coverage over ribs and spine that does not change daily; standard veterinary practice evaluates BCS weekly or fortnightly. Flagging it daily creates alert fatigue and obscures genuinely urgent daily gaps (like missing stools or unrecorded bowls).
- **Change:** Only treat BCS as missing if no condition score has been recorded in the past 7 days (`bcsMean(S.days, today, 7).n === 0`), or separate BCS into a "Weekly check" section rather than a mandatory daily item.
- **Done when:** A day without a condition score is marked "Complete" so long as a BCS was recorded earlier that week.

### AV-05 · P2 · Meal · "Tonight by recipe" portion preview is isolated on Status tab instead of Today's meal planner
- **Where:** `index.html:1908-1909`, `1572` (at `95a9cd7`)
- **Now:** The calculated breakdown of exact DARF grams for every protein ("Tonight by recipe", line 1908) is rendered exclusively at the very bottom of the Status tab. When standing in the kitchen on the Today tab deciding which recipe to feed or defrost, the owner cannot see the required DARF grams without selecting each recipe one-by-one in the dropdown.
- **Change:** Add an expandable disclosure ("Tonight's portions by recipe") inside the Evening Meal card on Today, or display the calculated DARF portion inline inside the `<select>` option labels (e.g. "Grass-Fed Lamb (123 g DARF)").
- **Done when:** On the Today tab, the owner can view tonight's DARF portion for all available recipes without navigating to the Status tab.

### AV-06 · P2 · Forms · Inconsistent saving paradigm between toggle chips and numeric inputs
- **Where:** `index.html:2534`, `2535`, `2744` (at `95a9cd7`)
- **Now:** Tapping a BCS button (`:2534`) or an Event chip (`:2535`) saves immediately to local storage and syncs to Firestore without secondary confirmation. In contrast, entering a walk duration, distance, treat count, or weight injects a secondary `Save` and `Cancel` button row (`:2744`). This creates an inconsistent interaction model where some UI elements persist instantly while others discard input unless an extra button is pressed.
- **Change:** Standardize on an auto-save model across all form inputs. Save numeric fields on blur or via a short debounce (with Enter key support as detailed in UX-03), providing a subtle "Saved" indicator, matching the direct feel of the BCS and event chips.
- **Done when:** Numeric and textual inputs persist consistently on blur/Enter without requiring a separate "Save" tap.

### AV-07 · P2 · Charts · Stool time plot uses 24-hour linear axis that crowds typical morning/evening walk times
- **Where:** `index.html:2068-2070` (at `95a9cd7`)
- **Now:** In `stoolChart`, the vertical position is computed as `py = minute => minute/1440 * 100`, spanning a full 24-hour vertical timeline. Because dogs usually defecate only during specific walk windows (e.g. 07:00–09:00 and 17:00–19:00), stools passed 10–15 minutes apart on the same walk overlap almost directly on top of each other, making mucus, blood rings, and Bristol shapes hard to distinguish.
- **Change:** Add a slight horizontal jitter/offset for stools occurring within 30 minutes of each other on the same date, or complement the scatter plot with a grouped timeline list organized by walk periods (Morning / Afternoon / Evening).
- **Done when:** Multiple stools logged during a single walk on the same day are visually separated and individually readable on the chart.

---

## 2. Cross-check with ux-review.md and docs/review-codex.md

Conducted after the independent findings above were written. Overlapping observations are credited to the earlier reviewer.

### Cross-check with ux-review.md

| ID | Verdict | Note |
|---|---|---|
| UX-01 | Agree | Today's viewport is consumed by the read-only summary; moving logging controls above the fold is critical for daily usability on mobile. |
| UX-02 | Agree | Stool logging is Murphy's primary daily touchpoint; removing the leading Date field and surfacing inline Edit/Delete directly removes friction on walks. |
| UX-03 | Agree | The injected Save/Cancel pattern is high-friction on mobile and silent loss on close is dangerous; auto-save on blur and Enter-to-save are essential. |
| UX-04 | Agree | Yesterday's bowl result is frequently logged the following morning; having a 1-tap bowl prompt at the top of Today avoids diving into History. |
| UX-05 | Agree | At feeding time, the prominent piece of information needed is the exact grams of DARF to weigh out; secondary switches should be compressed. |
| UX-06 | Agree | Sizing `.meal-column` to `calc(100vw - ...)` pushes all medical observations off-screen on phones; card layout below 600 px is the right fix. |
| BUG-01 | Agree | Confirmed. On the 1st of the month, `localToday().slice(0, 7)` targets the new month, rendering the "File the month on the 1st" instruction broken. Defaulting to previous month during the first 7 days solves this cleanly. |
| UX-07 | Agree | Target and weekly mean dashed lines are visually confusing; adding tap-to-inspect for points on touchscreens is required since `title` tooltips fail on mobile. |
| UX-08 | Agree | Collapsing heavy reference paragraphs into ⓘ disclosures will reduce page heights significantly without losing clinical guidance. |
| UX-09 | Agree | "History" (single past day) and "Data" (multi-day charts and log) are constantly conflated; renaming to "Day" and "Trends" clarifies the app hierarchy. |
| UX-10 | Agree | Hard-coded weight targets and read-only oil schedules limit flexibility; separating advanced calculation damping into a collapsed section keeps Settings tidy. |
| UX-11 | Agree | In-app dialogs should replace native browser `confirm()` and `prompt()` modals. |
| PWA-01 | Agree | Web manifest and PNG icons are needed for proper home screen installation on iOS and Android. |
| CODE-01 | Agree | Literal strings for target weight ("18.70 kg ±1%") are hardcoded across 5 templates; centralizing onto `WEIGHT_TARGET` prevents drift. |
| CODE-02 | Agree | Firestore security rules need verification since all client paths are top-level. |
| CODE-03 | Agree | Replacing the default GitHub profile README and removing stale `tests/` references improves repo maintainability. |
| CODE-04 | Agree | Modularity via native ES modules will make future feature PRs and automated testing safer without touching a monolithic 2,857-line file. |

### Cross-check with docs/review-codex.md

| ID | Verdict | Note |
|---|---|---|
| AG-01 | Agree | Reproducible: button activation replaces DOM nodes without re-focusing when elements lack stable IDs. |
| AG-02 | Agree | Confirmed in `fmtShort` (`:905`) and Data table (`:1990`). Discovered independently; dropped from AV list in favour of AG-02. |
| AG-03 | Agree | Confirmed in `weekContext` (`:1938-1940`). Unfed meal choices increment consumption statistics. Gating on `isFedMeal(m)` fixes this. |
| AG-04 | Agree | Transactional stool identity/location check is missing on remote recovery, allowing duplicate records if another device moved the stool. |
| AG-05 | Agree | Severe sync vulnerability: a conflicting move throws in `stoolMovePatches`, remaining permanently at the head of the outbox and wedging all later writes. |
| AG-06 | Agree | Replaying stale imports overlay the UI optimistically, and skipping the server write does not rebase the local client display. |
| AG-07 | Agree | Validator allows missing `id` on stool imports, producing empty `data-id` attributes that break subsequent Edit and Delete actions. |
| AG-08 | Agree | Setting `kcalPerGDarf` to 0 via JSON import bypasses editor bounds and causes divide-by-zero (`Infinity`/`NaN`) in `bowlFor`. |
| AG-09 | Agree | Using `Math.max` for `worstBristol` treats loose stool (Type 4) as worse than hard pellet constipation (Type 1), distorting CSV summaries. |
| AG-10 | Agree | `within()` checks only lower date bounds (`toDay(iso) > toDay(todayIso) - n`), erroneously including future-dated observations in rolling 7-day alert windows. |
| AG-11 | Agree | Stool Undo omits updating the day's `updatedAt`, causing subsequent backup imports to treat the restoration as superseded by the earlier deletion. |