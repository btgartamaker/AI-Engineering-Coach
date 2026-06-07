/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for ROI analyzer */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest } from './types';
import { ROIAnalyzer } from './analyzer-roi';

function makeReq(overrides: Partial<SessionRequest> & Pick<SessionRequest, 'requestId' | 'messageText' | 'responseText'>): SessionRequest {
  return {
    timestamp: 1_000_000_000,
    isCanceled: false,
    agentName: '',
    agentMode: '',
    modelId: 'gpt-4.1',
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
    promptTokens: 1000,
    completionTokens: 500,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: '',
    messageLength: overrides.messageText.length,
    responseLength: overrides.responseText.length,
    userCode: [],
    aiCode: [{ language: 'typescript', loc: 20 }],
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

describe('ROIAnalyzer', () => {
  it('returns zero costs when no sessions', () => {
    const analyzer = new ROIAnalyzer([], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.totalEstimatedCost).toBe(0);
    expect(result.totalEstimatedTimeSaved).toBe(0);
    expect(result.tasksCompleted).toBe(0);
  });

  it('estimates cost from token data', () => {
    const reqs = [makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi' })];
    const session = makeSession('s1', reqs);
    const analyzer = new ROIAnalyzer([session], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.totalEstimatedCost).toBeGreaterThan(0);
    expect(result.modelROI).toHaveLength(1);
    expect(result.modelROI[0].modelId).toBe('gpt-4.1');
  });

  it('counts tasks completed from sessions with edits', () => {
    const reqsEdit = [makeReq({ requestId: 'r1', messageText: 'edit', responseText: 'ok', editedFiles: ['file.ts'] })];
    const reqsNoEdit = [makeReq({ requestId: 'r2', messageText: 'hello', responseText: 'hi' })];
    const s1 = makeSession('s1', reqsEdit);
    const s2 = makeSession('s2', reqsNoEdit);
    const analyzer = new ROIAnalyzer([s1, s2], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.tasksCompleted).toBe(1);
  });

  it('estimates time saved from LoC and tools', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', aiCode: [{ language: 'typescript', loc: 50 }], toolsUsed: ['read_file', 'grep_search'] }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new ROIAnalyzer([session], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.totalEstimatedTimeSaved).toBeGreaterThan(0);
  });

  it('computes per-model breakdown', () => {
    const reqs1 = [makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', modelId: 'gpt-4.1' })];
    const reqs2 = [makeReq({ requestId: 'r2', messageText: 'hello', responseText: 'hi', modelId: 'claude-sonnet-4' })];
    const analyzer = new ROIAnalyzer([
      makeSession('s1', reqs1),
      makeSession('s2', reqs2),
    ], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.modelROI).toHaveLength(2);
  });

  it('computes weekly trend', () => {
    const now = Date.now();
    const reqs = [makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', timestamp: now - 14 * 86_400_000 })];
    const session = makeSession('s1', reqs, { lastMessageDate: now - 14 * 86_400_000 });
    const analyzer = new ROIAnalyzer([session], new Map(), new Map());
    const result = analyzer.getROI();
    expect(result.weeklyCost.labels.length).toBeGreaterThanOrEqual(1);
  });
});
