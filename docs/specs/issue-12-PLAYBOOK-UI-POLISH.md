# Issue 12: Playbook Page Inline-Style Cleanup & Visual Polish

## Problem
The Playbook page uses inline `style="..."` on virtually every element:
- Stat card wrappers, grade ring container, radar chart card
- Quick wins list items, trend chart wrapper
- Before/After details cards, pattern cards, practice cards
- Every text label, badge, pre block, and summary row

This makes the page unmaintainable, unthemeable, and inconsistent with the rest of the app (Corrections, SDLC, etc. all use dedicated CSS classes).

## Current Pain Points
1. **Zero CSS classes** — All styling lives in the TypeScript file
2. **No expand/collapse animation** — `<details>` cards snap open/closed
3. **No responsive breakpoints** — The grade+radar flex row breaks on narrow viewports
4. **Inconsistent card pattern** — Some use `class="card"` (which has no CSS definition), others don't
5. **Practice exercises lack visual separation** — Merged in issue-10 but styled identically to patterns

## Requirements

### CSS Extraction
Create a `.playbook-*` class family in `styles-pages.css`:
- `.playbook-layout` — max-width container with responsive padding
- `.playbook-hero` — grade ring + radar row with mobile stack
- `.playbook-card` — reusable card wrapper (border, bg, radius, padding)
- `.playbook-section-title` — consistent 14px bold section headers
- `.playbook-quick-win` — flex row with icon, text, impact badge
- `.playbook-details` — `<details>` wrapper with smooth grid transition
- `.playbook-details-summary` — summary row styling
- `.playbook-details-body` — inner content with grid animation
- `.playbook-prompt-block` — original prompt (muted bg)
- `.playbook-improved-block` — improved prompt (green accent border)
- `.playbook-pattern-badge`, `.playbook-difficulty-badge`, `.playbook-skill-badge` — colored pills
- `.playbook-exercise-card` — distinct styling for practice exercises
- `.playbook-saving-text` — token/correction savings line

### Visual Polish
- Stat card accents: same left-border color pattern as Corrections (green/yellow/red based on grade)
- Quick wins: colored left border based on impact (high=red, medium=yellow, low=blue)
- Before/After cards: smooth expand/collapse animation using `grid-template-rows` transition
- Pattern cards: smooth expand/collapse, "New" badge stands out more
- Practice exercises: distinct background tint so they don't blend with patterns
- Responsive: hero row stacks vertically below 700px

### Scope
- `src/webview/page-playbook.ts` — replace inline styles with class names
- `src/webview/styles-pages.css` — add all `.playbook-*` rules
- No data model or analyzer changes

## Out of Scope
- Prompt improvement logic (issue-02 content changes)
- Truncation limits (issue-08 — already fixed in analyzer)
- New charts or data sources
