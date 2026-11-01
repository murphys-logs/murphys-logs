**Murphy’s Logs should keep its core functionality, but present a much smaller daily interface.** Its strongest features are quick stool logging, the evening-meal calculator, reliable record keeping and useful historical context. The biggest usability problem is that routine actions compete with long explanations, repeated summaries and advanced controls.

I reviewed the current default-branch code at [commit `9cc5743`](https://github.com/murphys-logs/murphys-logs/tree/9cc5743da1e95f7b48f8c8f3f57e4557c515a603), app version **3.6.0**, including the application, service worker, manifest and five test files. I also inspected all five screens using synthetic records at an iPhone-sized viewport. **143 automated tests and 14 browser scenarios passed.** Application code and Firebase were left unchanged.

This was not a physical-iPhone test or an inspection of production Firebase data or deployed security rules.

The app’s exact purpose is to maintain **Murphy’s daily feeding and health-observation diary**, calculate his evening bowl, and draw attention to patterns according to its programmed rules.

It currently provides:

| Area | What it actually does |
|---|---|
| **Stools** | Records multiple stools per day: Bristol type 1–7, time, date, mucus and blood. Supports editing, moving between dates, deletion and Undo. |
| **Weight and condition** | Records pre-feed weight, a reversible “Weight missed” marker, and condition scores of 3, 4, 4.5, 5, 5.5, 6 or 7. Shows descriptions, averages and comparisons with the configured monitoring criteria. |
| **Activity and observations** | Records walk minutes, kilometres, active minutes, dried necks/feet, symptoms and notes. On Today, **Tractive active minutes belong to yesterday**; walk measurements belong to today. There is no automatic Tractive integration. |
| **Evening meal** | Calculates Bella & Duke, DARF and supplement amounts from the selected recipe, energy settings and accumulated ration adjustments. Tracks egg, broth, fibre and oil. “Fed” records feeding time and actual DARF, initially using the planned amount. |
| **Bowl result** | Records Cleared, Left some or Refused. Today can collect the previous evening’s result directly. |
| **Meal/stool relationship** | Groups every stool with the **confirmed meal from the preceding calendar date**. This is a fixed tracking convention; it does not infer which meal caused a stool. |
| **History** | Opens an editable daily record, initially yesterday, with date selection and previous/next controls. |
| **Status** | Shows weight/condition summaries, vet items, weekly ration advice, fibre advice, adjustments, weekly context and amounts for every recipe. |
| **Data** | Shows weight, condition and stool charts; comparisons by recipe and extra; and a detailed daily-record table. |
| **Settings and recovery** | Provides appearance, feeding/rule settings, supplement histories, regime markers, adjustment history, exports, backup import, diagnostics, app-update checks, sign-out and complete log erasure. |

These functions are implemented in the [screen and interaction code](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L1745-L2402).

A few important details distinguish it from a simple diary:

- **Meal calculation:** defaults are 1,240 kcal daily, 500 g Bella & Duke and 4.62 kcal per gram of DARF. Seven recipes have different calorie values. Egg and broth contribute fixed calories; oil follows its schedule and defaults off for salmon. Remaining calories determine DARF, with the accumulated adjustment applied.
- **Weekly ration advice:** compares two completed weeks before the current Monday. Defaults require five weigh-ins per week, use a 1% change threshold, and limit individual adjustments to 15 g and the accumulated adjustment to 40 g. Condition and recorded regime changes can prevent an adjustment. Applying or refusing advice records a decision; refusing prevents reconsideration until next Monday.
- **Fibre advice:** counts qualifying stool-observation days, pauses on days without stools recorded, and resets after abnormal observations. It can suggest an increase, a return to the preceding dose, or review.
- **Vet items:** use specific recorded patterns, including blood, vacant episodes, lethargy, repeated vomiting or bowl refusal, consecutive very loose-stool days and weight-loss context. **Blood records never age out.**
- **Historical meals:** preserve saved quantities and calorie estimates. Correcting a historical ingredient or quantity does not automatically rebuild the original calorie calculation.
- **Activity and treats:** provide context; they do not feed into the weekly ration recommendation.

Those are descriptions of the [existing programmed calculations](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L592-L903), not a clinical validation of them.

**The improvements I would prioritise are these, in order:**

1. **Fix the misleading “saved” message.**

   I reproduced a genuine problem: after a device-storage failure, dismissing the error changes the header from **“Not saved” to “Saved on this device”**, even though no record or queued write exists.

   Closing an explanation must leave the failed entry visibly marked **Not saved** until saving succeeds or the user cancels. This is the first change I would make. [Source](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L2885-L2887)

2. **Make Today a short daily workspace.**

   Today currently runs through stools, activity, weight, condition, evening meal, treats, events and notes. In the synthetic 390 × 844 preview, the evening meal began **more than 2,000 pixels down the page**.

   Keep these immediately accessible:

   - Stool type buttons, preserving the current type → Save flow.
   - Weight entry, with condition alongside it.
   - Tonight’s meal, its quantities and **Mark as fed**.
   - Last night’s bowl result when unanswered.

   Put activity, treats and notes into compact expandable sections. Keep a clear **Add observation** route for symptoms. Completed sections should show a short summary instead of continuing to occupy the space of a full form.

   “Still to log” should also show the meal’s state. “Complete” currently means only a subset of observations is present, so more precise wording would be better.

3. **Allow navigation without discarding drafts.**

   Drafts already survive interruptions, yet switching tabs—or starting a stool while another entry is unfinished—can require **discard or stay**.

   Let someone begin a note, record a stool, check History and return to the note. Preserve drafts locally by date and field, retaining explicit Save and Cancel. This builds on the existing draft system without changing Firebase. [Current navigation guard](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L1738-L1743)

4. **Give the meal one clear primary action.**

   The meal card currently contains quantities, four large switches, explanation, feeding controls, corrections and bowl controls.

   Its normal appearance should be something like:

   > **Tonight: Fish**  
   > DARF 160 g · Bella & Duke 500 g  
   > Oil 4 ml · Fibre 2.5 g  
   > **Mark as fed** · Change meal

   Open ingredient switches and detailed corrections through **Change meal**. After feeding, show “Fed at 18:30” and the bowl result; put Undo Fed and quantity corrections under Edit.

   Use short recipe names. For historical supplement entries with unknown inclusion, offer **Given / Not given** directly. The current instruction to turn a switch on and then off to record “not given” is unnecessary friction.

5. **Turn History into a readable phone diary.**

   The detailed table is eight columns wide. In the mobile preview, it measured approximately **791 pixels inside a 348-pixel viewing area**. Seeing the meal, stool, weight and bowl together requires sideways scrolling.

   Use stacked daily summaries on iPhone:

   > **31 October**  
   > 2 stools · Types 3–4  
   > Weight 18.7 kg · Condition 5  
   > Previous evening: Lamb · Bowl cleared

   Tapping the summary opens the existing daily editor. Keep the wide table for larger screens or an optional detailed view. [Current table](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L2215-L2241)

6. **Separate current attention from historical information.**

   A blood record from months ago can produce a prominent warning every time Today opens. Preserve that record and the existing rule, but show its date and identify it as historical.

   Within Status, actionable items should appear before the large weight-and-condition summary. Keep the explanation available beneath each result rather than showing all calculation detail immediately.

   Clearer labels would help:

   | Current wording | Suggested wording |
   |---|---|
   | Fed | Mark as fed |
   | Refuse | Keep current ration this week |
   | Corrective offset | Current DARF adjustment |
   | Regime change | Diet or routine changed |
   | Saved calorie figure after historical corrections | Original calculated estimate |
   | Check app files | Check offline access |

7. **Simplify the navigation and Settings structure.**

   I recommend four destinations:

   | Destination | Main job |
   |---|---|
   | **Today** | Record observations and feed Murphy. |
   | **History** | Find and correct a day. |
   | **Review** | See attention items, current advice and optional trends/comparisons. |
   | **Settings** | Manage the feeding plan, account, appearance and backups. |

   This combines Status and Data into Review while putting daily records in History. Charts and food comparisons can be selectable views within Review.

   Settings should show a short list of groups, with detailed rule parameters under **Advanced**. At present, twelve numerical settings, schedules, exports, diagnostic tools, vet information and erasure share one long page.

8. **Make backup and export understandable.**

   Replace four monthly-export buttons with a month choice, a format choice and one Export action. Keep **Full backup** separate.

   CSV currently downloads **two files**, with the second triggered after a delay. Name both outputs clearly and verify saving them on a real iPhone.

   Import should show a preview before applying the existing merge: dates covered, records accepted and records skipped. Explain that it **keeps newer records and existing settings**; it does not replace the whole log. Preserve the current validation and server rechecking. [Export and import implementation](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/index.html#L2405-L2573)

For the question of whether every function deserves to remain, my assessment is:

| Function | Recommendation |
|---|---|
| Stool entry, mucus/blood and date/time editing | **Keep prominent.** Central to the app. |
| Stool edit, delete and Undo | **Keep.** Preserve easy correction and recovery. |
| Weight and missed measurement | **Keep prominent.** Make the missed option more compact. |
| Body-condition scoring and descriptions | **Keep alongside weight.** Preserve the current scoring routine. |
| Meal calculator and feeding confirmation | **Keep prominent.** One of the app’s most valuable functions. |
| Recipe selection and recent recipes | **Keep.** Shorten names; show recent choices within meal editing. |
| Egg, broth, fibre and oil controls | **Keep under Change meal.** Summarise their current state on the main card. |
| Automatic oil choice | **Keep.** Add an obvious way to restore the recipe default after a manual override. |
| Actual quantities and historical corrections | **Keep under Edit meal.** Clearly label retained calorie estimates. |
| Bowl outcome | **Keep readily accessible when relevant.** |
| Walk minutes, distance and active minutes | **Keep as optional context.** Group them, with yesterday’s date beside Tractive. |
| Treat count | **Keep optional.** It does not need its own permanently expanded card. |
| Symptoms and notes | **Keep.** Make entry easy and protect unfinished text. |
| Weekly ration advice and decision history | **Keep in Review.** Result first; explanation and limits expandable. |
| Fibre advice, streak and postponement | **Keep.** Compress the presentation. |
| Vet items and guidance | **Keep.** Distinguish dated history from current attention. |
| Weight chart | **Keep as the principal trend chart.** |
| Condition and stool-time charts | **Keep as secondary views.** Avoid making users scroll past them to find records. |
| Recipe and extra comparisons | **Keep optional.** Emphasise counts and observations over mean Bristol score: types 1 and 7 average to 4, concealing the extremes. |
| Range filters | **Keep.** The existing choices are simple. |
| Repeated weight/condition summaries | **Consolidate.** Show detail once, with concise summaries elsewhere. |
| “Tonight by recipe” list | **Move into meal selection.** It duplicates the calculator’s purpose. |
| Decorative adjustment gauge | **Remove from the normal view.** Keep the numerical adjustment and its history. |
| Advanced rule parameters and schedule history | **Keep under Advanced settings.** |
| Light/dark/system appearance | **Keep.** Useful and inexpensive. |
| Sync, offline access, retry and update recovery | **Keep.** Quiet when healthy; clear when action is needed. |
| Draft recovery | **Keep and extend across navigation.** |
| CSV, Markdown, JSON backup and import | **Keep all capabilities.** Consolidate the controls. |
| Run self-tests and diagnostic output | **Move out of everyday UI.** Retain for maintenance. |
| Erase all log data | **Keep only under advanced data management.** Retain its confirmations. |
| Sign-out | **Keep under Account.** Explain pending local-only saves before leaving. |

The existing iPhone foundations are worth preserving: system fonts, large tap targets, native pickers, light/dark support, safe-area handling, inline validation, accessible chart values, quick stool entry and explicit saving. The app does not need a new framework or extra runtime dependencies to make these changes.

Firebase should remain exactly as it is: the existing authentication, `days`, `changes` and `settings/main` paths, subscriptions, local outbox, reconciliation, backup rules and historical meal snapshots. The [service worker’s separation between app-file caching and Firebase traffic](https://github.com/murphys-logs/murphys-logs/blob/9cc5743da1e95f7b48f8c8f3f57e4557c515a603/sw.js) should also remain.

Before releasing UI changes, test them on a physical iPhone for keyboard visibility, large text, VoiceOver, native pickers, force-close/reopen recovery, offline opening and both CSV downloads. The automated checks provide useful evidence, but do not establish those native behaviours.
