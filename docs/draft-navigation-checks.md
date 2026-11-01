# Save feedback and draft navigation

These UI changes keep explicit Save/Cancel. A draft is an unfinished entry on this device, not a confirmed record or a queued Firebase write.

## Automated checks

Run the existing unit suites and both browser suites:

```text
node --test --test-isolation=none tests/*.test.cjs
node tests/draft-input.browser.cjs
node tests/navigation-drafts.browser.cjs
```

The browser scripts use the existing Playwright installation (`PLAYWRIGHT_MODULE`) and optional browser path (`BROWSER_EXECUTABLE`). They block external requests, replace Firebase with synthetic stubs and forbid backend operations. No new application dependency is required.

The shared initial fixture has two dates, 1 November and 31 October 2026, and a fixed London clock. The navigation suite creates separate contexts for its additional cases. This is not a large-history performance benchmark.

Claude's review follow-ups cover failed instant-action dismissal without clearing draft errors, quick-log types staying separate from older hidden stool drafts, and confirmed removal of hidden drafts while visible entries remain. Unavailable fields explain that they cannot be opened on the current screen; an old or conditional field can still be discarded without signing out. Disclosure state is carried across navigation only while drafts exist.

## Physical iPhone checks still required

On a synthetic-data preview, check Safari and the installed Home Screen app at normal and enlarged text sizes:

1. Enter a weight with the decimal keypad. Record what the native Done control does; the visible Save action must remain reachable and use the existing validation. Notes must retain line breaks.
2. Begin a note, open a stool entry, visit Status and History, then return. Both unfinished entries should remain, with their original dates and no confirmation prompt or automatic save.
3. Edit two History dates. Save one field and cancel another; unrelated drafts must remain. Confirm yesterday's Tractive minutes stay attached to yesterday.
4. Suspend/reopen and force-close/reopen. Check recovery, including a draft spanning midnight. Restored controls must not open the keyboard or picker automatically.
5. Use VoiceOver to reach the dated unfinished-entry links, Save, Cancel and Retry. Verify safe-area spacing and 44px tap targets. Native picker behavior is not established by desktop emulation.
6. Check offline reopening and app-update blocking while unfinished entries exist, including hidden drafts.
7. Hide an unfinished supplement correction with Undo Fed, follow its resume link, and check the explanation and Discard hidden entries control. Cancel the confirmation first, then confirm; any visible unfinished entry must remain. Also verify a new quick-log type does not reopen an older hidden stool draft.

Do not mark these device checks complete from an emulated viewport. The version-2 draft store is device-only, isolated by account and session; legacy version-1 drafts are read and transferred only after successful local persistence. Firebase document shapes and persistence operations are unchanged.
