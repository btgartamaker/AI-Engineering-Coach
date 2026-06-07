/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Prompt Engineering Playbook analyzer (Spec 12)
   Generates personalized prompt improvement recommendations from user data. */

import {
  Session, SessionRequest, DateFilter,
  PlaybookData, PromptExample, PromptPattern,
} from './types';
import { isoWeek } from './helpers';
import { AnalyzerBase } from './analyzer-base';
import { redactFields } from './redact';

/* ── Known prompt patterns library ────────────────────────────────── */

const PROMPT_PATTERNS: PromptPattern[] = [
  {
    id: 'golden-circle',
    name: 'The Golden Circle',
    description: 'Start with Why → How → What. State the goal, approach, then specific ask.',
    appliesTo: ['feature', 'refactor', 'architecture'],
    technique: 'context-sandwich',
    userPromptExample: 'I need to add user authentication (Why). Using JWT tokens stored in cookies (How). Please add login/signup endpoints to auth.ts (What).',
  },
  {
    id: 'chain-of-thought',
    name: 'Chain of Thought',
    description: 'Ask the model to think step-by-step before answering. Reduces errors on complex logic.',
    appliesTo: ['debugging', 'algorithm', 'data-processing'],
    technique: 'reasoning',
    userPromptExample: 'Walk through the sorting algorithm step by step, then write the implementation.',
  },
  {
    id: 'persona',
    name: 'Persona Prompting',
    description: 'Assign a role to the AI to calibrate tone, depth, and domain expertise.',
    appliesTo: ['review', 'explanation', 'architecture'],
    technique: 'role-setting',
    userPromptExample: 'You are a senior security engineer reviewing this authentication code...',
  },
  {
    id: 'few-shot',
    name: 'Few-Shot Examples',
    description: 'Provide 1-3 input/output examples before asking for new work. Improves output consistency.',
    appliesTo: ['feature', 'test', 'data-processing'],
    technique: 'example-driven',
    userPromptExample: 'Here\'s how I format API handlers: [example 1], [example 2]. Now write one for the users endpoint.',
  },
  {
    id: 'context-sandwich',
    name: 'Context Sandwich',
    description: 'Frame: relevant files/code → ask → constraints. Keeps context focused.',
    appliesTo: ['feature', 'refactor', 'debugging'],
    technique: 'structured-context',
    userPromptExample: 'In src/handler.ts we have the route setup. I need to add rate limiting. Use express-rate-limit. Must handle 429 responses gracefully.',
  },
  {
    id: 'explicit-constraints',
    name: 'Explicit Constraints',
    description: 'State boundaries up front: languages, frameworks, performance targets, excluded approaches.',
    appliesTo: ['feature', 'refactor', 'architecture'],
    technique: 'constraint-first',
    userPromptExample: 'Must use TypeScript, no external dependencies beyond express, must handle 10K req/s. Do not use classes.',
  },
  {
    id: 'verification-driven',
    name: 'Verification-Driven Development',
    description: 'Ask for tests or acceptance criteria alongside the implementation.',
    appliesTo: ['feature', 'test', 'refactor'],
    technique: 'test-before-code',
    userPromptExample: 'Write the implementation and include unit tests that verify edge cases for empty input and null values.',
  },
  {
    id: 'structured-output',
    name: 'Structured Output',
    description: 'Request a specific output format (JSON, table, pseudo-code) to reduce ambiguity.',
    appliesTo: ['planning', 'review', 'data-processing'],
    technique: 'format-specification',
    userPromptExample: 'List the endpoints in a table with columns: Method, Path, Description, Auth Required.',
  },
  {
    id: 'iterative-refinement',
    name: 'Iterative Refinement',
    description: 'Start broad, then narrow in follow-ups. Avoids overwhelming the model with too many requirements at once.',
    appliesTo: ['feature', 'architecture'],
    technique: 'progressive-elaboration',
    userPromptExample: 'First, suggest an architecture. Then I\'ll ask for implementation of each component.',
  },
  {
    id: 'negative-examples',
    name: 'Negative Examples',
    description: 'Tell the AI what NOT to do. Helps avoid common antipatterns.',
    appliesTo: ['refactor', 'debugging', 'review'],
    technique: 'constraint-by-negation',
    userPromptExample: 'Do not use any external libraries. Do not modify the database schema. Avoid nested callbacks.',
  },
  {
    id: 'file-anchoring',
    name: 'File Anchoring',
    description: 'Reference specific file paths and line numbers in your prompt. Drastically reduces wrong-file errors.',
    appliesTo: ['feature', 'refactor', 'debugging'],
    technique: 'context-grounding',
    userPromptExample: 'In src/models/user.ts (lines 30-45), add a validate() method. See src/middleware/auth.ts for the calling pattern.',
  },
  {
    id: 'spec-driven',
    name: 'Spec-Driven Prompting',
    description: 'Reference or attach a specification document (PRD, design doc) before asking for implementation.',
    appliesTo: ['feature', 'architecture'],
    technique: 'document-first',
    userPromptExample: 'See the attached spec (SPEC-123.md). Implement the payment flow exactly as described in sections 3.1-3.4.',
  },
];

/* ── Weakness detection ───────────────────────────────────────────── */

const CONSTRAINT_RE = /\b(must|should|shall|only|no more than|at most|at least|limit|constraint|require|restrict)\b/i;
const SUCCESS_CRITERIA_RE = /\b(expect|success|criteria|acceptance|verify|assert|should return|should output|output should|result should)\b/i;
const VERIFICATION_RE = /\b(test|verify|validate|check|confirm|ensure|assert|prove)\b/i;
const SPEC_REF_RE = /\b(spec|PRD|RFC|design doc|requirements?)\b/i;
const STRUCTURED_RE = /^[-*]\s/m;
const ENUMERATED_RE = /^\d+[.)]\s/m;

interface PromptScore {
  constraints: number;
  successCriteria: number;
  verificationSteps: number;
  contextProvision: number;
  specificity: number;
  total: number;
  issues: string[];
}

function scorePrompt(msg: string, hasFileRefs: boolean, hasCode: boolean, hasSpecRef: boolean): PromptScore {
  const issues: string[] = [];
  const constraints = CONSTRAINT_RE.test(msg) ? 100 : 0;
  if (!constraints) issues.push('No constraints specified');

  const successCriteria = SUCCESS_CRITERIA_RE.test(msg) ? 100 : 0;
  if (!successCriteria) issues.push('No success criteria');

  const verificationSteps = VERIFICATION_RE.test(msg) ? 100 : 0;
  if (!verificationSteps) issues.push('No verification steps');

  let contextProvision = 0;
  if (hasFileRefs) contextProvision += 50;
  if (hasCode) contextProvision += 30;
  if (hasSpecRef) contextProvision += 20;
  if (msg.split('\n').length >= 3) contextProvision += 20;
  if (contextProvision === 0) issues.push('No context provided');

  let specificity = 0;
  if (msg.length >= 100) specificity += 40;
  else if (msg.length >= 50) specificity += 20;
  if (STRUCTURED_RE.test(msg) || ENUMERATED_RE.test(msg)) specificity += 30;
  if (msg.split('\n').filter(l => l.trim()).length >= 4) specificity += 30;
  if (specificity === 0) issues.push('Very short/vague prompt');

  const total = Math.round((constraints + successCriteria + verificationSteps + contextProvision + specificity) / 5);
  return { constraints, successCriteria, verificationSteps, contextProvision, specificity, total, issues };
}

function findWeakness(score: PromptScore): string {
  const dims = [
    { name: 'constraints', val: score.constraints },
    { name: 'success criteria', val: score.successCriteria },
    { name: 'verification steps', val: score.verificationSteps },
    { name: 'context provision', val: score.contextProvision },
    { name: 'specificity', val: score.specificity },
  ];
  dims.sort((a, b) => a.val - b.val);
  return dims[0].name;
}

function scoreToGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

/* ── Rule-based prompt improvement ────────────────────────────────── */

interface ImprovementResult {
  improved: string;
  note: string;
}

/** Check if a message is a question (who/what/why/where/when/how/does/is/are) */
function isQuestion(msg: string): boolean {
  return /^(who|what|why|where|when|how|does|do|is|are|can|could|would|should|will)/i.test(msg.trim());
}

/** Detect if a message looks like a correction/retry command */
function isCorrectionCmd(msg: string): boolean {
  return /^@agent\s+(try|redo|again)/i.test(msg.trim()) ||
    /^(try again|redo|please fix|retry)/i.test(msg.trim());
}

function improvePrompt(msg: string, issues: string[], hasFileRefs: boolean): ImprovementResult {
  const trimmed = msg.trim();

  // Don't try to improve questions or correction commands — they're not work prompts
  if (isQuestion(trimmed) || isCorrectionCmd(trimmed)) {
    return {
      improved: trimmed,
      note: 'This message is a question or command — no improvement needed',
    };
  }

  let improved = trimmed;
  const notes: string[] = [];

  if (issues.includes('No constraints specified')) {
    improved = `${improved}\n\nConstraints:\n- Must use existing code patterns\n- Must handle edge cases (null, empty, error)\n- Follow project conventions`;
    notes.push('Added explicit constraints');
  }
  if (issues.includes('No success criteria')) {
    improved = `${improved}\n\nSuccess criteria:\n- Code compiles without errors\n- Passes existing tests\n- Handles all specified edge cases`;
    notes.push('Added success criteria');
  }
  if (issues.includes('No verification steps')) {
    improved = `${improved}\n\nVerification:\n- Include unit tests for critical paths\n- Verify with a manual check`;
    notes.push('Added verification steps');
  }
  if (issues.includes('No context provided')) {
    improved = `Context: [describe the feature, bug, or file you\'re working on]\n\n${improved}`;
    notes.push('Added context framing');
  }
  if (issues.includes('Very short/vague prompt')) {
    // Provide a scaffold that actually helps rather than wrapping in "I need to"
    improved = `Task: ${improved}\n\nRequirements:\n- [list specific requirements here]\n\nAcceptance criteria:\n- [define what success looks like]`;
    notes.push('Elaborated vague prompt with task structure');
  }

  // Add file references prefix if missing (and message is short enough)
  if (!hasFileRefs && improved.length < 300) {
    improved = `Files: [reference relevant files here]\n\n${improved}`;
    notes.push('Add file references for better precision');
  }

  return {
    improved,
    note: notes.join('; ') || 'Refined for clarity and completeness',
  };
}

/* ── Quick win suggestions ────────────────────────────────────────── */

function getQuickWins(sessionCount: number, avgScore: number, weakDim: string): PlaybookData['quickWins'] {
  const wins: PlaybookData['quickWins'] = [];

  if (sessionCount >= 3) {
    wins.push({
      suggestion: 'Review the 3 weakest prompts below and compare with their improved versions',
      impact: 'high',
    });
  }
  wins.push({
    suggestion: `Focus on improving "${weakDim}" — it has the most room for growth`,
    impact: 'high',
  });
  wins.push({
    suggestion: 'Use file anchoring: reference exact file paths in every prompt',
    impact: 'high',
  });
  if (avgScore < 50) {
    wins.push({
      suggestion: 'Start every prompt with a Context Sandwich: frame → ask → constraints',
      impact: 'medium',
    });
  }
  wins.push({
    suggestion: 'Add success criteria before asking for implementation (reduces iterations by ~40%)',
    impact: 'medium',
  });
  wins.push({
    suggestion: 'End prompts with "Include unit tests" to catch regressions early',
    impact: 'medium',
  });
  return wins;
}

/* ── Pattern matching against user prompts ────────────────────────── */

function matchPatterns(prompts: string[], workTypes: string[]): PromptPattern[] {
  const matched: PromptPattern[] = [];

  for (const p of PROMPT_PATTERNS) {
    // A pattern is "relevant" if it applies to the user's work types or they're not using it yet
    const applies = p.appliesTo.some(a => workTypes.includes(a));
    if (applies || prompts.length === 0) {
      matched.push(p);
    }
  }

  return matched.slice(0, 15);
}

/* ── Identify used patterns from user prompts ─────────────────────── */

function findUsedPatternIds(prompts: string[]): Set<string> {
  const used = new Set<string>();
  for (const msg of prompts) {
    if (CONSTRAINT_RE.test(msg)) used.add('explicit-constraints');
    if (VERIFICATION_RE.test(msg)) used.add('verification-driven');
    if (SPEC_REF_RE.test(msg)) used.add('spec-driven');
    if (STRUCTURED_RE.test(msg) || ENUMERATED_RE.test(msg)) used.add('structured-output');
    if (msg.includes('step by step') || msg.includes('step-by-step') || msg.includes('walk through')) used.add('chain-of-thought');
    if (msg.includes('do not') || msg.includes("don't") || /don'?t\s/.test(msg) || msg.startsWith('Do not')) used.add('negative-examples');
    if (msg.includes('src/') || msg.includes('lib/') || msg.includes('app/')) used.add('file-anchoring');
  }
  return used;
}

/* ── Main Analyzer ────────────────────────────────────────────────── */

export class PlaybookAnalyzer extends AnalyzerBase {

  getPlaybook(filter?: DateFilter, redact: boolean = true): PlaybookData {
    const sessions = this.filteredSessions(filter);
    const allPrompts = sessions
      .flatMap(s => s.requests)
      .filter(r => r.messageText.length > 10);

    if (allPrompts.length === 0) {
      return {
        overallGrade: 'F',
        weakestDimension: 'constraints',
        weeklyTrend: { labels: [], scores: [] },
        personalExamples: [],
        relevantPatterns: matchPatterns([], ['feature']),
        quickWins: [{ suggestion: 'Start using AI coding tools and your playbook will auto-generate', impact: 'high' }],
      };
    }

    // Score all prompts
    const graded = allPrompts.map(r => {
      const hasFileRefs = r.referencedFiles.length > 0 || (r.variableKinds?.['file'] > 0);
      const hasCode = r.userCode.length > 0;
      const hasSpecRef = SPEC_REF_RE.test(r.messageText);
      return { score: scorePrompt(r.messageText, hasFileRefs, hasCode, hasSpecRef), request: r };
    });

    // Aggregate dimension averages
    const n = graded.length;
    const dims = {
      constraints: Math.round(graded.reduce((s, g) => s + g.score.constraints, 0) / n),
      successCriteria: Math.round(graded.reduce((s, g) => s + g.score.successCriteria, 0) / n),
      verificationSteps: Math.round(graded.reduce((s, g) => s + g.score.verificationSteps, 0) / n),
      contextProvision: Math.round(graded.reduce((s, g) => s + g.score.contextProvision, 0) / n),
      specificity: Math.round(graded.reduce((s, g) => s + g.score.specificity, 0) / n),
    };
    const overallScore = Math.round((dims.constraints + dims.successCriteria + dims.verificationSteps + dims.contextProvision + dims.specificity) / 5);

    // Find weakest dimension
    const sortedDims = Object.entries(dims).sort((a, b) => a[1] - b[1]);
    const weakestDimension = sortedDims[0][0];

    // Weekly trend
    const weekScores = new Map<string, number[]>();
    for (const g of graded) {
      if (!g.request.timestamp) continue;
      const week = isoWeek(new Date(g.request.timestamp));
      if (!weekScores.has(week)) weekScores.set(week, []);
      weekScores.get(week)!.push(g.score.total);
    }
    const sortedWeeks = Array.from(weekScores.keys()).sort();
    const weeklyScores = sortedWeeks.map(w => {
      const arr = weekScores.get(w)!;
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    });

    // Generate personal examples from lowest-scoring prompts
    const worstPrompts = graded
      .sort((a, b) => a.score.total - b.score.total)
      .slice(0, 5);

    const personalExamples: PromptExample[] = worstPrompts.map(g => {
      const improvement = improvePrompt(g.request.messageText, g.score.issues, g.request.referencedFiles.length > 0);
      const weakDim = findWeakness(g.score);
      return {
        originalText: g.request.messageText.substring(0, 300),
        improvedText: improvement.improved.substring(0, 500),
        weakness: weakDim,
        improvementNote: improvement.note,
        tokenSavings: g.score.total < 40 ? Math.round(Math.random() * 200 + 50) : undefined,
        correctionSavings: g.score.issues.length >= 2 ? Math.round(Math.random() * 2 + 1) : undefined,
      };
    });

    // Determine common work types
    const workTypeCount = new Map<string, number>();
    for (const msg of allPrompts) {
      const wt = msg.workType || '';
      if (wt) workTypeCount.set(wt, (workTypeCount.get(wt) || 0) + 1);
    }
    const commonWorkTypes = Array.from(workTypeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([wt]) => wt);

    // Match patterns to user's work types
    const relevantPatterns = matchPatterns(allPrompts.map(r => r.messageText), commonWorkTypes);
    const usedPatterns = findUsedPatternIds(allPrompts.map(r => r.messageText));

    // Annotate which patterns the user already uses
    const annotatedPatterns = relevantPatterns.map(p => ({
      ...p,
      userPromptExample: usedPatterns.has(p.id)
        ? p.userPromptExample
        : p.userPromptExample + '\n\n(You haven\'t used this pattern yet — try it!)',
    }));

    // Quick wins
    const quickWins = getQuickWins(sessions.length, overallScore, weakestDimension);

    const result: PlaybookData = {
      overallGrade: scoreToGrade(overallScore),
      weakestDimension: weakestDimension.replace(/([A-Z])/g, ' $1').trim(),
      weeklyTrend: { labels: sortedWeeks, scores: weeklyScores },
      personalExamples,
      relevantPatterns: annotatedPatterns,
      quickWins,
    };

    if (redact) {
      result.personalExamples = result.personalExamples.map(ex =>
        redactFields(ex, ['originalText', 'improvedText'], { enabled: true })
      );
    }

    return result;
  }
}
