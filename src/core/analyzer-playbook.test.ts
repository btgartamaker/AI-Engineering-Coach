/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the Prompt Engineering Playbook analyzer */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest } from './types';
import { PlaybookAnalyzer } from './analyzer-playbook';

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

describe('PlaybookAnalyzer', () => {
  it('returns empty data when no prompts exist', () => {
    const analyzer = new PlaybookAnalyzer([], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.overallGrade).toBe('F');
    expect(result.personalExamples).toHaveLength(0);
    expect(result.relevantPatterns.length).toBeGreaterThan(0);
    expect(result.quickWins.length).toBeGreaterThan(0);
  });

  it('grades a well-structured prompt highly', () => {
    const reqs = [
      makeReq({
        requestId: 'r1',
        messageText: 'Add authentication middleware to the Express app. Must use JWT tokens stored in cookies. Should verify tokens on every protected route. Only admins can access /admin. Include unit tests for each middleware function. Refer to src/middleware/auth.ts for the existing pattern.',
        responseText: 'Here is the implementation.',
        referencedFiles: ['src/middleware/auth.ts'],
        userCode: [{ language: 'typescript', loc: 10 }],
      }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new PlaybookAnalyzer([session], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.overallGrade).toBe('A');
    expect(result.weakestDimension).toBeTruthy();
    expect(result.personalExamples).toHaveLength(1);
  });

  it('grades a vague prompt poorly and generates improvements', () => {
    const reqs = [
      makeReq({
        requestId: 'r1',
        messageText: 'fix the bug in login',
        responseText: 'Fixed.',
      }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new PlaybookAnalyzer([session], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.overallGrade).toBe('F');
    expect(result.personalExamples).toHaveLength(1);
    expect(result.personalExamples[0].weakness).toBeTruthy();
    expect(result.personalExamples[0].improvedText.length).toBeGreaterThan(result.personalExamples[0].originalText.length);
  });

  it('generates pattern library relevant to work types', () => {
    const reqs = [
      makeReq({
        requestId: 'r1',
        messageText: 'Create a new API endpoint. Must validate input. Should return proper error codes.',
        responseText: 'Done.',
        workType: 'feature',
      }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new PlaybookAnalyzer([session], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.relevantPatterns.length).toBeGreaterThanOrEqual(1);
    // Should include feature-relevant patterns like "The Golden Circle"
    expect(result.relevantPatterns.some(p => p.id === 'golden-circle')).toBe(true);
  });

  it('detects used patterns from prompts', () => {
    const reqs = [
      makeReq({
        requestId: 'r1',
        messageText: 'Write step by step. Do not use any external libraries. Verify with unit tests. Refer to src/models/user.ts.',
        responseText: 'Done.',
        referencedFiles: ['src/models/user.ts'],
      }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new PlaybookAnalyzer([session], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.overallGrade).toBeDefined();
    expect(result.personalExamples).toHaveLength(1);
  });

  it('computes weekly trend over multiple sessions', () => {
    const now = Date.now();
    const reqs1 = [
      makeReq({ requestId: 'r1', messageText: 'A short prompt', responseText: 'OK', timestamp: now - 14 * 86_400_000 }),
    ];
    const reqs2 = [
      makeReq({
        requestId: 'r2',
        messageText: 'A much longer prompt with constraints and file references for better quality output',
        responseText: 'OK',
        timestamp: now - 7 * 86_400_000,
        referencedFiles: ['file.ts'],
      }),
    ];
    const s1 = makeSession('s1', reqs1, { lastMessageDate: now - 14 * 86_400_000 });
    const s2 = makeSession('s2', reqs2, { lastMessageDate: now - 7 * 86_400_000 });
    const analyzer = new PlaybookAnalyzer([s1, s2], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.weeklyTrend.labels.length).toBeGreaterThanOrEqual(1);
    expect(result.weeklyTrend.scores.length).toBeGreaterThanOrEqual(1);
  });

  it('reports quick wins for improvement', () => {
    const reqs = [
      makeReq({
        requestId: 'r1',
        messageText: 'write some code to fix the issue',
        responseText: 'Done.',
      }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new PlaybookAnalyzer([session], new Map(), new Map());
    const result = analyzer.getPlaybook();
    expect(result.quickWins.length).toBeGreaterThanOrEqual(3);
    expect(result.quickWins.some(q => q.impact === 'high')).toBe(true);
  });
});
