/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the Pi session parser */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findPiDirs, parsePiSessions, parsePiSessionFile, decodePiWorkspaceName } from './parser-pi';

// Sample Pi JSONL session data for testing
const SAMPLE_SESSION_JSONL = [
  `{"type":"session","version":3,"id":"test-session-001","timestamp":"2026-06-01T10:00:00.000Z","cwd":"/Users/testuser/project"}`,
  `{"type":"model_change","id":"entry-1","parentId":null,"timestamp":"2026-06-01T10:00:00.050Z","provider":"ollama","modelId":"test-model:latest"}`,
  `{"type":"thinking_level_change","id":"entry-2","parentId":"entry-1","timestamp":"2026-06-01T10:00:00.051Z","thinkingLevel":"medium"}`,
  `{"type":"message","id":"entry-3","parentId":"entry-2","timestamp":"2026-06-01T10:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Hello, how are you?"}],"timestamp":1780000005000}}`,
  `{"type":"message","id":"entry-4","parentId":"entry-3","timestamp":"2026-06-01T10:00:10.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"User is greeting me.","thinkingSignature":"reasoning"},{"type":"text","text":"I am doing great! How can I help you today?"}],"api":"openai-completions","provider":"ollama","model":"test-model:latest","usage":{"input":150,"output":50,"cacheRead":0,"cacheWrite":0,"totalTokens":200},"stopReason":"stop"}}`,
  `{"type":"message","id":"entry-5","parentId":"entry-4","timestamp":"2026-06-01T10:00:20.000Z","message":{"role":"user","content":[{"type":"text","text":"Can you help me debug this code?"}],"timestamp":1780000020000}}`,
  `{"type":"message","id":"entry-6","parentId":"entry-5","timestamp":"2026-06-01T10:00:25.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Looking at the code...","thinkingSignature":"reasoning"},{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"/Users/testuser/project/src/main.py"}}],"api":"openai-completions","provider":"ollama","model":"test-model:latest","usage":{"input":500,"output":100,"cacheRead":0,"cacheWrite":0,"totalTokens":600},"stopReason":"toolUse"}}`,
  `{"type":"message","id":"entry-7","parentId":"entry-6","timestamp":"2026-06-01T10:00:26.000Z","message":{"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"def main():\\n    print('hello')\\n"}],"isError":false}}`,
  `{"type":"message","id":"entry-8","parentId":"entry-7","timestamp":"2026-06-01T10:00:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"I can see the code. It looks correct!"}],"api":"openai-completions","provider":"ollama","model":"test-model:latest","usage":{"input":600,"output":30,"cacheRead":100,"cacheWrite":0,"totalTokens":730},"stopReason":"stop"}}`,
].join('\n');

// Session with tool calls leading to file edits
const SESSION_WITH_EDITS_JSONL = [
  `{"type":"session","version":3,"id":"test-session-002","timestamp":"2026-06-01T11:00:00.000Z","cwd":"/Users/testuser/another-project"}`,
  `{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-01T11:00:00.050Z","provider":"ollama","modelId":"coder-model:latest"}`,
  `{"type":"thinking_level_change","id":"t1","parentId":"m1","timestamp":"2026-06-01T11:00:00.051Z","thinkingLevel":"high"}`,
  `{"type":"message","id":"u1","parentId":"t1","timestamp":"2026-06-01T11:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Add a new function"}],"timestamp":1780000005000}}`,
  `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-06-01T11:00:10.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I need to write code.","thinkingSignature":"reasoning"},{"type":"toolCall","id":"call-edit","name":"edit","arguments":{"path":"src/main.py"}}],"api":"openai-completions","provider":"ollama","model":"coder-model:latest","usage":{"input":200,"output":80,"cacheRead":0,"cacheWrite":0,"totalTokens":280},"stopReason":"toolUse"}}`,
  `{"type":"message","id":"tr1","parentId":"a1","timestamp":"2026-06-01T11:00:11.000Z","message":{"role":"toolResult","toolCallId":"call-edit","toolName":"edit","content":[{"type":"text","text":"File updated."}],"isError":false}}`,
  `{"type":"message","id":"a2","parentId":"tr1","timestamp":"2026-06-01T11:00:15.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Done! I've added the function."}],"api":"openai-completions","provider":"ollama","model":"coder-model:latest","usage":{"input":280,"output":20,"cacheRead":50,"cacheWrite":0,"totalTokens":350},"stopReason":"stop"}}`,
].join('\n');

// Session that was aborted (error state)
const SESSION_ABORTED_JSONL = [
  `{"type":"session","version":3,"id":"test-session-003","timestamp":"2026-06-01T12:00:00.000Z","cwd":"/Users/testuser/project"}`,
  `{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-01T12:00:00.050Z","provider":"ollama","modelId":"test-model:latest"}`,
  `{"type":"message","id":"u1","parentId":"m1","timestamp":"2026-06-01T12:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Do something"}],"timestamp":1780000010000}}`,
  `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-06-01T12:00:10.000Z","message":{"role":"assistant","content":[],"api":"openai-completions","provider":"ollama","model":"test-model:latest","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0},"stopReason":"aborted","errorMessage":"Operation aborted"}}`,
].join('\n');

// Single-user message session (no response yet — pending)
const SESSION_PENDING_JSONL = [
  `{"type":"session","version":3,"id":"test-session-004","timestamp":"2026-06-01T13:00:00.000Z","cwd":"/Users/testuser/project"}`,
  `{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-01T13:00:00.050Z","provider":"ollama","modelId":"test-model:latest"}`,
  `{"type":"message","id":"u1","parentId":"m1","timestamp":"2026-06-01T13:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Still waiting..."}],"timestamp":1780000030000}}`,
].join('\n');

// Session with model change mid-conversation
const SESSION_MODEL_SWITCH_JSONL = [
  `{"type":"session","version":3,"id":"test-session-005","timestamp":"2026-06-01T14:00:00.000Z","cwd":"/Users/testuser/project"}`,
  `{"type":"model_change","id":"m1","parentId":null,"timestamp":"2026-06-01T14:00:00.050Z","provider":"ollama","modelId":"model-a:latest"}`,
  `{"type":"message","id":"u1","parentId":"m1","timestamp":"2026-06-01T14:00:05.000Z","message":{"role":"user","content":[{"type":"text","text":"First question"}],"timestamp":1780000100000}}`,
  `{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-06-01T14:00:10.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Answer from model A"}],"api":"openai-completions","provider":"ollama","model":"model-a:latest","usage":{"input":100,"output":20},"stopReason":"stop"}}`,
  `{"type":"model_change","id":"m2","parentId":"a1","timestamp":"2026-06-01T14:05:00.000Z","provider":"ollama","modelId":"model-b:latest"}`,
  `{"type":"message","id":"u2","parentId":"m2","timestamp":"2026-06-01T14:05:05.000Z","message":{"role":"user","content":[{"type":"text","text":"Second question after model switch"}],"timestamp":1780000150000}}`,
  `{"type":"message","id":"a2","parentId":"u2","timestamp":"2026-06-01T14:05:10.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Answer from model B"}],"api":"openai-completions","provider":"ollama","model":"model-b:latest","usage":{"input":200,"output":30},"stopReason":"stop"}}`,
].join('\n');

describe('decodePiWorkspaceName', () => {
  it('decodes a simple Unix path from double-hyphen encoding', () => {
    // Test fallback heuristic when no workspace dir is given
    const result = decodePiWorkspaceName('--Users-bgartamaker--');
    // The heuristic returns /Users/bgartamaker
    expect(result).toMatch(/Users/);
    expect(result).toMatch(/bgartamaker/);
  });

  it('returns encoded name when no pattern matches', () => {
    const result = decodePiWorkspaceName('unknown');
    expect(result).toBe('unknown');
  });

  it('reads cwd from session header when workspaceDir is provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'test.jsonl'), SAMPLE_SESSION_JSONL);
      const result = decodePiWorkspaceName('--Users-testuser-project--', tmpDir);
      expect(result).toBe('/Users/testuser/project');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('findPiDirs', () => {
  it('returns empty array when no home directory', () => {
    const prevHome = process.env.HOME;
    delete process.env.HOME;
    try {
      expect(findPiDirs()).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it('discovers Pi sessions directory when it exists', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-home-'));
    const prevHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const piDir = path.join(tmpHome, '.pi', 'agent', 'sessions');
      fs.mkdirSync(piDir, { recursive: true });
      expect(findPiDirs()).toEqual([piDir]);
    } finally {
      process.env.HOME = prevHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('parsePiSessionFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a basic session with user/assistant turns', () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(filePath, SAMPLE_SESSION_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe('test-session-001');
    expect(session!.workspaceId).toBe('test-ws');
    expect(session!.workspaceName).toBe('test-project');
    expect(session!.harness).toBe('pi');
    expect(session!.requestCount).toBe(2);
    expect(session!.requests).toHaveLength(2);

    // First request
    const r0 = session!.requests[0];
    expect(r0.messageText).toBe('Hello, how are you?');
    expect(r0.responseText).toContain('I am doing great!');
    expect(r0.modelId).toBe('test-model:latest');
    expect(r0.promptTokens).toBe(150);
    expect(r0.completionTokens).toBe(50);
    expect(r0.cacheReadTokens).toBeNull();
    expect(r0.reasoningEffort).toBe('medium');

    // Second request (with tool use)
    const r1 = session!.requests[1];
    expect(r1.messageText).toContain('Can you help me debug');
    expect(r1.toolsUsed).toContain('read');
    expect(r1.referencedFiles).toContain('/Users/testuser/project/src/main.py');
    expect(r1.promptTokens).toBe(1100); // 500 + 600
    expect(r1.completionTokens).toBe(130); // 100 + 30
    expect(r1.cacheReadTokens).toBe(100);
    expect(r1.cacheWriteTokens).toBeNull();
  });

  it('parses a session with file edits', () => {
    const filePath = path.join(tmpDir, 'session-edits.jsonl');
    fs.writeFileSync(filePath, SESSION_WITH_EDITS_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'another-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.requests).toHaveLength(1);

    const r0 = session!.requests[0];
    expect(r0.messageText).toBe('Add a new function');
    expect(r0.toolsUsed).toContain('edit');
    expect(r0.editedFiles).toContain('src/main.py');
    expect(r0.totalElapsed).toBe(10000); // 11:00:15 - 11:00:05 = 10s
  });

  it('handles aborted sessions with error state', () => {
    const filePath = path.join(tmpDir, 'session-aborted.jsonl');
    fs.writeFileSync(filePath, SESSION_ABORTED_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.requests).toHaveLength(1);

    const r0 = session!.requests[0];
    expect(r0.messageText).toBe('Do something');
    expect(r0.endState).toBe('errored');
    expect(session!.endReason).toBe('aborted');
  });

  it('handles pending sessions (user message with no response)', () => {
    const filePath = path.join(tmpDir, 'session-pending.jsonl');
    fs.writeFileSync(filePath, SESSION_PENDING_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.requests).toHaveLength(1);

    const r0 = session!.requests[0];
    expect(r0.messageText).toBe('Still waiting...');
    expect(r0.endState).toBe('pending');
    expect(session!.endReason).toBe('active');
  });

  it('handles mid-session model changes', () => {
    const filePath = path.join(tmpDir, 'session-model-switch.jsonl');
    fs.writeFileSync(filePath, SESSION_MODEL_SWITCH_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.requests).toHaveLength(2);

    const r0 = session!.requests[0];
    expect(r0.modelId).toBe('model-a:latest');
    expect(r0.messageText).toBe('First question');

    const r1 = session!.requests[1];
    expect(r1.modelId).toBe('model-b:latest');
    expect(r1.messageText).toContain('Second question after model switch');
  });

  it('returns null for empty file', () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');
    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).toBeNull();
  });

  it('returns null for invalid header', () => {
    const filePath = path.join(tmpDir, 'invalid.jsonl');
    fs.writeFileSync(filePath, '{"type":"not-session"}');
    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).toBeNull();
  });

  it('returns null for non-existent file', () => {
    const session = parsePiSessionFile('/nonexistent/file.jsonl', 'test-ws', 'test-project', 'pi');
    expect(session).toBeNull();
  });

  it('sets workspaceRootPath from cwd header', () => {
    const filePath = path.join(tmpDir, 'session-cwd.jsonl');
    fs.writeFileSync(filePath, SAMPLE_SESSION_JSONL);

    const session = parsePiSessionFile(filePath, 'test-ws', 'test-project', 'pi');
    expect(session).not.toBeNull();
    expect(session!.workspaceRootPath).toBe('/Users/testuser/project');
    expect(session!.location).toBe('/Users/testuser/project');
  });
});

describe('parsePiSessions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-workspace-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when no workspace directories exist', () => {
    const results = parsePiSessions(tmpDir);
    expect(results).toEqual([]);
  });

  it('parses sessions from workspace directories', () => {
    // Create a Pi workspace directory
    const wsDir = path.join(tmpDir, '--Users-testuser-project--');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'session-1.jsonl'), SAMPLE_SESSION_JSONL);
    fs.writeFileSync(path.join(wsDir, 'session-2.jsonl'), SESSION_WITH_EDITS_JSONL);

    const results = parsePiSessions(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].workspaceName).toBe('/Users/testuser/project');
    expect(results[0].workspaceId).toBe('pi---Users-testuser-project--');
    expect(results[0].sessions).toHaveLength(2);
  });

  it('handles multiple workspace directories', () => {
    const wsDir1 = path.join(tmpDir, '--Users-testuser-project1--');
    fs.mkdirSync(wsDir1, { recursive: true });
    fs.writeFileSync(path.join(wsDir1, 's.jsonl'), SAMPLE_SESSION_JSONL);

    const wsDir2 = path.join(tmpDir, '--Users-testuser-project2--');
    fs.mkdirSync(wsDir2, { recursive: true });
    fs.writeFileSync(path.join(wsDir2, 's.jsonl'), SESSION_ABORTED_JSONL);

    const results = parsePiSessions(tmpDir);
    expect(results).toHaveLength(2);
  });
});
