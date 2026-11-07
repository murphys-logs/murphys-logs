# PR #22: CX22-03 and offline validation follow-up

AI-generated implementation and validation record, 7 November 2026. Based on
`b5476b24069a47eba102b1323103d08ea689c5f3`; PR base remains
`ee42092658259605f56ef3cc9281418bb43b69f5`.

This addresses the [Codex independent re-review](https://github.com/murphys-logs/murphys-logs/pull/22#pullrequestreview-5808708928).
Earlier review reports and their counts describe their recorded revisions; this
follow-up records the new test behavior and validation environment.

## CX22-03: verify retry outcomes without requiring button focus

The failed-save test no longer requires Save to retain focus. The unchanged app
temporarily disables Save during confirmation, which can blur it; a Safari tap
also need not focus a button.

The test now exercises initial failure through touch, Tab+Enter and the Safari
focus model. Each case checks that:

- The saved record and complete queue remain unchanged after the injected local
  storage failure, while the dirty form and typed value remain available.
- The pinned status says **Not saved**, and the error retains `role="alert"`.
  These are DOM checks, not proof of a VoiceOver announcement.
- Save becomes enabled, remains above the modeled keyboard and below the header,
  and is the hit target at its center.
- After restoring synthetic storage, one coordinate-based touchscreen tap saves
  the retained value, adds exactly one operation for the correct day and field,
  and removes the confirmation row. No locator auto-scroll or automatic tap retry
  is used. The successful retry is a touch action in all three cases.

The three cases replace one, taking keyboard coverage from 41 to **43** scenarios.
The revised suite also passes all 43 scenarios on Chromium 151.0.7922.34, the
browser that exposed the original focus assertion failure.

The Cancel measurement comment now names both existing content updates: the
section's **Unsaved changes** marker and **Still to log**. The preceding review
measured a 23 px Activity-summary collapse, a separate 44 px todo-card collapse
offset by scroll anchoring, and zero additional field movement on repinning.
The no-shift assertion continues to isolate the pinning transition.

## Offline validation: use the matching browser and verify emulation

Playwright 1.64.1 had been run with a custom cached Chromium 151 executable.
After a service-worker-cached reload, that combination left `navigator.onLine`
true despite `context.setOffline(true)`. The synthetic SDK consequently treated
the browser as online. This reproduced on both the old PR head and its base.

The validation run uses Playwright's matching Chromium headless shell
**156.0.8078.4**, build 1248. The browser was downloaded to an isolated test
directory; application dependencies and runtime files were not changed.
Playwright documents its [browser-version requirement](https://playwright.dev/docs/browsers).

The offline suite now includes an uncached localhost connectivity endpoint with
an online positive control. Around offline reloads, reopened pages and the
injected send interruption, it checks both real `navigator.onLine === false`
and failure of an uncached HTTP fetch. The service worker does not intercept this
endpoint. Nothing overrides `navigator.onLine` or the app's offline state.

The old browser fails the new environment assertion clearly. The matching
browser passes it and all **six original offline scenarios**, including cached
launch, draft/outbox persistence across page reopening, reconnect, interrupted
synthetic sending and rejection of an incomplete shell update. Existing outcome
assertions remain intact.

## Validation

Windows x64; Node 20.18.0; Playwright 1.64.1; Chromium headless shell
156.0.8078.4. `PLAYWRIGHT_MODULE` selected the existing installed package,
`PLAYWRIGHT_BROWSERS_PATH` selected its matching isolated browser installation,
and `BROWSER_EXECUTABLE` was unset. All fixtures used synthetic data and local
origins; no production sign-in or Firebase requests were made.

| Check | Result |
|---|---|
| `node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"` | 220/220, zero skipped |
| All 11 `tests/*.browser.cjs` suites | 179/179: 124 existing + 43 keyboard + 12 forced colours |
| `node docs/reviews/2026-11-06/layout-checks.cjs` | 240/240 |
| `node docs/reviews/2026-11-06-claude/states-probe.cjs` | 19 configurations, no reported problems or errors |
| `node docs/reviews/2026-11-06-claude/audit-boundaries.cjs` | Pass against PR base |
| `git diff --check` and diff check against PR base | Pass |
| Current keyboard suite with `APP_HTML` set to exact `3bb4c65` HTML | Expected failure at Safari-model Save after six passes |
| Forced-colours suite with only the gauge-fill rule removed in a temporary HTML copy | Expected failure: fill and background both white |

All browser suites completed with zero page errors and zero external app requests.
Temporary probes, logs and browser binaries remain outside the repository.

## Scope and remaining acceptance

Only the two browser tests and this report change from `b5476b2`. `index.html`,
`sw.js`, manifest, icon and attributes remain byte-identical to that head. The
existing audit also passes against the PR base. There is no Firebase SDK,
configuration, Auth, rules, resource, database, dependency-manifest, calculation,
export, storage, draft, outbox, save or sync change. Release 3.12.4 is unchanged.

This closes the synthetic offline-test validation gap and the failed-save test
finding. It does not establish physical iPhone/Safari/Home Screen behavior,
native keyboard behavior, VoiceOver announcements, real Firebase persistent
cache availability or real SDK pending-write/reconnect behavior. The repository's
independent-review and physical-device merge gates remain pending; this record
is implementation evidence, not independent approval of the new changes.
