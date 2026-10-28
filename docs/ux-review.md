# Murphy's Logs: usability and code review (v3.5.0)

Review of `index.html` and `sw.js` at commit `95a9cd7`. Written for people and for coding agents:
each finding has a stable ID, `file:line` anchors (valid at that commit), the current behaviour,
the suggested change and a "Done when" check. Nothing in the app was changed by this review.

## 1. What the app is

A private, offline-capable web app (installable to an iPhone home screen) for logging the health
and feeding of one dog, Murphy, and turning those logs into ration and supplement advice.
Sign-in is email and password through Firebase Auth (no sign-up). Data lives in Firestore.

Tabs (labels as shown; internal `S.tab` ids in brackets):

| Tab | Purpose |
|---|---|
| Today (`today`) | Log stools (time, Bristol 1–7, mucus, blood), walk minutes and km, yesterday's Tractive active minutes, pre-feed weight or "weight missed", body condition score (3–7 in half steps), treats, events, notes. Plan tonight's meal: choose a recipe and the app calculates DARF grams so the bowl hits the kcal target; press **Fed**, then record the bowl as cleared, left some or refused. |
| History (`day`) | The same day editor for any past date. Defaults to yesterday. |
| Status (`status`) | Vet alerts, weekly ration advice (Apply or Refuse), Pro-Fibre advice, weight and condition averages, cumulative ration offset, this week compared with last, tonight's DARF by recipe. |
| Data (`history`) | Weight, condition and stool charts; stool outcomes by recipe and by extra; a day-by-day table. Ranges 14, 28 or 56 days, or all. |
| Settings (`more`) | Account, theme, offline and update status, kcal and rule constants, Pro-Fibre dose, regime changes, adjustment log, CSV, Markdown and JSON export, JSON import, self-tests, vet guidance, erase. |

Advice logic in plain terms:

- **Bowl** (`bowlFor`, `index.html:651`): 500 g Bella & Duke at the recipe's kcal/100 g, plus salmon oil, egg and broth, plus DARF at 4.62 kcal/g to reach 1,240 kcal. A cumulative offset from applied ration changes is added. DARF has a 20 g floor.
- **Weekly ration rule** (`computeDarfAdjustment`, `index.html:711`):
  - Inputs and preconditions:
    - Compares mean weight for the last completed Monday–Sunday week with the week before.
    - Needs at least 5 weigh-ins in each week.
    - Fires at most once per week.
    - Suppressed if a regime change falls inside either week.
  - Calculation:
    - A change under 1% means hold.
    - Otherwise the step is an eighth of the full energy correction.
    - The step is capped at 15 g, and the cumulative offset at ±40 g.
    - A reduction is held when the 7-day mean BCS is at or below 5.
  - The user presses Apply or Refuse; either is logged in `changes`.
- **Stool attribution** (`attributionFor`, `trackingMeal`, `index.html:774`, `:1411`): each date's stools belong to the previous date's meal, but only if that meal was marked Fed.
- **Pro-Fibre** (`fibreAdvice`, `index.html:796`):
  - Step-up advice: after 7 clean days (every stool Bristol 3–4, with no mucus or blood; days with no stool pause the streak), advise +2.5 g, up to a 5 g ceiling.
  - Step-back advice: if loose stools follow a step-up within 14 days, advise returning to the previous dose.
  - At the ceiling: after 14 days at 5 g, 6 or more bad days in the last 14 raise a vet-review flag.
- **Vet items** (`vetItems`, `index.html:850`):
  - any blood ever recorded (never ages out)
  - a vacant episode or lethargy in the last 90 days
  - vomiting on 2 or more days in the last 7
  - Bristol 6–7 on consecutive days
  - the bowl refused twice in the last 7 days
  - weight down 2% or more fortnight on fortnight while every recorded bowl was cleared

## 2. Code map (`index.html` unless stated)

| Area | Location |
|---|---|
| CSS (tokens, light and dark themes, components) | 12–379 |
| Sign-in screen markup | 383–402 |
| App shell, date-picker dialog, tab bar markup | 404–431 |
| Service-worker client: registration, update and repair (classic script) | 433–537 |
| Firebase imports and config | 539–568 |
| Domain constants: `RECIPES`, `BRISTOL`, `BCS_STEPS`, `WEIGHT_TARGET`, `EVENTS`, `DEFAULTS` | 572–617 |
| Pure calculations | 619–880 |
| State `S`, London clock, date formatting | 883–905 |
| Local outbox, replay, Firestore sync (`write`, `sendOperation`, `flushWrites`, `saveDay`) | 915–1193 |
| Undo and device-only state | 1195–1249 |
| Firestore subscriptions (`subscribe`) | 1251–1291 |
| Derived data and caching | 1302–1444 |
| Render core (`render`, `renderFeedback`, `leaveDraft`) | 1446–1559 |
| Today view and shared day editor | 1561–1818 |
| History day view and date picker | 1821–1855 |
| Status view | 1857–1955 |
| Data view, charts, tables | 1957–2107 |
| Settings view | 2109–2168 |
| Export, import and backup validation | 2170–2323 |
| In-app self-tests (`selfTest`) | 2325–2421 |
| Event handlers (single delegated click handler, about 45 `data-act` actions) | 2423–2790 |
| Auth and boot | 2792–2855 |
| `sw.js` | Cache-first app shell plus pinned Firebase SDK modules; staged updates; recovery page |

## 3. Constraints for anyone changing the app

1. **Release identifiers must move together.** The three version strings are:
   - `index.html:2` (`data-version`)
   - `index.html:547` (`APP_VERSION`)
   - `sw.js:2` (`VERSION`)

   The worker serves the cached shell first (`sw.js:97-110`). It only installs a new release when the `sw.js` bytes change, and `validShell` (`sw.js:27-32`) rejects a shell whose `APP_VERSION` differs from the worker's `VERSION`. Any `index.html` change meant to reach installed users therefore needs all three bumped to the same new value.
2. **Precache list.** `sw.js:10` precaches only the shell and the three Firebase modules. Any new local file (a split-out module, a manifest, icons) must be added there, or offline opening breaks.
3. **No build step and no test runner.** Pure calculations are covered by `selfTest()` (`index.html:2326`), run from Settings → Checks → Run self-tests. The comment at `index.html:570` mentions a `tests/` folder, which does not exist. Calculation changes must keep every self-test passing.
4. **Draft protection.**
   - `render()` defers a full re-render while any `#main [data-dirty]` or `#main [data-stool]` exists (`index.html:1532`).
   - `leaveDraft()` (`index.html:1555`) guards navigation.
   - Restructured forms must keep these markers, or unsaved input will be overwritten.
5. **All writes go through `write()`** (`index.html:1042`): a localStorage outbox, then `flushWrites()`. UI code should not call Firestore directly.
6. **Dates are Europe/London calendar labels** (`londonNow`, `index.html:892`). Use `toDay`, `toIso` and `shiftDate`, not millisecond arithmetic.
7. **Keep the accessibility work.** Existing patterns:
   - `aria-pressed` on choice buttons
   - `role="switch"` on toggles
   - the three live regions at `index.html:411-413`
   - 44 px minimum tap targets
   - forced-colours and reduced-motion styles

   New controls should follow the same patterns.

## 4. Verifying UI changes without the real backend

The screenshots behind this review used fake data:

- Served `index.html` from `http://localhost`. A secure context is needed for `crypto.randomUUID`.
- Blocked service workers.
- Intercepted `https://www.gstatic.com/firebasejs/12.19.0/firebase-{app,auth,firestore}.js` with stub modules exporting the names imported at `index.html:540-545`:
  - `onAuthStateChanged` calls back with a fake `{uid, email}`.
  - For a collection, `onSnapshot` calls back with `{docs:[{id, data()}], docChanges:()=>[...], metadata:{fromCache:false}}`.
  - For `settings/main`, it calls back with `{exists:()=>true, data:()=>({}), metadata:{fromCache:false}}`.
  - `runTransaction` runs its callback against a `tx` whose `get` returns a missing document.

Page heights measured at 390×844 with 52 days of sample data:

| Page | Height |
|---|---|
| Today | 4,312 px |
| History | 3,597 px |
| Status | 2,905 px |
| Data (14 days) | 5,660 px |
| Settings | about 4,100 px |

## 5. Findings index

Priority: P1 has the most day-to-day impact; P3 is polish.

| ID | P | Area | Summary |
|---|---|---|---|
| [UX-01](#ux-01) | P1 | Today | The first screen is read-only; logging controls start about 1,000 px down |
| [UX-02](#ux-02) | P1 | Stools | Entry form leads with a rarely needed date field; edit and delete are hidden |
| [UX-03](#ux-03) | P1 | Forms | Every number needs a separate Save tap; Enter does nothing; unsaved input is lost on close |
| [UX-06](#ux-06) | P1 | Data | On phones the daily table shows only date and meal; every reading is off-screen |
| [BUG-01](#bug-01) | P1 | Export | "Export this month" on the 1st exports only that day, yet the copy says to file the month on the 1st |
| [UX-04](#ux-04) | P2 | Today | Last night's bowl result is hard to reach |
| [UX-05](#ux-05) | P2 | Meal | The DARF grams needed at feeding time are not prominent; switches are verbose |
| [UX-07](#ux-07) | P2 | Charts | Target and weekly-average lines look alike; no tap-for-value; long legends |
| [UX-08](#ux-08) | P2 | Copy | Heavy explanatory text on every screen |
| [UX-10](#ux-10) | P2 | Settings | Rule internals mixed with everyday settings; oil schedule and weight target not editable |
| [PWA-01](#pwa-01) | P2 | Install | No web app manifest; the iOS touch icon is an SVG |
| [CODE-01](#code-01) | P2 | Code | Weight-target text is hard-coded in 5 places, separately from `WEIGHT_TARGET` |
| [UX-09](#ux-09) | P3 | Navigation | "History" and "Data" are easily confused; choosing a date takes three steps |
| [UX-11](#ux-11) | P3 | Polish | Native confirm and prompt dialogs, no password reset, unexplained Status dot, phone tab bar on desktop |
| [CODE-02](#code-02) | P3 | Data | All accounts share one log; access depends on Firestore rules that are not in the repo |
| [CODE-03](#code-03) | P3 | Repo | README is the profile template; commit messages are generic; stale `tests/` reference |
| [CODE-04](#code-04) | P3 | Code | Single 2,857-line file |

## 6. Findings

<a id="ux-01"></a>
### UX-01 · P1 · Today screen puts logging below the fold

- **Where:**
  - `viewToday`, `index.html:1562-1574`
  - `weightConditionSummary` and `weightConditionContent`, `index.html:1370-1387`
  - `weightHintContent`, `index.html:1696-1707`
- **Now:**
  - At 390×844 the whole first viewport is the read-only "Weight & condition" card. The first input ("+ Add stool") is about 1,000 px down.
  - The "Still to log" note, the most actionable item, is rendered last (`index.html:1573`).
  - The target range text and the 7-day mean appear in both the summary card and the Weight card.
- **Change:**
  - Render "Still to log" first.
  - On Today, replace the summary card with a one-line strip (for example "18.86 kg · within range · BCS 5.0, 3 days ago") linking to Status. Keep the full card on Status.
  - Show the target range and 7-day mean once.
- **Done when:**
  - At 390×844 the first viewport shows the still-to-log list and the add-stool control.
  - The target range text appears at most once on Today.
  - `#weight-announcement` still announces the latest weight. `refreshWeightConditionViews`, at `index.html:1388`, reads `[data-weight-summary]` elements.

<a id="ux-02"></a>
### UX-02 · P1 · Stool entry is slower than it needs to be

- **Where:**
  - Form: `stoolsCard`, `index.html:1742-1749`
  - Handlers: `index.html:2562-2610`
  - Actions disclosure: `index.html:1738`
- **Now:**
  - Field order is Date, Time, Bristol buttons, mucus and blood, then Save or Cancel.
  - The date defaults to the card's date and the time to now; focus lands on the time field.
  - Edit and Delete sit inside a collapsed "Actions" disclosure.
- **Change:**
  - Order the form Bristol, flags, time, Save.
  - Put the date behind a "Different date?" link.
  - Show Edit and Delete inline.
  - Optional: tapping a Bristol type saves immediately with time = now, with Undo through the existing `removeWithUndo` flow.
- **Done when:**
  - Logging a stool for now takes Add, then a type, then Save, with no date field in the way.
  - Moving a stool to another date (`moveStool`, `index.html:1163`) still works.

<a id="ux-03"></a>
### UX-03 · P1 · Number fields: explicit Save, Enter does nothing, silent loss on close

- **Where:**
  - The `input` listener that injects Save and Cancel: `index.html:2738-2751`
  - `confirmInput`: `index.html:2460`
  - The only keydown handler is the password field's, at `index.html:2820`
  - There is no `beforeunload` or `pagehide` handler
- **Now:**
  - Typing reveals Save and Cancel buttons.
  - The keyboard's Return or Done key does nothing.
  - Switching tabs prompts through `confirm()` (`index.html:1557`).
  - Closing or backgrounding the app discards the draft without warning.
- **Change:**
  - Enter in a `[data-form]` `<input>` (not `<textarea>`) calls `confirmInput`.
  - Add a `beforeunload` warning while drafts exist.
  - Consider saving on blur, with a brief "Saved" confirmation.
- **Done when:**
  - Typing a weight and pressing Enter saves it.
  - Reloading with a dirty field prompts.
  - Existing validation still runs: the settings range and step check, and the over-5% weight confirmation at `index.html:2472-2475`.

<a id="ux-04"></a>
### UX-04 · P2 · Last night's bowl result is hard to reach

- **Where:**
  - The collapsed previous-meal editor nested in the Stools card: `index.html:1617` and `:1750`
  - `missingFor` bowl item: `index.html:1441`
  - The jump that opens History: `index.html:2514-2516`
- **Now:** Yesterday's bowl is set either inside a collapsed "Last night's meal" disclosure in the Stools card, or by leaving Today for History.
- **Change:**
  - When yesterday's meal is Fed and has no bowl result, show a prompt at the top of Today with three buttons: `data-act="bowl" data-date="<yesterday>"`.
  - The existing handler (`index.html:2658-2661`) already accepts any date that isn't today.
- **Done when:** One tap on Today records yesterday's bowl, and the prompt then disappears.

<a id="ux-05"></a>
### UX-05 · P2 · Evening meal card is not built for feeding time

- **Where:**
  - `mealEditor`: `index.html:1670-1691`
  - `mealPlanDetails`: `index.html:1764-1788`
  - `mealFlags`: `index.html:1646-1649`
- **Now:**
  - The DARF amount ("DARF Active **148 g**") is one row among the regime line, "Last six", scheduled amounts and the calculation line.
  - Below those come four switch rows, each with two-line detail, then a paragraph, the Fed button and the bowl buttons.
- **Change:**
  - Lead with the recipe, the DARF grams in large type, and Fed.
  - Compress the four switches into a compact toggle row.
  - Move the calculation breakdown, regime and "Last six" into a Details disclosure.
- **Done when:** At 390 px wide, the recipe, DARF grams and Fed button fit in one viewport.

<a id="ux-06"></a>
### UX-06 · P1 · Data tab daily table is unreadable on phones

- **Where:**
  - `viewHistory`: `index.html:1958-2010`
  - Table CSS: `index.html:296-323`. The `max-width:600px` rule at `:318-319` sizes `.meal-column` to the full viewport width minus the date column.
  - `foodTable`: `index.html:2098-2107`
- **Now:**
  - At 600 px or narrower, only "Date" and "Last night's meal" are visible.
  - Bristol, weight, condition, DARF, bowl and events need a sideways scroll on every row.
  - The by-recipe table also overflows.
- **Change:**
  - At 600 px or narrower, render each day as a compact row or card: date · recipe · Bristol range (count) · weight and status · BCS · bowl · flags.
  - Keep the table for wider screens.
  - Consider putting daily records above the charts, or adding a Charts/Table toggle.
- **Done when:**
  - At 390 px every daily field is visible without horizontal scrolling.
  - The `data-act="openday"` links still work.

<a id="bug-01"></a>
### BUG-01 · P1 · Month export on the 1st exports the wrong month

- **Where:**
  - `exportMonthCsv`: `index.html:2187-2205`
  - `exportMonthMd`: `index.html:2206-2238`
  - Settings copy: `index.html:2160`
- **Now:**
  - Both exports use `localToday().slice(0,7)`, the current month.
  - Settings tells the user to "File the month in the project on the 1st".
  - On the 1st, the export therefore contains only that day.
  - Separately, the CSV export starts two downloads 400 ms apart (`index.html:2204`); iOS Safari may block or prompt for the second.
- **Change:**
  - Add a month selector that defaults to the previous month during the first week of a month, or always offer a "Last month" option.
  - Consider bundling the two CSVs into one download, or giving each its own button.
- **Done when:** On 2026-11-01 the default export covers 2026-10.

<a id="ux-07"></a>
### UX-07 · P2 · Charts are hard to read

- **Where:** `lineChart`, `index.html:2032-2062`; chart CSS, `index.html:261-285`.
- **Now:**
  - The target line (dashed, accent colour, `:2050`) and the weekly mean (dashed, `--ink-3`, `:2053`) look alike.
  - The y-axis labels are max, midpoint and min (`:2048`). The midpoint (for example 18.72) looks like the target but isn't.
  - Point values exist only in `title` attributes (`:2055`), so they can't be read on touch devices.
  - The legend is a paragraph (`:2060`).
- **Change:**
  - Give the target a distinct style and label it on the axis.
  - Let a tap on a point show its date and value.
  - Shorten the legend to keyed items.
- **Done when:** The target and weekly mean can be told apart at a glance, and a touch user can read any single point's value.

<a id="ux-08"></a>
### UX-08 · P2 · Too much explanatory copy

- **Where (examples):**
  - Activity help: `index.html:1611-1613`
  - Meal-switch paragraph: `:1648`
  - Status condition note: `:1918`
  - Chart legends: `:2058-2060`
  - `weekContext` footnote: `:1954`
- **Change:** Keep one short line per control. Put the longer explanation behind an ⓘ `<details>` toggle.
- **Done when:** Today and History pages are noticeably shorter (see the heights in §4), with no loss of information.

<a id="ux-09"></a>
### UX-09 · P3 · Navigation naming and date picking

- **Where:**
  - Tab markup: `index.html:424-430`
  - Date picker: `openHistoryPicker`, `index.html:1839-1846`, with its dialog at `:414-423`
- **Now:**
  - The tab labelled "History" edits a single day; the one labelled "Data" shows trends.
  - The internal ids are swapped relative to the labels (`day` is labelled History, `history` is labelled Data).
  - Choosing a date takes three steps: a button, then a dialog, then the native picker and "Show day".
- **Change:**
  - Relabel to something like **Day** and **Trends**.
  - Replace the button and dialog with an inline `<input type="date">` in the date bar.
  - If renaming the internal ids, update every `S.tab` comparison, for example at `:1398-1402`, `:1497-1503`, `:1535`, `:1544-1545` and `:1718`.
- **Done when:** Each label describes its screen, and a date can be chosen in one step.

<a id="ux-10"></a>
### UX-10 · P2 · Settings organisation and missing controls

- **Where:**
  - `viewMore`: `index.html:2115-2168`
  - `settingsSpec`: `:1580-1593`
  - Oil schedule display: `:2117`, `:2137`
  - Fibre chips: `:2140`
  - `WEIGHT_TARGET`: `:598`
- **Now:**
  - Weekly-rule internals (adjustment fraction, tissue energy, deadband) and "Run self-tests" sit at the same level as everyday settings.
  - The **oil schedule** is displayed but has no write path anywhere; it comes only from `DEFAULTS` at `:614`.
  - The **weight target** is a hard-coded constant.
  - Some copy assumes outside context: "the ceiling the audit set" (`:2690`) and "File the month in the project on the 1st" (`:2160`).
- **Change:**
  - Add a collapsed **Advanced** section for the rule constants and self-tests.
  - Add an oil-schedule entry control, mirroring the `setfibre` handler at `:2688-2691`.
  - Make the weight target a setting (see CODE-01).
  - Separate the danger zone (erase).
  - Rewrite the context-dependent copy.
- **Done when:**
  - The oil dose and the weight target can be changed in the app.
  - Everyday settings fit on the first screen of Settings.

<a id="ux-11"></a>
### UX-11 · P3 · Polish

- **Native dialogs:** `confirm()` and `prompt()` are used at `index.html:1557`, `:2474`, `:2690`, `:2695`, `:2702` and `:2712-2713`. Replace them with in-app dialogs that follow the existing `<dialog>` pattern at `:414-423`.
- **Sign-in:**
  - There is no password reset; `sendPasswordResetEmail` is available in the imported auth module.
  - There is no show-password toggle.
  - Enter submits only from the password field (`:2820`).
- **Status tab dot:** The dot (`:427`, toggled at `:1529-1530`) doesn't say why it's there. Use a count badge with an accessible label.
- **Desktop navigation:** On wide screens the phone tab bar floats at the bottom (CSS `:356-364`). Consider side or top navigation at 64rem and wider.

<a id="pwa-01"></a>
### PWA-01 · P2 · Install metadata

- **Where:** `index.html:5-11`.
- **Now:**
  - There is no `<link rel="manifest">`, so Android and desktop Chrome cannot install the app properly.
  - The `apple-touch-icon` is an SVG data URI. iOS expects a PNG, so it will probably use a page snapshot as the home-screen icon instead.
- **Change:**
  - Add `manifest.webmanifest` and PNG icons at 180, 192 and 512 px.
  - Add them to the precache list at `sw.js:10` and bump all three versions (§3.1).
- **Done when:** Chrome reports the app as installable, and the iOS home-screen icon is the paw.

<a id="code-01"></a>
### CODE-01 · P2 · Weight target duplicated as literal text

- **Where:** `WEIGHT_TARGET` at `index.html:598`. The literals "18.70 kg ±1%" and "18.513–18.887" also appear at:
  - `:1374`
  - `:1586`
  - `:1703`
  - `:2003`
  - `:2058`
- **Change:** Derive every displayed string from `WEIGHT_TARGET`, or from the setting once UX-10 lands.
- **Done when:** Searching `index.html` for `18.70` or `18.513` finds only the constant.

<a id="code-02"></a>
### CODE-02 · P3 · One shared log for every account

- **Where:** Firestore paths are top-level:
  - `collection(db,'days')`: `index.html:1267`
  - `collection(db,'changes')`: `:1274`
  - `doc(db,'settings','main')`: `:1279`
  - Writes: `:1059`, `:1081`, `:1088`, `:1096`, `:2724-2725`
- **Now:**
  - Every signed-in account reads and writes the same log.
  - The local outbox is per-user (`:916-919`), but the remote data is not.
  - Who can see the data depends entirely on Firestore security rules, which are not in this repo. The client API key in `:549-556` is normal for Firebase and is not a secret.
- **Change:**
  - Confirm the rules allow only the intended accounts.
  - Optionally commit `firestore.rules` so the policy is reviewable.
- **Done when:** The rules are verified, or committed and reviewed.

<a id="code-03"></a>
### CODE-03 · P3 · Repository hygiene

- `README.md` is GitHub's profile-README template. Because the repo is `murphys-logs/murphys-logs`, it renders on the account profile. Replace it with a description of the app and the release steps in §3.
- Every commit is titled "Add files via upload". Descriptive messages would make history useful to future agents.
- The comment at `index.html:570` points to a `tests/` folder that does not exist. Either add the folder or change the comment to point at `selfTest`.

<a id="code-04"></a>
### CODE-04 · P3 · Single 2,857-line file

- **Now:** All CSS, markup, calculations, sync, views and about 45 `data-act` actions (one delegated handler, `index.html:2484-2736`) live in `index.html`.
- **Change (optional):**
  - Split into native ES modules (calculations, store and sync, views, handlers). No build step is needed.
  - Respect §3.2: every new file goes into the `sw.js` precache.
  - Move the self-tests into a module that can also run under Node.
- **Done when:** The pure calculations can be tested outside the browser, and view changes no longer touch a 2,800-line file.

## 7. Strengths to preserve

- **Offline-first saving:** entries are saved locally first and synced with ordered replay, cross-tab coordination (Web Locks and `storage` events) and guarded restore operations.
- **Undo:** deletions keep a recovery copy on the device.
- **Draft protection:** unsaved forms survive syncs, midnight and app updates.
- **Staged updates:** a new version installs only when the user chooses "Update app", never while a form is unfinished.
- **Accessibility:** live regions, focus management, 44 px targets, forced-colours support and reduced motion.
- **Read-only history:** fed meals are immutable snapshots, and viewing history never writes data.
