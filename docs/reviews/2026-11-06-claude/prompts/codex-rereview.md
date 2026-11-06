# Codex: independent re-review of PR #22

You are Codex. Independently re-review https://github.com/murphys-logs/murphys-logs/pull/22, branch `claude/friendly-bardeen-wilio6`.

**Commits and scope:**

- Your first review was at `d0aa02f17d013607e4dceb2b2437f384fdc6a785`, and you then authored `3bb4c659b3f8ee5b66b4d3abe6dee9c8a2eefb12`.
- The author's follow-up runtime commit is `e7acf4f194c4d099f330c010297c6b8aa577999c`; documentation follows it. Base is `ee42092658259605f56ef3cc9281418bb43b69f5`. The expected release is still 3.12.4.
- Fetch and record the **actual current head and base**. Review the delta from `3bb4c65` and the complete PR diff. If the head moves while you review, state exactly what you tested.

**Ground rules:**

- Use an isolated checkout and read the repository instructions.
- Review only: do not modify tracked files, commit, push, approve, request changes, merge or deploy. Temporary probes may live outside the checkout.
- Do not read the other reviewers' new reviews until yours is submitted. The reconciliation and test output are claims to verify, not proof.
- Keep Firebase strictly read-only: no change to the SDK, version, configuration, Auth, rules, resources or database; no dependency update; no change to save, sync, outbox or storage semantics.
- Use synthetic data only; no production sign-in or probing. Preserve records, calculations, history and export meaning, and keep personal-weight readings transient. Publish no sensitive values or local paths.

**Check:**

1. **CX22-01 refinement.** The author says `3bb4c65` keyed on `[data-confirm] button:focus`, which Safari never establishes for a tapped button. The new rule keeps notices static while a keyboard field is focused **or** `#main [data-dirty]:not(details:not([open]) *)` exists.
   - Reproduce the claimed Safari-model failure on `3bb4c65` and the pass on the current head.
   - Judge whether a capturing `mousedown` that blocks button focus and blurs the field is a fair model of WebKit's focus behaviour.
   - Look for cases where unsaved-state unpinning is worse than the old behaviour. Candidates:
     - long-lived visible drafts;
     - restored drafts after reopening;
     - the History day editor;
     - a failed local save that keeps the form dirty while a new *Could not save locally* notice appears at the top of the page;
     - the weigh-in form;
     - Settings number fields;
     - feeding-time forms.
   - Confirm the collapsed-section exclusion and the absence of content shift when notices pin again.
2. **Residual tap.** With a field focused and nothing typed, tapping an unrelated control under the band the notices will cover is said to be swallowed, with no action and no notice-button activation. Verify this. Decide whether it is acceptable or needs another change within the CSS-only, protected-boundary constraint.
3. **Test changes.** The activation cases now run first. "Pinned again on blur" became "still unpinned while unsaved, pinned after Cancel". The no-shift check now covers only the repin step. Confirm none of these weakened a meaningful assertion, and that the 23 px movement on Cancel is the pre-existing *Still to log* update rather than the notices.
4. **CC-K2 (round 2).** A failed local save while notices are unpinned leaves the *Could not save locally* alert at the top of the page, with *Not saved* pinned in the status line. Judge whether this accepted trade-off (documented in the reconciliation's round 2) is acceptable, or whether a CSS-only alternative exists that keeps the field and Save visible.
5. **CX22-02.** Confirm the gauge-fill counterfactual and that the 12 forced-colours scenarios are sound.

**Run on the exact head:**

```text
node -e "for(const f of require('fs').readdirSync('tests').filter(f=>f.endsWith('.test.cjs')))require('./tests/'+f)"
all tests/*.browser.cjs (11 suites)
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06-claude/states-probe.cjs
node docs/reviews/2026-11-06-claude/audit-boundaries.cjs
git diff --check <base>..<head>
APP_HTML=<index.html at 3bb4c65> node tests/keyboard-reveal.browser.cjs   # expected to fail
```

Counts to verify: **220 Node; 177 browser (124 + 41 keyboard + 12 forced-colours); 240 layout; 19 state configurations.** Report real failures or skips; do not edit tests to reach these counts.

**Submit** one GitHub review as **COMMENT**, explicitly marked AI-generated. Include:

- the reviewed SHAs and environment;
- the commands you ran and their results;
- CX22-01 and CX22-02 dispositions (fixed, partly addressed, not fixed or unverified);
- any new findings, each with severity, file:line and reproduction;
- the Firebase boundary audit;
- separate conclusions for this change and for overall production readiness;
- every missing physical-device or real-SDK check.

No @-mentions, approval, merge or deployment. Sign **"Codex independent re-review — PR #22"**.
