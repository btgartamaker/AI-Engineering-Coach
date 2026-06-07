/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Gemini Code Assist & Gemini CLI session parser
 *
 * Both tools share the same data directory (~/.gemini/tmp/<project>/chats/)
 * but use different JSONL formats. This parser auto-detects the format and
 * handles both.
 *
 * Data layout (macOS):
 *   ~/.gemini/projects.json                    -- maps project root paths to short names
 *   ~/.gemini/tmp/<project-name>/chats/
 *     session-<date>-<uuid>.jsonl              -- JSONL session file
 *
 * ── Gemini Code Assist (VS Code extension) format ──
 * Each JSONL line is one of:
 *   { sessionId, projectHash, startTime, lastUpdated, kind: "main" }   -- session header
 *   { id, timestamp, type: "user",     content: [...] }                 -- user message
 *   { id, timestamp, type: "assistant", content: [...] }               -- assistant response
 *   { $set: { lastUpdated: "..." } }                                    -- status update
 * Content blocks can have { text }, { image_url }, { tool_call }, { tool_result }.
 *
 * ── Gemini CLI format ──
 * Each JSONL line is one of:
 *   { sessionId, projectHash, startTime, lastUpdated, kind: "main"|"subagent" }
 *   { id, timestamp, type: "user",  content: [...] }
 *   { id, timestamp, type: "gemini", content: [...],
 *     toolCalls: [{ id, name, args, result, status, timestamp }],
 *     thoughts: [{ text, type }], tokens: { input, output, cached, total }, model }
 *   { $set: { ... } }        -- metadata update (summary, memoryScratchpad, etc.)
 *   { $rewindTo: "..." }     -- rewind marker (skip)
 *
 * See docs/specs/GEMINI-CLI-SUPPORT.md for full spec.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';
import { Session, SessionRequest, ModelUsage } from './types';
import { assertTrustedPath, createRequest, createSession, detectDevcontainerFromRequests } from './parser-shared';
import { warnCore } from './log';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A raw parsed line from any Gemini session JSONL file. */
interface GeminiLine {
  sessionId?: string;
  parentSessionId?: string;
  id?: string;
  timestamp?: string | number;
  type?: string;
  content?: GeminiContentBlock[];
  kind?: string;
  $set?: Record<string, unknown>;
  $rewindTo?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  // Gemini CLI fields on "gemini" type messages
  toolCalls?: GeminiToolCall[];
  thoughts?: GeminiThought[];
  tokens?: GeminiTokens;
  model?: string;
}

interface GeminiContentBlock {
  text?: string;
  type?: string;
  image_url?: { url?: string };
  tool_call?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
}

interface GeminiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status?: string;
  timestamp?: string;
}

interface GeminiThought {
  text?: string;
  type?: string;
}

interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
  thoughts?: number;
  tool?: number;
}

/** Detected session file format. */
type GeminiFormat = 'code-assist' | 'gemini-cli' | 'unknown';

/** Tool names that indicate file write/edit operations (lowercased). */
const GEMINI_WRITE_TOOLS = new Set([
  'write', 'write_file', 'create_file', 'edit', 'edit_file',
  'apply_diff', 'patch', 'multi_edit', 'create', 'overwrite',
  'replace', 'writefile',
]);

/** Tool names that indicate file read operations (lowercased). */
const GEMINI_READ_TOOLS = new Set([
  'read', 'read_file', 'view', 'list', 'ls', 'grep', 'search',
  'lookup', 'glob', 'find', 'readfile', 'read_many_files',
]);

const HARNESS_CODE_ASSIST = 'Gemini Code Assist';
const HARNESS_GEMINI_CLI = 'Gemini CLI';

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

/* ------------------------------------------------------------------ */
/*  Workspace resolution                                              */
/* ------------------------------------------------------------------ */

/**
 * Load the Gemini projects.json file which maps project root paths to
 * short names used as directory names under ~/.gemini/tmp/.
 * Returns a Map<shortName, fullPath> (inverted from the file).
 */
function loadGeminiProjects(): Map<string, string> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return new Map();

  const projectsPath = path.join(home, '.gemini', 'projects.json');
  try {
    const content = fs.readFileSync(projectsPath, 'utf-8');
    const parsed = JSON.parse(content) as { projects?: Record<string, string> };
    if (!parsed.projects) return new Map();

    // Invert: shortName → fullPath
    const result = new Map<string, string>();
    for (const [fullPath, shortName] of Object.entries(parsed.projects)) {
      result.set(shortName, fullPath);
    }
    return result;
  } catch {
    return new Map();
  }
}

/** Cache for projects map — loaded once per parse cycle to avoid redundant I/O. */
let _projectsCache: Map<string, string> | null = null;
let _projectsCacheHome: string = '';

function getGeminiProjects(): Map<string, string> {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!_projectsCache || _projectsCacheHome !== home) {
    _projectsCache = loadGeminiProjects();
    _projectsCacheHome = home;
  }
  return _projectsCache;
}

/**
 * Resolve workspace info from a short project directory name
 * (the directory name under ~/.gemini/tmp/). Falls back to the
 * short name if the projects file doesn't have a mapping.
 */
function resolveGeminiWorkspace(shortName: string): { workspaceName: string; workspaceRootPath: string | undefined } {
  const projects = getGeminiProjects();
  const fullPath = projects.get(shortName);
  if (fullPath) {
    return {
      workspaceName: path.basename(fullPath),
      workspaceRootPath: fullPath,
    };
  }
  return {
    workspaceName: shortName,
    workspaceRootPath: undefined,
  };
}

function normalizeWorkspaceName(raw: string): string {
  // Use the project directory name as the workspace name
  return raw;
}

function encodeWorkspaceId(projectName: string): string {
  return 'gemini-' + projectName;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Classify a tool use into edited/referenced files lists. */
function classifyGeminiToolUse(
  toolName: string,
  args: Record<string, unknown> | undefined,
  state: { editedFiles: string[]; referencedFiles: string[]; toolsUsed: string[] },
): void {
  const name = toolName.toLowerCase();
  state.toolsUsed.push(toolName);

  if (GEMINI_WRITE_TOOLS.has(name) && args) {
    const filePath = stringValue(args.path) || stringValue(args.file_path) || stringValue(args.filePath) || '';
    if (filePath) state.editedFiles.push(filePath);
  }

  if (GEMINI_READ_TOOLS.has(name) && args) {
    const filePath = stringValue(args.path) || stringValue(args.file_path) || stringValue(args.filePath) || '';
    if (filePath) state.referencedFiles.push(filePath);
  }
}

/** Extract code content from a tool call args for LoC counting. */
function extractCodeFromArgs(args: Record<string, unknown> | undefined): { code: string; ext: string } | null {
  if (!args) return null;
  const code = stringValue(args.content) || stringValue(args.new_str) || stringValue(args.code) || '';
  if (!code) return null;
  const fp = stringValue(args.path) || stringValue(args.file_path) || stringValue(args.filePath) || '';
  const ext = fp.split('.').pop() || '';
  return { code, ext };
}

/* ------------------------------------------------------------------ */
/*  Format detection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Detect session format by scanning the first N records.
 * Returns 'gemini-cli' if any record has type "gemini" or a toolCalls array,
 * 'code-assist' if any record has type "assistant", or 'unknown'.
 */
function detectFormat(records: GeminiLine[], _filePath: string): GeminiFormat {
  let hasAssistant = false;
  let hasGemini = false;
  let hasToolCalls = false;

  // Scan up to 50 records for format hints
  const scanLimit = Math.min(records.length, 50);
  for (let i = 0; i < scanLimit; i++) {
    const rec = records[i];
    if (rec.type === 'assistant') hasAssistant = true;
    if (rec.type === 'gemini') hasGemini = true;
    if (Array.isArray(rec.toolCalls) && rec.toolCalls.length > 0) hasToolCalls = true;

    // Subagent kind is Gemini CLI specific
    if (rec.kind === 'subagent') return 'gemini-cli';
  }

  if (hasGemini || hasToolCalls) return 'gemini-cli';
  if (hasAssistant) return 'code-assist';

  // Fallback: check file naming — Gemini CLI files are always .jsonl,
  // Gemini Code Assist files are also .jsonl, so this isn't a reliable
  // distinguisher. Return unknown and let the caller handle.
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Metadata extraction from $set records                             */
/* ------------------------------------------------------------------ */

interface GeminiSessionMetadata {
  summary?: string;
  memoryScratchpad?: string;
}

/**
 * Extract summary and memoryScratchpad from $set records scattered
 * through the session JSONL file. These are written by Gemini CLI as
 * the session progresses.
 */
function extractGeminiMetadata(records: GeminiLine[]): GeminiSessionMetadata {
  let summary: string | undefined;
  let memoryScratchpad: string | undefined;

  for (const rec of records) {
    if (!rec.$set) continue;
    if (typeof rec.$set.summary === 'string' && rec.$set.summary) {
      summary = rec.$set.summary;
    }
    if (typeof rec.$set.memoryScratchpad === 'string' && rec.$set.memoryScratchpad) {
      memoryScratchpad = rec.$set.memoryScratchpad;
    }
  }

  return { summary, memoryScratchpad };
}

/* ------------------------------------------------------------------ */
/*  Gemini CLI-specific parsing                                       */
/* ------------------------------------------------------------------ */

/**
 * Parse a Gemini CLI format session.
 *
 * Format details:
 *   - Metadata header: { sessionId, projectHash, startTime, lastUpdated, kind }
 *   - User messages:   { id, timestamp, type: "user", content: [...] }
 *   - AI messages:     { id, timestamp, type: "gemini", content: [...],
 *                         toolCalls, thoughts, tokens, model }
 *   - Metadata updates: { $set: { ... } }
 *   - Rewind markers:   { $rewindTo: "..." } (skip)
 */
function parseGeminiCliSessionFile(
  filePath: string,
  records: GeminiLine[],
  geminiSessionId: string,
  startTime: number,
  projectName: string,
  workspaceRootPath?: string,
): Session | null {
  // Find the session header record for metadata
  const headerRecord = records.find(r => r.kind === 'main' && r.sessionId === geminiSessionId) ||
                        records.find(r => r.kind === 'main' && r.sessionId);

  // Collect messages in chronological order
  const requests: SessionRequest[] = [];
  let pendingUserText = '';
  let pendingUserTs = 0;

  // Tally per-model token data from gemini messages
  const modelTokenTotals = new Map<string, { input: number; output: number; cached: number }>();

  for (const rec of records) {
    // Skip metadata-only records
    if (rec.$set) continue;
    if (rec.$rewindTo) continue;
    if ((rec.kind === 'main' || rec.kind === 'subagent') && rec.sessionId) continue;

    if (rec.type === 'user' && rec.content) {
      // Flush any previous pending user message
      if (pendingUserText) flushPendingUser(false);

      // Extract text from content blocks
      const textParts: string[] = [];
      for (const block of rec.content) {
        if (block.text) textParts.push(block.text);
        if (block.image_url?.url) textParts.push('[image]');
      }

      const recTs = ensureNumber(rec.timestamp);
      if (textParts.length > 0) {
        pendingUserText = textParts.join('\n');
        pendingUserTs = recTs || startTime;
      }
    } else if (rec.type === 'gemini') {
      // Gemini CLI assistant response
      const textParts: string[] = [];
      const tools: string[] = [];
      const editedFiles: string[] = [];
      const referencedFiles: string[] = [];
      let pendingCode = '';

      // Extract text from content blocks
      if (rec.content) {
        for (const block of rec.content) {
          if (block.text) textParts.push(block.text);
        }
      }

      // Extract thoughts/reasoning
      if (Array.isArray(rec.thoughts)) {
        for (const thought of rec.thoughts) {
          if (thought.text) {
            textParts.push(`[thought: ${thought.text}]`);
          }
        }
      }

      // Extract tool calls from the message-level array
      if (Array.isArray(rec.toolCalls)) {
        for (const tc of rec.toolCalls) {
          const name = tc.name || 'unknown';
          const args = isRecord(tc.args) ? tc.args : undefined;
          classifyGeminiToolUse(name, args, { editedFiles, referencedFiles, toolsUsed: tools });

          // Extract code content from write tools for LoC counting
          if (GEMINI_WRITE_TOOLS.has(name.toLowerCase()) && args) {
            const extracted = extractCodeFromArgs(args);
            if (extracted) {
              pendingCode += '```' + extracted.ext + '\n' + extracted.code + '\n```\n';
            }
          }
        }
      }

      // Extract tokens
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      let cacheReadTokens: number | null = null;
      if (rec.tokens) {
        promptTokens = rec.tokens.input ?? null;
        completionTokens = rec.tokens.output ?? null;
        cacheReadTokens = rec.tokens.cached ?? null;

        // Track per-model totals for session-level modelUsage
        const model = rec.model || 'unknown';
        if (!modelTokenTotals.has(model)) {
          modelTokenTotals.set(model, { input: 0, output: 0, cached: 0 });
        }
        const totals = modelTokenTotals.get(model)!;
        totals.input += promptTokens || 0;
        totals.output += completionTokens || 0;
        totals.cached += cacheReadTokens || 0;
      }

      const modelId = rec.model || '';
      const recTs = ensureNumber(rec.timestamp);
      const responseText = pendingCode + textParts.join('\n');

      if (pendingUserText) {
        // Pair with the pending user message
        requests.push(createRequest({
          requestId: geminiSessionId + '-' + (rec.id || String(recTs)),
          timestamp: pendingUserTs,
          messageText: pendingUserText,
          responseText,
          modelId,
          toolsUsed: tools,
          editedFiles,
          referencedFiles,
          promptTokens,
          completionTokens,
          cacheReadTokens,
        }));
        pendingUserText = '';
        pendingUserTs = 0;
      } else {
        // Orphaned assistant response — create as a synthetic request
        requests.push(createRequest({
          requestId: geminiSessionId + '-' + (rec.id || String(recTs)),
          timestamp: recTs || startTime,
          messageText: '',
          responseText,
          modelId,
          toolsUsed: tools,
          editedFiles,
          referencedFiles,
          promptTokens,
          completionTokens,
          cacheReadTokens,
        }));
      }
    }
  }

  function flushPendingUser(isPending: boolean): void {
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
      endState: isPending ? 'pending' : undefined,
    }));
    pendingUserText = '';
    pendingUserTs = 0;
  }

  // Flush final pending user
  flushPendingUser(true);

  // Sort requests by timestamp for correct ordering
  requests.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  if (requests.length === 0) return null;

  // Build per-model usage from accumulated token data
  let modelUsage: Record<string, ModelUsage> | undefined;
  if (modelTokenTotals.size > 0) {
    modelUsage = {};
    for (const [model, totals] of modelTokenTotals) {
      modelUsage[model] = {
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cached,
        cacheWriteTokens: 0,
      };
    }
  }

  // Extract session-level metadata from $set records
  const metadata = extractGeminiMetadata(records);
  if (metadata.summary) {
    warnCore('parser-gemini', `Session ${geminiSessionId} summary: ${metadata.summary.slice(0, 200)}`);
  }

  const workspaceInfo = resolveGeminiWorkspace(projectName);
  const workspaceName = workspaceInfo.workspaceName;
  const resolvedRootPath = workspaceInfo.workspaceRootPath ?? workspaceRootPath;
  const workspaceId = encodeWorkspaceId(projectName);

  const creationDate = startTime || null;
  const lastTimestamp = requests.length > 0
    ? requests[requests.length - 1].timestamp ?? creationDate
    : creationDate;

  // Track last user message times to compute overall session range
  let oldestTs = creationDate;
  let newestTs = lastTimestamp;
  for (const req of requests) {
    if (req.timestamp && (!oldestTs || req.timestamp < oldestTs)) oldestTs = req.timestamp;
    if (req.timestamp && (!newestTs || req.timestamp > newestTs)) newestTs = req.timestamp;
  }

  return createSession({
    sessionId: geminiSessionId,
    workspaceId,
    workspaceName,
    harness: HARNESS_GEMINI_CLI,
    requests,
    creationDate: oldestTs,
    lastMessageDate: newestTs,
    location: 'terminal',
    modelUsage,
    hasDevcontainer: detectDevcontainerFromRequests(requests),
    workspaceRootPath: resolvedRootPath,
  });
}

/* ------------------------------------------------------------------ */
/*  Gemini Code Assist (VS Code extension) parsing                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a Gemini Code Assist (VS Code extension) format session.
 *
 * Content blocks can have:
 *   { text: "..." }                            -- text content
 *   { image_url: { url: "..." } }              -- attached images
 *   { tool_call: { name, arguments } }         -- tool invocation
 *   { tool_result: { output, content } }       -- tool result
 */
function parseGeminiCodeAssistSessionFile(
  filePath: string,
  records: GeminiLine[],
  geminiSessionId: string,
  startTime: number,
  projectName: string,
  workspaceRootPath?: string,
): Session | null {
  const requests: SessionRequest[] = [];
  let pendingUserText = '';
  let pendingUserTs = 0;

  for (const rec of records) {
    if (rec.$set) continue;
    if (rec.kind === 'main' && rec.sessionId) continue;

    if (rec.type === 'user' && rec.content) {
      if (pendingUserText) flushPendingUser();

      const textParts: string[] = [];
      for (const block of rec.content) {
        if (block.text) textParts.push(block.text);
        if (block.image_url?.url) textParts.push('[image]');
        if (block.tool_call) {
          const fnName = stringValue(block.tool_call.name) || 'unknown';
          textParts.push(`[tool_call: ${fnName}]`);
        }
      }

      const recTs = ensureNumber(rec.timestamp);
      if (textParts.length > 0) {
        pendingUserText = textParts.join('\n');
        pendingUserTs = recTs || startTime;
      }
    } else if (rec.type === 'assistant' && rec.content) {
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
          const fnName = stringValue(block.tool_call.name) || 'function';
          const fnArgs = isRecord(block.tool_call.arguments) ? block.tool_call.arguments as Record<string, unknown> : undefined;
          classifyGeminiToolUse(fnName, fnArgs, { editedFiles, referencedFiles, toolsUsed: tools });
          if (GEMINI_WRITE_TOOLS.has(fnName.toLowerCase()) && fnArgs) {
            const extracted = extractCodeFromArgs(fnArgs);
            if (extracted) {
              pendingText += '```' + extracted.ext + '\n' + extracted.code + '\n```\n';
            }
          }
        }
        if (block.tool_result && isRecord(block.tool_result)) {
          const output = stringValue(block.tool_result.output) || stringValue(block.tool_result.content) || null;
          if (output) textParts.push(output);
        }
      }

      const recTs = ensureNumber(rec.timestamp);
      const responseText = pendingText + textParts.join('\n');

      if (pendingUserText) {
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

  flushPendingUser();

  if (requests.length === 0) return null;

  const workspaceInfo = resolveGeminiWorkspace(projectName);
  const workspaceName = workspaceInfo.workspaceName;
  const resolvedRootPath = workspaceInfo.workspaceRootPath ?? workspaceRootPath;
  const workspaceId = encodeWorkspaceId(projectName);

  let oldestTs = startTime || null;
  let newestTs = startTime || null;
  for (const req of requests) {
    if (req.timestamp && (!oldestTs || req.timestamp < oldestTs)) oldestTs = req.timestamp;
    if (req.timestamp && (!newestTs || req.timestamp > newestTs)) newestTs = req.timestamp;
  }

  return createSession({
    sessionId: geminiSessionId,
    workspaceId,
    workspaceName,
    harness: HARNESS_CODE_ASSIST,
    requests,
    creationDate: oldestTs,
    lastMessageDate: newestTs,
    location: 'panel',
    workspaceRootPath: resolvedRootPath,
  });
}

/* ------------------------------------------------------------------ */
/*  Combined parser entry point                                       */
/* ------------------------------------------------------------------ */

interface GeminiParseResult {
  session: Session;
  isSubagent: boolean;
}

function parseGeminiSessionFile(filePath: string): GeminiParseResult | null {
  if (!fs.existsSync(filePath)) return null;
  try { assertTrustedPath(filePath); } catch { return null; }

  // Read and parse all JSONL lines
  let rawContent: string;
  try {
    const decoder = new StringDecoder('utf-8');
    rawContent = decoder.end(fs.readFileSync(filePath) as Buffer);
  } catch {
    return null;
  }

  const lines = rawContent.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  const records: GeminiLine[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as GeminiLine;
      records.push(parsed);
    } catch { /* skip malformed lines */ }
  }
  if (records.length === 0) return null;

  // Extract session metadata from the first header record
  const headerRecord = records.find(r => (r.kind === 'main' || r.kind === 'subagent') && r.sessionId);
  if (!headerRecord || !headerRecord.sessionId) return null;

  const geminiSessionId = headerRecord.sessionId;
  const startTime = ensureNumber(headerRecord.startTime || headerRecord.timestamp);
  const isSubagent = headerRecord.kind === 'subagent';

  // Derive workspace from file path
  // Path: .../tmp/<project-name>/chats/session-*.jsonl
  const chatsDir = path.dirname(filePath);
  const projectDir = path.dirname(chatsDir);
  const projectName = path.basename(projectDir);

  // Resolve workspace info from projects.json
  const workspaceInfo = resolveGeminiWorkspace(projectName);
  const workspaceRootPath = workspaceInfo.workspaceRootPath;

  // Auto-detect format
  const format = detectFormat(records, filePath);

  let session: Session | null = null;
  if (format === 'gemini-cli') {
    session = parseGeminiCliSessionFile(filePath, records, geminiSessionId, startTime, projectName, workspaceRootPath);
  } else if (format === 'code-assist') {
    session = parseGeminiCodeAssistSessionFile(filePath, records, geminiSessionId, startTime, projectName, workspaceRootPath);
  } else {
    // Unknown format — try code-assist first (it was the original parser),
    // then gemini-cli as fallback.
    session = parseGeminiCodeAssistSessionFile(filePath, records, geminiSessionId, startTime, projectName, workspaceRootPath);
    if (!session) {
      session = parseGeminiCliSessionFile(filePath, records, geminiSessionId, startTime, projectName, workspaceRootPath);
    }
  }

  if (!session) return null;
  return { session, isSubagent };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Find all Gemini session directories (shared by both Gemini Code Assist
 * and Gemini CLI).
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
 * Merge subagent sessions into their parent sessions.
 *
 * Gemini CLI sessions can have `kind: "subagent"` on the header record.
 * Subagent sessions that share a sessionId with a parent are merged;
 * orphans (subagents with no matching parent) become standalone sessions
 * with a warning.
 *
 * @param sessions    All parsed sessions (will be modified in place)
 * @param subagentIdxs  Indices into sessions[] that are subagents
 */
function mergeGeminiSubagents(sessions: Session[], subagentIdxs: number[]): void {
  if (subagentIdxs.length === 0) return;

  // Build parent index by sessionId (first non-subagent session wins)
  const subagentSet = new Set(subagentIdxs);
  const byId = new Map<string, Session>();
  for (let i = 0; i < sessions.length; i++) {
    if (!subagentSet.has(i) && !byId.has(sessions[i].sessionId)) {
      byId.set(sessions[i].sessionId, sessions[i]);
    }
  }

  // Track indices to remove after merge
  const removeIdxs = new Set<number>();

  for (const idx of subagentIdxs) {
    const s = sessions[idx];
    const parent = byId.get(s.sessionId);

    if (parent && parent !== s) {
      // Merge subagent requests into parent
      for (const r of s.requests) parent.requests.push(r);
      // Extend parent's timestamps
      if (s.lastMessageDate &&
          (!parent.lastMessageDate || s.lastMessageDate > parent.lastMessageDate)) {
        parent.lastMessageDate = s.lastMessageDate;
      }
      if (s.creationDate &&
          (!parent.creationDate || s.creationDate < parent.creationDate)) {
        parent.creationDate = s.creationDate;
      }
      // Merge model usage
      if (s.modelUsage) {
        if (!parent.modelUsage) parent.modelUsage = {};
        for (const [model, usage] of Object.entries(s.modelUsage)) {
          if (!parent.modelUsage[model]) {
            parent.modelUsage[model] = { ...usage };
          } else {
            parent.modelUsage[model].inputTokens += usage.inputTokens;
            parent.modelUsage[model].outputTokens += usage.outputTokens;
            parent.modelUsage[model].cacheReadTokens += usage.cacheReadTokens;
            parent.modelUsage[model].cacheWriteTokens += usage.cacheWriteTokens;
          }
        }
      }
      removeIdxs.add(idx);
    } else {
      // Orphan subagent — keep as standalone
      warnCore('parser-gemini', `Orphan subagent session (no parent found): ${s.sessionId}`);
    }
  }

  // Re-sort merged parent requests and update requestCount
  for (const s of byId.values()) {
    if (s.requests.length > 1) {
      s.requests.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    }
    s.requestCount = s.requests.length;
  }

  // Remove merged subagents from the array
  if (removeIdxs.size > 0) {
    const kept = sessions.filter((_, i) => !removeIdxs.has(i));
    sessions.length = 0;
    for (const s of kept) sessions.push(s);
  }
}

/**
 * Parse all Gemini session files in a chats directory.
 * Auto-detects Gemini CLI vs Gemini Code Assist format per file.
 * Performs subagent merging after parsing.
 * @param chatsDir Path to a Gemini chats directory (~/.gemini/tmp/<project>/chats/)
 * @returns Array of parsed sessions
 */
export function parseGeminiSessions(chatsDir: string): Session[] {
  if (!fs.existsSync(chatsDir)) return [];

  const sessions: Session[] = [];
  const subagentIdxs: number[] = [];

  try {
    const files = fs.readdirSync(chatsDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(chatsDir, file);
      try {
        const result = parseGeminiSessionFile(filePath);
        if (result) {
          if (result.isSubagent) {
            subagentIdxs.push(sessions.length);
          }
          sessions.push(result.session);
        }
      } catch {
        // Skip corrupted session files
      }
    }
  } catch {
    // Permission or missing directory
  }

  // Merge subagent sessions into their parents
  mergeGeminiSubagents(sessions, subagentIdxs);

  return sessions;
}

/**
 * Async version of parseGeminiSessions. Parses all session files in a
 * Gemini chats directory with async I/O to keep the event loop responsive.
 * @param chatsDir Path to a Gemini chats directory (~/.gemini/tmp/<project>/chats/)
 * @returns Array of parsed sessions
 */
export async function parseGeminiSessionsAsync(
  chatsDir: string,
  onFile?: (idx: number, total: number, name: string) => void,
): Promise<Session[]> {
  if (!fs.existsSync(chatsDir)) return [];

  let files: string[];
  try {
    files = (await fs.promises.readdir(chatsDir)).filter(f => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const sessions: Session[] = [];
  const subagentIdxs: number[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(chatsDir, file);
    onFile?.(i + 1, files.length, file);
    try {
      const result = parseGeminiSessionFile(filePath);
      if (result) {
        if (result.isSubagent) {
          subagentIdxs.push(sessions.length);
        }
        sessions.push(result.session);
      }
    } catch {
      // Skip corrupted session files
    }
    // Yield every 5 files to keep the event loop responsive
    if (i % 5 === 0) await new Promise<void>(r => setTimeout(r, 0));
  }

  // Merge subagent sessions into their parents
  mergeGeminiSubagents(sessions, subagentIdxs);

  return sessions;
}
