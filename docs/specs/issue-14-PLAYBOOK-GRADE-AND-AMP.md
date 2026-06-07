# Issue 14: Playbook Grade Display + HTML Entity Fix

## Problem
1. The Overall Grade card in the Playbook shows a score ring but the actual letter grade (A, B, C, etc.) is not prominently displayed inside the card — only in the subtitle text above.
2. The "Before &amp; After" section title contains a literal `&amp;` HTML entity instead of the `&` character.

## Fix
- Add a large letter grade display inside the `.pb-grade-card` below the ring.
- Change `&amp;` → `&` in the section title.

## Files
- `src/webview/page-playbook.ts`
