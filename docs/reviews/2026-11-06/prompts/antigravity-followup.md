# Antigravity: independent follow-up review of PR #20

You are Antigravity. Independently review the follow-up on https://github.com/murphys-logs/murphys-logs/pull/20, branch `codex/whole-app-review-20261106`.

You previously reviewed `5e2b04fc6a587bd0d7d9b21f0d88803e1c539a09` (3.12.1), against `f28696bc8027c2d1788d167cc2119e8063627c68`. Fetch and record the **actual current PR head and base**; expected follow-up release is 3.12.2. Review both the follow-up delta and complete PR diff. Recheck the head before posting and identify any untested movement.

Use an isolated checkout and read repository instructions. Review only: no tracked edits, commit, push, approval, request-changes action, merge or deployment. Keep temporary probes outside the checkout. Do not read Claude Code's new follow-up review until you have submitted your own. Review all categories; emphasize observed browser behaviour and the evidence gaps your earlier passing matrix did not cover.

Firebase, its SDK/version/configuration/Auth/rules/resources, data structures and save/sync/outbox behaviour are strictly read-only. No indirect dependency/configuration changes. Use synthetic fixtures only, never production sign-in or probes. Preserve records, calculations, history/export compatibility and personal-weight privacy. Publish no sensitive values or personal local paths.

Verify independently:

1. **Focus regression coverage:** four failure cases now force a main replacement and prove the original button disconnected before asserting replacement focus. Confirm all four cases exercise this path and do not merely pass because the original node stayed focused. Success paths, repeated updates, disclosures and unrelated focus/navigation must still work.
2. **Named results:** both focus targets should be named groups with `tabindex="-1"`. Inspect browser accessible role/name and keyboard focus on successful/failed actions. Only claim VoiceOver announcements or Safari pointer behaviour if actually tested; Chromium click behaviour is not that evidence.
3. **Conditional-action layout:** retain the 192 original matrix cases and verify 48 extra Review cases with all four advice buttons present. Check fixture isolation, 44px controls, labels, overflow, bottom navigation, light/dark/forced colours and 16/32px root text across 320×568, 375×667, 390×844, 393×852, 440×956, 852×393, 956×440 and desktop 1440×900. Explicitly distinguish CSS viewport/root-font simulation from actual iPhone, browser zoom and Dynamic Type.
4. **Offline evidence:** rerun offline-launch.browser.cjs in Edge and Brave. It exercises actual worker/cache APIs and app outbox/draft persistence; record availability/Auth/sending are synthetic. The failure is an injected send rejection after completed local saving, not interruption of local saving or actual SDK pending-write behaviour. Check the revised claims, exact SDK transport invariants, exact-origin isolation and incomplete-update rejection. Do not equate mocked record echoes with Firestore caching.
5. **Docs/security tooling:** verify the current docs use a generic Playwright path and the corrected 58,094-node figure; no history erasure or performance improvement should be claimed. Check the CodeQL substring-alert follow-up without calling it a proven production vulnerability. Verify hosted analysis status if available.
6. **Protected boundary and correctness:** run audit-boundaries.cjs and manually review its exempt `render`, `viewReview`, `syncSectionBody` bodies. Runtime follow-up should add only group/name attributes and matching 3.12.2 app release IDs. Worker cache logic, Firebase12.19.0 URLs, Auth/listeners/transactions, save/sync/outbox/drafts, calculations, weight privacy and import/export formats must remain unchanged.

Run and report the actual commands/results:

```text
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"
all tests/*.browser.cjs (nine suites; use the appropriate shell loop)
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06/audit-boundaries.cjs
git diff --check <actual-base>..<actual-head>
```

Use existing test-only Playwright/browser installations and the `PLAYWRIGHT_MODULE` / `BROWSER_EXECUTABLE` options. Verify reported 218 Node cases, 121 browser scenarios and 240 layout combinations, rather than changing assertions to match them. Repeat review-focus, weigh-in and offline-launch in Brave (reported 27 scenarios). Investigate new failures honestly. Rerun the benchmark or older defect reproducers where claims/new changes warrant it; their older results are not new head execution evidence.

If physical iPhone 16 or 17 Pro Max is available, check Safari and Home Screen with synthetic data, including safe areas, keyboard, chrome, landscape and VoiceOver. Otherwise name those gaps. Do not attach an untested iOS version to the results or describe browser Firebase persistence as tested C++ persistence. Through-layout benchmark times include script; they do not directly prove mobile scrolling latency.

After your initial independent pass, compare `docs/reviews/2026-11-06/review-reconciliation.md`, the whole-app report and PR claims. Give dispositions for CC20-01..05 and the CodeQL change, plus any new findings. Confirm that your prior AG20-01..05 assurance gaps/pre-existing defects remain accurately disclosed and have not worsened. A separately authorized focused design is required for protected conflicts; do not prescribe an unproven architectural overhaul.

Submit a clearly AI-labelled GitHub **COMMENT** review and actionable inline comments. No approval/request-changes action, @-mentions, merge or deployment. Include exact SHAs, OS/Node/Playwright/browser/device versions, commands and pass/fail/skipped counts, findings with severity/category/exact lines/reproduction/impact, Firebase audit, and separate conclusions for this narrow PR versus overall production/device readiness. Sign **“Antigravity independent follow-up review — PR #20”**.
