# Gemini CLI Support Specification

## Problem

The existing `parser-gemini.ts` handles **Gemini Code Assist** (the VS Code
extension/side-panel tool) session files from `~/.gemini/tmp/<project>/chats/`.
However, Google's standalone **Gemini CLI** (`@google/gemini-cli`) — a separate
open-source terminal AI agent with 100K+ GitHub stars — writes to the same
directory but uses a **different JSONL session format**. The current parser
silently produces empty results for Gemini CLI sessions because it never
matches the CLI's `type: "gemini"` assistant records (it expects
`type: "assistant"`).

## Gemini CLI Data Sources

### 1. Chat Sessions (primary)

| Detail | Value |
|---|---|
| Location | `~/.gemini/tmp/<project_hash>/chats/session-*.jsonl` |
| Format | Newline-delimited JSON (JSONL) |
| File prefix | `session-` |
| Shared path with | Gemini Code Assist (VS Code extension) |

### 2. Activity Logs (optional, secondary)

| Detail | Value |
|---|---|
| Location | `~/.gemini/tmp/<project_hash>/logs/session-<sessionId>.jsonl` |
| Availability | Only when `GEMINI_CLI_ACTIVITY_LOG_TARGET=file` is set |
| Content | Console log entries and network request/response payloads |
| Format | `{ type: "console"|"network", payload: {...}, sessionId, timestamp }` |

## Format Differences

### Common fields (same)

Both tools share the same header record format:

```jsonl
{ "sessionId": "...", "projectHash": "...", "startTime": "...", "lastUpdated": "...", "kind": "main" }
{ "id": "...", "timestamp": "...", "type": "user", "content": [...] }
{ "$set": { "lastUpdated": "..." } }
```

### Gemini Code Assist (VS Code extension) — currently handled

```jsonl
{ "id": "...", "timestamp": "...", "type": "assistant", "content": [
  { "text": "..." },
  { "tool_call": { "name": "write_file", "arguments": {...} } },
  { "tool_result": { "output": "..." } }
]}
```

### Gemini CLI — Handle via `type: "gemini"`

```jsonl
{ "id": "...", "timestamp": "...", "type": "gemini", "content": [...],
  "toolCalls": [
    { "id": "...", "name": "write_file", "args": {...},
      "result": [...], "status": "success", "timestamp": "..." }
  ],
  "thoughts": [{ "text": "...", "type": "reasoning" }],
  "tokens": { "input": 123, "output": 456, "cached": 78, "total": 657 },
  "model": "gemini-2.5-pro"
}
```

Key differences:

| Feature | Gemini Code Assist | Gemini CLI |
|---|---|---|
| Assistant type field | `"assistant"` | `"gemini"` |
| Tool calls | Content blocks with `tool_call` | Message-level `toolCalls[]` array |
| Token usage | Not on messages | `tokens` object on gemini messages |
| Model tracking | Not on messages | `model` field on gemini messages |
| Reasoning | Not stored | `thoughts[]` array on gemini messages |
| Rewind records | Not used | `$rewindTo` records |
| Subagents | Not supported | `kind: "subagent"` |
| Summary/metadata | Basic `$set` | `$set` with `summary`, `memoryScratchpad` |

## Detection Strategy

Parse the first 20 lines of each session file and check for the presence of
`type: "gemini"` records vs `type: "assistant"` records:

- If any record has `type: "gemini"` → treat as **Gemini CLI** format
- If any record has `type: "assistant"` → treat as **Gemini Code Assist** format
- Fallback: detect by checking for `toolCalls` arrays on any record

## Harness Naming

| Format | Harness Value |
|---|---|
| Gemini Code Assist | `"Gemini Code Assist"` |
| Gemini CLI | `"Gemini CLI"` |

This allows the dashboard to distinguish between the two tools.

## Implementation Plan

### Phase 1: Chat session parser core (Mostly Complete)

- [x] **Detect format** during session file parsing by scanning the first records.
- [x] **Handle `type: "gemini"`** — treat as assistant messages with tool calls,
      tokens, thoughts, and model.
- [x] **Extract `toolCalls[]`** — parse each tool call for name, args, status;
      classify write vs read tools for editedFiles/referencedFiles.
- [x] **Extract `tokens`** — populate `promptTokens` (input), `completionTokens`
      (output), `cacheReadTokens` (cached).
- [x] **Extract `model`** — set on each request for model attribution.
- [x] **Skip `$rewindTo` records** — gracefully ignore.
- [x] **Set harness** to `"Gemini CLI"` for CLI format, `"Gemini Code Assist"` for
      VS Code extension format.
- [x] **Harness registry** — update `parser-harnesses.ts` to include `"Gemini CLI"`
      in `EXTERNAL_HARNESS_SET`.

### Phase 1b: Polish & Reliability (Complete ✅)

- [x] **Workspace resolution** — use `~/.gemini/projects.json` to map project
      hashes/short names back to real filesystem paths and set human-readable
      `workspaceName` and `workspaceRootPath`.
- [x] **Subagent merging** — group `kind: "subagent"` session files into their
      parent sessions (similar to Claude subagent handling).
- [x] **Async Support** — implement `parseGeminiSessionsAsync` in `parser-gemini.ts`
      and update `parser-harnesses.ts` to use it.
- [x] **Metadata Extraction** — extract `summary` and `memoryScratchpad` from `$set`
      records for session labeling.
- [x] **Unit Tests** — add `src/core/parser-gemini.test.ts` with test cases for
      both Code Assist and CLI formats.

### Phase 2: Activity log parsing (Future)

1. Discover `~/.gemini/tmp/<project_hash>/logs/` directories.
2. Parse console and network activity entries.
3. Correlate with chat sessions via `sessionId`.
4. Enrich session requests with additional tool call timing and output data.

### Phase 3: Tool output caching (Future)

1. Support `~/.gemini/tmp/<project_hash>/tool-outputs/` for large tool call
   outputs stored separately.
2. Reference from `toolCalls[].result` output IDs when present.
