---
id: no-slash-commands
name: No Slash Commands
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 2
tags: [tools, slash, commands]
thresholds:
  minRate: 0.02
  minReqs: 20
harnessOverrides:
  claude.suggestion: "Claude Code uses natural language commands. Use @-mentions to reference files, and create CLAUDE.md for persistent instructions."
  claude.description: "Claude Code doesn't use slash commands. Provide clear, structured prompts instead."
  pi.suggestion: "Pi uses natural language. Create skills/prompts for reusable instructions (e.g., ~/.pi/agent/skills/ or .github/skills/*/SKILL.md)."
  pi.description: "Pi doesn't use slash commands. Use structured prompts and reusable skills for common tasks."
  gemini.suggestion: "Gemini Code Assist uses natural language prompts. Add context via .gemini/settings.json for project-specific instructions."
---

# Description
Detects low usage of slash commands, which produce more targeted responses than freeform prompts.

# When Triggered
Only {{extra.withSlash}} of {{total}} requests use slash commands. Slash commands produce more targeted responses.

# How to Improve
Use structured commands and clear instructions for best results. In Copilot, try /fix for bugs, /explain for understanding code, /tests for test generation, /doc for documentation. Other tools use natural language — just be specific and provide context.

# Examples
/fix - Fix bugs in selected code
/explain - Explain how code works
/tests - Generate unit tests

# Detection Logic
```detect
scan: requests
match: slashCommand == ""
aggregate: count
usageRate: (total - count) / total
withSlash: total - count
check: usageRate < thresholds.minRate AND total > thresholds.minReqs
```
