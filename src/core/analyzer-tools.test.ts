/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for Tool Proficiency analyzer */

import { describe, it, expect } from 'vitest';
import { Session, SessionRequest } from './types';
import { ToolAnalyzer } from './analyzer-tools';

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
    harness: 'GitHub Copilot',
    creationDate: 1_000_000_000,
    lastMessageDate: 1_000_000_000 + reqs.length * 10_000,
    requestCount: reqs.length,
    requests: reqs,
    ...overrides,
  };
}

describe('ToolAnalyzer', () => {
  it('returns empty data when no sessions exist', () => {
    const analyzer = new ToolAnalyzer([], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    expect(result.overallScore).toBe(0);
    expect(result.toolsUsed).toHaveLength(0);
    expect(result.blindSpots.length).toBe(0);
    expect(result.topSuggestions.length).toBeGreaterThan(0);
  });

  it('aggregates tool usage across sessions', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', toolsUsed: ['Read', 'Edit', 'Write'] }),
      makeReq({ requestId: 'r2', messageText: 'fix', responseText: 'done', toolsUsed: ['Edit', 'Bash'] }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new ToolAnalyzer([session], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    expect(result.toolsUsed.length).toBeGreaterThanOrEqual(3);
    expect(result.overallScore).toBeGreaterThan(0);
    const editStat = result.toolsUsed.find(t => t.toolName === 'edit_file');
    expect(editStat).toBeDefined();
    expect(editStat!.callCount).toBe(2);
  });

  it('detects blind spots for the user harness', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', toolsUsed: ['write_file', 'read_file'] }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new ToolAnalyzer([session], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    // Should have blind spots since the user only uses write_file and read_file
    expect(result.blindSpots.length).toBeGreaterThanOrEqual(1);
    // grep_search should be a blind spot
    expect(result.blindSpots.some(b => b.toolName === 'grep_search')).toBe(true);
  });

  it('computes group scores against benchmarks', () => {
    const reqs = Array.from({ length: 5 }, (_, i) =>
      makeReq({ requestId: `r${i}`, messageText: 'prompt', responseText: 'resp', toolsUsed: ['write_file', 'read_file', 'Edit', 'Grep', 'Bash'] }),
    );
    const session = makeSession('s1', reqs);
    const analyzer = new ToolAnalyzer([session], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    expect(result.groups.length).toBeGreaterThan(0);
    const writeGroup = result.groups.find(g => g.groupName === 'file-write');
    expect(writeGroup).toBeDefined();
    expect(writeGroup!.usageRate).toBeGreaterThan(0);
    expect(typeof writeGroup!.benchmarkRate).toBe('number');
  });

  it('generates suggestions based on gaps', () => {
    const reqs = [
      makeReq({ requestId: 'r1', messageText: 'hello', responseText: 'hi', toolsUsed: ['Write'] }),
    ];
    const session = makeSession('s1', reqs);
    const analyzer = new ToolAnalyzer([session], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    expect(result.topSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('computes weekly trend', () => {
    const now = Date.now();
    const reqs1 = [makeReq({ requestId: 'r1', messageText: 'a', responseText: 'b', toolsUsed: ['Read', 'Write'], timestamp: now - 14 * 86_400_000 })];
    const reqs2 = [makeReq({ requestId: 'r2', messageText: 'a', responseText: 'b', toolsUsed: ['Read', 'Write', 'Edit', 'Grep', 'Bash'], timestamp: now - 7 * 86_400_000 })];
    const s1 = makeSession('s1', reqs1, { lastMessageDate: now - 14 * 86_400_000 });
    const s2 = makeSession('s2', reqs2, { lastMessageDate: now - 7 * 86_400_000 });
    const analyzer = new ToolAnalyzer([s1, s2], new Map(), new Map());
    const result = analyzer.getToolProficiency();
    expect(result.weeklyTrend.labels.length).toBeGreaterThanOrEqual(1);
    expect(result.weeklyTrend.score.length).toBeGreaterThanOrEqual(1);
  });
});
