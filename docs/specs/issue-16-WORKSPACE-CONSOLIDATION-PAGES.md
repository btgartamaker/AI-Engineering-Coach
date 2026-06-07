# Issue 16: Workspace Name Consolidation in Timeline, Output, Context Health

## Problem
While the dashboard and dropdowns normalize workspace names to simplified basenames (last path segment), three pages still display full paths:

1. **Timeline** — session list, lane labels, and detail all show `workspaceName`; if it's a full path (e.g. `/Users/.../project`) it renders as-is
2. **Output** — "By Workspace" chart labels and the `Workspace` column in the token table use raw `workspaceName` which may be a full path
3. **Context Health** — treemap tiles and detail panel show `workspaceName` which may be a full path

## Root Causes
### Parser-level (new data, already fixed)
`src/core/parser-pi.ts` `decodePiWorkspaceName` returned the full `header.cwd` instead of `path.basename(header.cwd)`. Fixed in v0.2.14 but only helps newly parsed sessions.

### Cached data (still broken)
Old session data was already cached with full-path workspace names. The pages have no display-level normalization.

## Fix
### A. Display-level normalization (robust for all data)
Add a `displayWsName(name: string): string` helper to `src/webview/shared.ts` that:
- If the name contains `/` or `\`, extracts the last path segment
- Otherwise returns the name as-is

### B. Apply to Timeline
Wrap every `workspaceName` render in `displayWsName()`:
- Session list header (`.session-ws`)
- Lane labels (`.lane-ws`)
- Lane tooltips
- Lane click detail (`<h3>`)
- Session detail (`<h2>`)

### C. Apply to Output
- Production chart labels (`prod.byWorkspace.labels`)
- Token consumption chart dataset labels
- Token table `Workspace` column (`req.workspace`)

### D. Apply to Context Health
- Treemap data entries (`name: w.workspaceName`)
- Detail panel header (`ws.workspaceName`)
- Review section (`review.workspaceName`)

## Files
- `src/webview/shared.ts` — add `displayWsName()`
- `src/webview/page-timeline.ts` — wrap all `workspaceName` in `displayWsName()`
- `src/webview/page-output.ts` — normalize workspace labels in charts and table
- `src/webview/page-config.ts` — normalize workspace names in treemap, detail, review
