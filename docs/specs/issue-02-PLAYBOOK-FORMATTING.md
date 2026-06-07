# Issue 2: Playbook Prompt Improvements Are Too Generic

## Problem
The before/after prompt examples in the Playbook page show generic, templated improvements instead of genuinely helpful rewrites. Examples:

- **Original:** `@agent Try Again` → **Improved:** `[Reference relevant files here]\n\nI need to @agent try again. Please provide a complete, well-structured solution with proper error handling and edge case coverage.`
- **Original:** `who are you?` → **Improved:** `[Reference relevant files here]\n\nI need to who are you?. Please provide a complete...`
- **Original:** `what is the next steps?` → **Improved:** Same template

The "improvements" are mechanical templates that don't analyze the actual prompt, don't reference real project context, and in some cases produce grammatically broken sentences.

## Root Cause
The `improvePrompt()` function in `analyzer-playbook.ts` detects issues via regex scoring but appends generic boilerplate text rather than generating context-aware rewrites. It doesn't:
- Understand the prompt's intent
- Know the user's actual project files
- Adapt grammar to fit the original sentence
- Provide realistic, project-specific suggestions

## Proposed Solution
### Better Prompt Improvement
Replace the templated approach with rule-based refinements:
1. **Grammar-aware prefix**: Instead of "I need to {msg}", check if the message already starts with a verb or is a question. Use appropriate framing.
2. **File reference integration**: If the session has `referencedFiles`, use actual file paths instead of `[Reference relevant files here]`.
3. **Scaffold examples**: For very short prompts, suggest a complete prompt scaffold relevant to the inferred work type (feature, bugfix, refactor, etc.) rather than a one-size-fits-all template.

### Formatting Fixes
- `&middot;` should render as `·` (use Unicode or entity correctly)
- Improved prompt should be visually distinct (green border/background)
- Token/correction savings should only show when non-zero

## Success Criteria
- [ ] "who are you?" gets a reasonable improvement instead of grammatical nonsense
- [ ] Short prompts get a scaffold appropriate to their work type
- [ ] File references use real session file paths when available
- [ ] `&middot;` renders correctly as `·`
- [ ] Zero-value savings badges are hidden
