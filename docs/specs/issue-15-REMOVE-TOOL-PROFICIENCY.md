# Issue 15: Remove Tool Proficiency Page

## Problem
The "Skills" page (`page-tool-proficiency.ts`) shows tool call counts, benchmarks, and blind spots. The user points out that humans do not have direct control over which tools the AI invokes — the tool calls are largely automatic. The page therefore provides limited actionable value for human-in-the-loop improvement.

## Decision
Remove the "Skills" sidebar entry and routing. The underlying page file can remain in the repo (not linked from anywhere) for potential future revival.

## Files
- `src/webview/panel-html.ts` — remove `<li>` for `data-page="tool-proficiency"`
- `src/webview/app.ts` — remove `case 'tool-proficiency'` routing
