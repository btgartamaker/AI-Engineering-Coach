# Issue 1: Corrections Page Shows No Data

## Problem
The Corrections page shows "0.0% Correction Rate", "0 corrections in 0 total turns", and "No correction loops detected" even when the user has active sessions with corrections. The detection regex (`CORRECTION_RE`) is too narrow for the user's harness patterns.

The user's examples include prompts like:
- `@agent Try Again`
- `please proceed`
- `what is the next steps?`

None of these match the current `CORRECTION_RE` which looks for patterns like `that'?s not`, `fix this`, `wrong`, `incorrect`, etc. The `@agent` harness prefix and softer correction language are not covered.

## Root Cause
The correction detection regex in `analyzer-corrections.ts` (`CORRECTION_RE`) was designed for GitHub Copilot / Claude Code patterns and doesn't account for:
1. Agent-prefixed commands (`@agent try again`)
2. Vague continuation prompts that imply correction ("please proceed", "next steps")
3. The harness prefix stripping happens late in parsing; the correction detector sees raw message text

## Proposed Solution
### Detection Regex Expansion
Add these patterns to `CORRECTION_RE`:
- `try again` — direct retry request
- `@agent\s+(try|redo|again|fix|correct)` — agent-prefixed correction
- `next steps?` — vague continuation after a failed response
- `proceed` — same
- `(not|no[.,])\s+(quite|exactly|what I|that)` — softer negation
- `still\s+(not|wrong|broken|failing)` — persistence indicator

### Formatting Fixes
- The subtitle line is missing proper spacing between sections
- Empty charts should be hidden (not showing 0-height canvas with no data)
- Card labels should be consistently styled

## Success Criteria
- [ ] Corrections page shows actual data when user has correction patterns
- [ ] `@agent Try Again` is detected as a correction
- [ ] Empty charts are hidden or show a placeholder graphic
- [ ] Page layout has proper spacing between stat cards and sections
