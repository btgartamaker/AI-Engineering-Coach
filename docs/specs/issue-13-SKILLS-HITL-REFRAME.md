# Issue 13: Skills Pages — Human-in-the-Loop Reframe + UI Polish

## Problem
There are **two** skill-related pages in the sidebar:
1. **"Skill Finder"** (`page-skills.ts`) — Custom skill opportunities + community catalog
2. **"Skills"** (`page-tool-proficiency.ts`) — Tool proficiency score, blind spots, benchmarks

Both suffer from inline-style bloat. More importantly, the "Skill Finder" page is infrastructure-focused (install skills to `~/.agents/skills/`) rather than human-focused (help me write better prompts).

### Skill Finder Issues
- Requires manual "Analyze" click before showing anything
- Results push "Install Skill" as the primary action
- The actionable insight (`reason`, `examples`) is buried under a generation flow
- Community catalog is Copilot-centric and irrelevant to Pi/Claude/Gemini users
- Dismissed items are session-only, creating noise on revisit

### Tool Proficiency Issues  
- Inline styles on every element (same problem as Playbook)
- Score ring + suggestions layout breaks on narrow screens
- Blind spots cards are raw `<details>` with no animation
- Growth stats are plain boxes without visual hierarchy

## Proposed Changes

### A. Skill Finder — Reframe for Human Value
1. **Rename sections**:
   - "Custom Skill Opportunities" → "Recurring Patterns"
   - "Community Skills & Agents" → "Community Catalog" (or hide entirely)
2. **Remove "Install Skill" as primary action**:
   - Replace with "View Examples" button that expands the card
   - Show the `reason` and `examples` directly in the card body
   - Move "Generate Skill" to a small secondary link
3. **Auto-run analysis** on page load (with loading state) — no manual button
4. **Show actionable insight first**: frequency, examples, then the AI reason
5. **Remove dismiss buttons** — not useful for coaching content

### B. Tool Proficiency — UI Polish
1. Extract all inline styles to `.tp-*` CSS classes in `styles-pages.css`
2. Stat cards with left-border accents (matching Corrections/Playbook pattern)
3. Responsive hero row (score ring + suggestions)
4. Smooth expand/collapse for blind spots
5. Improved growth stat cards with icon + color coding

### C. Shared
- Both pages get consistent card styling, section dividers, and typography
- Remove the `styles-skills.css` separate file and merge relevant rules into `styles-pages.css` (esbuild already bundles both, but consolidation reduces file count)

## Files
- `src/webview/page-skills.ts` — reframe layout, remove install-as-primary, auto-run
- `src/webview/page-tool-proficiency.ts` — extract inline styles to classes
- `src/webview/styles-pages.css` — add `.sk-*` and `.tp-*` rules
- `src/webview/styles-skills.css` — deprecate/merge (optional)

## Out of Scope
- Analyzer changes (triage logic, catalog source)
- Data model changes
- Removing either page from the sidebar
