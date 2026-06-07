# Issue: Corrections Page UI Needs Polish

## Problem
The Corrections page now shows real data but the visual design is rough:
- Stat cards are plain, lacking visual hierarchy
- Category badges lack contrast and proper spacing
- Correction cards collapse/expand without smooth transitions
- "Output Quality" badge for every correction is repetitive (all 9 are "Output Quality")
- The 0-token entries should probably be filtered or grouped

## Current State (ref. user report)
```
Correction Turn Analysis
Identify back-and-forth loops where you had to correct the AI...

2.7%        118.3K       $0.35
Correction  Tokens      Estimated
Rate        Wasted      Cost

[bar chart]  [line chart]

Top Correction Triggers  → No correction triggers identified.

Recent Corrections
  Output Quality | 2 turns | 0 tokens
  Output Quality | 1 turn  | 3.6K tokens
  Output Quality | 1 turn  | 44.5K tokens
  ...
```

## Requirements
### Visual Hierarchy
- Stat cards should have colored accents (green/yellow/red based on rate severity)
- Add subtle dividers between sections
- Token and cost values should be prominently displayed

### Empty/Zero States
- Hide correction cards with 0 wasted tokens (they shouldn't appear as corrections)
- If all corrections in a category have 0 tokens, skip showing that category badge
- Empty charts should not reserve space (already done, but verify)

### Correction Cards
- Add smooth CSS transition on expand/collapse (use `details` element with animation)
- Show truncated prompt text with a "Show more" link instead of hard 500-char slice
- Add syntax-highlighted code block styling to prompt text

### Category Distribution
- The "Output Quality" label for every entry suggests the classifier isn't distinguishing patterns
- Consider showing the actual trigger word/phrase in the card summary (not just the category)
- Example: "Output Quality — 'try again'" instead of just "Output Quality"

### Responsive Layout
- On narrow viewports, stat cards should stack vertically
- Charts should resize properly

## Out of Scope
- Correction detection logic changes (Issue 1 already handled)
- Changing the data model or analyzer

## Handoff Notes
This is a pure UI/CSS task. All data is flowing correctly. Focus on:
1. `src/webview/page-corrections.ts` — template and component structure
2. `src/webview/styles-pages.css` — add correction-specific CSS classes
3. May need a new CSS file `styles-corrections.css` imported in esbuild
