# Whole-app review and focused fixes — 6 November 2026

Base: `main` at **`f28696bc8027c2d1788d167cc2119e8063627c68`**, app 3.12.0. Branch: `codex/whole-app-review-20261106`. Result: app 3.12.2, limited presentation fixes and additional local regression evidence. The [independent-review reconciliation](review-reconciliation.md) records the follow-up to reviews of `5e2b04f`. The PR description records its exact final head SHA and final command results. No merge or deployment is requested.

## Scope, architecture and boundaries

The review covered the full runtime, not only PR #19: the 48 baseline tracked files include `index.html`, the complete worker, manifest/icon, six Node suites, seven browser suites, existing review/reconciliation/device documents and historical prompts. No `AGENTS.md` was found. Relevant history includes the 3.9.2 full review, 3.10.0 draft/recovery/status changes, PR #16 instant logging and BCS-only advice, PR #17 cleanup, PR #18 browser refresh and PR #19 private weigh-by-difference entry. Historical findings are reconciled below instead of being counted as new discoveries. Existing checkouts were untouched; no open PRs were returned at the start.

The app has no build step or package manifest. One HTML document contains styles, the independent AppShell bootstrap, domain calculations, four destinations and the day editor, Firebase integration, drafts, outbox, exports and event handlers. Sources and tests were divided among internal Codex review passes; these are **not** independent Claude Code or Antigravity approvals.

Baseline `index.html` references:

| Area | Behaviour inspected |
|---|---|
| 622–659 | Firebase 12.19.0 modules; email/password Auth; Firestore persistent local cache with multiple-tab manager and memory fallback |
| 1095–1539 | Three compatible UID-scoped localStorage outbox prefixes; local persistence before optimistic projection; replay, shape validation, transactions/merged writes, Web Locks and retry backoff |
| 1699–1762 | Whole `days` and `changes` collections and `settings/main`; initial readiness waits for all three; cached/server metadata supports sync status |
| 1799–1833, 2291–2332, 3455–3574 | Two personal readings produce only Murphy's net weight. Durable draft capture and restore strip solo/combined readings; explicit save and existing validation remain intact |
| 3139–3340 | CSV formula protection, monthly CSV/Markdown, Full backup and import validation/reconciliation |
| 4381–4412 | Retry on page connectivity/focus/visibility and timers; no worker background-sync handler |
| `sw.js` | Caches app shell and pinned dependency files, not records; validates version/type/body before installation, stages updates, avoids forced reload of unfinished forms |

No production account was used, and no production Firebase data, rules or resources were probed or modified. All fixtures are synthetic. The Firebase client configuration is public-by-design configuration, not evidence of an exposed service secret; its values are omitted here. Authorization still depends on deployed rules and account controls. [Firebase guidance](https://firebase.google.com/docs/projects/api-keys).

## 1. iPhone usability and accessibility

**Fixed — AG-01, P2: Review decisions lose keyboard focus.** Apply ration, Keep current ration, Apply Pro-Fibre and Not now removed their focused button during render, leaving focus on the document body. Each now has a stable ID and a focusable, named result group. Render restores the surviving button, including after failed local saves, or its result when the button disappears. Save handlers and decisions are unchanged. The 13-scenario suite covers keyboard/pointer activation, preserved disclosures and unrelated focus. Following CC20-01, all four storage-failure scenarios force a replacement of `#main` and verify the original button is disconnected before checking restored focus; the earlier failure checks only exercised the unchanged-markup fast path. Named groups are browser-checked; VoiceOver announcement behaviour is still unverified.

**Verified within emulation:** eight generic CSS viewports (320×568, 375×667, 390×844, 393×852, 440×956, 852×393, 956×440, 1440×900), four destinations, light/dark/forced colours and 16/32px root fonts. The layout probe retains the original 192 standard-fixture combinations and adds 48 Review combinations with all four advice actions explicitly present (CC20-03). It expands all disclosures and checks page overflow, labels, enabled main controls and bottom-tab bounds/state. All tested enabled controls meet 44×44px; this does not certify every conditional/error form or contrast ratio. Existing browser tests cover day editing, native-input attributes, validation, draft retention, focus, selections and layouts. Four initial-review screenshots were visually inspected. The 44px goal follows [WCAG enhanced target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).

**Unresolved — CL-05, P2:** multiple sticky notices can still consume up to 45dvh, particularly with enlarged text. The 3.10.0 Undo expiry reduces its frequency but not the cap. Consolidation needs keyboard/notice-priority acceptance on a real phone. **Device acceptance remains open:** iPhone 16 and iPhone 17 Pro Max Safari and Home Screen; physical safe-area/home-indicator rendering, native keyboard obstruction, browser-chrome movement, landscape, browser zoom, Dynamic Type and VoiceOver. CSS viewports and doubled root text are not those device tests. The existing status-bar appearance concern also remains unverified; no metadata was changed.

## 2. Performance and responsiveness

**PERF-01, P2, measured and deferred:** All History eagerly creates 1,827 cards and about 71,311 DOM nodes for five years; All Review creates about 58,094 nodes even with disclosures collapsed. This is a demonstrated large-history bottleneck. Default 14-day screens are substantially smaller. Incremental history rendering or deferred chart tables need a focused follow-up preserving accessibility, browser find, scrolling and navigation; no speculative performance refactor or dependency was added.

`history-benchmark.cjs` uses 31, 365 and 1,826 days, daily weight/BCS/activity/meal/notes and three stools per day. The table and PR description now cite one run: **6 November 2026 original-review final validation**, Windows Edge 156.0.4314.58, Node 20.18.0, 390×844 touch/mobile emulation, unthrottled local hardware, synthetic SDK. Its [retained raw output](evidence/history-benchmark-original-final.jsonl) records the environment and results but does not embed a commit SHA; it is historical evidence, not a new-head benchmark. Five warm forced-render samples; timings include script, forced layout and DOM measurement, **exclude paint, cold startup and real network/Firebase costs**.

| Fixture | JSON bytes | All History nodes | All History median | All Review median |
|---|---:|---:|---:|---:|
| Month, 31 days | 18,015 | 1,306 | 9.1 ms | 4.3 ms |
| Year, 365 days | 213,353 | 14,332 | 86.7 ms | 18.2 ms |
| Five years, 1,826 days | 1,071,188 | 71,311 | 465.9 ms | 95.1 ms |

These historical measurements describe the unchanged rendering model, not an improvement claim. They replace the earlier unlabeled run in this table (CC20F-01). In the same retained run, five-year default first forced renders through layout were Today 13.7 ms, History 7.1 ms and Review 11.5 ms. The script prints fresh measurements when rerun; results vary by environment and run. There were no horizontal overflows, page errors or external requests in the 15 size/view combinations.

The final HTML is approximately 297 KB uncompressed / 92 KB locally gzip-compressed; compression is a local estimate, not a hosting-header measurement. The app has one 2,960-byte PNG and no new assets/dependencies. Startup and asset-loading paths were inspected and worker loading exercised locally; no real-iPhone startup, radio/battery, CDN timing or hosting compression claim is made.

## 3. Offline experience and resilience

**OFF-01, P2, fixed presentation:** Settings previously promised automatic syncing whenever signal exists. It now says to keep the app open while connected, reopen it if closed, and check sync status. Existing locally saved/waiting/synced/failed/cached status computation, retries and queue semantics are untouched.

**OFF-02, P2, fixed presentation:** persistent-storage wording named iOS even on desktop and implied unlimited protection. Copy is now browser-neutral, distinguishes automatic clearing protection from finite space and manual clearing, and retains the Full backup reminder. Persistent storage is not unlimited storage. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

**OFF-03, P2, fixed presentation spanning categories 1/3/5:** Review now states that results use records available on the device and can change when records are missing or waiting to sync. It does not invent a freshness flag, suppress an existing calculation or change advice. The global established sync status remains visible.

**New real-browser worker test (scope clarified after CC20-04):** actual browser Service Worker/Cache APIs install app files and support offline shell reload/navigation. The app's real local outbox survives page close/reopen with the same queued key and operation and replays a pending note over the stub's stale snapshot; the app's real draft storage restores unfinished walk text. Reconnect produces one acknowledgement per note from the synthetic sender without erasing the draft. After a completed local save, an explicitly injected send rejection is retained and retried after reopening. An incomplete release is rejected while the old cached shell still opens offline. Previously available and post-acknowledgement records are supplied from the stub's localStorage fixture regardless of connectivity: those checks prove rendering of supplied records, **not Firestore offline caching**. The test rewrites test-served CDN URLs to three local synthetic SDK modules. It does not interrupt a local save, model the real SDK keeping an offline write pending, establish real SDK persistence, or test browser-process/Home Screen cold starts.

The existing offline reproducer still confirms the following risks. Its successful execution means the **defects reproduced**, not that data safety passed:

| ID / severity | User impact and baseline evidence | Why unresolved / proposed next step |
|---|---|---|
| AG-05 **P1** | Conflicting stool move stops replay; later queued observations disappear from the visible projection and Full backup, and further edits can overwrite them. `replayQueuedWrites` 1233, `stoolMovePatches` 1266, `exportAll` 3239 | **Blocked:** recoverable conflict handling and complete recovery export change protected save/outbox behaviour. Design and separately authorize a loss-preserving conflict model |
| FR-01 **P1** | Remote move/delete followed by partial stool edit can recreate an incomplete duplicate; own backup can then fail import. `stoolMerge` 1245, sender 1459–1466 | **Blocked:** edit/create identity and atomic conflict handling require transaction/helper changes |
| FR-02 **P1** | Concurrent symptom additions/removals can replace another observation. Event handler 3907–3909, sender 1457 | **Blocked:** per-flag intent/reconciliation changes save/sync semantics |
| AG-04 / CL-03 **P2** | Queued Undo can duplicate a remotely moved stool; queued Delete can silently miss the moved identity. Recovery sender 1410–1428 | **Blocked:** requires identity/conflict policy and transaction changes |
| AV-02 **P2** | Interrupted confirmed erase can leave partial erasure without durable continuation on reopening. Erase 4240–4262 | **Blocked:** preserving this workflow requires separately authorized storage/save recovery design |
| FR-03 **P3** | Clock rollback across restart can reverse intended pending-edit order. Clock 1095/1350, sorting 1228–1230 | **Blocked:** durable sequencing/order repair changes outbox semantics |

No user data was cleared, migrated, quarantined, restored or erased by this review. No background execution while closed or unlimited storage is promised. Remaining worker limits include physical iOS quota/eviction, interrupted resource-body downloads, real downloaded SDK contents and concurrent old/new installed windows.

## 4. Security and privacy

**CODE-02, P3 assurance gap, read-only:** no deployed Firebase rules are in the repository. Shared top-level `days`, `changes` and `settings/main` paths (1726/1740/1753) might intentionally support carers, but source cannot establish permitted accounts. This is **not a demonstrated open database**. Next step is a separately authorized rules review and local-emulator authorization tests; no rule, Auth, resource, configuration or SDK change is included.

Working-tree pattern scanning found no private-key/service-token match. Rendering escape helpers, attribute escaping, CSV formula neutralization, import unsafe-key/depth validation and outbox shape validation were inspected; no new reproducible injection issue was found. Runtime networking inspected consists of Firebase services/modules and app assets; no analytics endpoint or unsafe external target link was identified. This is a bounded source audit, not a complete history secret scan or deployed-header/security certification. The [Firebase SDK advisory page](https://github.com/firebase/firebase-js-sdk/security/advisories) showed no published advisories when checked; that is not proof of absence of vulnerabilities. Dependencies were not updated.

**Personal-weight privacy preserved:** the eight existing weigh-in scenarios exercise decimal comma, precision, invalid readings, stale/restored state, local write failure, missed readings, History, and net-only persistence. Personal solo/combined values remain transient, are excluded from durable drafts and save payloads, and no logging was added. No data-format change was made.

## 5. Correctness and regression coverage

No calculation, historical interpretation, backup schema, import/export data meaning or logging workflow was changed. The app's 62 calculation self-checks remain part of the Node suite (not an additional 62 Node cases). New focused coverage protects Review focus and real local-worker lifecycle; existing offline wording assertions were strengthened. The existing ration regression now locates its headline inside the new focusable result wrapper, retaining all BCS/weight/advice assertions. Version assertions now expect 3.12.2, and the worker upgrade fixture covers the unchanged main release 3.12.0 → 3.12.2.

Existing domain probes still reproduce these issues, left unchanged because this request preserves calculations, historical interpretation and export formats:

| ID / severity | Evidence and impact | Next step |
|---|---|---|
| AG-03 **P2** | Unfed meal plans count toward consumed-meal summaries/recent recipes; Markdown does not distinguish planned/fed quantities. `weekContext` 2759–2783, `mealContext` 2568, Markdown 3165–3199 | Decide summary semantics and explicit plan/fed presentation separately. Preserve the valid control where refusal of an unfed bowl is an observation |
| AG-09 **P3** | CSV `worstBristol` takes the maximum: types 1 and 4 yield 4, hiding the hard extreme in that summary; detailed stool CSV keeps both. 3146–3157 | Agree a compatible summary/column meaning before changing exports |
| AG-10 **P3** | Future-dated observations can trigger current-window warnings. `vetItems` 966–994 | Separately authorize and test future-date handling without silently rewriting historical records |

## Reproduction and validation

Windows, Node **20.18.0**, existing Playwright installation. Headless Edge **156.0.4314.58** and Brave **157.0.8103.39**. No dependencies were installed in the repository. All browser fixtures block external app requests; the worker suite serves only a local origin.

```powershell
# Equivalent single-process invocation for Node 20 where sandbox child spawning is restricted.
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"

$env:PLAYWRIGHT_MODULE='<path-to-existing>\node_modules\playwright'
$env:BROWSER_EXECUTABLE='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
Get-ChildItem tests\*.browser.cjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }
node docs/reviews/2026-11-06/history-benchmark.cjs

$env:BROWSER_EXECUTABLE='C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
node docs/reviews/2026-11-06/layout-checks.cjs
node tests/review-focus.browser.cjs
node tests/weigh-in.browser.cjs
node tests/offline-launch.browser.cjs

node docs/reviews/2026-11-04/reproduce-offline.cjs
node docs/reviews/2026-11-04/reproduce-domain.cjs
node docs/reviews/2026-11-06/audit-boundaries.cjs
git diff --check f28696bc8027c2d1788d167cc2119e8063627c68
```

Baseline: **218/218 Node cases; 102/102 existing Edge browser scenarios**. Current targeted checks: **13 Review focus scenarios; 6 worker/outbox/draft scenarios with synthetic record availability and sender; 240 layout combinations (192 standard + 48 with Review advice); 15 history size/view measurements**. The final PR description records the final rerun totals and its exact head. Early sandbox `spawn EPERM` attempts did not execute tests; direct Node imports and approved isolated browser launches were used. A stale export-version assertion found during validation was corrected; its content assertions were not weakened.

The offline reproducer completes 15 defect/edge/control scenarios; the domain reproducer completes six. Do not add them to passing product-regression counts. No real iPhone/Safari, installed-app cold start, actual browser zoom, native keyboard, VoiceOver, real Firebase SDK transactions/cache/Auth, production rules or storage-pressure test was available. The older physical-device checklist remains applicable with the current version and a synthetic isolated account. Claude Code and Antigravity have now reviewed `7dccc7a`, with no remaining code blocker; their dispositions are recorded in the [reconciliation](review-reconciliation.md). The later documentation-only correction requires focused re-review under `docs/review-handoff.md` §6. Merge readiness remains pending that re-review; no merge or deployment is authorized.

## Explicit Firebase and protected-data diff audit

`audit-boundaries.cjs` compares the complete baseline source with the working tree, allowing only **`render`**, **`viewReview`**, **`syncSectionBody`**, and the three app release identifiers. Every line outside those three functions is identical after normalizing release IDs and line endings. The complete permitted function diffs were also manually reviewed by the lead and an internal Codex reviewer: only focus/markup and explanatory strings change; no protected call/argument was added or altered.

**Firebase imports, SDK version, configuration, initialization, authentication, subscriptions, writes/transactions, rules/resources, database structures, local storage formats, save/sync/outbox/draft handling, calculation code and import/export schemas are unchanged.** `sw.js` changes only `VERSION` from 3.12.0 to 3.12.2 as required by `docs/ux-review.md` §3. App shell/module identifiers move with it; backup release metadata follows `APP_VERSION` in the existing format. Cache algorithms, cache-key structure, SDK URLs and update/reload policy are unchanged. Manifest/icon and all other configuration/dependency files are unchanged. Tests and review evidence add no shipped dependency.

Remaining P1 data-integrity defects and authorization/device uncertainties above prevent an unconditional data-safety or production-readiness claim. They require separately scoped authorization and testing; this PR does not bypass the Firebase restriction.
