---
id: no-skills
name: No Skills Usage
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 2
tags: [tools, skills, domain]
harnessOverrides:
  claude.suggestion: "Create .claude/skills/*/SKILL.md files for domain-specific knowledge. Skills use progressive disclosure: only the name and description are loaded initially."
  claude.description: "No Claude Code skills used. Skills provide specialized domain knowledge beyond general coding."
  pi.suggestion: "Create .agents/skills/*/SKILL.md or .github/skills/*/SKILL.md files for domain-specific knowledge. Pi loads skills when the skill name matches your prompt context."
  pi.description: "No Pi skills used. Skills provide specialized domain knowledge beyond general coding."
  gemini.suggestion: "Gemini Code Assist uses project context from .gemini/settings.json. Consider adding project-specific instructions there."
thresholds:
  minReqs: 50
---

# Description
Detects when no requests use Copilot skills, missing out on specialized domain knowledge.

# When Triggered
No requests use Copilot skills. Skills provide specialized domain knowledge beyond general coding.

# How to Improve
Explore available skills for your AI coding assistant. Skills provide specialized domain knowledge for frameworks, cloud providers, and development workflows. Create SKILL.md files in .github/skills/ (Copilot), .claude/skills/ (Claude Code), or .agents/skills/ (Pi).

# Examples
Skills extend Copilot with domain expertise
Check VS Code extensions for available skills

# Detection Logic
```detect
scan: requests
match: skillsUsed.length == 0
aggregate: count
check: count == total AND total > thresholds.minReqs
```
