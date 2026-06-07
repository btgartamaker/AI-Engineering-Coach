/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the Correction Turn analyzer */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest } from './types';
import { CorrectionsAnalyzer } from './analyzer-corrections';

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

describe('CorrectionsAnalyzer', () => {
  it('detects zero corrections in a clean session', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Add a function', responseText: 'Here you go' }),
      makeReq({ requestId: 'r2', messageText: 'Great, thanks', responseText: 'Youre welcome' }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.totalCorrectionTurns).toBe(0);
    expect(result.correctionRate).toBe(0);
    expect(result.wastedTokens).toBe(0);
  });

  it('detects a correction loop from user fixing output', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Write a sort function', responseText: 'def sort(arr): return arr' }),
      makeReq({ requestId: 'r2', messageText: 'That\'s not what I wanted, fix this', responseText: 'def sort(arr): return sorted(arr)', editedFiles: ['test.py'], promptTokens: 50, completionTokens: 30 }),
      makeReq({ requestId: 'r3', messageText: 'Still wrong, try again', responseText: 'def sort(arr): arr.sort(); return arr', editedFiles: ['test.py'], promptTokens: 40, completionTokens: 20 }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.totalCorrectionTurns).toBeGreaterThanOrEqual(1);
    expect(result.correctionRate).toBeGreaterThan(0);
    expect(result.wastedTokens).toBeGreaterThan(0);
    expect(result.recentCorrections.length).toBeGreaterThanOrEqual(1);
    const c = result.recentCorrections[0];
    expect(c.correctionCount).toBeGreaterThanOrEqual(1);
    expect(c.originalRequest).toContain('Write a sort function');
  });

  it('categorizes corrections by type', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Build a web server', responseText: 'def handle(req): pass' }),
      makeReq({ requestId: 'r2', messageText: 'This doesnt compile, fix the syntax error', responseText: 'def handle(req): return None' }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.totalCorrectionTurns).toBe(1);
    expect(result.byCategory['syntax-error']).toBe(1);
  });

  it('detects scope creep corrections', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Create a user model', responseText: 'class User: pass' }),
      makeReq({ requestId: 'r2', messageText: 'Also add validation while youre at it', responseText: 'class User:\n  def validate(self): pass' }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.byCategory['scope-creep']).toBe(1);
  });

  it('detects tool misfire corrections', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Write handler to test.py', responseText: 'def handler(): pass' }),
      makeReq({ requestId: 'r2', messageText: 'Wrong file, should have been in src/handler.py', responseText: 'def handler(): pass' }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.byCategory['tool-misfire']).toBe(1);
  });

  it('computes weekly trend', () => {
    const now = Date.now();
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'Hello', responseText: 'Hi', timestamp: now - 7 * 86_400_000 * 2 }),
      makeReq({ requestId: 'r2', messageText: 'Thats not right', responseText: 'Fixed', timestamp: now - 7 * 86_400_000 * 2 }),
    ];
    const session = makeSession('s1', reqs, { lastMessageDate: now - 7 * 86_400_000 * 2 });
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.weeklyTrend.labels.length).toBeGreaterThanOrEqual(1);
    expect(result.weeklyTrend.correctionRate.length).toBeGreaterThanOrEqual(1);
  });

  it('handles sessions with no requests gracefully', () => {
    const session = makeSession('empty', [], { requestCount: 0 });
    const analyzer = new CorrectionsAnalyzer([session], new Map(), new Map());
    const result = analyzer.analyze();
    expect(result.totalCorrectionTurns).toBe(0);
    expect(result.correctionRate).toBe(0);
  });
});
