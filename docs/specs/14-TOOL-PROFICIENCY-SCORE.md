# Tool Proficiency Score

## Motivation

Every AI coding agent exposes a toolbox (`read_file`, `write_file`, `grep`,
`search`, `execute_command`, etc.). Most users rely heavily on 2-3 tools and
never discover more efficient ones. A proficiency score reveals blind spots
and guides users toward tooling patterns that reduce correction turns and
improve output quality.

The existing `toolsUsed` array on `SessionRequest` captures which tools were
called but aggregates them only as a count, never as a diagnostic signal.

## Problem

1. **Uneven tool utilization** — users over-use `write_file` (repeated tweaks)
   instead of using `edit` with surgical precision; they search manually when
   `grep` would be faster.
2. **No tool-skill benchmark** — there's no way to tell if a user's tool usage
   is typical for their experience level or harness.
3. **No learning path** — users don't know which tools exist or which ones
   would help their specific workflow.

## Proposed Solution

### Data Model (new types in `analytics-types.ts`)

```typescript
export interface ToolStat {
  toolName: string;
  callCount: number;
  uniqueSessions: number;
  /** Success rate based on endState / correction turns after this tool */
  successRate: number;
  /** Avg tokens consumed per call */
  avgTokensPerCall: number;
}

export interface ToolGroupScore {
  groupName: string;          // e.g. 'file-write', 'file-read', 'search', 'execute'
  tools: string[];
  usageRate: number;          // calls per session
  benchmarkRate: number;      // expected calls per session for the harness
  gap: number;                // usageRate - benchmarkRate (negative = underused)
  importance: 'critical' | 'recommended' | 'optional';
}

export interface ToolProficiencyData {
  overallScore: number;          // 0-100
  toolsUsed: ToolStat[];
  groups: ToolGroupScore[];
  /** Blind spots — tools the user has never used but would help their workflow */
  blindSpots: {
    toolName: string;
    harness: string;
    applicableWorkTypes: string[];
    exampleUsage: string;
    expectedBenefit: string;
  }[];
  weeklyTrend: { labels: string[]; score: number[] };
  topSuggestions: string[];       // 3 actionable suggestions
}
```

### Detection Algorithm (new analyzer: `analyzer-tools.ts`)

1. **Aggregate tool stats** — for each harness, count tool calls, success
   rates (did the next request correct the output?), token cost.
2. **Group tools into categories**:
   - File reading: `read_file`, `view`, `list`
   - File writing: `write_file`, `edit`, `apply_diff`, `multi_edit`
   - Search: `grep_search`, `search`, `glob`
   - Execution: `execute_command`, `run`, `bash`
   - Planning: `think`, `plan`, `question`
   - Review: `review`, `lint`, `check`
3. **Compute benchmarks** — per harness, compute the 50th/75th percentile
   tool mix from all users (or from a built-in reference profile).
4. **Flag gaps** — any group below the 25th percentile is an opportunity.
   Any tool never used that's common in the user's work types is a blind spot.

### New UI Page: `/tool-proficiency`

- **Score ring** — overall tool proficiency score with harness-specific context.
- **Tool radar** — spider chart comparing the user's tool mix to the benchmark.
- **Blind spot cards** — each undeployed tool gets a card showing:
  - Tool name and what it does
  - Example prompt that uses it
  - Expected benefit (e.g. "Reduces write iterations by 40%")
  - A "Try it" example button (injects a sample into the clipboard)
- **Group scores** — bar chart showing usage rate vs. benchmark by group.
- **Trend** — weekly proficiency score over time.

### Dashboard Integration

- A "Tool Diversity" score next to the existing metrics in the hero stats.
- A "Blind Spot" badge if the user has never used a high-value tool.

## Success Criteria

- [ ] Tool usage is aggregated and displayed per harness.
- [ ] Users can see which tool groups they underutilize.
- [ ] Blind spot detection surfaces at least 2-3 tools the user hasn't tried.
- [ ] Each blind spot includes a working example relevant to the user's domain.
- [ ] The proficiency score trends upward after users act on suggestions.

## Data Sources

Tool name classification already exists in each parser's `GEMINI_WRITE_TOOLS`,
`GEMINI_READ_TOOLS`, `CLAUDE_WRITE_TOOLS`, etc. These should be unified into a
shared registry so tool grouping is consistent across harnesses.

## Future Enhancements

- **Tool auto-completion** — when the user types a prompt, suggest a tool that
  would help ("It looks like you're searching — try using `grep_search`").
- **Command + K integration** — surface tool recommendations in the VS Code
  command palette.
