# Adding independent review findings (Antigravity, Codex)

- **PR:** https://github.com/murphys-logs/murphys-logs/pull/1
- **Branch:** `claude/gracious-clarke-w8ubgx`
- **Reviewed commit:** `95a9cd7`

Three agents review this web app independently, then reconcile before any fixes start.
Claude's findings are in [`ux-review.md`](ux-review.md). This page is the whole protocol.

## 1. Review independently first

- Read `index.html` and `sw.js` yourself.
- Before your own pass, read only §2 (code map), §3 (constraints) and §4 (running without Firebase) of `ux-review.md`.
- Don't open its §5–§6 until your findings are written, so they stay independent.
- Focus on usability and UI first. Then look for correctness bugs, data safety, offline and sync behaviour, and accessibility.
- If you can, run the app with stubbed Firebase (see `ux-review.md` §4). Never sign in to, or write to, the live Firebase project.

## 2. Write your own file

Create one file, and don't edit anyone else's.

| Agent | File | ID prefix |
|---|---|---|
| Antigravity | `docs/review-antigravity.md` | `AG-` |
| Codex | `docs/review-codex.md` | `CX-` |

Use this format for each finding:

```markdown
### AG-01 · P1 · <area> · <one-line summary>
- **Where:** `index.html:<line>` (at 95a9cd7)
- **Now:** what happens, concretely (screen size, steps, data)
- **Change:** the smallest change that fixes it
- **Done when:** a check anyone can run
```

Priorities:

- **P1:** daily impact or a risk to data
- **P2:** noticeable friction
- **P3:** polish

Check every line number. If you read a later commit, cite it.

## 3. Cross-check, after your own pass

Now read `ux-review.md` §5–§6 and end your file with this table:

```markdown
## Cross-check with ux-review.md
| ID | Verdict | Note |
|---|---|---|
| UX-03 | Agree | |
| BUG-01 | Disagree | reason, with evidence |
| UX-06 | Refine | what should change |
```

- List only the IDs you have a view on.
- If one of your findings duplicates an existing one, drop it from your list and mark that ID **Agree** instead.

## 4. Add it to the PR

- Push one commit to `claude/gracious-clarke-w8ubgx` that adds only your file.
  - Commit message: `Add <agent> review findings`.
  - No rebase, amend or force-push. If the push is rejected, pull (merge) and push again.
- Leave `index.html` and `sw.js` unchanged in this PR. Fixes come in later PRs, one finding or a small group each.
- If you can't push, post your file's full content as a single PR comment. Claude will commit it unchanged as `docs/review-<agent>.md`.

## 5. Next

Once all three files are in, the findings are merged into one prioritised list. Agents then claim items for fix PRs by ID.
