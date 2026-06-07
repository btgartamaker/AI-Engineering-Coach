/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Gemini Code Assist session parser
 *
 * Data layout (macOS):
 *   ~/.gemini/projects.json                    -- maps project root paths to short names
 *   ~/.gemini/tmp/<project-name>/chats/
 *     session-<date>-<uuid>.jsonl              -- JSONL session file
 *
 * Each JSONL line is one of:
 *   { sessionId, projectHash, startTime, lastUpdated, kind: "main" }   -- session header
 *   { id, timestamp, type: "user",     content: [...] }                 -- user message
 *   { id, timestamp, type: "assistant", content: [...] }               -- assistant response
 *   { $set: { lastUpdated: "..." } }                                    -- status update
 *
 * Content blocks can have { text: "..." } (text), { image_url: { url: "..." } } (images).
 * Tool calls appear as additional blocks with tool metadata.
 *
 * Currently only user messages are persisted locally; assistant responses exist when
 * Gemini Code Assist stores them. The parser handles both cases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { Session, SessionRequest } from './types';
import { assertTrustedPath, createRequest, createSession } from './parser-shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GeminiLine {
  sessionId?: string;
  id?: string;
  timestamp?: string | number;
  type?: string;
  content?: GeminiContentBlock[];
  kind?: string;
  $set?: Record<string, unknown>;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
}

interface GeminiContentBlock {
  text?: string;
  type?: string;
  image_url?: { url?: string };
  tool_call?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
}

interface GeminiSessionMeta {
  sessionId: string;
  projectHash: string;
  startTime: number;
}

/** Tool names that indicate file write/edit operations. */
const GEMINI_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'edit_file',
  'apply_diff', 'patch', 'multi_edit', 'create', 'overwrite',
]);

/** Tool names that indicate file read operations. */
const GEMINI_READ_TOOLS = new Set([
  'read', 'read_file', 'view', 'list', 'ls', 'grep', 'search',
  'lookup', 'glob', 'find',
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Date.parse(value);
    if (!isNaN(n)) return n;
  }
  return 0;
}

function normalizeWorkspaceName(raw: string): string {
  // Use the project directory name as the workspace name
  return raw;
}

function encodeWorkspaceId(projectName: string): string {
  // Consistent encoding: gemini-<project-name>
  return 'gemini-' + projectName;
}

function classifyGeminiToolUse(
  toolName: string,
  args: Record<string, unknown> | undefined,
  state: { editedFiles: string[]; referencedFiles: string[]; toolsUsed: string[] },
): void {
  const name = toolName.toLowerCase();
  state.toolsUsed.push(toolName);

  if (GEMINI_WRITE_TOOLS.has(name) && args) {
    const filePath = typeof args.path === 'string' ? args.path
      : typeof args.file_path === 'string' ? args.file_path
      : typeof args.filePath === 'string' ? args.filePath
      : '';
    if (filePath) state.editedFiles.push(filePath);
  }

  if (GEMINI_READ_TOOLS.has(name) && args) {
    const filePath = typeof args.path === 'string' ? args.path
      : typeof args.file_path === 'string' ? args.file_path
      : typeof args.filePath === 'string' ? args.filePath
      : '';
    if (filePath) state.referencedFiles.push(filePath);
  }
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

function parseGeminiSessionFile(filePath: string): Session | null {
  if (!fs.existsSync(filePath)) return null;
  try { assertTrustedPath(filePath); } catch { return null; }

  const decoder = new StringDecoder('utf-8');
  const content = decoder.end(fs.readFileSync(filePath) as Buffer);
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Parse each line as JSON
  const records: GeminiLine[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as GeminiLine;
      records.push(parsed);
    } catch { /* skip malformed lines */ }
  }
  if (records.length === 0) return null;

  // Extract session metadata from first header record
  const headerRecord = records.find(r => r.kind === 'main' && r.sessionId);
  if (!headerRecord || !headerRecord.sessionId) return null;

  const geminiSessionId = headerRecord.sessionId;
  const startTime = ensureNumber(headerRecord.startTime || headerRecord.timestamp);

  // Extract file name parts for date hints
  const fileBase = path.basename(filePath, '.jsonl'); // e.g. session-2026-05-31T19-08-6afb1324
  const dateMatch = fileBase.match(/session-(\d{4}-\d{2}-\d{2})/);
  const fileDate = dateMatch ? dateMatch[1] : null;

  // Collect messages in chronological order
  const requests: SessionRequest[] = [];
  let pendingUserText = '';
  let pendingUserTs = 0;
  let consumedAttachment = false;

  for (const rec of records) {
    if (rec.$set) continue; // Skip status update markers
    if (rec.kind === 'main' && rec.sessionId) continue; // Skip header (already processed)

    if (rec.type === 'user' && rec.content) {
      // Flush any previous pending user message
      if (pendingUserText) {
        flushPendingUser();
      }

      // Extract text from content blocks
      const textParts: string[] = [];
      for (const block of rec.content) {
        if (block.text) textParts.push(block.text);
        if (block.image_url?.url) textParts.push('[image]');
        if (block.tool_call) {
          const fnName = typeof block.tool_call.name === 'string' ? block.tool_call.name : 'unknown';
          textParts.push(`[tool_call: ${fnName}]`);
        }
      }

      const recTs = ensureNumber(rec.timestamp);
      if (textParts.length > 0) {
        pendingUserText = textParts.join('\n');
        pendingUserTs = recTs || startTime;
        consumedAttachment = false;
      }
    } else if (rec.type === 'assistant' && rec.content) {
      // Assistant response with content blocks
      const textParts: string[] = [];
      const tools: string[] = [];
      const editedFiles: string[] = [];
      const referencedFiles: string[] = [];
      let pendingText = '';

      for (const block of rec.content) {
        if (block.text) {
          textParts.push(block.text);
        }
        if (block.tool_call && isRecord(block.tool_call)) {
          const fnName = typeof block.tool_call.name === 'string' ? block.tool_call.name : 'function';
          const fnArgs = isRecord(block.tool_call.arguments) ? block.tool_call.arguments as Record<string, unknown> : undefined;
          classifyGeminiToolUse(fnName, fnArgs, { editedFiles, referencedFiles, toolsUsed: tools });
          // Add code from write/edit tool calls for LoC counting
          if (GEMINI_WRITE_TOOLS.has(fnName.toLowerCase()) && fnArgs) {
            const code = typeof fnArgs.content === 'string' ? fnArgs.content
              : typeof fnArgs.new_str === 'string' ? fnArgs.new_str
              : typeof fnArgs.code === 'string' ? fnArgs.code
              : null;
            if (code) {
              const filePath = typeof fnArgs.path === 'string' ? fnArgs.path
                : typeof fnArgs.file_path === 'string' ? fnArgs.file_path
                : '';
              const ext = filePath.split('.').pop() || '';
              pendingText += '\`\`\`' + ext + '\n' + code + '\n\`\`\`\n';
            }
          }
        }
        if (block.tool_result && isRecord(block.tool_result)) {
          const output = typeof block.tool_result.output === 'string' ? block.tool_result.output
            : typeof block.tool_result.content === 'string' ? block.tool_result.content
            : null;
          if (output) textParts.push(output);
        }
      }

      const recTs = ensureNumber(rec.timestamp);
      const responseText = pendingText + textParts.join('\n');

      if (pendingUserText) {
        // Pair with the pending user message
        const codeBlocks = responseText.indexOf('\`\`\`') >= 0;
        requests.push(createRequest({
          requestId: geminiSessionId + '-' + rec.id,
          timestamp: pendingUserTs,
          messageText: pendingUserText,
          responseText,
          modelId: '',
          toolsUsed: tools,
          editedFiles,
          referencedFiles,
          promptTokens: null,
          completionTokens: null,
        }));
        pendingUserText = '';
        pendingUserTs = 0;
      } else {
        // Orphaned assistant response — create as a synthetic request
        requests.push(createRequest({
          requestId: geminiSessionId + '-' + rec.id,
          timestamp: recTs || startTime,
          messageText: '',
          responseText,
          modelId: '',
          toolsUsed: tools,
          editedFiles,
          referencedFiles,
          promptTokens: null,
          completionTokens: null,
        }));
      }
    }
  }

  function flushPendingUser(): void {
    // Flush a user message with no matching assistant response (pending/abandoned)
    if (!pendingUserText) return;
    requests.push(createRequest({
      requestId: geminiSessionId + '-' + pendingUserTs,
      timestamp: pendingUserTs,
      messageText: pendingUserText,
      responseText: '',
      modelId: '',
      toolsUsed: [],
      editedFiles: [],
      referencedFiles: [],
      promptTokens: null,
      completionTokens: null,
      endState: 'pending',
    }));
    pendingUserText = '';
    pendingUserTs = 0;
  }

  // Flush final pending user
  flushPendingUser();

  // Derive workspace from file path
  // Path: .../tmp/<project-name>/chats/session-*.jsonl
  const chatsDir = path.dirname(filePath);
  const projectDir = path.dirname(chatsDir); // .../tmp/<project-name>
  const projectName = path.basename(projectDir);

  const workspaceName = normalizeWorkspaceName(projectName);
  const workspaceId = encodeWorkspaceId(projectName);

  const creationDate = startTime || null;

  if (requests.length === 0) return null;

  return createSession({
    sessionId: geminiSessionId,
    workspaceId,
    workspaceName,
    harness: 'Gemini',
    requests,
    creationDate,
    lastMessageDate: creationDate,
    location: 'panel',
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Find all Gemini Code Assist session directories.
 * Returns paths like ~/.gemini/tmp/<project-name>/chats/
 */
export function findGeminiDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return [];

  const geminiRoot = path.join(home, '.gemini', 'tmp');
  if (!fs.existsSync(geminiRoot)) return [];

  const dirs: string[] = [];
  try {
    const entries = fs.readdirSync(geminiRoot);
    for (const entry of entries) {
      const chatsDir = path.join(geminiRoot, entry, 'chats');
      if (fs.statSync(chatsDir).isDirectory()) {
        dirs.push(chatsDir);
      }
    }
  } catch {
    // Permission or missing directory
  }

  return dirs;
}

/**
 * Parse all Gemini session files in a chats directory.
 * @param chatsDir Path to a Gemini chats directory (~/.gemini/tmp/<project>/chats/)
 * @returns Array of parsed sessions
 */
export function parseGeminiSessions(chatsDir: string): Session[] {
  if (!fs.existsSync(chatsDir)) return [];

  const sessions: Session[] = [];
  try {
    const files = fs.readdirSync(chatsDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(chatsDir, file);
      try {
        const session = parseGeminiSessionFile(filePath);
        if (session) sessions.push(session);
      } catch {
        // Skip corrupted session files
      }
    }
  } catch {
    // Permission or missing directory
  }

  return sessions;
}
