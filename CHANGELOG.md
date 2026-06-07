# Changelog

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
