---
id: agentic-no-tools
name: Agentic Without Tools
group: tool-mastery
severity: low
scope: requests
requiresIdeContext: true
version: 2
tags: [tools, agent, effectiveness]
thresholds:
  minSample: 10
harnessOverrides:
  pi.suggestion: "Ensure Pi has tool access enabled (read, write, edit, bash). Without tools, Pi can only respond with text."
  pi.description: "{{count}} agentic Pi requests used no tools. Agent mode is most effective when tools are enabled."
  claude.suggestion: "Ensure Claude Code has tool access enabled. Without tools, Claude can only generate text responses."
  claude.description: "{{count}} Claude Code requests used no tools. Agent mode requires tools for file operations."
  gemini.suggestion: "Gemini Code Assist automatically manages tool access. Ensure your project context is complete."
---

# Description
Detects agentic requests that used no tools, reducing the effectiveness of agent mode.

# When Triggered
{{count}} agentic requests used no tools. Agent mode is most effective when tools are enabled.

# How to Improve
Ensure tools are enabled for your AI coding assistant. Tools like file read/write, terminal access, and search give the agent the ability to produce meaningful output.

# Examples
{{extra.agentName}}: "{{message}}..."

# Detection Logic
```detect
scan: requests
match: (agentMode == "agent" OR agentName != "") AND toolsUsed.length == 0
aggregate: count
check: count > thresholds.minSample
examples: "{{messageText | truncate:60}}"
```
