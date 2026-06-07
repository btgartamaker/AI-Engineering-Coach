# Issue: Playbook Improved Prompts Truncated

## Problem
The improved prompts on the Playbook page are cut off mid-sentence because the analyzer truncates them to 500 characters before sending to the UI.

### Examples of cutoff
```
Requirements:
- [list specific requirements here]

Acceptance cri                     ← cut off!
```

```
Acceptance criteria:
- [                             ← cut off!
```

## Root Cause
In `src/core/analyzer-playbook.ts` line 388:
```typescript
improvedText: improvement.improved.substring(0, 500),
```

The auto-generated improvements include task header, context block, constraints list, success criteria, verification steps, and requirements/acceptance criteria. This easily exceeds 500 characters.

The fix should also check the `originalText` truncation (line 387: `substring(0, 300)`) since some original prompts are also cut off.

## Proposed Solution
### Increase Truncation Limits (Immediate Fix)
- `improvedText`: change from `substring(0, 500)` to `substring(0, 2000)`
- `originalText`: change from `substring(0, 300)` to `substring(0, 1000)`

### Add "Show more" Link (Better UX)
In the playbook example card template (`page-playbook.ts`):
- Show first ~300 chars of the improved text
- Add a "Show full prompt →" button that expands to the full text
- Store the full text in a data attribute or render both truncated and full versions
- The full improvedText can be passed through the RPC (just increase the limit)

### Considerations
- The RPC payload size: improved prompts are still small (< 2KB each), so increasing the limit won't affect performance
- Redaction must still apply after truncation (for security)

## Handoff
Changes needed in:
1. `src/core/analyzer-playbook.ts` — increase `substring` limits
2. `src/webview/page-playbook.ts` — add "Show more" expand link in example card
