# Deliberate Practice & Weakness-Driven Learning Plan

## Motivation

The existing Learning Center offers generic quizzes and code review games, but
they aren't tied to the user's actual weaknesses. A surgeon doesn't practice
general medicine — they practice the specific procedures they struggle with.
Similarly, a developer who consistently writes vague prompts needs practice
writing constraints, not a general "how to prompt" quiz.

This spec closes the loop between *detection* (anti-patterns, prompt maturity)
and *improvement* (targeted practice exercises).

## Problem

1. **One-size-fits-all learning** — the Learning Center shows the same content
   to everyone regardless of their anti-pattern profile.
2. **No practice-to-improvement feedback loop** — users can't see whether
   practicing a skill actually improved their scores.
3. **No progression system** — there's no "you've mastered prompt specificity,
   now work on tool diversity" path.
4. **Detection without remediation** — anti-patterns tell users what's wrong
   but provide no structured way to fix it.

## Proposed Solution

### Data Model (new types in `insights-types.ts`)

```typescript
export type SkillArea =
  | 'prompt-specificity'
  | 'constraint-writing'
  | 'context-provision'
  | 'tool-selection'
  | 'session-hygiene'
  | 'error-recovery'
  | 'task-decomposition';

export interface SkillProficiency {
  area: SkillArea;
  /** 0-100 score derived from existing anti-pattern data */
  score: number;
  /** Benchmark: average score for users with similar experience */
  benchmark: number;
  /** True if this area is a priority for improvement */
  isWeakness: boolean;
  /** Number of practice exercises completed in this area */
  exercisesCompleted: number;
  /** Score improvement after completing exercises */
  improvement: number;
}

export interface PracticeExercise {
  id: string;
  skillArea: SkillArea;
  title: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  /** The exercise prompt the user should try */
  exercisePrompt: string;
  /** What a good answer looks like (for self-assessment) */
  successCriteria: string[];
  /** Estimated time to complete (minutes) */
  estimatedMinutes: number;
}

export interface PracticePlanData {
  skills: SkillProficiency[];
  /** Priority-ordered exercise recommendations */
  recommendedExercises: PracticeExercise[];
  /** Completed exercises with results */
  completedExercises: {
    exerciseId: string;
    completedAt: string;
    score: number;        // user's self-assessment
    scoreDelta?: number;  // change in proficiency after completion
  }[];
  /** Current "level" in each skill area */
  levels: Record<SkillArea, 'unaware' | 'aware' | 'practicing' | 'proficient' | 'mentoring'>;
  /** Streak / consistency metrics */
  currentStreak: number;
  longestStreak: number;
  lastPracticeDate: string | null;
}
```

### Detection Logic (new analyzer + integration with existing analyzers)

1. **Map anti-patterns to skill areas** — each existing anti-pattern
   (from `AntiPatternData`) maps to a `SkillArea`:
   - `prompt-quality` patterns → `prompt-specificity`, `constraint-writing`
   - `context-management` patterns → `context-provision`
   - `tool-mastery` patterns → `tool-selection`
   - `session-hygiene` patterns → `session-hygiene`
   - Correction patterns → `error-recovery`, `task-decomposition`

2. **Score proficiency** — for each skill area, compute a 0-100 score from
   the weighted sum of related anti-pattern severities. Lower severity = higher
   proficiency.

3. **Generate exercises** — LLM-generates (or template-matches) 3-5 practice
   exercises for the bottom 2 skill areas. Each exercise is a realistic
   coding scenario that forces the user to practice the weak skill.

4. **Track progress** — when a user completes an exercise, re-compute their
   proficiency scores and show the delta. Exercises are stored locally.

### New UI: `/practice`

- **Skill profile**: radar chart of all 7 skill areas with scores and benchmarks.
  Weak areas are highlighted in red, strong areas in green.
- **Practice plan**: the top 5 recommended exercises, sorted by:
  1. Weakest skill area (prioritized)
  2. Difficulty (start easy, build confidence)
  3. Estimated time (offer options from 5 min to 30 min)

  Each exercise card shows:
  - Skill area tag and difficulty badge
  - Exercise title and description
  - The actual exercise prompt (ready to copy/paste into AI tool)
  - Success criteria (checklist to self-evaluate)
  - "Mark Complete" button with a self-assessment score (1-5)

- **Progress timeline**: scatter plot showing skill scores over time.
  Completion of exercises is marked as annotations showing the improvement.
- **Streak counter**: daily practice streak with GitHub-style contribution
  squares.

### Integration with Existing Features

- **Anti-Patterns page** — each anti-pattern card gets a "Practice This" link
  that navigates to a relevant exercise in the practice plan.
- **Insights → Prompt Maturity** — the grade display gets a "Your weakest
  dimension is X — practice it" call-to-action linking to `/practice`.
- **Learning Center** — the `/practice` page replaces the current generic
  quiz list with a personalized curriculum. The quizzes become a subset of
  exercises within the plan.
- **Achievements** — new badges for completing exercises, maintaining streaks,
  and improving skill scores.

### Scoring Examples

| Anti-Pattern | Linked Skill Area | When Triggered |
|---|---|---|
| `vague-prompt` | `prompt-specificity` | Prompt lacks constraints/success criteria |
| `no-context` | `context-provision` | File references missing from prompt |
| `tool-repetition` | `tool-selection` | Same tool called 3+ times in a row |
| `mega-session` | `session-hygiene` | Session exceeds 30 turns |
| `correction-loop` | `error-recovery` | 3+ correction turns on same file |
| `scope-creep` | `task-decomposition` | User adds requirements mid-task |

## Success Criteria

- [ ] Every anti-pattern links to at least one practice exercise.
- [ ] Users see 3-5 personalized exercises after their first analysis.
- [ ] Completing an exercise shows a measurable improvement in the related
  skill score within 1 week of consistent practice.
- [ ] Streak tracking motivates repeat visits.
- [ ] Users report that exercises are relevant to their actual weaknesses.

## Future Enhancements

- **Peer comparison** — "Your prompt specificity is in the bottom 25% of
  developers using {harness}. Here's how to catch up."
- **Guided practice** — an interactive mode in the chat panel that coaches
  the user through an exercise in real time.
- **Team challenges** — shared practice goals for enterprise teams.
