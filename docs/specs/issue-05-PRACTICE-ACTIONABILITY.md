# Issue 5: Practice Exercises Lack Actionability

## Problem
The Deliberate Practice Plan page shows skill areas and exercises, but the exercises are not specific or actionable enough. Users don't know what concrete steps to take to improve.

Currently the page shows:
- A radar chart of 7 skill areas vs benchmark
- Level labels (Unaware → Mentoring)
- Collapsible exercise cards with generic descriptions

But the exercises are too abstract (e.g., "Write a prompt with at least 3 specific constraints") and don't provide:
- Real examples of before/after
- Measurable success criteria
- Links to relevant resources
- Concrete step-by-step instructions

## Root Cause
The `PracticeAnalyzer` in `analyzer-practice.ts` maps anti-patterns to skill areas and generates exercises from a static list. The exercises use templated language without incorporating the user's actual session data (their actual prompts, actual mistakes).

## Proposed Solution
### Make Exercises Data-Driven
Instead of generic exercises, generate exercises that reference:
- **The user's actual weak prompts** (from playbook analysis)
- **Their actual correction loops** (from corrections analysis)
- **Their actual tool blind spots** (from tool proficiency)

### Add Concrete Examples
For each exercise:
- Show "Your current approach" (real example from user data)
- Show "Try this instead" (specific improvement)
- Include measurable success criteria (e.g., "Reduce corrections by 2 per session")
- Add a time estimate ("5 minutes", "1 session")

### Better Exercise Templates
Replace generic templates with scenario-based ones:
- **Prompt Quality**: "Take your last correction loop and rewrite the original prompt with [specific improvement]"
- **Tool Mastery**: "Next session, try [specific tool] for [specific task type]"
- **Context Management**: "Review the last 3 sessions where you had to re-explain context"

## Success Criteria
- [ ] Exercises reference the user's actual data (weak prompts, corrections, blind spots)
- [ ] Each exercise has a "Your approach" vs "Try this" comparison
- [ ] Success criteria are measurable
- [ ] Time estimates are shown
