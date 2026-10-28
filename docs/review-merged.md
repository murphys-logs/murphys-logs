# Consolidated usability and code review

**Status:** All three reviews reconciled; owner decision on merging PR #1 pending. This document is the canonical prioritised backlog, including explicit refinements and disagreements. No application fix has been implemented. The 35 source findings yield **33 active backlog items**: AV-06 maps to UX-03, and AV-01 is not confirmed as a defect and is deferred as a design preference.

## Baseline and provenance

- Repository: [murphys-logs/murphys-logs](https://github.com/murphys-logs/murphys-logs).
- Review PR: [#1](https://github.com/murphys-logs/murphys-logs/pull/1).
- Verified on 28 October 2026: open and mergeable; branch `claude/gracious-clarke-w8ubgx` at `0f6f7bc1376035fa166e9e30af67635912966ade`; main/base `95a9cd7c376cc5131950d86778b6473ddd67781b`.
- At handoff, four review commits changed only the three review/protocol documents. CodeQL and Analyze (javascript-typescript) succeeded at `0f6f7bc`. The AV intake and this reconciliation add documentation only; current-head checks must be rechecked before merge. Code scanning does not prove runtime correctness.
- The app blobs are unchanged: `index.html` = `e944aefecd448f2ecbf76806b3bf53cce3a257fb`; `sw.js` = `99839881ff27450c3c987e9ec103f641620e0809`.
- Claude: [ux-review.md](ux-review.md), 17 findings (`UX-`, `BUG-`, `PWA-`, `CODE-`).
- Codex: [review-codex.md](review-codex.md), 11 findings (`AG-01`–`AG-11`), verified byte-identical to [comment 6478330714](https://github.com/murphys-logs/murphys-logs/pull/1#issuecomment-6478330714).
- Antigravity: [review-antigravity.md](review-antigravity.md), seven `AV-` findings supplied by the owner and committed unchanged in `7e83852c7dfe50c9f7afd3bcf4b2989b670ac891`. Do not confuse the historical AG comment with Antigravity's review.
- Preserve original IDs for traceability. AV-06 aliases UX-03; other retained AV findings keep their IDs. Original review files remain unchanged. Line references in this reconciliation use the unchanged app at `95a9cd7`; source reviews retain their original cited revisions.

## Agreed corrections

1. **UX-02:** Keep explicit Save after stool type/flags/time. `removeWithUndo` undoes deletions, not insertion; do not describe it as an existing quick-add Undo.
2. **UX-03:** Enter support is missing. Backgrounding does not itself discard an in-memory draft; reload/termination can. An unload warning is not durable draft recovery. Keep the existing validation and the weight outlier confirmation.
3. **UX-07:** Values already exist in expandable “View … values” tables. Direct point inspection is a separate improvement; preserve the accessible tables.
4. **AG-06:** A later subscription callback, including a metadata-only callback, may repair the day display. A no-op transaction need not trigger that callback. Skipped settings restores can also leave stale calculation settings until their own subscription callback.
5. **AG-11:** An actual Undo must advance freshness beyond the existing day even if an old queued operation meets a newer remote timestamp. A guarded no-op must not advance timestamps or overwrite newer fields.
6. **UX-10 / CODE-01:** The owner has chosen an editable weight target and a wider editable monitoring band. Display monitoring bounds must stay distinct from the weekly ration-change deadband.
7. **CODE-02:** The owner does not know whether the live rules restrict access to intended accounts. Keep this open; repository evidence cannot establish deployed authorization.

## Prioritised list

P1 means daily impact or data risk; P2 means noticeable friction; P3 means polish or an investigation/refactor. The order within P1 starts with data protection. Proposed implementation groups below do not erase individual findings.

| ID | Priority | Problem | Reconciled scope and acceptance |
|---|---|---|---|
| AG-04 | P1 | Undo can duplicate a stool moved on another device. | Use a transactional stool identity/location guard shared by moves and recovery. Two-client move/delete/Undo and retries leave one identity at its winning date. |
| AG-05 | P1 | A permanently conflicted move blocks all later queued writes. | Expose conflict resolution without losing its payload; continue valid queued edits after resolution. Test snapshots, reload, retry, and a subsequent weight/meal save. |
| AG-06 | P1 | Skipped backup restores can leave stale local values labelled Synced. | Reconcile optimistic replay with the server's retained day/settings/change records after no-op transactions. Screen and exports must immediately match the retained server state. |
| AG-07 | P1 | Accepted ID-less stools cannot be corrected or deleted. | Choose explicit rejection or stable legacy-ID assignment before enqueueing; preserve existing IDs. No partial import, duplicate on edit, or inert Delete. |
| AG-08 | P1 | Imported numeric settings bypass editor bounds. | Validate imported settings with the same ranges/steps plus explicit hidden-setting rules; reject unsafe null/zero/negative values before any write. Calculated meals must remain finite. |
| AG-11 | P1 | Undo does not advance the day's backup freshness timestamp. | Use a durable recovery timestamp strictly later than the pre-recovery day when restoration actually occurs; preserve newer concurrent fields and no-op idempotency. A post-Undo backup restores the deleted copy exactly once. |
| AV-02 | P1 | Erase can stop partially complete without durable recovery. | Persist an explicit erase command and target set/progress through the queue; use bounded batches in its sender and resume idempotently. Handle offline pending promises, restart, partial failures and concurrent clients; preserve settings and never report completion early. |
| BUG-01 | P1 | Current-month export cannot archive the completed month on the 1st. | Let the user choose a month or directly export last month. On 1 November 2026, October must be exportable. Verify both CSV and Markdown; separately test the second CSV download on supported browsers. |
| UX-01 | P1 | Today's assessment pushes daily logging below the first viewport. | Put missing observations and Add stool first; use a compact assessment linking to Status. At 390×844, actionable logging is visible and target text is not duplicated. |
| UX-02 | P1 | Stool entry emphasizes date and hides edit actions. | Lead with type/flags, reduce date prominence, and expose Edit clearly. Retain explicit Save after all corrections; date moves, labels and tap targets must continue to work. |
| UX-03 | P1 | Numeric entries require a separate Save tap; reload loses drafts. | Canonical item for AV-06. Make Enter in numeric inputs use existing validation/confirmation. Preserve textarea newlines and Cancel. Design durable draft recovery separately from an unload warning; blur/debounce autosave is not an agreed requirement. |
| UX-06 | P1 | Mobile daily records hide readings off-screen. | Use a compact mobile row/card or equivalent responsive presentation; retain semantic field labels and day/meal links. All key observations are readable at 390 px without sideways scrolling. |
| AG-03 | P2 | Status counts planned meals and retained outcomes as consumed. | Gate meal/supplement/bowl counters on isFedMeal. Planning contributes none; Fed adds them; Undo Fed removes the counts without deleting the saved plan. |
| AG-09 | P2 | Daily CSV calls the numerical maximum the worst stool score. | Export both minimum and maximum/range. [1,4], [2,3] and [1,7] retain their extremes; existing consumers must receive a documented column change. |
| AG-10 | P2 | Future imported observations trigger present-window alerts. | Apply an upper as-of-date bound to rolling-window warnings; keep future records inspectable and correctable. Test each affected warning at both window boundaries. |
| AG-01 | P2 | Rerendering drops focus from controls without IDs. | Preserve stable control identity/focus across settings actions and changing snapshots, including disclosure summaries. Expanded state and sensible focus must survive. |
| AG-02 | P2 | All-history date labels omit years. | Show years for multi-year table/chart intervals and in accessible names. Same month/day in different years must be distinguishable before opening the record. |
| UX-04 | P2 | Yesterday's bowl result is hidden in a nested disclosure. | Show a direct prompt when yesterday's confirmed meal has no outcome. One tap records the correct dated result and removes the prompt. |
| UX-05 | P2 | Recipe, planned DARF grams and Fed are separated by verbose details. | Group the feeding essentials in one phone viewport; move secondary calculation/regime history into details. Keep supplement controls understandable and at least 44 px. |
| UX-07 | P2 | Chart target styling and direct point inspection are weak. | Differentiate target and weekly averages; offer direct inspection if useful. Preserve the existing expandable value tables, which already provide a touch/keyboard-accessible alternative to title tooltips. |
| UX-08 | P2 | Repeated explanations make daily screens long. | Consolidate secondary guidance with the owning screen changes. Keep units, the previous-day activity date, validation and historical-correction consequences visible. |
| UX-10 | P2 | Settings mix advanced rules with daily controls; weight monitoring is fixed. | Owner wants editable target and monitoring tolerance; default 18.70 kg ±3% chosen below. Keep the ration-rule deadband separate. Separate advanced constants/danger zone; a validated oil-schedule editor is a separate scope. |
| PWA-01 | P2 | Install metadata and portable home-screen icons are missing. | Add a suitable manifest and raster icons; validate installed/offline behavior on target browsers. Reproduce actual platform limitations rather than assuming a manifest is the sole installability criterion. |
| CODE-01 | P2 | Weight target text is duplicated independently of its data. | Derive assessment text, ranges, chart bands and labels from the same validated monitoring settings. Group with the weight-target portion of UX-10; do not change ration advice thresholds. |
| AV-03 | P2 | Saving a different stool date interrupts the Today workflow. | For a cross-date save originating on Today, remain there and show the saved date plus View in History. Existing other-draft protection already works; retain it and a sensible focus target. Treat this as a navigation improvement, not demonstrated data loss. |
| AV-04 | P2 | Daily completion requires BCS even when a recent score exists. | Offer a periodic reminder with a visible last-assessed date; cadence is an app/owner preference, not a universal veterinary standard. Evaluate History relative to its selected date. Do not carry scores forward or change bcsMean/ration policy implicitly. |
| AV-05 | P2 | All-recipe portion comparison is only available on Status. | Add a read-only disclosure near Today's meal planner, coordinated with UX-05. Opening it must preserve selected recipe, saved meals and drafts. Treat as a usability enhancement, not a calculation defect. |
| AV-07 | P2 | Nearby stool chart points and flag rings overlap. | Use deterministic collision handling or accessible cluster inspection while preserving exact dates/times and the full values table. Keep the truthful 24-hour scale unless a separately justified view is offered. |
| UX-09 | P3 | History/Data labels and date selection add navigation friction. | Evaluate clearer labels and an inline date control while preserving date limits, draft guards and accessible announcements; retain stable internal identifiers unless renaming adds value. |
| UX-11 | P3 | Several unrelated polish/accessibility suggestions need separate scopes. | Make the Status indicator's reason accessible. Assess native dialogs, account recovery/show-password and desktop navigation separately; keep destructive confirmations and a reliable keyboard path. |
| CODE-02 | P3 | Deployed authorization policy is not reviewable in the repository. | Owner is unsure whether rules restrict access to intended accounts. Leave verification open; shared carers may be intentional. No live Firebase reads/sign-in/writes. Do not assert a vulnerability or deploy new paths without an authorized rules review. |
| CODE-03 | P3 | Repository documentation and test references are stale. | Provide app/release instructions and correct the nonexistent tests reference. Use descriptive new commit messages; never rewrite old commit history for cosmetic cleanup. |
| CODE-04 | P3 | The app is one large HTML file. | Optional later refactor; isolate pure calculation tests before broad modularization. Preserve offline assets and release coherence; not a prerequisite for narrow defect fixes. |

## Antigravity reconciliation

Antigravity supplied seven AV findings. Its source file is preserved unchanged from the owner's attachment. The table below records lead-review conclusions against the same app source; claims in that source review are not automatically accepted.

| Source ID | Verdict | Canonical disposition and evidence |
|---|---|---|
| AV-01 | Disagree with defect diagnosis; defer design preference | CSS 223–227 already lays out four buttons above three centered buttons: the second row occupies columns 2–3, 4–5 and 6–7, with equal margins. This is the proposed 4+3 alternative, not a broken grid. Seven across must not shrink the 44 px targets. Text guidance exists at 589–595 and 1713–1729; silhouettes can be explored separately. No active defect item added. |
| AV-02 | Refine; retain P1 | Sequential erasure at 2724–2725 has no durable continuation. Earlier deletes can survive a later failure, and closing loses unissued work. Call this incomplete erasure, not proven database corruption. With the full SDK, going offline can leave the awaited promise pending rather than throwing. A rejected batch applies none of that batch, but successful earlier batches remain deleted. Batching alone is insufficient; see acceptance below. |
| AV-03 | Refine; retain P2 | 2602 switches to History after a cross-date save only when no other drafts exist; 2601–2605 already protect other drafts. Keep the proposal as a Today-navigation preference and preserve confirmation/focus at 2607, without claiming draft loss. |
| AV-04 | Refine; retain P2 proposal | The daily check is confirmed at 1439, called by Today 1570 and History 1848. No universal weekly/fortnightly clinical scoring interval is established by the sources below. A periodic reminder must not invent observations, look forward from an old History date, or silently alter the ration hold. |
| AV-05 | Agree as enhancement; retain P2 | All-recipe amounts appear at 1908–1909/1925, while Today calculates only the chosen recipe at 1671–1684/1764–1787. A read-only disclosure addresses a distinct comparison task; implement alongside UX-05 where practical. |
| AV-06 | Duplicate/refinement | Merge into **UX-03**. Immediate chip saves (2534–2536) and explicit input confirmation (2738–2745) are confirmed. Neither reviewer agreement nor source code makes universal autosave essential. Preserve validation at 2466–2474 and the deliberate weight-outlier confirmation. |
| AV-07 | Agree, narrowed; retain P2 | At 2068–2071 same-date markers share x. At a 176 px plot height, 15 minutes separates centers by about 1.83 px, less than an 8 px marker or flag rings. Collision handling is the issue, not the 24-hour scale itself. The full values table at 2076 already retains each observation. |

Additional source-review correction: the AV cross-check of AG-09 calls Bristol 4 “loose”. The app classifies 3–4 together and 5–7 as loose. The valid AG-09 issue is that a numerical maximum of 4 hides a type-1 extreme in a field named `worstBristol`.

### AV-02 erase acceptance

Use the existing durable-write architecture for a new explicit erase operation; do not simply add direct batch calls to the click handler. Plan replay/version compatibility, preserve settings, and define whether records created concurrently fall inside or outside the erase target set. The current handler is an exception to the desired queued-write invariant, not a precedent for another one.

Test inventories of 499, 500, 501 and 1,001 documents across both collections, including any checkpoint writes. Inject a permanent second-batch failure and an offline transition before/during commit. The UI must show pending/partial state, retain the remaining work and not claim “Erased”. Close after a commit but before its acknowledgement is recorded; reopening must reconcile/resume idempotently without resurrecting erased data through an old outbox or Undo. Test another client's concurrent writes and stale cached inventory. A whole-log all-or-nothing visibility requirement would need a different design, not multiple batches.

Firestore's full JavaScript SDK can wait for server acknowledgement while offline, and batch atomicity is limited to each commit. Respect current SDK, request-size and rules limits when sizing batches; a maximum-size batch is not always safe. See [JavaScript reference](https://firebase.google.com/docs/reference/js/firestore#deletedoc), [batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes), and [limits](https://firebase.google.com/docs/firestore/quotas).

### AV-04 reminder acceptance and ration dependency

[AAHA](https://www.aaha.org/resources/2021-aaha-nutrition-and-weight-management-guidelines/screening-evaluation/) recommends nutritional screening including body and muscle condition at veterinary visits; [WSAVA nutritional assessment guidance](https://pmc.ncbi.nlm.nih.gov/articles/PMC11107980/) individualizes follow-up. These do not establish a universal weekly or fortnightly home-scoring rule. Keep reminder cadence an explicit product choice, with seven days available as a candidate.

If seven days is chosen, a real score on 19 October satisfies the reminder through 25 October, and another assessment becomes due on 26 October. History must look back from the selected date (`iso-6 <= scoreDate <= iso`), never from today's date or a future record. Show the actual assessment date; do not fill missing days or change chart/export observations.

The existing ration rule uses the real trailing seven-day BCS mean (1431). A missing mean bypasses the condition hold at 748. An unchanged dataset must retain unchanged ration recommendations after a reminder-only fix, with stale/missing BCS visible. Any change to block reductions when BCS is stale needs a separate explicit decision; a fortnightly reminder must not silently introduce that policy mismatch.

## Owner decisions

- **Weight controls:** The owner approved editable target and tolerance on 28 October 2026 and asked for a more sensible default than ±1%. Selected implementation default: **18.70 kg with an editable ±3% monitoring band**, exact bounds **18.139–19.261 kg** (approximately **18.14–19.26 kg**). This is a pragmatic app preference, not an established veterinary normal range. Use “Below / Within / Above monitoring band” instead of “healthy” or “acceptable”. Keep the weekly ration-change deadband and existing health alerts separate.
- **Weight evidence and rationale:** AAHA assesses weight together with body and muscle condition and clinical context ([AAHA screening evaluation](https://www.aaha.org/resources/2021-aaha-nutrition-and-weight-management-guidelines/screening-evaluation/)). Veterinary authors Pye and German suggest investigating deviations of ±5% from a recorded healthy weight in their body-composition guidance ([Royal Canin Academy](https://academy.royalcanin.com/en/veterinary/managing-body-composition-in-senior-pets)). Choosing 3% provides a wider display band than 1% while flagging drift before that 5% threshold; the 3% selection is our product judgment, not their recommendation. Small weigh-in differences can reflect scale, meals, bladder, equipment or time of day ([APOP weighing guidance](https://www.petobesityprevention.org/weight-check)). The configurable band must not imply that unexpected loss or illness within it is safe.
- **Weight acceptance:** Target and tolerance save through the queue, survive reload/sync and backup import, and drive all labels, badges and chart bands from one validated source. Use unrounded values for classification and display enough precision to avoid a rounded “within” value being labelled outside. Existing users with no new settings get the new default without overwriting saved records. Changing the monitoring settings must not change ration calculations or rewrite historical measurements.
- **Firestore authorization:** Unverified. The owner selected “Not sure — leave as an open verification item”. No live project access is authorized.
- **BCS cadence:** AV-04's periodic reminder is retained as a product proposal; the cadence and stale-BCS ration policy remain separate choices. No clinical rule change is approved by this review.
- **PR #1 merge:** All reviews are now reconciled; owner decision remains pending. Documentation checks passing is not approval to merge.


## Proposed fix PR sequence

This is the lead's sequencing recommendation after reconciliation. No fix branch is claimed or implementation started. Resolve remaining design choices in the corresponding fix PR, and seek the owner's merge decision for PR #1 first.

| Order | IDs | Scope / dependency |
|---|---|---|
| 1 | AG-07, AG-08 | Validate the entire backup before any local write. Prefer actionable rejection of ID-less entries unless a supported legacy-import requirement calls for stable one-time normalization. Establish targeted import regressions. |
| 2 | AG-06 | Reconcile restored days, settings and changes after skipped transactions, including mixed accepted/skipped aggregate imports and restart. Build on validated inputs from order 1. |
| 3 | AG-11 | Advance an actual stool recovery's freshness timestamp without regressing newer remote timestamps; support already-queued recovery commands and idempotent retries. |
| 4 | AG-05 | Make permanent move conflicts actionable while preserving data. Rebase/discard only the selected obsolete move; account for same-stool dependent operations before draining unrelated edits. |
| Design track, then 5 | AG-04 | Choose and prove a global identity/location protocol. Adding a client-side index is insufficient if older clients/direct writes bypass it. Needs a reviewable offline rules copy, mixed-version strategy, historical-duplicate handling and two-client emulator tests before claiming a complete fix. No live inspection. |
| After sync queue groundwork | AV-02 | Durable, resumable erase with bounded batches and explicit target/concurrency semantics. Reuse outbox conflict/recovery patterns where justified; do not bundle it into the identity migration. |
| 6; can run separately from sync work | BUG-01, AG-09 | Select export month and preserve both stool extremes in daily CSV. Keep CSV and Markdown scope consistent; document changed CSV columns and test both downloads. |
| 7 | UX-01, UX-04; related UX-08 copy | Put daily actions first and expose yesterday's missing bowl result. Preserve assessment announcements and draft handling. |
| 8 | UX-02, AV-03 | Streamline stool entry with explicit Save and clear Edit; retain Today after cross-date saves originating there, with feedback and History access. Keep drafts and focus intact. |
| 9 | UX-03 | Enter-to-save with existing validation; durable draft recovery is an explicit design/test requirement, not satisfied by an unload dialog. |
| 10 | UX-06, AG-02 | Responsive daily records plus unambiguous multi-year labels and accessible date names. |
| 11 | Weight portion of UX-10, CODE-01 | Editable target/monitoring tolerance, default ±3%, all displays driven by one settings source; ration advice unchanged. The remaining settings reorganization can follow separately. |
| 12 | AG-01; AG-03 and AG-10 in separate focused PR(s) | Keyboard-focus resilience; confirmed-meal counts; bounded-date alerts. Each keeps an independent acceptance check. |
| Later | UX-05 + AV-05; UX-07 + AV-07; AV-04; remaining UX-08/09/10/11, PWA-01, CODE-03/04 | Coordinate meal comparison and chart collision work with the owning screen. Resolve BCS reminder cadence without changing ration policy implicitly. Keep install/offline work independently tested; avoid broad refactoring before defects are fixed. |

Each fix PR records the canonical IDs, minimal behavior change, relevant regression results, version changes and any unresolved risk. Narrow reviews should finish before merging; CodeQL alone is insufficient for sync, draft or offline correctness.

## Release and test constraints

- Keep PR #1 documentation-only. Fix work uses separate PRs, one finding or a small related group, based on the then-current main.
- Never rewrite shared history or force-push.
- Bump the HTML `data-version`, module `APP_VERSION` and worker `VERSION` together for each app release; rebase line references against the actual fix branch.
- Add any new runtime asset to offline precaching. Review notes and development-only tests are not runtime dependencies.
- Preserve `[data-dirty]`, `[data-stool]`, draft-aware rendering, focus management, live regions and 44 px controls.
- All new application mutations go through `write()` and the durable queue.
- Use Europe/London calendar labels and the existing date helpers; test month/year and BST boundaries where relevant.
- Retain all 62 current calculation self-tests and add targeted regression checks for the actual defect. Review-time source probes are evidence, not a repository test suite.
- Use synthetic data and stub modules or an explicitly local emulator. Never sign in to, read from or write to `murphy-s-stool-log-v3`. New remote collection/path assumptions require rules compatibility review before implementation.
- Verify mobile behavior at 390×844, keyboard focus/validation, offline recovery and installed-client updates for changes affecting those paths.

## Completion and merge gate

- All three source reviews are present; Antigravity's submitted text is unchanged.
- Source findings are accounted for: 17 Claude + 11 Codex + 7 Antigravity = 35. One duplicate (AV-06 → UX-03), one unconfirmed defect (AV-01), and 33 active items remain: 12 P1, 16 P2, 5 P3.
- The agreed UX-02/03/07 corrections and AV refinements above supersede conflicting recommendations in the preserved source documents for planning purposes.
- Owner decisions on editable weight monitoring and unverified Firestore access are recorded.
- Verify this PR still changes only documentation and inspect checks on its final head. Ask the owner when to merge PR #1; do not merge or begin implementation automatically.
- Once the owner decides to merge, open focused fix PRs from the then-current main, using canonical IDs and the release/test constraints above.
