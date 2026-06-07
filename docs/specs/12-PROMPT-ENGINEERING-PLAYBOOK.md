# Prompt Engineering Playbook

## Motivation

The existing Prompt Maturity insight (`PromptMaturityData`) scores prompts on
constraints, specificity, context, etc. — but gives users a grade *without
actionable next steps*. A playbook turns that grade into a personalized library
of prompt patterns the user can adopt, grounded in their own data.

## Problem

1. **Grade without guidance** — a "C" grade in specificity tells the user they
   lack detail, but not *how* to add it or *what good looks like*.
2. **No personalization** — all users see the same generic advice regardless of
   their actual prompt history or tool harness.
3. **No before/after comparison** — users can't see how changing a prompt
   changed the output quality.

## Proposed Solution

### Data Model (new types in `insights-types.ts`)

```typescript
export interface PromptExample {
  originalText: string;
  improvedText: string;
  weakness: string;        // e.g. "no constraints", "ambiguous goal"
  improvementNote: string; // e.g. "Adding file paths and output format reduced iterations by 2"
  /** If the user has run the same prompt twice (original vs improved),
   *  show LoC and token deltas */
  tokenSavings?: number;
  correctionSavings?: number;
}

export interface PromptPattern {
  id: string;
  name: string;             // e.g. "The Golden Circle"
  description: string;
  appliesTo: string[];      // task types / work types
  technique: string;        // e.g. "context sandwich", "chain-of-thought"
  userPromptExample: string; // how to write it
}

export interface PlaybookData {
  overallGrade: string;
  weakestDimension: string;  // which of the 5 dimensions needs most work
  weeklyTrend: { labels: string[]; scores: number[] };

  /** Personalized from user's own prompts */
  personalExamples: PromptExample[];

  /** Library of patterns relevant to the user's work types */
  relevantPatterns: PromptPattern[];

  /** Quick wins — specific improvements the user can make today */
  quickWins: { suggestion: string; impact: 'high' | 'medium' | 'low' }[];
}
```

### Detection Logic (new analyzer: `analyzer-playbook.ts`)

1. **Surface weak examples** — from the lowest-scoring dimensions, pull real
   user prompts from the session data and generate an "improved" version
   (via LLM or rule-based transformation).
2. **Pattern matching** — classify user prompts against known effective
   patterns (chain-of-thought, persona, few-shot, context sandwich, etc.)
   and compute a "pattern diversity" score.
3. **Quick win generation** — correlate prompt structure with outcome metrics
   (correction rate, LoC produced) to identify high-leverage changes.

### New UI Page: `/playbook`

- **Grade dashboard** — the existing maturity score, plus a radar/spider chart
  of the 5 dimensions with the weakest highlighted.
- **Personal before/after gallery** — user's own prompts shown alongside
  improved versions with the expected benefit. Each card shows:
  - Original prompt (from actual session)
  - What was wrong (highlighted weak areas)
  - Improved prompt (suggested rewrite)
  - Expected savings (tokens, corrections)
- **Pattern library** — filtered by the user's common work types. Each pattern
  has a name, description, technique tag, and a user-facing example.
  Patterns seen in the user's own data are marked "✓ You use this".
- **Quick wins panel** — 3-5 specific, actionable improvements ranked by
  effort-to-impact ratio.

### Linkage with Existing Features

- **Skills page** — patterns in the playbook that the user doesn't use yet
  become candidate skills for automation.
- **Insights → Prompt Maturity** — the playbook replaces the current static
  grade with a dynamic, actionable version.
- **Correction Turn Analysis** — prompts that generate many corrections are
  flagged as "improvement candidates" in the playbook.

## Success Criteria

- [ ] Users can see 3+ personalized before/after prompt examples from their own data.
- [ ] Each example includes a concrete improvement and estimated savings.
- [ ] Pattern library shows at least 10 patterns relevant to the user's work types.
- [ ] Clicking a pattern shows a usage example.
- [ ] Quick wins are accurate (user can immediately apply them).

## Future Enhancements

- **One-click prompt improvement** — clicking "Apply Improvement" rewrites the
  prompt and shows a diff.
- **Team playbook** — aggregate patterns across a team to build shared best practices.
- **A/B test mode** — let users try two prompt styles and see which performs better.
