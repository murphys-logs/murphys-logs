# Claude Code: independent review of PR #22

You are Claude Code, in a **separate session** from the one that authored this PR. Independently review https://github.com/murphys-logs/murphys-logs/pull/22, branch `claude/friendly-bardeen-wilio6`.

**Commits and scope:**

- Base is `ee42092658259605f56ef3cc9281418bb43b69f5`. The release is 3.12.4.
- PR history: the author's original head `d0aa02f17d013607e4dceb2b2437f384fdc6a785`, Codex's follow-up `3bb4c659b3f8ee5b66b4d3abe6dee9c8a2eefb12`, and the author's refinement `e7acf4f194c4d099f330c010297c6b8aa577999c`, followed by documentation.
- Fetch and record the **actual current head**. Review the complete PR diff, not just the last commit. If the head moves while you review, state exactly what you tested.

**Ground rules:**

- Use an isolated checkout and read the repository instructions (`docs/review-handoff.md`, `docs/ux-review.md` §3).
- Review only: do not modify tracked files, commit, push, approve, request changes, merge or deploy. Temporary probes may live outside the checkout.
- Do not read the Codex or Antigravity reviews, or `docs/reviews/2026-11-06-claude/review-reconciliation.md`, until your own initial pass is written. Treat the report and test output as claims to verify.
- Keep Firebase strictly read-only: no change to the SDK, version, configuration, Auth, rules, resources or database; no dependency update; no change to save, sync, outbox or storage semantics.
- Use synthetic data only; no production sign-in or probing. Preserve records, calculations, history and export meaning, and keep personal-weight readings transient. Publish no sensitive values or local paths.

**Check:**

1. **CC-K1 (keyboard and notices).**
   - Is the 352 px pinned stack against a ~330 px keyboard viewport a fair model of iOS? Does `position:static` while a keyboard field is focused, or a visible entry is unsaved, actually keep the typed field and its Save/Cancel visible and tappable?
   - Check Save/Cancel activation by touch, mouse, Tab+Enter and the Safari focus model. Confirm there is no content shift when notices pin again, and that collapsed sections, picker inputs and desktop are excluded.
   - Probe other situations:
     - weigh-in;
     - Settings number fields;
     - feeding time;
     - restored drafts;
     - failed local saves;
     - VoiceOver reading order, as far as the browser accessibility tree allows.
2. **CC-F1 (forced colours).** Are the attention dot, stool dots, chart points and gauge visible with forced colours and unchanged otherwise? Does any other fill-only status mark remain?
3. **Release.** `data-version`, `APP_VERSION` and `sw.js` `VERSION` must move together, with the worker changing only its `VERSION`. Check that the upgrade fixture goes from 3.12.3 to 3.12.4.
4. **Tests.** Do the 40 keyboard and 12 forced-colours scenarios fail on base for the right reason, and do they protect against reintroducing CX22-01? Look for weak, skipped or tautological assertions.
5. **Unresolved items and wording.** Are the unresolved items in the report accurately classified, including those blocked by the Firebase restriction? Look for any overclaim (emulation presented as Safari, probes presented as passing tests).

**Run on the exact head:**

```text
node --test tests/*.test.cjs
for f in tests/*.browser.cjs; do node "$f" || exit 1; done
node docs/reviews/2026-11-06/layout-checks.cjs
node docs/reviews/2026-11-06-claude/states-probe.cjs
node docs/reviews/2026-11-06-claude/audit-boundaries.cjs
git diff --check <base>..<head>
```

Counts to verify: **220 Node; 176 browser (124 + 40 + 12); 240 layout; 19 state configurations.** Report real failures or skips; do not edit tests to reach these counts. Rerun `interaction-probe.cjs` or `history-benchmark.cjs` only if you rely on performance claims, and label any such results as measurements.

**Submit** one GitHub review as **COMMENT**, explicitly marked AI-generated, with inline comments where they are actionable. Include:

- the reviewed SHAs and environment;
- the commands you ran and their results;
- findings, each with severity, category, file:line and reproduction;
- dispositions for CX22-01 and CX22-02 once you have read them;
- the Firebase boundary audit;
- separate conclusions for this change and for overall production readiness;
- every missing physical-device or real-SDK check.

No @-mentions, approval, merge or deployment. Sign **"Claude Code independent review — PR #22"**.
