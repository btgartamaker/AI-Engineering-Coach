# Issue 15: Remove Tool Proficiency Page from Sidebar

## Problem
The "Skills" page (`page-tool-proficiency.ts`, data-page="tool-proficiency") shows tool call counts, benchmarks, and blind spots. The user points out that humans do not have direct control over which tools the AI invokes — the tool calls are largely automatic. The page therefore provides limited actionable value for human-in-the-loop improvement.

## Decision
Remove the "Skills" sidebar entry and routing for `data-page="tool-proficiency"`. The page file can remain in the repo (not linked) for potential future revival.

**Note:** The Skill Finder page (`page-skills.ts`, data-page="skills") was NOT removed — it provides value by identifying recurring prompt patterns and coaching insights.

## Files
- `src/webview/panel-html.ts` — remove `<li>` for `data-page="tool-proficiency"`
- `src/webview/app.ts` — remove `case 'tool-proficiency'` routing and import
