/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the Gemini session parser (Code Assist & CLI formats) */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findGeminiDirs, parseGeminiSessions, parseGeminiSessionsAsync } from './parser-gemini';

/* ------------------------------------------------------------------ */
/*  Sample session JSONL data                                         */
/* ------------------------------------------------------------------ */

// Gemini Code Assist format: type: "assistant", content with tool_call blocks
const SAMPLE_CODE_ASSIST_JSONL = [
  `{"sessionId":"ca-session-001","projectHash":"abc123","startTime":"2026-06-01T10:00:00.000Z","lastUpdated":"2026-06-01T10:00:00.000Z","kind":"main"}`,
  `{"id":"msg-1","timestamp":"2026-06-01T10:00:05.000Z","type":"user","content":[{"text":"Hello, fix this bug"}]}`,
  `{"id":"msg-2","timestamp":"2026-06-01T10:00:10.000Z","type":"assistant","content":[{"text":"I'll help you fix that bug."},{"tool_call":{"name":"read_file","arguments":{"path":"src/main.ts"}}},{"tool_result":{"output":"File contents here"}},{"tool_call":{"name":"write_file","arguments":{"path":"src/main.ts","content":"fixed code"}}}]}`,
  `{"id":"msg-3","timestamp":"2026-06-01T10:00:15.000Z","type":"user","content":[{"text":"Thanks!"}]}`,
  `{"id":"msg-4","timestamp":"2026-06-01T10:00:20.000Z","type":"assistant","content":[{"text":"You're welcome!"}]}`,
  `{"$set":{"lastUpdated":"2026-06-01T10:00:20.000Z"}}`,
].join('\n');

// Gemini CLI format: type: "gemini", with toolCalls, tokens, thoughts, model
const SAMPLE_GEMINI_CLI_JSONL = [
  `{"sessionId":"cli-session-001","projectHash":"abc123","startTime":"2026-06-01T11:00:00.000Z","lastUpdated":"2026-06-01T11:00:00.000Z","kind":"main"}`,
  `{"id":"u-1","timestamp":"2026-06-01T11:00:05.000Z","type":"user","content":[{"text":"Add a new function"}]}`,
  `{"id":"g-1","timestamp":"2026-06-01T11:00:10.000Z","type":"gemini","content":[{"text":"Here's the new function"}],"toolCalls":[{"id":"tc-1","name":"read_file","args":{"file_path":"src/lib.ts"},"status":"success","timestamp":"2026-06-01T11:00:08.000Z"},{"id":"tc-2","name":"write_file","args":{"file_path":"src/lib.ts","content":"export function add(a,b){return a+b}"},"status":"success","timestamp":"2026-06-01T11:00:09.000Z"}],"thoughts":[{"text":"Need to add a new function","type":"reasoning"}],"tokens":{"input":150,"output":50,"cached":25,"total":225},"model":"gemini-2.5-pro"}`,
  `{"id":"u-2","timestamp":"2026-06-01T11:00:15.000Z","type":"user","content":[{"text":"Also add tests"}]}`,
  `{"id":"g-2","timestamp":"2026-06-01T11:00:20.000Z","type":"gemini","content":[{"text":"Tests added"}],"toolCalls":[{"id":"tc-3","name":"write_file","args":{"file_path":"src/lib.test.ts","content":"import {add} from './lib'"},"status":"success","timestamp":"2026-06-01T11:00:18.000Z"}],"tokens":{"input":300,"output":80,"cached":50,"total":430},"model":"gemini-2.5-flash"}`,
  `{"$set":{"lastUpdated":"2026-06-01T11:00:20.000Z"}}`,
].join('\n');

// Gemini CLI format with rewind records (skip gracefully)
const SAMPLE_WITH_REWIND_JSONL = [
  `{"sessionId":"cli-session-002","projectHash":"abc123","startTime":"2026-06-01T12:00:00.000Z","lastUpdated":"2026-06-01T12:00:00.000Z","kind":"main"}`,
  `{"id":"u-1","timestamp":"2026-06-01T12:00:05.000Z","type":"user","content":[{"text":"Do something"}]}`,
  `{"id":"g-1","timestamp":"2026-06-01T12:00:10.000Z","type":"gemini","content":[{"text":"Result"}],"tokens":{"input":100,"output":20,"cached":0,"total":120},"model":"gemini-2.5-pro"}`,
  `{"$rewindTo":"u-1"}`,
  `{"id":"u-2","timestamp":"2026-06-01T12:01:00.000Z","type":"user","content":[{"text":"Do something else"}]}`,
  `{"id":"g-2","timestamp":"2026-06-01T12:01:05.000Z","type":"gemini","content":[{"text":"Other result"}],"tokens":{"input":200,"output":30,"cached":0,"total":230},"model":"gemini-2.5-pro"}`,
  `{"$set":{"lastUpdated":"2026-06-01T12:01:05.000Z"}}`,
].join('\n');

// Subagent session (Gemini CLI format)
const SAMPLE_SUBAGENT_JSONL = [
  `{"sessionId":"cli-session-001","projectHash":"abc123","startTime":"2026-06-01T11:30:00.000Z","lastUpdated":"2026-06-01T11:30:00.000Z","kind":"subagent"}`,
  `{"id":"sg-u-1","timestamp":"2026-06-01T11:30:05.000Z","type":"user","content":[{"text":"Subagent task"}]}`,
  `{"id":"sg-g-1","timestamp":"2026-06-01T11:30:10.000Z","type":"gemini","content":[{"text":"Subagent result"}],"tokens":{"input":50,"output":10,"cached":0,"total":60},"model":"gemini-2.5-pro"}`,
].join('\n');

// Orphan subagent (no parent session in the directory)
const SAMPLE_ORPHAN_SUBAGENT_JSONL = [
  `{"sessionId":"orphan-sub-001","projectHash":"abc123","startTime":"2026-06-01T12:00:00.000Z","lastUpdated":"2026-06-01T12:00:00.000Z","kind":"subagent"}`,
  `{"id":"os-u-1","timestamp":"2026-06-01T12:00:05.000Z","type":"user","content":[{"text":"Orphan task"}]}`,
  `{"id":"os-g-1","timestamp":"2026-06-01T12:00:10.000Z","type":"gemini","content":[{"text":"Orphan result"}],"tokens":{"input":30,"output":5,"cached":0,"total":35},"model":"gemini-2.5-pro"}`,
].join('\n');

// Gemini CLI format with metadata $set (summary, memoryScratchpad)
const SAMPLE_WITH_METADATA_JSONL = [
  `{"sessionId":"cli-session-003","projectHash":"abc123","startTime":"2026-06-01T13:00:00.000Z","lastUpdated":"2026-06-01T13:00:00.000Z","kind":"main"}`,
  `{"id":"u-1","timestamp":"2026-06-01T13:00:05.000Z","type":"user","content":[{"text":"Build a feature"}]}`,
  `{"id":"g-1","timestamp":"2026-06-01T13:00:10.000Z","type":"gemini","content":[{"text":"Building..."}],"tokens":{"input":200,"output":100,"cached":0,"total":300},"model":"gemini-2.5-pro"}`,
  `{"$set":{"summary":"Built authentication feature","memoryScratchpad":"User wants auth with JWT","lastUpdated":"2026-06-01T13:00:10.000Z"}}`,
].join('\n');

// Empty session (only header, no messages)
const SAMPLE_EMPTY_JSONL = [
  `{"sessionId":"empty-session","projectHash":"abc123","startTime":"2026-06-01T14:00:00.000Z","lastUpdated":"2026-06-01T14:00:00.000Z","kind":"main"}`,
].join('\n');

// Session with only $set records (no messages)
const SAMPLE_SET_ONLY_JSONL = [
  `{"sessionId":"set-only","projectHash":"abc123","startTime":"2026-06-01T15:00:00.000Z","lastUpdated":"2026-06-01T15:00:00.000Z","kind":"main"}`,
  `{"$set":{"lastUpdated":"2026-06-01T15:00:05.000Z"}}`,
  `{"$set":{"lastUpdated":"2026-06-01T15:00:10.000Z"}}`,
].join('\n');

// User message with no response
const SAMPLE_PENDING_USER_JSONL = [
  `{"sessionId":"pending-session","projectHash":"abc123","startTime":"2026-06-01T16:00:00.000Z","lastUpdated":"2026-06-01T16:00:00.000Z","kind":"main"}`,
  `{"id":"u-1","timestamp":"2026-06-01T16:00:05.000Z","type":"user","content":[{"text":"Still waiting..."}]}`,
].join('\n');

// Malformed JSON lines (should be skipped gracefully)
const SAMPLE_WITH_MALFORMED_JSONL = [
  `{"sessionId":"malformed-session","projectHash":"abc123","startTime":"2026-06-01T17:00:00.000Z","lastUpdated":"2026-06-01T17:00:00.000Z","kind":"main"}`,
  `{"id":"u-1","timestamp":"2026-06-01T17:00:05.000Z","type":"user","content":[{"text":"Hello"}]}`,
  `not valid json`,
  `{"id":"g-1","timestamp":"2026-06-01T17:00:10.000Z","type":"gemini","content":[{"text":"Hi"}],"tokens":{"input":10,"output":5,"cached":0,"total":15},"model":"gemini-2.5-pro"}`,
].join('\n');

/* ------------------------------------------------------------------ */
/*  Helper: set up a fake Gemini tmp directory with session files      */
/* ------------------------------------------------------------------ */

interface SetupOptions {
  sessions?: Array<{ filename: string; content: string }>;
  projectsJson?: Record<string, string> | null;
}

function setupGeminiDir(options: SetupOptions = {}): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
  const prevHome = process.env.HOME;
  process.env.HOME = home;

  const { sessions = [], projectsJson = null } = options;

  // Write projects.json if provided
  if (projectsJson) {
    const geminiDir = path.join(home, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(
      path.join(geminiDir, 'projects.json'),
      JSON.stringify({ projects: projectsJson }, null, 2),
    );
  }

  // Write each session file
  for (const { filename, content } of sessions) {
    const filePath = path.join(home, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return home;
}

function cleanupGeminiDir(home: string): void {
  const prevHome = process.env.HOME;
  process.env.HOME = prevHome;
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ok */ }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('findGeminiDirs', () => {
  it('returns empty array when no home directory', () => {
    const prevHome = process.env.HOME;
    delete process.env.HOME;
    try {
      expect(findGeminiDirs()).toEqual([]);
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it('returns empty array when .gemini/tmp does not exist', () => {
    const home = setupGeminiDir({ sessions: [] });
    try {
      expect(findGeminiDirs()).toEqual([]);
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('discovers Gemini chats directories', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-1.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
        { filename: '.gemini/tmp/other-project/chats/session-2.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
    });
    try {
      const dirs = findGeminiDirs();
      expect(dirs).toHaveLength(2);
      expect(dirs.some(d => d.endsWith('test-project/chats'))).toBe(true);
      expect(dirs.some(d => d.endsWith('other-project/chats'))).toBe(true);
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessions — Gemini Code Assist format', () => {
  it('parses a Code Assist session with tool calls', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-ca.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.sessionId).toBe('ca-session-001');
      expect(s.harness).toBe('Gemini Code Assist');
      expect(s.location).toBe('panel');
      expect(s.requestCount).toBeGreaterThanOrEqual(2);

      // First request — user+assistant with tool calls
      const r0 = s.requests[0];
      expect(r0.messageText).toBe('Hello, fix this bug');
      expect(r0.responseText).toContain("I'll help you fix that bug.");
      expect(r0.toolsUsed).toContain('read_file');
      expect(r0.toolsUsed).toContain('write_file');
      expect(r0.referencedFiles).toContain('src/main.ts');
      expect(r0.editedFiles).toContain('src/main.ts');
      expect(r0.promptTokens).toBeNull(); // Code Assist doesn't have per-message tokens
      expect(r0.completionTokens).toBeNull();
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('parses a Code Assist session with a pending user message', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-ca-pending.jsonl', content: SAMPLE_PENDING_USER_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.requestCount).toBe(1);
      expect(s.requests[0].messageText).toBe('Still waiting...');
      expect(s.requests[0].endState).toBe('pending');
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessions — Gemini CLI format', () => {
  it('parses a Gemini CLI session with tokens, toolCalls, model', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-cli.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.sessionId).toBe('cli-session-001');
      expect(s.harness).toBe('Gemini CLI');
      expect(s.location).toBe('terminal');
      expect(s.requestCount).toBe(2);

      // First request
      const r0 = s.requests[0];
      expect(r0.messageText).toBe('Add a new function');
      expect(r0.responseText).toContain("Here's the new function");
      expect(r0.toolsUsed).toContain('read_file');
      expect(r0.toolsUsed).toContain('write_file');
      expect(r0.editedFiles).toContain('src/lib.ts');
      expect(r0.referencedFiles).toContain('src/lib.ts');
      expect(r0.modelId).toBe('gemini-2.5-pro');
      expect(r0.promptTokens).toBe(150);
      expect(r0.completionTokens).toBe(50);
      expect(r0.cacheReadTokens).toBe(25);

      // Second request
      const r1 = s.requests[1];
      expect(r1.messageText).toBe('Also add tests');
      expect(r1.responseText).toContain('Tests added');
      expect(r1.modelId).toBe('gemini-2.5-flash');
      expect(r1.promptTokens).toBe(300);
      expect(r1.completionTokens).toBe(80);
      expect(r1.cacheReadTokens).toBe(50);

      // Session-level modelUsage should be present
      expect(s.modelUsage).toBeDefined();
      expect(s.modelUsage!['gemini-2.5-pro']).toBeDefined();
      expect(s.modelUsage!['gemini-2.5-pro'].inputTokens).toBe(150);
      expect(s.modelUsage!['gemini-2.5-pro'].outputTokens).toBe(50);
      expect(s.modelUsage!['gemini-2.5-flash']).toBeDefined();
      expect(s.modelUsage!['gemini-2.5-flash'].inputTokens).toBe(300);
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('skips $rewindTo records gracefully', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-rewind.jsonl', content: SAMPLE_WITH_REWIND_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      // Should have exactly 2 requests (both user+assistant pairs)
      expect(s.requestCount).toBe(2);
      expect(s.requests[0].messageText).toBe('Do something');
      expect(s.requests[1].messageText).toBe('Do something else');
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('returns null for empty session (no messages)', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-empty.jsonl', content: SAMPLE_EMPTY_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(0);
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('handles set-only session (no user/assistant records)', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-setonly.jsonl', content: SAMPLE_SET_ONLY_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(0);
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('skips malformed JSON lines gracefully', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-malformed.jsonl', content: SAMPLE_WITH_MALFORMED_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].requestCount).toBe(1);
      expect(sessions[0].requests[0].messageText).toBe('Hello');
      expect(sessions[0].requests[0].responseText).toBe('Hi');
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('handles pending user message (no response)', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session-pending.jsonl', content: SAMPLE_PENDING_USER_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].requestCount).toBe(1);
      expect(sessions[0].requests[0].endState).toBe('pending');
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessions — format auto-detection', () => {
  it('auto-detects Gemini CLI format', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].harness).toBe('Gemini CLI');
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('auto-detects Code Assist format', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].harness).toBe('Gemini Code Assist');
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessions — workspace resolution', () => {
  it('resolves workspace name and root path from projects.json', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
      projectsJson: { '/Users/testuser/projects/Test Project': 'test-project' },
    });
    try {
      const chatsDir = path.join(home, '.gemini/tmp/test-project/chats');
      const sessions = parseGeminiSessions(chatsDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].workspaceName).toBe('Test Project');
      expect(sessions[0].workspaceRootPath).toBe('/Users/testuser/projects/Test Project');
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('falls back to short name when projects.json has no mapping', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
      projectsJson: { '/some/other/path': 'other-project' },
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].workspaceName).toBe('test-project');
      expect(sessions[0].workspaceRootPath).toBeUndefined();
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('falls back when projects.json is missing', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/test-project/chats/session.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
      ],
      projectsJson: null,
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/test-project/chats'));
      expect(sessions).toHaveLength(1);
      expect(sessions[0].workspaceName).toBe('test-project');
      expect(sessions[0].workspaceRootPath).toBeUndefined();
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessions — subagent merging', () => {
  it('merges subagent requests into parent session', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session-parent.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
        { filename: '.gemini/tmp/project/chats/session-subagent.jsonl', content: SAMPLE_SUBAGENT_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/project/chats'));
      // Both sessions share sessionId "cli-session-001" — subagent should merge into parent
      expect(sessions).toHaveLength(1);
      const s = sessions[0];
      expect(s.harness).toBe('Gemini CLI');
      // Parent had 2 requests + subagent had 1 = 3 total
      expect(s.requestCount).toBe(3);
      // Subagent request should be merged in
      const subReq = s.requests.find(r => r.messageText === 'Subagent task');
      expect(subReq).toBeDefined();
      expect(subReq!.responseText).toBe('Subagent result');
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('keeps orphan subagents as standalone sessions', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session-orphan.jsonl', content: SAMPLE_ORPHAN_SUBAGENT_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/project/chats'));
      // Orphan subagent with no parent should be kept as standalone
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('orphan-sub-001');
      expect(sessions[0].requestCount).toBe(1);
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('parseGeminiSessionsAsync', () => {
  it('parses sessions asynchronously with the same results as sync', async () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session-1.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
        { filename: '.gemini/tmp/project/chats/session-2.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
      ],
    });
    try {
      const chatsDir = path.join(home, '.gemini/tmp/project/chats');
      const sessions = await parseGeminiSessionsAsync(chatsDir);
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.harness === 'Gemini CLI')).toBe(true);
      expect(sessions.some(s => s.harness === 'Gemini Code Assist')).toBe(true);
    } finally {
      cleanupGeminiDir(home);
    }
  });

  it('reports progress via onFile callback', async () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session-1.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
        { filename: '.gemini/tmp/project/chats/session-2.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
      ],
    });
    try {
      const calls: string[] = [];
      const chatsDir = path.join(home, '.gemini/tmp/project/chats');
      await parseGeminiSessionsAsync(chatsDir, (idx, total, name) => {
        calls.push(`${idx}/${total}: ${name}`);
      });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatch(/1\/2: session-/);
      expect(calls[1]).toMatch(/2\/2: session-/);
    } finally {
      cleanupGeminiDir(home);
    }
  });
});

describe('format detection — mixed directory', () => {
  it('handles both formats in the same directory', () => {
    const home = setupGeminiDir({
      sessions: [
        { filename: '.gemini/tmp/project/chats/session-cli.jsonl', content: SAMPLE_GEMINI_CLI_JSONL },
        { filename: '.gemini/tmp/project/chats/session-ca.jsonl', content: SAMPLE_CODE_ASSIST_JSONL },
      ],
    });
    try {
      const sessions = parseGeminiSessions(path.join(home, '.gemini/tmp/project/chats'));
      expect(sessions).toHaveLength(2);
      const harnesses = sessions.map(s => s.harness).sort();
      expect(harnesses).toEqual(['Gemini CLI', 'Gemini Code Assist']);
    } finally {
      cleanupGeminiDir(home);
    }
  });
});
