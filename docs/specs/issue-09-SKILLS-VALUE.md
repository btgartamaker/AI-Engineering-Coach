# Issue: Skills Page Value Assessment

## Problem
The Skills page (previously "Tool Proficiency") shows basic tool call counts that overlap significantly with other pages. The user questions whether it provides unique value.

### What the page currently shows
1. **Skill Score ring** — Overall score (0-100) based on tool usage vs benchmark
2. **Suggestions panel** — Text suggestions for improving tool usage
3. **Skill Areas bar chart** — Usage rate per group (file-write, file-read, search, execute, planning, review) vs benchmark
4. **Blind Spots** — Tools never used (currently: "No blind spots found")
5. **Tool Breakdown table** — Raw call counts per tool name
6. **Skill Trend line chart** — Weekly proficiency score

### Overlap with other pages
| Data | Also shown in |
|---|---|
| Tool call counts | Output page (lines of code, tool calls per session) |
| Weekly trend | Dashboard (daily activity) |
| Suggestions | Playbook (quick wins) |
| Raw tool table | Timeline (individual tool calls per request) |

## Proposed Direction
Keep the page but refocus it on **skill development**, not tool accounting:

### What to Keep
1. **Skill Score** (unique metric — no other page computes this)
2. **Skill Areas radar/bar chart** (unique — compares vs harness benchmarks)
3. **Blind spots** (unique — cross-harness tool discovery)
4. **Suggestions** (unique — actionable improvement tips)

### What to Remove or Merge
1. **Tool Breakdown table** — redundant with Output and Timeline. Remove or move to a collapsible "raw data" section.
2. **Skill Trend line chart** — too thin to be useful (weekly score barely changes). Remove and show a simple "streak" or "days active" indicator instead.

### What to Add
1. **Skill growth over time** — Show which skills have improved (e.g., "file-write +15% this month")
2. **Peer comparison hint** — "Most Copilot users at your level score 65+ in file-read"
3. **Next skill to unlock** — "You're 3 sessions away from the 'Power User' achievement"

## Decision Needed
Before implementing, confirm:
- [ ] Keep Skills as a standalone page
- [ ] Merge Skills data into Playbook or Dashboard
- [ ] Remove Skills entirely (de-clutter sidebar)

## Handoff
If keeping the page:
- `src/webview/page-tool-proficiency.ts` — refactor sections
- `src/webview/panel-html.ts` — update sidebar label if needed
- `src/core/analyzer-tools.ts` — add growth-over-time computation
