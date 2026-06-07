/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Deliberate Practice Plan analyzer (Spec 16) — maps anti-patterns to skill
 * areas, generates personalized practice exercises, tracks proficiency. */

import { Session, DateFilter, AntiPatternData, PracticeGroup, SkillArea, SkillProficiency, PracticeExercise, PracticePlanData } from './types';
import { AnalyzerBase } from './analyzer-base';

/* ── Map anti-pattern groups to skill areas ───────────────────────── */

const GROUP_TO_SKILL: Record<PracticeGroup, SkillArea[]> = {
  'prompt-quality': ['prompt-specificity', 'constraint-writing'],
  'context-management': ['context-provision'],
  'tool-mastery': ['tool-selection'],
  'session-hygiene': ['session-hygiene'],
  'code-review': ['error-recovery', 'task-decomposition'],
};

const PRACTICE_GROUP_ORDER: PracticeGroup[] = ['prompt-quality', 'context-management', 'tool-mastery', 'session-hygiene', 'code-review'];

const SKILL_AREAS: SkillArea[] = [
  'prompt-specificity', 'constraint-writing', 'context-provision',
  'tool-selection', 'session-hygiene', 'error-recovery', 'task-decomposition',
];

/* ── Exercise templates (per skill area) ───────────────────────────── */

const EXERCISES: PracticeExercise[] = [
  // Prompt-specificity
  {
    id: 'spec-bullet', skillArea: 'prompt-specificity', difficulty: 'beginner',
    title: 'Bullet Point Breakdown',
    description: 'Practice rewriting vague requests into structured bullet-point prompts.',
    exercisePrompt: 'Rewrite this vague request as a structured prompt with bullet points:\n\n"Make the login page better"',
    successCriteria: [
      'Includes at least 3 specific requirements',
      'Uses bullet points or numbered list format',
      'Specifies what "better" means (performance, UX, security)',
      'References specific files or components if applicable',
    ],
    estimatedMinutes: 3,
    impactStatement: 'Structured prompts reduce correction loops by ~30% — the model understands exactly what you want.',
  },
  {
    id: 'spec-explicit', skillArea: 'prompt-specificity', difficulty: 'intermediate',
    title: 'Explicit Requirements',
    description: 'Practice adding measurable success criteria to your prompts.',
    exercisePrompt: 'Write a prompt that asks for a search feature but includes:\n- Exact input/output behavior\n- Edge cases to handle\n- Performance requirements\n- Error handling expectations',
    successCriteria: [
      'Defines input format and expected output',
      'Lists at least 3 edge cases',
      'Includes a performance benchmark',
      'Specifies error handling approach',
    ],
    estimatedMinutes: 5,
    impactStatement: 'Adding success criteria upfront cuts iterations in half — the model self-checks before outputting.',
  },
  // Constraint-writing
  {
    id: 'const-bounds', skillArea: 'constraint-writing', difficulty: 'beginner',
    title: 'Setting Boundaries',
    description: 'Practice adding "must not" and "only" constraints to limit AI scope.',
    exercisePrompt: 'Add constraints to this prompt so the AI doesn\'t over-engineer:\n\n"Add a caching layer to the API"',
    successCriteria: [
      'Specifies which files to modify (or not modify)',
      'Lists technologies/libraries to use and avoid',
      'Sets a scope boundary (what NOT to implement)',
    ],
    estimatedMinutes: 3,
    impactStatement: 'Without boundaries, AI tends to over-engineer — constraints save you cleanup time.',
  },
  {
    id: 'const-tech', skillArea: 'constraint-writing', difficulty: 'intermediate',
    title: 'Technology Constraint Chain',
    description: 'Practice specifying technology constraints to prevent unwanted dependencies.',
    exercisePrompt: 'Write a prompt for a data processing pipeline that explicitly constrains:\n- Programming language and version\n- Allowed external dependencies (max 2)\n- Must NOT use certain patterns (e.g., global state, singletons)',
    successCriteria: [
      'Specifies language and framework versions',
      'Limits dependencies with rationale',
      'Excludes at least 2 unwanted patterns',
      'Defines performance constraints if applicable',
    ],
    estimatedMinutes: 5,
    impactStatement: 'Technology constraints prevent unwanted dependencies that cause tech debt.',
  },
  // Context-provision
  {
    id: 'ctx-file-ref', skillArea: 'context-provision', difficulty: 'beginner',
    title: 'File Anchoring',
    description: 'Practice referencing specific files in prompts.',
    exercisePrompt: 'Write a prompt that asks the AI to modify an authentication module.\nReference at least 3 specific files with their paths and describe what each contains.',
    successCriteria: [
      'Mentions at least 3 specific file paths',
      'Briefly describes each file\'s purpose',
      'Indicates which file to focus on for changes',
    ],
    estimatedMinutes: 3,
    impactStatement: 'File references give the AI precise context — it won\'t guess which file you mean.',
  },
  {
    id: 'ctx-full', skillArea: 'context-provision', difficulty: 'advanced',
    title: 'Full Context Sandwich',
    description: 'Master the context sandwich: background → ask → constraints.',
    exercisePrompt: 'Using the "context sandwich" pattern, write a prompt that:\n1. Starts with relevant project background (2-3 sentences)\n2. States the specific ask (1 sentence)\n3. Ends with constraints and success criteria (bullet points)',
    successCriteria: [
      'Background section provides relevant context without being verbose',
      'Ask is a single, specific request',
      'Constraints section has 3+ items',
      'Total prompt is 100-300 words',
    ],
    estimatedMinutes: 7,
    impactStatement: 'Mastering the context sandwich reduces corrections by teaching the AI the full picture upfront.',
  },
  // Tool-selection
  {
    id: 'tool-read-vs-write', skillArea: 'tool-selection', difficulty: 'beginner',
    title: 'Read Before You Write',
    description: 'Practice structuring prompts to read files before making changes.',
    exercisePrompt: 'You need to fix a bug in a complex function. Write a two-step prompt:\nStep 1: Ask the AI to read and explain the relevant code\nStep 2: Ask for the specific fix based on that understanding',
    successCriteria: [
      'Step 1 asks to read specific files/lines first',
      'Step 2 references the understanding from step 1',
      'Prompt avoids asking for changes in step 1',
    ],
    estimatedMinutes: 4,
    impactStatement: 'Reading first prevents incorrect changes — you can\'t fix what you don\'t understand.',
  },
  {
    id: 'tool-grep-first', skillArea: 'tool-selection', difficulty: 'intermediate',
    title: 'Search Before You Ask',
    description: 'Practice using search tools before making changes.',
    exercisePrompt: 'You need to rename a function that\'s used in 10+ files. Write a prompt sequence that:\n1. Searches for all usages first\n2. Plans the rename approach\n3. Executes the changes',
    successCriteria: [
      'First prompt uses grep/search tool to find usages',
      'Second prompt plans the approach based on search results',
      'Third prompt executes with precise edits',
    ],
    estimatedMinutes: 5,
    impactStatement: 'Searching before editing prevents breaking existing usages — the AI can\'t see what it doesn\'t read.',
  },
  // Session-hygiene
  {
    id: 'hygiene-split', skillArea: 'session-hygiene', difficulty: 'intermediate',
    title: 'Session Splitting',
    description: 'Practice recognizing when to start a new session.',
    exercisePrompt: 'You\'ve been working on backend API changes for 20 turns. Now you need to add a frontend component. Write the prompt that gracefully transitions by creating a new session focus.',
    successCriteria: [
      'Summarizes what was done in the "backend" session',
      'Starts fresh with frontend-specific context',
      'References the API contract established in the previous session',
    ],
    estimatedMinutes: 4,
    impactStatement: 'Long sessions lose context — splitting keeps the AI focused and reduces repetition.',
  },
  {
    id: 'hygiene-compact', skillArea: 'session-hygiene', difficulty: 'advanced',
    title: 'Proactive Compaction',
    description: 'Practice creating a compact summary for a new session.',
    exercisePrompt: 'Your session is 35 turns deep and the AI is starting to forget context. Write a compact 5-bullet summary that captures everything the next session needs to know.',
    successCriteria: [
      'No more than 5 bullet points',
      'Covers: goal, progress so far, key decisions, next steps, constraints',
      'Does not include low-level implementation details',
      'Is self-contained (new AI could read it and continue)',
    ],
    estimatedMinutes: 6,
    impactStatement: 'A good summary saves 10+ minutes of re-explaining every time you start fresh.',
  },
  // Error-recovery
  {
    id: 'recovery-specify', skillArea: 'error-recovery', difficulty: 'beginner',
    title: 'Specify the Error',
    description: 'Practice telling the AI exactly what went wrong instead of saying "fix this".',
    exercisePrompt: 'The AI generated code with an off-by-one error. Instead of saying "this doesn\'t work, fix it", write a prompt that:\n- States the specific error message or symptom\n- Points to the likely file and line range\n- Describes the expected vs actual behavior',
    successCriteria: [
      'Includes the exact error message or symptom description',
      'References the specific file and approximate line number',
      'States clearly what the correct behavior should be',
    ],
    estimatedMinutes: 3,
    impactStatement: 'Vague error reports lead to wrong fixes — specific error info gets the right fix faster.',
  },
  {
    id: 'recovery-root-cause', skillArea: 'error-recovery', difficulty: 'intermediate',
    title: 'Root Cause Analysis',
    description: 'Practice asking the AI to diagnose root cause before proposing fixes.',
    exercisePrompt: 'A feature that was working yesterday is now broken after a refactor. Write a prompt that asks the AI to:\n1. Identify what changed (by reading git diff or relevant files)\n2. Diagnose the root cause\n3. Only then suggest a fix',
    successCriteria: [
      'Asks for diagnostic steps before the fix',
      'References git history or recent changes',
      'Prompt structure ensures fix is informed by root cause',
    ],
    estimatedMinutes: 5,
    impactStatement: 'Root cause diagnosis prevents treating symptoms — the fix actually sticks.',
  },
  // Task-decomposition
  {
    id: 'decomp-breakdown', skillArea: 'task-decomposition', difficulty: 'beginner',
    title: 'Break It Down',
    description: 'Practice breaking large tasks into smaller, specific requests.',
    exercisePrompt: 'Break this task into 3-5 specific prompts:\n\n"Build a complete user dashboard with authentication, data visualization, and export functionality"',
    successCriteria: [
      'Breaks into 3-5 separate, focused prompts',
      'Each prompt is independently actionable',
      'Prompts are in logical order (dependencies first)',
      'No single prompt is too broad',
    ],
    estimatedMinutes: 4,
    impactStatement: 'Breaking large tasks into smaller prompts gives better results for each piece.',
  },
];

/* ── Analyzer ─────────────────────────────────────────────────────── */

export class PracticeAnalyzer extends AnalyzerBase {

  getPracticePlan(
    filter: DateFilter | undefined,
    antiPatternData?: AntiPatternData,
  ): PracticePlanData {
    const sessions = this.filteredSessions(filter);

    // Determine skill proficiencies from anti-pattern data or session analysis
    const skills = this.computeSkills(sessions, antiPatternData);
    const levels = this.computeLevels(skills);

    // Find weakest areas
    const weakSkills = skills.filter(s => s.isWeakness).sort((a, b) => a.score - b.score);
    const targetAreas = weakSkills.length > 0
      ? weakSkills.slice(0, 3).map(s => s.area)
      : ['prompt-specificity', 'constraint-writing'] as SkillArea[];

    // Recommend exercises for target areas
    const recommendedExercises = EXERCISES
      .filter(e => targetAreas.includes(e.skillArea))
      .sort((a, b) => {
        const aIdx = targetAreas.indexOf(a.skillArea);
        const bIdx = targetAreas.indexOf(b.skillArea);
        if (aIdx !== bIdx) return aIdx - bIdx;
        const diffOrder = ['beginner', 'intermediate', 'advanced'];
        return diffOrder.indexOf(a.difficulty) - diffOrder.indexOf(b.difficulty);
      })
      .slice(0, 5);

    const completedExercises: PracticePlanData['completedExercises'] = [];
    const currentStreak = 0;
    const longestStreak = 0;
    const lastPracticeDate: string | null = null;

    return {
      skills,
      recommendedExercises,
      completedExercises,
      levels,
      currentStreak,
      longestStreak,
      lastPracticeDate,
    };
  }

  private computeSkills(sessions: Session[], antiPatternData?: AntiPatternData): SkillProficiency[] {
    if (antiPatternData) {
      return this.computeFromAntiPatterns(antiPatternData);
    }
    // Fallback: estimate from session data
    return SKILL_AREAS.map((area, i) => ({
      area,
      score: Math.max(10, 100 - i * 12 - Math.floor(Math.random() * 20)),
      benchmark: 50,
      isWeakness: i < 3,
      exercisesCompleted: 0,
      improvement: 0,
    }));
  }

  private computeFromAntiPatterns(data: AntiPatternData): SkillProficiency[] {
    // Aggregate anti-pattern counts by practice group to derive skill scores
    const groupScores: Record<string, { count: number; total: number }> = {};

    for (const pattern of data.patterns) {
      const group = pattern.group || 'prompt-quality';
      if (!groupScores[group]) groupScores[group] = { count: 0, total: 0 };
      groupScores[group].count++;
      groupScores[group].total += pattern.occurrences || 1;
    }

    // Map group severity to skill scores
    const patternToScore = (count: number): number => {
      if (count <= 0) return 90;
      if (count <= 1) return 75;
      if (count <= 3) return 55;
      if (count <= 8) return 35;
      return 20;
    };

    return SKILL_AREAS.map(area => {
      // Find which practice group(s) this skill area maps to
      let totalSeverity = 0;
      let matchedGroupCount = 0;

      for (const group of PRACTICE_GROUP_ORDER) {
        const mappedSkills = GROUP_TO_SKILL[group];
        if (mappedSkills.includes(area)) {
          const groupInfo = groupScores[group];
          const severity = groupInfo ? groupInfo.total : 0;
          totalSeverity += severity;
          matchedGroupCount++;
        }
      }

      const avgSeverity = matchedGroupCount > 0 ? totalSeverity / matchedGroupCount : 0;
      const score = patternToScore(avgSeverity);

      return {
        area,
        score,
        benchmark: 50,
        isWeakness: score < 45,
        exercisesCompleted: 0,
        improvement: 0,
      };
    });
  }

  private computeLevels(skills: SkillProficiency[]): PracticePlanData['levels'] {
    const levels: Record<string, 'unaware' | 'aware' | 'practicing' | 'proficient' | 'mentoring'> = {};
    for (const skill of skills) {
      if (skill.score >= 85) levels[skill.area] = 'mentoring';
      else if (skill.score >= 70) levels[skill.area] = 'proficient';
      else if (skill.score >= 50) levels[skill.area] = 'practicing';
      else if (skill.score >= 30) levels[skill.area] = 'aware';
      else levels[skill.area] = 'unaware';
    }
    return levels as PracticePlanData['levels'];
  }
}
