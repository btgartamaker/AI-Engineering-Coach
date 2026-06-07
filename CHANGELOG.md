# Changelog

## 0.2.15 — Remove Skill Finder, Workspace Display Normalization

- **Removed Skill Finder**: the "Skill Finder" sidebar entry and routing were removed (the page showed AI-triage results for installing skills, which is infrastructure-focused and not actionable for human-in-the-loop coaching)
- **Workspace name display normalization**: added `displayWsName()` helper to `shared.ts` that strips file paths down to the last path segment for display
  - **Timeline**: session list, lane labels, tooltips, and session detail all normalize workspace names
  - **Output**: production "By Workspace" chart labels, token chart dataset labels, and the token table `Workspace` column all normalize
  - **Context Health**: treemap tiles, detail panel headers, and review section workspace names all normalize

## 0.2.14 — Playbook & Skills Page UI Polish + Human-in-the-Loop Reframe + Workspace Consolidation

- **Playbook grade display**: the Overall Grade card now shows the letter grade (A, B, C, etc.) prominently alongside the score ring
- **Playbook HTML entity fix**: "Before & After" section title now renders `&` correctly instead of `&amp;`
- **Removed Tool Proficiency page**: the "Skills" sidebar entry and routing are gone — tool call counts are not directly actionable for humans
- **Pi workspace name fix**: `decodePiWorkspaceName` now returns the basename of `cwd` instead of the full path, so workspace names are consistent across Timeline, Output, and Context Health
- **Timeline detail cleanup**: removed redundant `session.location` from the session detail view (was duplicating workspace info for Pi sessions)
- **Playbook UI cleanup**: extracted ~150 lines of inline styles into dedicated `.pb-*` CSS classes
  - Stat cards with colored left-border accents (green/yellow/red based on grade)
  - Responsive hero row (grade ring + radar) stacks vertically below 700px
  - Quick wins with colored left-border accents based on impact severity
  - Smooth expand/collapse animations on Before/After, Pattern, and Practice cards via CSS grid transition
  - Consistent `.pb-card` wrapper with proper borders, backgrounds, and radius
  - Improved prompt blocks use green accent border; original prompts use muted styling
- **Tool Proficiency UI cleanup**: extracted inline styles to `.tp-*` CSS classes
  - Score card with colored left-border accent
  - Responsive hero layout
  - Smooth expand/collapse for blind spot details
  - Growth stat cells with color-coded values
- **Skill Finder human-in-the-loop reframe**:
  - Renamed "Custom Skill Opportunities" → "Recurring Patterns"
  - Replaced "Install Skill" primary button with "View Examples" expand/collapse (shows repeated prompt examples inline)
  - Moved skill generation to a secondary "Generate Skill" button
  - Removed dismiss buttons (coaching insights shouldn't be dismissable)
  - Community catalog section is now collapsed by default behind a `<details>` element
  - Examples are no longer truncated with ellipsis; they wrap naturally with `pre-wrap`
  - Renamed action button from "Analyze" → "Find Patterns"

## 0.2.13 — Corrections Page UI Polish

- **Visual hierarchy**: stat cards now have colored left-border accents (green/yellow/red based on correction-rate severity) and improved typography
- **Zero-token filtering**: correction cards with 0 wasted tokens are hidden from the Recent Corrections list
- **Smooth expand/collapse**: `details` cards animate open/close via CSS grid transition
- **Truncated prompts**: long original prompts, first responses, and correction messages show a "Show more" toggle instead of a hard character slice
- **Trigger snippets**: each correction summary now displays the first correction message snippet (e.g. `"Output Quality — \"try again...\""`) to add variety beyond the category badge
- **Responsive layout**: stat cards stack vertically on narrow viewports; correction summaries reflow gracefully
- **Syntax-highlighted blocks**: code/pre blocks inside correction cards use editor-themed styling with borders and padding

## 0.2.0 — Pi, Gemini & Harness-Agnostic Analytics

- **Pi harness integration**: full session parser for `~/.pi/agent/sessions/` — tree-structured JSONL with tool call classification, token tracking, and multi-workspace support
- **Gemini Code Assist parser**: session discovery under `~/.gemini/tmp/<project>/chats/` with user/assistant message pairing
- **Harness-agnostic anti-patterns**: rule messages now adapt to your primary harness (Pi, Claude, Gemini, Codex, Copilot) via `harnessOverrides` in rule frontmatter
- **Custom LLM provider**: configure a local model (Ollama, LM Studio, OpenRouter) as an alternative to Copilot for Skill Finder, code review, and learning center features — set `aiEngineerCoach.llmProvider` to `custom`
- **Config health for external harnesses**: Pi and Gemini workspaces now appear in Config Health with correct root resolution, instruction detection, and harness-specific suggestions
- **Code production (LoC) tracking for Pi**: write/edit tool call content is extracted as code blocks for AI LoC counting

## 0.1.0 — First Release

- Dashboard with timeline, output, and consumption views
- Anti-pattern detection with 40+ built-in rules
- Skill Finder and context quality analysis
- Activity patterns (projects, work hours)
