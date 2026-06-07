# Issue 15: Remove Skill-Related Pages — Tool Proficiency + Skill Finder

## Problem
Two skill-related pages were evaluated as not providing enough human-in-the-loop value:

1. **Tool Proficiency** (`page-tool-proficiency.ts`, data-page="tool-proficiency") — shows tool call counts, benchmarks, blind spots. Humans do not directly control which tools the AI invokes.
2. **Skill Finder** (`page-skills.ts`, data-page="skills") — shows recurring prompt patterns with an "Install Skill" flow. The coaching insight is buried under infrastructure. Even after the issue-13 reframe, the underlying data comes from AI triage and the page still requires manual analysis before returning value.

## Decision
Remove both "Tool Proficiency / Skills" and "Skill Finder" sidebar entries and routing. The underlying page files can remain in the repo (not linked) for potential future revival.

## Files
- `src/webview/panel-html.ts` — remove both `<li>` entries (`data-page="tool-proficiency"` and `data-page="skills"`)
- `src/webview/app.ts` — remove both `case` branches and both imports
