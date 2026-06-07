# Issue 3: Tools Page Shows Harness Internals, Not User Skills

## Problem
The Tools proficiency page displays per-harness tool call data (e.g., `Edit`, `View`, `Search`, `RunCommand`) which is useful for understanding AI tool usage but is framed as "tools" from the harness perspective rather than "skills" from the user perspective.

A developer reading "Edit: 47 calls" doesn't know if that's good or bad, or what action to take. The blind spots suggest tools to use, but they're harness-specific tool names that may not map to the user's mental model.

The user asks: "would this be better seen as skill usage?"

## Root Cause
The page was built around the `tool-registry.ts` which maps harness-level tool names (`Edit`, `View`, `grep`) into groups (`file-write`, `file-read`, etc.). While the grouping is correct, the presentation focuses on raw tool names rather than the underlying skill (e.g., "file navigation skill", "code generation skill").

## Proposed Solution
### Reframe as Skills
Rename the page and labels:
- "Tools" → "Tool & Skill Proficiency" (sidebar label)
- "Tool Usage by Group" → "Skill Areas"
- "All Tools Used" → "Tool Breakdown"
- Blind spot tool names should include a plain-English skill translation

### Add Skill Descriptions
For each tool group, add a one-line description of the skill:
- `file-write`: "Generating and editing code"
- `file-read`: "Understanding existing code"
- `search`: "Finding relevant code and patterns"
- `execute`: "Running commands and tests"
- `planning`: "Architecture and design thinking"
- `review`: "Code review and debugging"

### Better Benchmark Context
The benchmark comparison should explain what "good" looks like:
- "Top Copilot users call Edit ~5× per session"
- "You're below average on search — try /explain or /search"

## Success Criteria
- [ ] Page sidebar label changed to "Tool & Skill Proficiency" or similar
- [ ] Sections are labeled as skills, not raw tool names
- [ ] Each skill area has a human-readable description
- [ ] Blind spots include plain-English skill translation
- [ ] Benchmark comparisons include context for the numbers
