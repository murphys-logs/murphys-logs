# Antigravity: independent re-review of PR #22

You are Antigravity. Independently re-review https://github.com/murphys-logs/murphys-logs/pull/22, branch `claude/friendly-bardeen-wilio6`.

**Commits and scope:**

- Your first review was at `d0aa02f17d013607e4dceb2b2437f384fdc6a785`, which was before both follow-ups.
- Since then: Codex's `3bb4c659b3f8ee5b66b4d3abe6dee9c8a2eefb12` (CX22-01 and CX22-02), then the author's `e7acf4f194c4d099f330c010297c6b8aa577999c`, followed by documentation. Base is `ee42092658259605f56ef3cc9281418bb43b69f5`. The release is still 3.12.4.
- Fetch and record the **actual current head and base**. Review the delta from `d0aa02f` and the complete PR diff. If the head moves while you review, state exactly what you tested.

**Ground rules:**

- Use an isolated checkout and read the repository instructions.
- Review only: do not modify tracked files, commit, push, approve, request changes, merge or deploy. Temporary probes may live outside the checkout.
- Do not read the other reviewers' new reviews until yours is submitted. The reconciliation and test output are claims to verify, not proof.
- Keep Firebase strictly read-only: no change to the SDK, version, configuration, Auth, rules, resources or database; no dependency update; no change to save, sync, outbox or storage semantics.
- Use synthetic data only; no production sign-in or probing. Preserve records, calculations, history and export meaning, and keep personal-weight readings transient. Publish no sensitive values or local paths.

**Your first review did not cover these. Check:**

1. **CX22-01 (P2, a regression in `d0aa02f`).** A Save/Cancel tap moved focus, the notices repinned over the button and the tap was swallowed. Reproduce it on `d0aa02f`.
   - Then evaluate the current rule: notices stay static while a keyboard field is focused **or** a visible unsaved entry exists (`#main [data-dirty]:not(details:not([open]) *)`).
   - Verify single-tap Save and Cancel by touch, mouse, Tab+Enter and the Safari focus model (no button focus on tap). Confirm notices pin again afterwards without shifting content, and that collapsed sections, pickers and desktop are excluded.
   - Look for situations where unpinning on unsaved state is worse than before.
2. **Residual tap.** With a field focused and nothing typed, tapping an unrelated control under the band the notices will cover is said to be swallowed harmlessly. Verify that no notice button activates and nothing is written.
3. **CX22-02.** The forced-colours suite previously skipped every gauge fill. Confirm the new ±20 g cases and that the suite fails when only the gauge-fill rule is removed.
4. **Your earlier wording.** The author qualified two points: `interaction-probe.cjs` records timings and has no pass/fail assertions, and "recommend merge" does not satisfy the §6 gate. State whether you agree.

**Run on the exact head:**

```text
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"
all tests/*.browser.cjs (11 suites)
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06-claude/states-probe.cjs
node docs/reviews/2026-11-06-claude/audit-boundaries.cjs
git diff --check <base>..<head>
```

Counts to verify: **220 Node; 177 browser (124 + 41 keyboard + 12 forced-colours); 240 layout; 19 state configurations.** Report real failures or skips; do not edit tests to reach these counts. Distinguish Edge/Brave (Chromium) emulation from Safari, and do not describe untested VoiceOver, keyboard or Home Screen behaviour as verified.

**Submit** one GitHub review as **COMMENT**, explicitly marked AI-generated. Include:

- the reviewed SHAs and environment;
- the commands you ran and their results;
- CX22-01 and CX22-02 dispositions (fixed, partly addressed, not fixed or unverified);
- any new findings, each with severity, file:line and reproduction;
- the Firebase boundary audit;
- separate conclusions for this change and for overall production readiness;
- every missing physical-device or real-SDK check.

No @-mentions, approval, merge or deployment. Sign **"Antigravity independent re-review — PR #22"**.
