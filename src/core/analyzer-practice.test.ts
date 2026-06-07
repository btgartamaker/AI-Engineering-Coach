/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for Practice Plan analyzer */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest, AntiPatternData, PracticeGroup } from './types';
import { PracticeAnalyzer } from './analyzer-practice';

function makeReq(overrides: Partial<SessionRequest> & Pick<SessionRequest, 'requestId' | 'messageText' | 'responseText'>): SessionRequest {
  return {
    timestamp: 1_000_000_000,
    isCanceled: false,
    agentName: '',
    agentMode: '',
    modelId: '',
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: null,
    totalElapsed: null,
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: '',
    messageLength: overrides.messageText.length,
    responseLength: overrides.responseText.length,
    userCode: [],
    aiCode: [],
    ...overrides,
  };
}

function makeSession(id: string, reqs: SessionRequest[], overrides?: Partial<Session>): Session {
  return {
    sessionId: id,
    workspaceId: 'test-ws',
    workspaceName: 'Test',
    location: 'terminal',
    harness: 'test',
    creationDate: 1_000_000_000,
    lastMessageDate: 1_000_000_000 + reqs.length * 10_000,
    requestCount: reqs.length,
    requests: reqs,
    ...overrides,
  };
}

describe('PracticeAnalyzer', () => {
  it('returns a practice plan with all skill areas', () => {
    const analyzer = new PracticeAnalyzer([], new Map(), new Map());
    const result = analyzer.getPracticePlan(undefined);
    expect(result.skills.length).toBe(7);
    expect(result.recommendedExercises.length).toBeGreaterThan(0);
    expect(Object.keys(result.levels).length).toBe(7);
  });

  it('maps anti-pattern data to skill proficiencies', () => {
    const antiPatternData: AntiPatternData = {
      patterns: [
        {
          id: 'vague-prompt',
          name: 'Vague Prompts',
          severity: 'high',
          group: 'prompt-quality' as PracticeGroup,
          occurrences: 10,
          description: '',
          suggestion: '',
          examples: [],
          details: [],
          weeklyHist: { labels: [], counts: [] },
        },
      ],
      totalOccurrences: 10,
      weeklyTrend: { labels: [], counts: [] },
      groupScores: [{ group: 'prompt-quality' as PracticeGroup, score: 20, wowPct: 0, momPct: 0, topIssue: null, improvements: [], patternCount: 1 }],
      weeklyScores: { labels: [], series: [] },
    };

    const analyzer = new PracticeAnalyzer([], new Map(), new Map());
    const result = analyzer.getPracticePlan(undefined, antiPatternData);
    const promptSpec = result.skills.find(s => s.area === 'prompt-specificity');
    expect(promptSpec).toBeDefined();
    expect(promptSpec!.score).toBeLessThan(60);
    expect(promptSpec!.isWeakness).toBe(true);
  });

  it('recommends exercises for weak areas', () => {
    const antiPatternData: AntiPatternData = {
      patterns: [
        {
          id: 'no-context', name: 'No Context', severity: 'high',
          group: 'context-management' as PracticeGroup, occurrences: 15,
          description: '', suggestion: '', examples: [], details: [],
          weeklyHist: { labels: [], counts: [] },
        },
        {
          id: 'tool-repetition', name: 'Tool Repetition', severity: 'medium',
          group: 'tool-mastery' as PracticeGroup, occurrences: 8,
          description: '', suggestion: '', examples: [], details: [],
          weeklyHist: { labels: [], counts: [] },
        },
      ],
      totalOccurrences: 23,
      weeklyTrend: { labels: [], counts: [] },
      groupScores: [
        { group: 'context-management' as PracticeGroup, score: 15, wowPct: 0, momPct: 0, topIssue: null, improvements: [], patternCount: 1 },
        { group: 'tool-mastery' as PracticeGroup, score: 30, wowPct: 0, momPct: 0, topIssue: null, improvements: [], patternCount: 1 },
      ],
      weeklyScores: { labels: [], series: [] },
    };

    const analyzer = new PracticeAnalyzer([], new Map(), new Map());
    const result = analyzer.getPracticePlan(undefined, antiPatternData);
    expect(result.recommendedExercises.length).toBeGreaterThanOrEqual(1);
    // Should include exercises for context-provision and tool-selection
    const areas = new Set(result.recommendedExercises.map(e => e.skillArea));
    expect(areas.has('context-provision')).toBe(true);
  });

  it('assigns levels based on scores', () => {
    const analyzer = new PracticeAnalyzer([], new Map(), new Map());
    const result = analyzer.getPracticePlan(undefined);
    // With no anti-pattern data, weak areas get low scores → 'unaware' or 'aware'
    const levels = Object.values(result.levels);
    expect(levels.some(l => l === 'unaware' || l === 'aware')).toBe(true);
  });

  it('includes success criteria for each exercise', () => {
    const analyzer = new PracticeAnalyzer([], new Map(), new Map());
    const result = analyzer.getPracticePlan(undefined);
    for (const ex of result.recommendedExercises) {
      expect(ex.successCriteria.length).toBeGreaterThan(0);
      expect(ex.estimatedMinutes).toBeGreaterThan(0);
    }
  });
});
