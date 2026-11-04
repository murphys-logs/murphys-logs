# Review coverage, validation and iPhone acceptance checks

Reviewed baseline: [`2646239395ddb6369eb6a940fab0a66db2259004`](https://github.com/murphys-logs/murphys-logs/tree/2646239395ddb6369eb6a940fab0a66db2259004), app **3.9.2**, on **4 November 2026**. These results describe the baseline code. This PR adds review documentation and reproduction evidence; it does not fix the findings or change the Firebase integration.

## Scope and inventory

`git ls-tree -r --name-only 2646239395ddb6369eb6a940fab0a66db2259004` lists **28 tracked files**:

| Files | Count | Review coverage |
|---|---:|---|
| `index.html`, `sw.js` | 2 | All application and worker source reviewed; responsibility split below. |
| `manifest.webmanifest`, `icon-180.png` | 2 | Standalone launch, relative start/scope and icon references inspected. PNG signature and actual 180×180 dimensions verified. |
| Four `tests/*.test.cjs` files | 4 | Source inspected and all Node suites executed. |
| Five `tests/*.browser.cjs` files | 5 | Source/fixture limitations inspected and all Chromium suites executed. |
| `tests/ui-layout-baseline.json` | 1 | Historical layout fixture inspected; measurements are regression references, not current iPhone evidence. |
| Existing `docs/*.md` | 12 | Historical findings, constraints, validation claims and unresolved device checks considered. Earlier reports remain historical records. |
| `README.md`, `.gitattributes` | 2 | README is still the profile template; line-ending policy is present. No CI workflow or deployed Firebase rules are tracked in this baseline. |

| Runtime area | Review responsibility |
|---|---|
| CSS, markup, Today/History/Review/Settings rendering, controls, focus and navigation | iPhone/UI pass |
| Calculation constants/functions, derived results, exports/import validation, test coverage and cross-checking findings | Lead review |
| Local outbox, replay, transactions, subscriptions, draft persistence, account transitions and recovery | Offline/data-integrity pass |
| Classic AppShell bootstrap (`index.html:490–596`), entire worker, manifest, installation metadata and cache lifecycle | PWA pass |

The review did not sign in to, read from, or write to production Firebase. Deployed rules, account permissions, hosting headers and real production data were not inspected. Source review cannot establish those deployment properties.

## Automated results

| Node suite | Passed | Failed |
|---|---:|---:|
| `tests/import-backup.test.cjs` | 29 | 0 |
| `tests/restore-sync.test.cjs` | 86 | 0 |
| `tests/sw-assets.test.cjs` | 9 | 0 |
| `tests/ui-ergonomics.test.cjs` | 55 | 0 |
| **Total** | **179** | **0** |

One import-suite test invokes the application's **62 calculation self-tests**, all passing. They are covered by the 179 reported test cases, not 62 additional Node test cases. The nine worker tests are also a subset of 179.

| Chromium browser suite | Passed scenarios |
|---|---:|
| `tests/draft-input.browser.cjs` | 21 |
| `tests/navigation-drafts.browser.cjs` | 26 |
| `tests/today-layout.browser.cjs` | 11 |
| `tests/history-review.browser.cjs` | 6 |
| `tests/settings-exports.browser.cjs` | 5 |
| **Total** | **69** |

All five browser suites passed. Their synthetic fixtures block external requests. A green baseline suite does not invalidate newly reproduced findings: it shows that existing assertions do not cover those failing cases. See the companion findings and reproduction evidence in this directory.

### Reproduce this review's findings

The three additional scripts below assert the **observed defective behavior** at the reviewed baseline. A successful run confirms a finding; these are audit evidence, not regression tests of the desired future behavior. After remediation, replace the affected assertions with tests of the intended outcome. They reuse the repository's existing synthetic harnesses and make no live Firebase requests.

```text
node docs/reviews/2026-11-04/reproduce-offline.cjs
node docs/reviews/2026-11-04/reproduce-domain.cjs
node docs/reviews/2026-11-04/reproduce-ui.cjs
```

All three completed successfully: six offline/conflict/erase cases, three domain/export cases, and four keyboard-activated Review actions losing focus. The UI script uses the same Playwright/Chromium environment options described below and reported zero page errors/external requests. The scripts do not count toward the baseline's 179/69 totals.

### Reproduce the existing checks

Run from the repository root with a current Node.js version:

```text
node --test tests/import-backup.test.cjs tests/restore-sync.test.cjs tests/sw-assets.test.cjs tests/ui-ergonomics.test.cjs
```

If a restricted environment disallows the test runner's child processes, use its supported same-process mode:

```text
node --test --test-isolation=none tests/import-backup.test.cjs tests/restore-sync.test.cjs tests/sw-assets.test.cjs tests/ui-ergonomics.test.cjs
```

The browser scripts need an existing Playwright installation and Chromium. Optionally set `PLAYWRIGHT_MODULE` to its module path and `BROWSER_EXECUTABLE` to an installed Chromium executable. These are test-only environment options, not application dependencies. Leave `APP_HTML` unset to test this checkout; some suites accept it to compare another source snapshot.

```text
node tests/draft-input.browser.cjs
node tests/navigation-drafts.browser.cjs
node tests/today-layout.browser.cjs
node tests/history-review.browser.cjs
node tests/settings-exports.browser.cjs
```

## What these checks do not prove

- All five browser suites disable service workers and replace the classic AppShell script and Firebase imports with synthetic fixtures. They do not test actual installation, cached SDK loading, persisted Firebase sign-in, Home Screen cold launch or service-worker activation.
- The Node worker suite mocks CacheStorage, clients and network responses. Its staged-upgrade checks are useful logic evidence, not an installed-browser lifecycle test. Sync tests use local adapters rather than real multi-client Firestore transactions.
- Chromium mobile viewports, root-font enlargement and mocked lifecycle events do not establish native iOS keyboard, picker, Dynamic Type, VoiceOver, OS termination or storage-eviction behaviour.
- This review did not perform current v3.9.2 physical-iPhone acceptance checks. The owner's **2 November 2026** confirmation in [the v3.7.0 Today report](../../today-layout-checks.md#physical-iphone-checks) remains valid historical evidence for those listed checks. Later History/Settings reports still record their device checks as pending. VoiceOver was recorded as not applicable to the owner's workflow, not tested.

### Storage assurance boundary

WebKit documents best-effort storage as the default and permits origin eviction under storage pressure. Home Screen installation is a heuristic for granting a persistent-storage request; it does not establish that a request was made or granted. This app does not call `navigator.storage.persisted()` or `persist()`. Requesting and checking persistent mode would strengthen local retention without changing Firebase, but must handle denial and unsupported browsers. Even granted persistence cannot protect against explicit website-data deletion, device loss or every crash. A successful local outbox write is useful durability evidence, not an absolute data-safety proof. See [WebKit's storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

This review supersedes the absolute-safety, guaranteed-native-keyboard and universal-verification claims in `docs/review-iphone-offline-ux.md` (especially lines 6, 29, 109–112 and 150). Those claims exceed the available evidence.

## Prioritized iPhone acceptance matrix

Use a disposable synthetic-data preview and test-only emulator/adapter, never the production project. Test the actual worker and, where applicable, actual SDK against the isolated test backend. Do not change shipped Firebase configuration, authentication flows, schemas or rules to run these checks. Record iPhone model, iOS version, Safari versus installed Home Screen mode, tested commit, starting cache/session state, steps and observed results. No deployment is authorized or performed by this document.

| Priority | Scenario | Required observation |
|---|---|---|
| P1 | **Prepared offline cold launch:** load while connected, establish the test session and cached records, confirm app-file readiness, enable airplane mode, terminate and reopen from Home Screen. | App opens with the same user and cached records; a new saved entry is visible and remains queued locally. An initial uncached visit is tested separately and must give truthful recovery guidance. |
| P1 | **Poor signal with `navigator.onLine === true`:** keep the network interface connected but block/blackhole test-backend traffic, save a stool, meal, note and weight, then restore traffic. | Local saves complete promptly; pending status remains truthful; restored traffic drains entries once without manual retry, duplication or dropped edits. Measure recovery time. |
| P1 | **Termination around save:** close immediately after confirmed local save and during an in-flight remote operation; reopen offline, then reconnect. | Confirmed entries survive and replay once. Test ambiguous remote acknowledgement as well as a request that never reached the server. Do not equate unsaved drafts with confirmed records. |
| P1 | **Draft recovery:** type notes/numbers and create a stool draft, background or force-close, reopen, and repeat across London midnight. | Recoverable drafts retain values and original dates without auto-submitting; the restored form remains usable. Record the debounce window separately from completed saves. |
| P1 | **Storage rejection/quota:** inject localStorage write failures on the test origin during save and draft capture. | Show `Not saved`, keep editable input and existing records, and never claim a queued or synced save that does not exist. Recovery after space becomes available must be possible. |
| P1 | **Conflicts and blocked queue:** with two isolated clients, move/delete a stool remotely while the other has an offline move plus later independent saves; also try delete/Undo across dates. | Expose the conflicts reported in this review; do not accept a generic retry as resolution. After a future fix, verify retained operations, visible resolution and eventual progress without silent loss or duplication. |
| P1 | **Reconnect without an `online` event:** restore traffic while visible, then repeat while suspended and on focus/unlock. | Existing interval/resume triggers retry pending work when the app can execute. Do not promise execution while iOS suspends or terminates it. |
| P1 | **Session expiry and sign-out:** expire/revoke only the synthetic session while writes are pending; test offline sign-out, same-account relogin and a different test account. | Pending data remains retained and isolated; access/sync limits are explained; same-account recovery resumes safely. Record the current sign-out friction as a finding, not a passed safety check. |
| P1 | **Installed update:** stage a coherent synthetic release while saved writes and visible/hidden drafts exist; interrupt downloads and connectivity. | Old release remains usable after failed staging; updates cannot discard drafts; saved pending writes survive activation/reopen. Verify shell/version/module cache coherence and recovery. |
| P2 | **Native input and layout:** use small/large iPhones, portrait/landscape, normal/enlarged text, decimal keypad, notes and date/select pickers. | Save/Cancel stay reachable above keyboard and home indicator; no unwanted zoom, picker reopening or horizontal page scroll; controls remain comfortably tappable. |
| P2 | **Accessible interaction:** when accessibility validation is in scope, use VoiceOver through navigation, status, drafts, Save/Cancel, errors, disclosures and chart values. | Names, selection, focus and announcements are accurate; charts have a usable textual route. Record unperformed VoiceOver checks explicitly. |
| P2 | **Export/restore on iPhone:** export CSV, Markdown and JSON through Files; verify both CSV outputs, then restore synthetic data. | Both delayed CSV downloads are obtainable, selected month is correct, JSON round-trips, and blocked/cancelled downloads or import failures are understandable. |
| P2 | **Persistent storage/readiness:** inspect storage mode and exercise unavailable/denied/granted persistence in a test harness, separately from app-file caching. | Readiness never conflates cached files, retained records and server acknowledgement. Unsupported/denied persistence remains a qualified state, not a promise of zero data loss. |

Treat the P1 matrix as a release gate for claiming the poor-signal requirement is satisfied after remediation. Record failures and unavailable checks; do not convert proposed acceptance criteria into completed results.
