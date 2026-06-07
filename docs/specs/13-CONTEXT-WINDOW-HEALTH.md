# Context Window Health

## Motivation

Context window management is the single largest lever for both quality and
cost in AI coding tools. A crammed context window produces forgetful, sloppy
outputs and burns tokens on irrelevant history. Yet no existing view shows
users *how full their context window is*, *what's filling it*, or *when to
compact/start fresh*.

The existing `CompactionEvent` on `SessionRequest` tracks when Copilot
compacts — but there's no visualization or recommendation layer.

## Problem

1. **No context utilization visibility** — users can't see context pressure
   building, so they don't know when to open a new session.
2. **No content audit** — users don't know what fraction of context is
   instructions vs. conversation history vs. file contents vs. tool results.
3. **No compaction guidance** — the extension already detects compaction
   events (`CompactionEvent`) but never surfaces compaction frequency or
   effectiveness.
4. **No session-length optimization** — long sessions (50+ turns) are often
   less efficient than 2-3 shorter sessions, but users have no data to
   decide when to split.

## Proposed Solution

### Data Model (new types in `context-types.ts`)

```typescript
export type ContextSlot = 'instructions' | 'conversation' | 'files-read' | 'tool-results' | 'system-prompt' | 'unknown';

export interface ContextSnapshot {
  /** Estimated total tokens in context at this point */
  estimatedTotalTokens: number;
  /** Breakdown by slot type */
  slotBreakdown: Record<ContextSlot, number>;
  /** Model's max context window */
  maxContextTokens: number;
  /** Utilization ratio (0-1) */
  utilization: number;
  /** True if a compaction event occurred at this point */
  compactionTriggered: boolean;
  /** How many turns into the session */
  turnNumber: number;
}

export interface SessionContextHealth {
  sessionId: string;
  workspaceName: string;
  maxUtilization: number;        // peak context fill %
  avgUtilization: number;
  compactionCount: number;
  totalTurns: number;
  /** Per-turn snapshots (sampled every N turns for performance) */
  snapshots: ContextSnapshot[];
  /** Was the session ended because context was full? */
  endedDueToContext: boolean;
}

export interface ContextHealthData {
  /** Per-session breakdown */
  sessions: SessionContextHealth[];
  /** Aggregate metrics */
  totalCompactions: number;
  avgUtilization: number;
  highUtilizationSessions: number;  // sessions >85% utilization
  /** Which slots consume the most context */
  topSlotConsumers: { slot: ContextSlot; avgTokens: number }[];
  /** Recommendations generated from patterns */
  recommendations: ContextRecommendation[];
}

export interface ContextRecommendation {
  type: 'compact-earlier' | 'split-session' | 'reduce-files' | 'trim-history';
  sessionId?: string;
  suggestion: string;
  expectedTokensSaved: number;
}
```

### Detection Algorithm (new analyzer: `analyzer-context-health.ts`)

1. **Estimate context size** — for each request, estimate tokens from:
   - `messageText` + `responseText` (conversation)
   - `editedFiles` content + `referencedFiles` (approximate from file sizes)
   - `customInstructions` length
   - System prompt (known per harness)
2. **Track compaction events** — already on `SessionRequest.compaction`;
   compute compaction frequency and post-compaction utilization drop.
3. **Identify high-pressure sessions** — sessions that consistently run >85%
   estimated utilization.
4. **Generate recommendations** — e.g. "Split session at turn 24 when you
   switched from backend to frontend work", "Your instructions file is 4x
   larger than recommended".

### New UI Page: `/context-health`

- **Overview cards**:
  - Avg context utilization %
  - Total compactions
  - High-utilization sessions count
  - Estimated tokens saved if optimizing
- **Slot breakdown chart**: pie/bar chart showing what fills the context window
  (instructions vs. conversation vs. files).
- **Session list**: sortable table of sessions with utilization %, compaction
  count, turn count. Expand each session to see a per-turn utilization
  line chart with compaction markers.
- **Recommendations panel**: actionable suggestions ranked by expected impact.

### Dashboard Integration

- A "Context Pressure" gauge in the hero section (if utilization is high).
- A "Sessions Over 85%" alert when the count crosses a threshold.

## Success Criteria

- [ ] Context utilization is estimated and shown per session.
- [ ] Slot breakdown (instructions vs. conversation vs. files) is visible.
- [ ] Compaction events are surfaced on a timeline.
- [ ] Recommendations are generated and actionable.
- [ ] Users report they know *when* to start a new session based on the data.

## Future Enhancements

- **Live context monitor** — real-time context bar in VS Code status bar.
- **Auto-split suggestion** — detect topic shifts and suggest new sessions.
- **Context budget** — users set a max session length; extension alerts before
  hitting context limits.
