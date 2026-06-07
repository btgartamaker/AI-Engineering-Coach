---
id: no-plan-mode
name: Never Uses Plan Mode
group: tool-mastery
severity: medium
scope: requests
requiresIdeContext: true
version: 2
tags: [tools, planning, agent]
harnessOverrides:
  pi.suggestion: "Before complex tasks, outline your approach in a prompt first. Planning helps Pi understand scope and avoid wasted iterations."
  pi.description: "{{extra.agenticReqs}} Pi agentic requests with no evidence of planning. Jumping straight to implementation often leads to wrong approaches."
  claude.suggestion: "Use /plan in Claude Code before complex tasks. Planning helps define scope and approach before implementation."
  claude.description: "{{extra.agenticReqs}} Claude Code agentic requests with no /plan usage. Jumping straight to implementation often leads to wrong approaches."
thresholds:
  minReqs: 30
  agentRate: 0.3
---

# Description
Detects heavy agentic usage with no use of plan mode, which helps the agent understand scope before implementation.

# When Triggered
{{extra.agenticReqs}} agentic requests but no use of plan mode. Jumping straight to implementation often leads to wrong approaches.

# How to Improve
Plan before complex tasks. Outline your approach, define scope, and break down work before implementation. In VS Code Copilot, use Plan mode. In Claude Code, use /plan. For other tools, write a structured prompt describing the approach first.

# Examples
Switch to Plan mode in the mode picker before starting large features
Use /plan to outline an approach before coding
Plan first, then switch to Agent mode to execute

# Detection Logic
```detect
scan: requests
match: agentMode == "agent" OR agentName != ""
aggregate: count
agentRatio: count / total
planUsage: someWhere(all, "slashCommand", "plan") OR \
  someWhere(all, "agentMode", "matches", "(?i)plan"slashCommand", "plan") OR \
  someWhere(all, "agentMode", "matches", "(?i)plan")
agenticReqs: count
check: planUsage == 0 AND total >= thresholds.minReqs AND agentRatio >= thresholds.agentRate
```
