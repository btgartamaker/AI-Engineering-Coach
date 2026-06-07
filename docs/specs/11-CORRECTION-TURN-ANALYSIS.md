# Correction Turn & Error Analysis

## Motivation

Users waste significant time and tokens on back-and-forth correction loops.
Current analytics surface *that* sessions are long but not *why* — whether the
model misunderstood, the prompt was ambiguous, or the task required multiple
iterations. A dedicated correction-turn view helps users identify *where* their
workflow breaks down and how to reduce wasted rounds.

## Problem

1. **No error categorization** — aborted/cancelled requests exist as `endState`
   on `SessionRequest` but are never aggregated into patterns
   (e.g. "40% of aborts happen after `write_file` calls").
2. **No correction-loop detection** — sequences like
   `user → assistant (write) → user (fix) → assistant (write) → user (fix)`
   are not identified as correction turns.
3. **No cost-of-correction metric** — users can't see how many tokens or LoC
   were wasted on corrections vs. first-attempt output.

## Proposed Solution

### Data Model (new types in `analytics-types.ts`)

```typescript
/** Classification of why a request was corrected or abandoned */
export type CorrectionCategory =
  | 'output-quality'     // "this doesn't work", "that's wrong"
  | 'misalignment'       // "I meant X, not Y"
  | 'missing-context'    // "you forgot the error handling"
  | 'syntax-error'       // code didn't compile/run
  | 'scope-creep'        // "also add ..." mid-task
  | 'tool-misfire'       // wrote wrong file, wrong location
  | 'unknown';

export interface CorrectionTurn {
  sessionId: string;
  requestIndex: number;        // index of the first user correction message
  correctionCount: number;     // how many user→assistant turns in this loop
  category: CorrectionCategory;
  wastedTokens: number;        // total tokens spent on corrected output
  originalRequest: string;     // the initial user prompt
  correctionRequests: string[]; // the follow-up fix prompts
  firstResponseSnippet: string; // what the model originally produced
}

export interface CorrectionAnalysisData {
  totalCorrectionTurns: number;
  correctionRate: number;           // correction turns / total turns
  wastedTokens: number;
  wastedCost: number;               // estimated $ wasted
  byCategory: Record<CorrectionCategory, number>;
  topCorrectionTriggers: { pattern: string; count: number }[];
  weeklyTrend: { labels: string[]; correctionRate: number[] };
  recentCorrections: CorrectionTurn[];
}
```

### Detection Algorithm (new analyzer: `analyzer-corrections.ts`)

1. Walk each session's requests sequentially.
2. Detect a **correction start**: a user message that follows an assistant
   response and contains correction language (regex on `messageText`:
   `/(that'?s not|fix this|wrong|incorrect|actually i meant|try again|redo|this doesn'?t work)/i`).
3. If the *same* `editedFiles` are touched again in the next assistant
   response, increment `correctionCount`.
4. A correction loop ends when either:
   - The user changes files/topic, OR
   - 5+ consecutive correction turns (treat as scope creep).
5. Categorize the correction using a lightweight keyword classifier on the
   user's correction message.

### New UI Page: `/corrections`

- **Summary card**: correction rate %, tokens wasted, estimated $ cost.
- **Category breakdown**: bar chart of correction categories.
- **Top triggers**: table showing the most common patterns that lead to
   corrections (e.g. "adding error handling", "wrong import path").
- **Recent correction list**: expandable cards showing the original prompt,
   what the model produced, and what the user had to fix.
- **Trend chart**: correction rate over time (weekly).

### New Dashboard Section

A "Wasted Effort" card on the dashboard showing:
- Correction rate vs. peer benchmark (or vs. your own last month)
- Tokens burned on corrections
- One-click link to the full corrections page

## Success Criteria

- [ ] Correction turns are detected with >80% accuracy vs. manual review.
- [ ] New `/corrections` page renders with summary, breakdown, and trend.
- [ ] Users can click individual corrections to see the original prompt and response.
- [ ] Dashboard shows correction waste alongside other KPIs.

## Future Enhancements

- **Autofix suggestions**: for common correction triggers, suggest prompt
  templates that avoid the problem.
- **Model comparison**: show which models require the most correction turns
  for the same task categories.

