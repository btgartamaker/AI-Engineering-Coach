# Issue 16: Workspace Name Consolidation in Timeline, Output, Context Health

## Problem
While the dashboard and dropdowns normalize workspace names to simplified basenames (last path segment), three pages still expose full paths alongside simplified names:

1. **Timeline session detail** — shows `workspaceName` (simplified) and `location` (full `cwd` for Pi, making them redundant duplicates)
2. **Output charts/tables** — workspace labels come from `session.workspaceName`; for Pi sessions this is the full `cwd` because `decodePiWorkspaceName` returns `header.cwd` when available
3. **Context Health treemap + detail** — workspace names come from the same session data, so Pi workspaces appear as full paths

## Root Cause
`src/core/parser-pi.ts` `decodePiWorkspaceName` returns the full `header.cwd` string when it can read the session header, instead of the basename. VS Code, Claude, Codex, and Gemini parsers already return basenames.

## Fix
1. **Pi parser**: change `decodePiWorkspaceName` to return `path.basename(header.cwd)` instead of the full `cwd`
2. **Timeline detail**: remove `session.location` from the session detail display line (it duplicates workspace info for Pi and is just a UI location string for VS Code)

## Files
- `src/core/parser-pi.ts` — fix `decodePiWorkspaceName`
- `src/webview/page-timeline.ts` — remove `session.location` from detail
