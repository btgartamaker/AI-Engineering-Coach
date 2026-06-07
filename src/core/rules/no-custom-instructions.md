---
id: no-custom-instructions
name: No Custom Instructions
group: tool-mastery
severity: medium
scope: requests
requiresIdeContext: true
version: 2
tags: [tools, instructions, personalization]
harnessOverrides:
  claude.suggestion: "Create a CLAUDE.md file in your workspace to give Claude Code persistent context about your project conventions, stack, and coding style."
  claude.description: "Only {{extra.usagePct}}% of Claude Code requests use custom instructions. Missing out on personalized responses."
  pi.suggestion: "Add an AGENTS.md or .instructions.md file in your workspace to give Pi persistent context about your project conventions, stack, and coding style."
  pi.description: "Only {{extra.usagePct}}% of Pi requests use custom instructions. Missing out on personalized responses."
  gemini.suggestion: "Add a .gemini/settings.json or instructions file to give Gemini Code Assist context about your project conventions."
  codex.suggestion: "Add a SPEC.md or .instructions.md file to give Codex CLI context about your project conventions."
thresholds:
  minRate: 0.05
  minReqs: 20
---

# Description
Detects when very few requests use custom instructions, missing out on personalized and project-specific responses.

# When Triggered
Only {{extra.usagePct}}% of requests use custom instructions ({{extra.withInstructions}}/{{total}}). Missing out on personalized responses.

# How to Improve
Create a .github/copilot-instructions.md (for VS Code Copilot), CLAUDE.md (for Claude Code), or AGENTS.md (for Pi) in your workspace to give your AI assistant persistent context about your project conventions, stack, and coding style.

# Examples
{{extra.withInstructions}} of {{total}} requests had custom instructions

# Detection Logic
```detect
scan: requests
match: customInstructions.length == 0
aggregate: count
usageRate: (total - count) / total
withInstructions: total - count
usagePct: round(usageRate * 100)
check: usageRate < thresholds.minRate AND total > thresholds.minReqs
```
