/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pi session parser implementation.
 *
 * Data layout:
 *   ~/.pi/agent/sessions/<encoded-workspace-path>/<timestamp>_<uuid>.jsonl
 *
 * Each .jsonl file is a session. Lines are tree-structured via parentId:
 *
 *   Line 0: {"type":"session","version":3,"id":"<session-uuid>","timestamp":"ISO","cwd":"/path"}
 *   Subsequent: {"type":"model_change"|"thinking_level_change"|"message",
 *                "id":"...","parentId":"...","timestamp":"ISO", ...}
 *
 * Message roles: user, assistant, toolResult
 * Assistant content blocks: thinking, text, toolCall
 */

import * as fs from 'fs';
import * as path from 'path';
import { Session, SessionRequest } from './types';
import { createRequest, createSession, extractCodeBlocks, detectDevcontainerFromRequests } from './parser-shared';
import { debugCore, warnCore } from './log';
import { canonicalizeReasoningEffort } from './helpers';

/* ---- Types ---- */

interface PiSessionHeader {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
}

interface PiBaseEntry {
  type: 'model_change' | 'thinking_level_change' | 'message';
  id: string;
  parentId: string | null;
  timestamp: string;
}

interface PiModelChangeEntry extends PiBaseEntry {
  type: 'model_change';
  provider: string;
  modelId: string;
}

interface PiThinkingLevelChangeEntry extends PiBaseEntry {
  type: 'thinking_level_change';
  thinkingLevel: string;
}

interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

interface PiMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: PiContentBlock[] | string;
  api?: string;
  provider?: string;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  stopReason?: string;
  errorMessage?: string;
  timestamp?: number;
  responseId?: string;
  responseModel?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

interface PiMessageEntry extends PiBaseEntry {
  type: 'message';
  message: PiMessage;
}

type PiEntry = PiModelChangeEntry | PiThinkingLevelChangeEntry | PiMessageEntry;

/* ---- Helpers ---- */

function parsePiEntries(raw: string): PiEntry[] {
  const entries: PiEntry[] = [];
  for (const rawLine of raw.split('\n')) {
    if (!rawLine.trim()) continue;
    try {
      const entry = JSON.parse(rawLine);
      if (entry.type === 'session') continue; // skip header
      if (entry.type === 'model_change' || entry.type === 'thinking_level_change' || entry.type === 'message') {
        entries.push(entry as PiEntry);
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function getTs(ts: string | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/** Walk the parentId chain to collect the ancestor IDs of a given entry. */
function getAncestorIds(entries: PiEntry[], startId: string): string[] {
  const ids: string[] = [];
  const byId = new Map<string, PiEntry>();
  for (const e of entries) byId.set(e.id, e);

  let current: PiEntry | undefined = byId.get(startId);
  while (current && current.parentId) {
    ids.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return ids;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isContentBlock(v: unknown): v is PiContentBlock {
  return isRecord(v) && typeof v.type === 'string';
}

function toContentArray(content: PiContentBlock[] | string | undefined): PiContentBlock[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function getUsageNumber(usage: Record<string, unknown> | undefined, key: string): number {
  const v = usage?.[key];
  return typeof v === 'number' ? v : 0;
}

/* ---- Session-level context accumulation ---- */

interface PiSessionContext {
  /** Current active model info tracked via model_change entries. */
  currentModel: { provider: string; modelId: string };
  /** Current thinking level tracked via thinking_level_change entries. */
  currentThinkingLevel: string | null;
  /** Token usage since last user message. */
  pendingInputTokens: number;
  pendingOutputTokens: number;
  pendingCacheRead: number;
  pendingCacheWrite: number;
  /** Accumulated assistant text / tools since last user message. */
  pendingResponseTexts: string[];
  pendingTools: string[];
  pendingEditedFiles: string[];
  pendingReferencedFiles: string[];
  pendingModel: string;
  pendingStopReason: string;
  pendingErrorMessage: string | null;
  /** Track whether we saw any assistant response tokens (for endState logic). */
  sawAssistantTokens: boolean;
  /** Set of toolCall IDs seen to match toolResults. */
  pendingToolCallNames: Map<string, string>;
}

function resetAssistantAccum(ctx: PiSessionContext): void {
  ctx.pendingInputTokens = 0;
  ctx.pendingOutputTokens = 0;
  ctx.pendingCacheRead = 0;
  ctx.pendingCacheWrite = 0;
  ctx.pendingResponseTexts = [];
  ctx.pendingTools = [];
  ctx.pendingEditedFiles = [];
  ctx.pendingReferencedFiles = [];
  ctx.pendingModel = '';
  ctx.pendingStopReason = '';
  ctx.pendingErrorMessage = null;
  ctx.sawAssistantTokens = false;
  ctx.pendingToolCallNames.clear();
}

/* ---- Tool classification ---- */

const PI_WRITE_TOOLS = new Set(['edit', 'write', 'Edit', 'Write', 'MultiEditTool']);
const PI_READ_FILE_TOOLS = new Set(['read', 'Read', 'View']);
const PI_READ_PATH_TOOLS = new Set(['bash', 'Glob', 'LS', 'Find', 'grep']);

function classifyPiToolUse(name: string, args: Record<string, unknown> | undefined, ctx: {
  editedFiles: string[];
  referencedFiles: string[];
  toolsUsed: string[];
}): void {
  if (!name) return;
  ctx.toolsUsed.push(name);

  if (PI_WRITE_TOOLS.has(name)) {
    const fp = typeof args?.path === 'string' ? args.path : null;
    if (fp) ctx.editedFiles.push(fp);
    return;
  }
  if (PI_READ_FILE_TOOLS.has(name)) {
    const fp = typeof args?.path === 'string' ? args.path : null;
    if (fp) ctx.referencedFiles.push(fp);
    return;
  }
  if (PI_READ_PATH_TOOLS.has(name)) {
    if (name === 'bash') {
      // bash commands often reference file paths; we capture the command
      // but don't try to extract file paths from free text
      return;
    }
    const target = typeof args?.path === 'string' ? args.path
      : typeof args?.pattern === 'string' ? args.pattern
      : null;
    if (target) ctx.referencedFiles.push(target);
  }
}

/* ---- Main session parser ---- */

function parsePiSessionFileInternal(
  filePath: string,
  wsId: string,
  wsName: string,
  harness: string,
): Session | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    debugCore('parser-pi', `Cannot read ${filePath}`, e);
    return null;
  }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Parse header
  let header: PiSessionHeader;
  try {
    const first = JSON.parse(lines[0]);
    if (first.type !== 'session') {
      warnCore('parser-pi', `Invalid session header in ${filePath}`);
      return null;
    }
    header = first as PiSessionHeader;
  } catch (e) {
    debugCore('parser-pi', `Failed to parse header in ${filePath}`, e);
    return null;
  }

  const sessionId = header.id;
  const cwd = header.cwd || '';
  const entries = parsePiEntries(raw);
  if (entries.length === 0) {
    debugCore('parser-pi', `No entries in ${filePath}`);
    return null;
  }

  // Build id->entry map for tree walking
  const byId = new Map<string, PiEntry>();
  for (const e of entries) byId.set(e.id, e);

  // Children map: parentId -> children (preserving order)
  const childrenOf = new Map<string | null, PiEntry[]>();
  for (const e of entries) {
    const parentKey = e.parentId ?? '';
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey)!.push(e);
  }

  // Collect leaf message entries (entries with no children that are messages)
  const leafIds = new Set(entries.map(e => e.id));
  for (const e of entries) {
    if (e.parentId) leafIds.delete(e.parentId);
  }

  // Collect user messages on the main path (breadth-first from root children)
  const sessionCtx: PiSessionContext = {
    currentModel: { provider: '', modelId: '' },
    currentThinkingLevel: null,
    pendingInputTokens: 0,
    pendingOutputTokens: 0,
    pendingCacheRead: 0,
    pendingCacheWrite: 0,
    pendingResponseTexts: [],
    pendingTools: [],
    pendingEditedFiles: [],
    pendingReferencedFiles: [],
    pendingModel: '',
    pendingStopReason: '',
    pendingErrorMessage: null,
    sawAssistantTokens: false,
    pendingToolCallNames: new Map(),
  };

  const requests: SessionRequest[] = [];
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let requestIndex = 0;

  // Walk entries in chronological order, tracking context state
  for (const entry of entries) {
    const entryTs = getTs(entry.timestamp);
    if (entryTs) {
      if (!firstTs || entryTs < firstTs) firstTs = entryTs;
      if (!lastTs || entryTs > lastTs) lastTs = entryTs;
    }

    if (entry.type === 'model_change') {
      sessionCtx.currentModel = { provider: entry.provider, modelId: entry.modelId };
      continue;
    }

    if (entry.type === 'thinking_level_change') {
      sessionCtx.currentThinkingLevel = entry.thinkingLevel;
      continue;
    }

    if (entry.type !== 'message') continue;

    const msg = entry.message;

    if (msg.role === 'user') {
      // Flush any pending assistant data from previous turn
      if (sessionCtx.sawAssistantTokens || sessionCtx.pendingTools.length > 0) {
        // This represents a follow-up user message in the same session
        // The previous assistant response is already captured
      }

      // Extract user text
      const userText = toContentArray(msg.content)
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join('\n');

      // Count images
      const imageCount = toContentArray(msg.content)
        .filter(c => c.type === 'image').length;

      // Start tracking assistant state for this turn
      resetAssistantAccum(sessionCtx);
      sessionCtx.pendingModel = sessionCtx.currentModel.modelId;

      // Create request for this user message (will be updated when we see the assistant response)
      const req = createRequest({
        requestId: entry.id,
        timestamp: entryTs,
        messageText: userText,
        responseText: '', // filled when we see assistant response
        agentName: 'pi',
        agentMode: 'agent',
        modelId: sessionCtx.currentModel.modelId,
        toolsUsed: [],
        editedFiles: [],
        referencedFiles: [],
        variableKinds: imageCount > 0 ? { image: imageCount } : {},
        totalElapsed: null, // filled at end
        promptTokens: null, // filled from assistant usage
        completionTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningEffort: canonicalizeReasoningEffort(sessionCtx.currentThinkingLevel),
      });

      requests.push({ entry: req, idx: requestIndex++ } as any);
      lastTs = entryTs;
      continue;
    }

    if (msg.role === 'assistant') {
      // Accumulate assistant data into the most recent user request
      const content = toContentArray(msg.content);

      // Extract thinking and text
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          sessionCtx.pendingResponseTexts.push(block.text);
        }
        if (block.type === 'toolCall' && block.name) {
          // Track tool call for matching with results
          const toolId = block.id || '';
          if (toolId) sessionCtx.pendingToolCallNames.set(toolId, block.name);

          // Classify tool use
          classifyPiToolUse(block.name, block.arguments as Record<string, unknown> | undefined, {
            editedFiles: sessionCtx.pendingEditedFiles,
            referencedFiles: sessionCtx.pendingReferencedFiles,
            toolsUsed: sessionCtx.pendingTools,
          });
        }
      }

      // Update model from this message if present
      if (msg.model) sessionCtx.pendingModel = msg.model;
      else if (sessionCtx.currentModel.modelId) sessionCtx.pendingModel = sessionCtx.currentModel.modelId;

      // Accumulate token usage
      if (msg.usage) {
        sessionCtx.pendingInputTokens += getUsageNumber(msg.usage as Record<string, unknown>, 'input');
        sessionCtx.pendingOutputTokens += getUsageNumber(msg.usage as Record<string, unknown>, 'output');
        sessionCtx.pendingCacheRead += getUsageNumber(msg.usage as Record<string, unknown>, 'cacheRead');
        sessionCtx.pendingCacheWrite += getUsageNumber(msg.usage as Record<string, unknown>, 'cacheWrite');
        if ((sessionCtx.pendingInputTokens > 0 || sessionCtx.pendingOutputTokens > 0)) {
          sessionCtx.sawAssistantTokens = true;
        }
      }

      if (msg.stopReason) sessionCtx.pendingStopReason = msg.stopReason;
      if (msg.errorMessage) {
        sessionCtx.pendingErrorMessage = msg.errorMessage;
        sessionCtx.pendingStopReason = 'error';
      }

      if (entryTs && (!lastTs || entryTs > lastTs)) lastTs = entryTs;
      continue;
    }

    if (msg.role === 'toolResult') {
      // Tool results don't change request state directly
      if (entryTs && (!lastTs || entryTs > lastTs)) lastTs = entryTs;
      continue;
    }
  }

  // Walk through entries sequentially, pairing user messages with following assistant messages
  const userRequests: SessionRequest[] = [];
  let currentUser: { entry: PiMessageEntry; req: SessionRequest } | null = null;
  let assistantsSinceUser: {
    texts: string[];
    tools: string[];
    editedFiles: string[];
    referencedFiles: string[];
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    stopReason: string;
    errorMessage: string | null;
    timestamp: number | null;
  }[] = [];
  let lastModel = sessionCtx.currentModel;
  let lastAssistantTs: number | null = null;
  let lastThinkingLevel = sessionCtx.currentThinkingLevel;

  for (const entry of entries) {
    if (entry.type === 'model_change') {
      lastModel = { provider: entry.provider, modelId: entry.modelId };
      continue;
    }
    if (entry.type === 'thinking_level_change') {
      lastThinkingLevel = entry.thinkingLevel;
      continue;
    }
    if (entry.type !== 'message') continue;

    const msg = entry.message;

    if (msg.role === 'user') {
      // Finalize previous user request if any
      if (currentUser) {
        finalizePiRequest(currentUser, assistantsSinceUser, userRequests);
      }

      const userText = toContentArray(msg.content)
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join('\n');

      const imageCount = toContentArray(msg.content)
        .filter(c => c.type === 'image').length;

      assistantsSinceUser = [];
      const entryTs = getTs(entry.timestamp);
      const req = createRequest({
        requestId: entry.id,
        timestamp: entryTs,
        messageText: userText,
        responseText: '',
        agentName: 'pi',
        agentMode: 'agent',
        modelId: lastModel.modelId,
        toolsUsed: [],
        editedFiles: [],
        referencedFiles: [],
        variableKinds: imageCount > 0 ? { image: imageCount } : {},
        totalElapsed: null,
        promptTokens: null,
        completionTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningEffort: canonicalizeReasoningEffort(lastThinkingLevel),
      });

      currentUser = { entry, req };
      continue;
    }

    if (msg.role === 'assistant') {
      const content = toContentArray(msg.content);
      const entryTs = getTs(entry.timestamp);
      const acc: typeof assistantsSinceUser[0] = {
        texts: [],
        tools: [],
        editedFiles: [],
        referencedFiles: [],
        model: msg.model || lastModel.modelId,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        stopReason: msg.stopReason || '',
        errorMessage: msg.errorMessage || null,
        timestamp: entryTs,
      };

      for (const block of content) {
        if (block.type === 'text' && block.text) acc.texts.push(block.text);

        if (block.type === 'toolCall' && block.name) {
          classifyPiToolUse(block.name, block.arguments as Record<string, unknown> | undefined, {
            editedFiles: acc.editedFiles,
            referencedFiles: acc.referencedFiles,
            toolsUsed: acc.tools,
          });

          // Extract code from write/edit tool calls so extractCodeBlocks() can count LoC
          if (PI_WRITE_TOOLS.has(block.name) && block.arguments) {
            const args = block.arguments as Record<string, unknown>;
            const code = typeof args.content === 'string' ? args.content
              : typeof args.new_str === 'string' ? args.new_str
              : typeof args.code === 'string' ? args.code
              : null;
            if (code) {
              const filePath = typeof args.path === 'string' ? args.path
                : typeof args.file_path === 'string' ? args.file_path
                : '';
              const ext = filePath.split('.').pop() || '';
              acc.texts.push('\`\`\`' + ext + '\n' + code + '\n\`\`\`');
            }
          }
        }
      }

      if (msg.usage) {
        acc.inputTokens = getUsageNumber(msg.usage as Record<string, unknown>, 'input');
        acc.outputTokens = getUsageNumber(msg.usage as Record<string, unknown>, 'output');
        acc.cacheRead = getUsageNumber(msg.usage as Record<string, unknown>, 'cacheRead');
        acc.cacheWrite = getUsageNumber(msg.usage as Record<string, unknown>, 'cacheWrite');
      }

      if (msg.errorMessage) acc.errorMessage = msg.errorMessage;

      if (entryTs && (!lastAssistantTs || entryTs > lastAssistantTs)) lastAssistantTs = entryTs;
      assistantsSinceUser.push(acc);
      continue;
    }

    // toolResult — ignored for request construction
  }

  // Finalize last user request
  if (currentUser) {
    finalizePiRequest(currentUser, assistantsSinceUser, userRequests);
  }

  if (userRequests.length === 0) return null;

  // Determine endReason based on last assistant stopReason
  const lastEntry = entries[entries.length - 1];
  let endReason: Session['endReason'] = 'unknown';
  if (lastEntry.type === 'message') {
    const role = lastEntry.message.role;
    if (role === 'assistant') {
      const sr = lastEntry.message.stopReason;
      if (sr === 'stop' || sr === 'toolUse') {
        endReason = 'shutdown';
      } else if (sr === 'aborted') {
        endReason = 'aborted';
      }
    } else if (role === 'user') {
      // Session ended with user message (still active)
      endReason = 'active';
    }
  }

  return createSession({
    sessionId,
    workspaceId: wsId,
    workspaceName: wsName,
    location: cwd || 'terminal',
    harness,
    creationDate: firstTs,
    lastMessageDate: lastTs,
    requests: userRequests,
    hasDevcontainer: detectDevcontainerFromRequests(userRequests, cwd),
    workspaceRootPath: cwd || undefined,
    endReason,
  });
}

function finalizePiRequest(
  currentUser: { entry: PiMessageEntry; req: SessionRequest },
  assistantsSinceUser: {
    texts: string[];
    tools: string[];
    editedFiles: string[];
    referencedFiles: string[];
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
    stopReason: string;
    errorMessage: string | null;
    timestamp: number | null;
  }[],
  outRequests: SessionRequest[],
): void {
  const req = currentUser.req;
  const userTs = req.timestamp;

  if (assistantsSinceUser.length === 0) {
    // User message with no assistant response (pending/aborted)
    outRequests.push(createRequest({
      ...req,
      messageText: req.messageText,
      responseText: '',
      endState: 'pending',
      userCode: undefined,
      aiCode: undefined,
    }));
    return;
  }

  // Accumulate across all assistant turns for this user request
  let responseTexts: string[] = [];
  const toolsSet = new Set<string>();
  const editedSet = new Set<string>();
  const referencedSet = new Set<string>();
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let lastModel = '';
  let lastStopReason = '';
  let sawError = false;
  let lastAssistantTs: number | null = null;

  for (const acc of assistantsSinceUser) {
    if (acc.timestamp && (!lastAssistantTs || acc.timestamp > lastAssistantTs)) {
      lastAssistantTs = acc.timestamp;
    }
    responseTexts.push(...acc.texts);
    for (const t of acc.tools) toolsSet.add(t);
    for (const f of acc.editedFiles) editedSet.add(f);
    for (const f of acc.referencedFiles) referencedSet.add(f);
    totalInput += acc.inputTokens;
    totalOutput += acc.outputTokens;
    totalCacheRead += acc.cacheRead;
    totalCacheWrite += acc.cacheWrite;
    if (acc.model) lastModel = acc.model;
    if (acc.stopReason) lastStopReason = acc.stopReason;
    if (acc.errorMessage) sawError = true;
  }

  const hasAnyTokens = totalInput > 0 || totalOutput > 0;

  // Determine endState
  let endState: 'pending' | 'errored' | 'no-data' | undefined;
  if (sawError || lastStopReason === 'aborted' || lastStopReason === 'error') {
    endState = 'errored';
  } else if (lastStopReason === 'stop' || lastStopReason === 'toolUse') {
    if (!hasAnyTokens) {
      endState = 'no-data';
    }
  }
  // If stopReason is 'toolUse', the assistant started a tool call
  // The response continues in subsequent assistant messages with tool results

  const elapsed = userTs && lastAssistantTs ? lastAssistantTs - userTs : null;

  outRequests.push(createRequest({
    ...req,
    requestId: req.requestId || currentUser.entry.id,
    messageText: req.messageText,
    responseText: responseTexts.join('\n'),
    modelId: lastModel || req.modelId,
    toolsUsed: [...toolsSet],
    editedFiles: [...editedSet],
    referencedFiles: [...referencedSet],
    totalElapsed: elapsed,
    promptTokens: hasAnyTokens ? totalInput : null,
    completionTokens: hasAnyTokens ? totalOutput : null,
    cacheReadTokens: totalCacheRead > 0 ? totalCacheRead : null,
    cacheWriteTokens: totalCacheWrite > 0 ? totalCacheWrite : null,
    endState,
    // Force re-extraction of code blocks from the updated response text
    userCode: undefined,
    aiCode: undefined,
  }));
}

/* ---- Directory discovery ---- */

/**
 * Resolve an encoded Pi workspace directory name back to the real folder name.
 *
 * Pi encodes workspace paths by replacing `/` and whitespace with `-`.
 * For example `--Users-bgartamaker--` represents `/Users/bgartamaker`.
 * Because the encoding is lossy (hyphens, spaces, and path separators all
 * become `-`) we first try to read the `cwd` from a session header as the
 * authoritative name, and fall back to a naive decoding.
 *
 * If `workspaceDir` is provided (the full path to the workspace directory),
 * we scan session headers for the real `cwd` value.
 */
export function decodePiWorkspaceName(encoded: string, workspaceDir?: string): string {
  // Try reading the real cwd from the first session file header
  if (workspaceDir) {
    try {
      const entries = fs.readdirSync(workspaceDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.jsonl'));
      if (entries.length > 0) {
        // Read the first line (session header) from the first file
        const firstFile = path.join(workspaceDir, entries[0].name);
        const firstLine = fs.readFileSync(firstFile, 'utf-8').split('\n')[0];
        const header = JSON.parse(firstLine);
        if (header.type === 'session' && typeof header.cwd === 'string' && header.cwd) {
          // Use the basename of cwd as the workspace display name
          return path.basename(header.cwd.replace(/\/+$/, ''));
        }
      }
    } catch {
      // fall through to heuristic decoding
    }
  }

  // Heuristic decoding: extract the last meaningful segment.
  // Pattern: `--Users-bgartamaker-tools-AI-Engineering-Coach--`
  // Strip leading/trailing `-` tokens, then join remaining segments with `/`.
  // This is lossy for names containing hyphens, but produces a valid path.
  if (encoded.startsWith('--')) {
    // Remove leading `--` and trailing `--` if present
    let stripped = encoded;
    if (stripped.startsWith('--')) stripped = stripped.slice(2);
    if (stripped.endsWith('--')) stripped = stripped.slice(0, -2);

    const segments = stripped.split('-');
    const parts = segments.filter(s => s.length > 0);
    if (parts.length > 0) {
      return '/' + parts.join('/');
    }
  }

  // Windows drive pattern: e.g. `c--Users-...`
  if (/^[a-zA-Z]--/.test(encoded)) {
    const segments = encoded.split('-');
    const parts = segments.filter(s => s.length > 0);
    if (parts.length >= 2) {
      const drive = parts[0];
      return drive + ':/' + parts.slice(1).join('/');
    }
  }

  return encoded;
}

/** Find Pi session directories under ~/.pi/agent/sessions/. */
export function findPiDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return [];
  const piDir = path.join(home, '.pi', 'agent', 'sessions');
  try {
    if (fs.existsSync(piDir) && fs.statSync(piDir).isDirectory()) {
      return [piDir];
    }
  } catch {
    // ignore
  }
  return [];
}

/** Parse all Pi sessions from the given sessions directory. */
export function parsePiSessions(sessionsDir: string): { sessions: Session[]; workspaceId: string; workspaceName: string }[] {
  const results: { sessions: Session[]; workspaceId: string; workspaceName: string }[] = [];

  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory());
  } catch {
    return results;
  }

  // Skip directories that don't look like Pi workspace dirs (must have `--`)
  for (const projDir of projectDirs) {
    const dirName = projDir.name;
    // Pi workspace directories are encoded paths, typically starting with `--` on Unix
    if (!dirName.includes('--')) continue;

    const workspaceId = `pi-${dirName}`;
    const projPath = path.join(sessionsDir, dirName);
    // Resolve workspace name from session header cwd, with fallback
    const workspaceName = decodePiWorkspaceName(dirName, projPath);

    const sessions: Session[] = [];

    try {
      const files = fs.readdirSync(projPath, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.jsonl'));

      for (const file of files) {
        const session = parsePiSessionFileInternal(
          path.join(projPath, file.name),
          workspaceId,
          workspaceName,
          'pi',
        );
        if (session) sessions.push(session);
      }
    } catch (e) {
      debugCore('parser-pi', `Cannot list files in ${projPath}`, e);
    }

    if (sessions.length > 0) {
      results.push({ sessions, workspaceId, workspaceName });
    }
  }

  return results;
}

/** Legacy single-file parser — delegates to the detailed parser. */
export function parsePiSessionFile(
  sessionFile: string,
  wsId: string,
  wsName: string,
  harness: string,
): Session | null {
  return parsePiSessionFileInternal(sessionFile, wsId, wsName, harness);
}

/** Alias for consistent naming (detailed = full implementation). */
export function parsePiSessionFileDetailed(
  sessionFile: string,
  wsId: string,
  wsName: string,
  harness: string,
): Session | null {
  return parsePiSessionFileInternal(sessionFile, wsId, wsName, harness);
}
