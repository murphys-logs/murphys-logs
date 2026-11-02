# Shorter Today and tonight's meal card

Release 3.7.0. This change covers items 2 and 4 of [the iPhone usability review](iphone-usability-review-2026-11-01.md), on the Today screen only.

## What changed on Today

The new order is:

1. Still to log
2. Weight & condition assessment (read-only, folded)
3. Stools
4. Weigh-in & condition
5. Tonight's meal
6. Activity, Treats, Observations and Notes, each closed

- **Tonight's meal:** The DARF amount, Bella & Duke, salmon oil and Pro-Fibre (plus egg or broth when included) sit directly above **Mark as fed**.
  - The recipe picker, ingredient switches, regime and calculation details are under **Change meal**.
  - Change meal starts open when no recipe is chosen.
- **After feeding:** The card shows the saved snapshot, "Fed at HH:MM" and the bowl result.
  - **Edit meal** holds the recipe correction, grams actually fed, switches, supplement corrections and **Undo Fed**.
  - Focus moves to the fed time after Mark as fed, and back to Mark as fed after Undo Fed.
  - Mark as fed keeps an actual DARF amount already saved for an unfed meal (for example after Undo Fed). When that amount differs from the plan, a notice beside the button states it, with **Record the plan instead** (CX-01).
  - The fed summary keeps unknown supplement inclusion visible. A quantity is shown plainly only when inclusion is confirmed; otherwise it is qualified as "originally recorded" (CX-02).
  - A fibre or oil schedule change in the past week is cautioned beside the amounts, not inside Change meal (AGY-02).
- **Weigh-in & condition:** Weight entry, Weight missed and the condition score are in one card.
  - The hint under the weight shows only the saved reading's status and the unusual-change warning. The target, range and means are in the assessment above.
- **Closed sections:** Each summary line shows what is recorded, for example "Walked 40 min · 3.2 km · Tractive 31 Oct: 55 min". Tractive minutes stay attached to yesterday.
  - A restored draft opens its section. A section the user opened stays open across saves.
  - Summaries update while another entry is unfinished. Recorded symptoms are highlighted in the Observations summary, in bold as well as the warning colour so they stay distinct under forced colours (AGY-06, AGY-07), and each summary is separated from its title by a word space for screen readers (AGY-05).
- **Still to log** now includes the evening meal's state ("tonight's recipe not chosen" or "tonight's meal not fed yet"). That shortcut lands on the meal card, so the amounts show above the button.
  - It also refreshes while another entry is unfinished (CX-03). Its shortcuts have stable IDs, so a refresh keeps focus on a surviving shortcut, or moves it to the card when that shortcut disappears (CX-04).
  - `missingFor()` is unchanged, so History's completeness rule is unchanged.
- **Wording:**
  - History's note now says "Not yet recorded" or "Core observations recorded" instead of "Incomplete" or "Complete".
  - History's explicit feeding button reads "Mark as fed".

## What did not change

- History's day editor, apart from the two wording changes above.
- A recovered earlier day on Today keeps the full editor with its explicit feeding time.
- Calculations, Firebase document shapes, write paths, the outbox, the draft store and the service-worker caching rules.
- Mark as fed still saves through `saveMeal`: the current time, and the planned DARF unless an actual amount is already saved.
- Undo Fed still clears only `fedAt`.

The release identifiers in `index.html` and `sw.js` move together to 3.7.0.

## Measurements

These use the synthetic fixture in `tests/today-layout.browser.cjs`: a stool and a planned recipe today, and a fed meal yesterday. They come from Chromium mobile emulation, with no sideways scrolling.

| 390 × 844 | Before | After |
|---|---|---|
| Tonight's meal starts | 2,031 px | 1,424 px |
| Mark as fed | 2,828 px | 1,658 px |
| Today height | 3,721 px | 2,354 px |

At 375 × 667 and 320 × 568, the amounts and Mark as fed also fit in one screen above the tab bar.

## Automated checks

```text
node --test tests/*.test.cjs
node tests/draft-input.browser.cjs
node tests/navigation-drafts.browser.cjs
node tests/today-layout.browser.cjs
```

- **Results:** 163 unit tests and 21 + 26 + 6 browser scenarios pass. There are no external requests or page errors.
- **Codex and Antigravity review follow-ups:**
  - Tests check that Mark as fed saves exactly the shown DARF, Bella & Duke, oil and fibre amounts.
  - A matrix covers supplement inclusion (true, false, unknown) against amounts (positive, zero, missing).
  - Restored drafts must reopen their section after navigation, reload and a History edit. Removing that reopening now fails a test.
- **Existing browser suites:**
  - Their field helpers now open a closed section by tapping its summary before typing.
  - Two Undo Fed steps now use the control under Edit meal.
  - Their assertions are unchanged, apart from two added focus checks.

## Physical iPhone checks still required

Use a preview with synthetic data, in Safari and the installed app, at normal and enlarged text sizes.

1. **Picker:** Choose the first recipe with the native picker. It must not reopen, and Mark as fed must appear beneath the amounts.
2. **Feeding flow:** Tap Mark as fed, then a bowl result. Open Edit meal and Undo Fed.
   - Check what VoiceOver announces at each step.
   - Check that focus never lands on the page body.
3. **Unfinished note:** Leave a note unfinished, then save Treats and toggle an observation. The summaries should update and the note should stay open.
4. **Force-close:** With a note or grams-fed draft, force-close and reopen. The draft's section should reopen without raising the keyboard.
5. **Large text:** Check the summaries, amount grid and Change meal at the largest Dynamic Type size. Check for 44 px targets and safe-area spacing.

Emulated positions are regression guards. They do not establish native layout, Dynamic Type or VoiceOver behaviour.

## Not in this change

- History's meal editor redesign, including "Given / Not given" for unknown supplement inclusion.
- Short recipe names in the picker.
- Status, Data, Settings and export changes from the same review.
