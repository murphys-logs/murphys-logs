# Claude Code: independent follow-up review of PR #20

You are Claude Code. Independently review the follow-up on https://github.com/murphys-logs/murphys-logs/pull/20, branch `codex/whole-app-review-20261106`.

Your first review was at `5e2b04fc6a587bd0d7d9b21f0d88803e1c539a09` (3.12.1); original base is `f28696bc8027c2d1788d167cc2119e8063627c68`. Fetch and record the **actual current PR head and base**; the expected follow-up release is 3.12.2. Review both the delta from the first reviewed head and the complete PR diff. If the head moves during review, state exactly what you tested and inspect the new delta before claiming current-head coverage.

Use an isolated checkout. Read repository instructions. Review only: do not modify tracked files, commit, push, approve, request changes, merge or deploy. Temporary probes may live outside the checkout. Do not read Antigravity's new follow-up review until your own is submitted. The reconciliation and tests are claims to verify, not proof.

Keep Firebase strictly read-only: no SDK/version/configuration/Auth/rules/resources/database changes, dependency updates, or changes to save/sync/outbox/storage semantics. Use synthetic data and isolated profiles only; no production sign-in or probing. Preserve records, calculations, historical/export meaning and transient personal-weight readings. Publish no sensitive values or personal local paths.

Check every prior finding:

1. **CC20-01:** failure tests must cause actual `#main` replacement, prove the original button disconnected and then check the surviving replacement button retains focus. Verify all four actions, with zero queued writes. Reproduce that old failure checks pass on the original base while strengthened failure-only probes fail there; do not rely solely on the full suite stopping at its first unrelated baseline failure.
2. **CC20-02:** inspect both named result groups (`role="group"`, names, `tabindex="-1"`). Confirm accessible role/name resolution, success/failure focus, repeated renders, disclosure preservation and unrelated focus/navigation. Distinguish browser naming evidence from untested Safari pointer/VoiceOver behaviour. No extra live-region or save/calculation change should appear.
3. **CC20-03:** the original 192 standard layout cases must remain, with 48 additional advice-present Review cases. Each must actually contain all four actions; confirm fixture reset, target sizes, overflow, labels, light/dark/forced colours, 16/32px root text, portrait/landscape and desktop.
4. **CC20-04:** audit report, PR and test output wording. Previously available/post-ack records come from a synthetic snapshot fixture; genuine app persistence evidence concerns the outbox/draft and replay. An injected send rejection after local saving does not validate interrupted local saving, actual SDK pending writes or real Firestore persistence. No assertion should have been weakened.
5. **CC20-05:** personal local-path details should be absent from current documentation. Do not claim older history/comments were erased. Confirm the corrected 58,094 Review-node figure is not presented as a new speed improvement.
6. **CodeQL follow-up:** inspect exact SDK import/worker-directory invariants and request-origin isolation. Determine whether the two substring warnings are addressed; distinguish fixture safety from production URL security. If hosted analysis is unavailable, say so rather than infer a pass.

Run the complete relevant checks on the exact head, using existing tooling:

```text
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"
all tests/*.browser.cjs (nine suites; use the appropriate shell loop)
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06/audit-boundaries.cjs
git diff --check <actual-base>..<actual-head>
```

Reported counts to verify: 218 Node cases, 121 browser scenarios, 240 layout combinations (192 standard + 48 advice). Browser scripts accept existing `PLAYWRIGHT_MODULE` / `BROWSER_EXECUTABLE`. Inspect assertions and report real failures/skips; do not edit tests to obtain those counts. Rerun history-benchmark.cjs or old defect reproducers where new evidence or claims warrant it; distinguish historical measurements and successful defect reproduction from a new product pass.

Read `docs/reviews/2026-11-06/review-reconciliation.md` and the revised whole-app report after your own initial pass. Manually inspect the three audit-exempt functions (`render`, `viewReview`, `syncSectionBody`) as well as running the boundary script. Verify the release-only worker delta and unchanged personal-weight, Firebase, calculation and data-format behaviour. Existing P1 conflict/duplicate/symptom risks and other documented blockers remain outside this task; report any newly introduced worsening separately.

Submit one GitHub review as **COMMENT**, explicitly marked AI-generated, with actionable inline comments where needed. No approval/request-changes action, @-mentions, merge or deployment. Include reviewed SHAs, environment, exact commands/results, CC20-01 through CC20-05 dispositions (fixed, partly addressed, not fixed, or unverified), CodeQL disposition, new severity/category/file-line/reproduction findings, Firebase audit and separate conclusions for the narrow change versus overall production readiness. State every missing physical-device/real-SDK check. Sign **“Claude Code independent follow-up review — PR #20”**.
