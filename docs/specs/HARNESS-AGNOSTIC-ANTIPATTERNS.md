# Harness-Agnostic Anti-Patterns & Config Health

## Motivation

The extension currently hard-codes **GitHub Copilot / VS Code** terminology in:

1. **Rule `.md` files** (45+ detector rules) — suggestions mention `#file`, `.github/copilot-instructions.md`, Copilot skills, `/fix` slash commands, etc.
2. **`analyzer-config.ts` — context anti-patterns** — suggestions for "Active Workspaces Without Context Files" hardcode Copilot and Claude paths.
3. **`config-health-helpers.ts` — workspace suggestions** — `generateWorkspaceSuggestions()` always recommends `.github/copilot-instructions.md` first.
4. **`analyzer-config.ts` — context provision scoring** — scoring weights assume Copilot-specific taxonomy (file refs, instructions, skills, tools).

As the extension now supports **Pi, Claude Code, Codex CLI, OpenCode, Gemini Code Assist**, and arbitrary custom models via OpenRouter/Ollama, these Copilot-centric messages are misleading and reduce trust in the analytics.

## Goal

Make all anti-pattern, config health, and suggestion messages **harness-aware** so they reference the correct tooling for each workspace and surface the right fix for the harness actually in use.

---

## Phase 1: Harness-Aware Rule Messages

### Problem

Every rule `.md` file has a fixed `# How to Improve` section and `# When Triggered` template that assumes Copilot. For example:

| Rule | Current Message | Should Say (for Pi) |
|------|----------------|---------------------|
| `no-custom-instructions.md` | "Create a .github/copilot-instructions.md ..." | "Add an AGENTS.md or .instructions.md file in your workspace to give Pi persistent context..." |
| `no-slash-commands.md` | "Try /fix for bugs, /explain ..." | "Pi uses natural language; use skills/prompts for reusable instructions (e.g., ~/.pi/agent/skills/)" |
| `no-skills.md` | "Explore available skills in your IDE..." | "Create SKILL.md files in .github/skills/ or .claude/skills/ for domain-specific knowledge..." |
| `agentic-no-tools.md` | "Ensure tools are enabled in agent mode..." | "Ensure Pi has tool access (read/write/edit/bash) enabled..." |

### Solution

Add a `harnessOverrides` section to the rule `.md` frontmatter:

```yaml
---
id: no-custom-instructions
name: No Custom Instructions
group: tool-mastery
severity: medium
scope: requests
requiresIdeContext: true
version: 2  # bump to track format change
harnessOverrides:
  pi:
    suggestion: "Add an AGENTS.md or .instructions.md file in your workspace to give Pi persistent context about your project conventions, stack, and coding style. Pi also reads ~/.pi/agent/AGENTS.md for agent-level instructions."
    description: "Only {{extra.usagePct}}% of Pi requests use custom instructions. Missing out on personalized responses."
  claude:
    suggestion: "Create a CLAUDE.md file in your workspace to give Claude Code persistent context about your project conventions, stack, and coding style."
  codex:
    suggestion: "Add a SPEC.md or instructions file to give Codex CLI context about your project conventions."
  gemini:
    suggestion: "Add a .gemini/settings.json or instructions file to give Gemini Code Assist context about your project conventions."
---
```

**How it works:**

- The `fillTemplate()` function in `rule-parser.ts` already supports templated variables.
- The `emissionToAntiPattern()` function in `detector-registry.ts` constructs the `description` and `suggestion` from templates.
- We pass the harness context through `DetectorContext` and if `harnessOverrides` exist for that harness, use the harness-specific template instead of the default.
- If no override exists for a harness, fall back to the default template (which stays Copilot-focused for backward compatibility).

### Files to change

| File | Change |
|------|--------|
| `src/core/types/rule-types.ts` | Add `harnessOverrides?: Record<string, { description?: string; suggestion?: string }>` to `DetectionRule` |
| `src/core/detector-registry.ts` | Pass harness info through `DetectorContext`, update `emissionToAntiPattern()` to check overrides |
| `src/core/types/analytics-types.ts` | Optionally add `harness` field to `AntiPattern` for UI display |
| All 45+ rule `.md` files | Add `harnessOverrides` sections for `pi`, `claude`, `codex`, `gemini` |

---

## Phase 2: Harness-Aware Config Health Suggestions

### Problem

`generateWorkspaceSuggestions()` in `config-health-helpers.ts` always recommends Copilot-specific paths:

```typescript
suggestions.push('Create a .github/copilot-instructions.md file with project conventions...');
```

But for a Pi workspace or Gemini workspace, that's the wrong suggestion.

### Solution

Make `generateWorkspaceSuggestions()` accept a `harness` parameter and generate harness-appropriate suggestions.

```typescript
export function generateWorkspaceSuggestions(
  files: ConfigFileInfo[],
  hookCoverage: HookCoverageInfo | null,
  isClaudeWorkspace: boolean,
  harness?: string,  // NEW
): string[]
```

**Suggestion mapping by harness:**

| Harness | No-Instructions Suggestion | No-Skills Suggestion | No-Prompts Suggestion |
|---------|---------------------------|----------------------|----------------------|
| `VS Code` / `Copilot` (default) | `.github/copilot-instructions.md` | `.github/skills/*/SKILL.md` | `.github/prompts/*.prompt.md` |
| `Claude` | `CLAUDE.md` | `.claude/skills/*/SKILL.md` | N/A (Claude uses @import) |
| `pi` | `AGENTS.md` or `.instructions.md` | `.github/skills/*/SKILL.md` or `~/.pi/agent/skills/` | Prompts in skills |
| `Gemini` | `.gemini/settings.json` | N/A | N/A |
| `Codex` | `SPEC.md` or `.instructions.md` | N/A | N/A |
| `OpenCode` | `.instructions.md` | Skills via OpenCode plugins | N/A |
| mixed harnesses | Show the suggestion for each harness | - | - |

### Files to change

| File | Change |
|------|--------|
| `src/core/config-health-helpers.ts` | Update `generateWorkspaceSuggestions()`, add harness branching |
| `src/core/analyzer-config.ts` | Pass harness to `generateWorkspaceSuggestions()` call sites |
| `src/core/types/analytics-types.ts` | Ensure `harness` propagates to the UI |

---

## Phase 3: Harness-Aware Context Anti-Patterns

### Problem

`deriveContextAntiPatterns()` in `analyzer-config.ts` hardcodes Copilot/Claude suggestions:

```typescript
suggestion: 'Add .github/copilot-instructions.md (for VS Code) or CLAUDE.md (for Claude Code) ...'
```

And the "Low Context Provision" anti-pattern uses Copilot-specific terminology ("Use #file to reference files").

### Solution

Make the `suggestion` and `description` fields harness-aware based on the workspace's `harness` property.

```typescript
private harnessInstructionFile(harness: string): string {
  switch (harness) {
    case 'Claude': return 'CLAUDE.md';
    case 'pi':     return 'AGENTS.md';
    case 'Gemini': return '.gemini/settings.json';
    case 'Codex':  return 'SPEC.md';
    default:       return '.github/copilot-instructions.md';
  }
}
```

Also update the "Low Context Provision" messages to use harness-appropriate file reference syntax:

| Harness | File Reference Syntax | Instructions File |
|---------|---------------------|-------------------|
| VS Code | `#file:path` | `.github/copilot-instructions.md` |
| Claude | `@file` | `CLAUDE.md` |
| Pi | `@file` | `AGENTS.md` |
| Gemini | `#file` | `.gemini/settings.json` |

### Files to change

| File | Change |
|------|--------|
| `src/core/analyzer-config.ts` | Add `harnessInstructionFile()`, `harnessFileRefSyntax()`, update `deriveContextAntiPatterns()` |

---

## Phase 4: Custom Skills with Model-Agnostic Provider Configuration

### Problem

The "Custom Skills" feature in the coaching UI assumes Copilot extension skills. Users of other models (Pi, Claude, OpenRouter, Ollama) need the ability to define skills that their harness/agent can consume.

### Current architecture

- Skills are scanned via `scanConfigFiles()` → `.github/skills/`, `.claude/skills/`, `.agents/skills/` directories
- `scanPersonalSkillFiles()` checks `~/.ai-engineer-coach/skills/`
- `computeProgressiveDisclosureScore()` evaluates skill coverage
- The skill finder/workflow optimizer clusters prompts regardless of harness
- But the **UI and skill editor** assume Copilot skills

### Solution

1. **Extend the skill editor UI** to show which harness each skill targets (via `harness` field in SKILL.md frontmatter)
2. **Add a provider-configurable skill export** — let users choose which format to generate:
   - Copilot `.github/skills/*/SKILL.md`
   - Claude `.claude/skills/*/SKILL.md`
   - Pi `.agents/skills/*/SKILL.md` (already supported)
   - Custom Markdown `~/.ai-engineer-coach/skills/*/SKILL.md` (for any model via general instructions)
3. **Add harness routing** to the skill recommendation engine — if a user primarily uses Pi, recommend Pi-format skills

### Skill frontmatter extension

Current SKILL.md format:
```yaml
---
name: vue-testing
description: Vue.js testing with Vitest and Testing Library
---
```

Extended format:
```yaml
---
name: vue-testing
description: Vue.js testing with Vitest and Testing Library
harness: pi           # optional: target harness (pi, claude, copilot, gemini, any)
provider: ollama      # optional: target provider (ollama, openrouter, openai, anthropic, google)
model: gemma4:26b-mlx # optional: specific model recommendation
---
```

### Files to change

| File | Change |
|------|--------|
| `src/webview/page-skills.ts` (or equivalent) | Add harness/provider/model dropdowns to skill editor |
| Skill renderer / rule-editor UI | Show harness badge on skills |
| `src/core/config-health-helpers.ts` | Update skill scanning to read `harness` from frontmatter |
| `src/core/analyzer-config.ts` | Update context provision scoring to account for harness-matched skills |

---

## Implementation Order

1. **Phase 1** — Rule harness overrides (lowest risk, highest impact per change)
2. **Phase 2** — Config health suggestion branching (small surface area)
3. **Phase 3** — Context anti-pattern harness awareness (medium risk)
4. **Phase 4** — Model-agnostic skill configuration (new feature, separate from refactoring)

## Type Changes

### `rule-types.ts` — add to `DetectionRule`

```typescript
interface DetectionRule {
  // ... existing fields ...
  /** Harness-specific message overrides. Key = harness name (pi, claude, codex, gemini).
   *  Values override the default description/suggestion templates. */
  harnessOverrides?: Record<string, {
    description?: string;
    suggestion?: string;
  }>;
}
```

### `analytics-types.ts` — add to `AntiPattern`

```typescript
interface AntiPattern {
  // ... existing fields ...
  /** Harness this pattern applies to, if harness-specific. */
  harness?: string;
}
```

## Testing

- Update existing rule tests to verify harness overrides produce correct messages
- Add tests for `generateWorkspaceSuggestions()` with different harness values
- Add integration test for `deriveContextAntiPatterns()` with mixed-harness workspaces
- Verify UI renders harness badge on anti-pattern cards

## Out of Scope

- Rewriting the rule pipeline engine itself
- Changing the DSL/detection logic in rule files
- Adding new anti-pattern detectors for specific harness features
- Backend changes to how skills are stored or versioned
