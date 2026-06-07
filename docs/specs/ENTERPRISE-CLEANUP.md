# Enterprise Cleanup: Remove Pi Harness & Local LLM Skill Finder

## Motivation

This project is being brought into a company repository that has no relationship
to the `pi` coding agent. The `pi` harness (session parser for `~/.pi/agent/sessions`)
is irrelevant and should be removed to reduce maintenance surface area.

Additionally, the Skill Finder feature currently supports a **custom LLM provider
mode** (`aiEngineerCoach.llmProvider = 'custom'`) that allows users to point the
skill-triage AI calls at a local OpenAI-compatible endpoint (e.g. Ollama, LM Studio).
In an enterprise context, all AI features should use Copilot's built-in language model
(the `vscode.LanguageModelChat` API) exclusively — no local/fetch-based providers.

---

## Scope of Work

### A. Remove Pi Agent Harness

The pi harness consists of:

| Asset | Path | Role |
|---|---|---|
| Parser | `src/core/parser-pi.ts` | 866 lines — parses `~/.pi/agent/sessions/*.jsonl` into `Session[]` |
| Tests | `src/core/parser-pi.test.ts` | ~330 lines — unit tests for the parser |
| Harness registry | `src/core/parser-harnesses.ts` | Imports `findPiDirs`, `parsePiSessions`; registers `'pi'` in `EXTERNAL_HARNESS_SET` |
| Log discovery | `src/core/parser.ts` | Calls `findPiDirs()` in `findLogsDirs()` |
| Dashboard load gate | `src/core/parser-harnesses.ts` | `hasExternalHarnessSources()` checks `findPiDirs().length > 0` |

#### Files to delete
- `src/core/parser-pi.ts`
- `src/core/parser-pi.test.ts`

#### Files to edit

**`src/core/parser-harnesses.ts`**
- Remove `import { findPiDirs, parsePiSessions } from './parser-pi'`
- Remove the `Pi` entry from `EXTERNAL_HARNESSES` array (lines ~85-111)
- Remove `'pi'` from `EXTERNAL_HARNESS_SET` (line 152)
- Remove `findPiDirs().length > 0 ||` from `hasExternalHarnessSources()`

**`src/core/parser.ts`**
- Remove `import { findPiDirs } from './parser-pi'` (line 16)
- Remove `...findPiDirs()` from `findLogsDirs()` (line 104)

### B. Remove Local / Custom LLM Provider for Skill Finder

The custom LLM provider is the `callCustomProvider()` function in
`src/webview/panel-llm.ts` plus the `isCustomProviderEnabled()` check in
`callLlm()` and `callLlmJson()`. It lets users configure a non-Copilot
endpoint (Ollama, LM Studio, OpenRouter) for all AI calls in the extension.

#### What to change

The goal is to **remove the custom-provider code paths** so the extension
always uses `vscode.lm.selectChatModels()` exclusively.

**`src/webview/panel-llm.ts`**
- Remove (or gut) `callCustomProvider()` — the ~180-line function that does
  `fetch()` against a configurable endpoint.
- Remove the configuration constants:
  - `CFG_PROVIDER`
  - `CFG_CUSTOM_ENDPOINT`
  - `CFG_CUSTOM_MODEL`
  - `CFG_CUSTOM_API_KEY`
  - `CFG_CUSTOM_TIMEOUT`
- Remove `isCustomProviderEnabled()` — always return `false` (or delete and
  inline the constant).
- Remove the `if (isCustomProviderEnabled()) { ... }` branches at the top of
  both `callLlm()` and `callLlmJson()`.

**`src/webview/panel-rpc.ts`** — check if it imports `callCustomProvider` or
references the custom provider settings.

#### What stays

The core `callLlm()` / `callLlmJson()` functions that use `selectModel()` and
`vscode.LanguageModelChat` stay untouched — these are the Copilot-native path.
The skill triage, catalog triage, generate skill content, and other AI features
will continue to work exactly as before, just always through Copilot's model.

### C. Validation / Testing

1. **Compile check** — `npx tsc --noEmit` must pass with zero errors.
2. **Parser tests** — run the full test suite; pi-related tests are deleted;
   all other tests (harnesses, parser-main, etc.) must still pass.
3. **Smoke check** — launch the extension and verify:
   - Dashboard loads and discovers sessions (no pi-related errors in console).
   - Skill Finder analysis still works and returns results.
4. **Custom-provider config** — verify `aiEngineerCoach.llmProvider` /
   `llmCustomEndpoint` etc. settings are no longer read or respected.

---

## Files Changed Summary

| Action | File |
|---|---|
| **DELETE** | `src/core/parser-pi.ts` (866 lines) |
| **DELETE** | `src/core/parser-pi.test.ts` (~330 lines) |
| **EDIT** | `src/core/parser-harnesses.ts` — remove imports, Pi collector, `'pi'` from EXTERNAL_HARNESS_SET |
| **EDIT** | `src/core/parser.ts` — remove pi import and `findPiDirs()` call |
| **EDIT** | `src/webview/panel-llm.ts` — remove custom provider code, settings, branches |
| **MAYBE** | `src/webview/panel-rpc.ts` — check for custom provider references |

---

## Out of Scope

- **Other VS Code extensions / non-pi harnesses** — Claude Code, Codex CLI,
  OpenCode, Gemini, and VS Code built-in harnesses are unaffected.
- **The `callLlm`/`callLlmJson` function signatures** — only the custom-provider
  branching is removed; the public API remains the same.
- **VS Code settings schema** — removing the `aiEngineerCoach.llmProvider` etc.
  settings from `package.json` is a separate cleanup task and should be done
  in a follow-up after the team confirms the custom provider is not needed in
  any deployment scenario.
