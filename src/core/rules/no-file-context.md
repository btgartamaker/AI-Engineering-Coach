---
id: no-file-context
name: Missing File Context
group: prompt-quality
severity: medium
scope: requests
requiresIdeContext: true
version: 2
tags: [prompt, context, files]
harnessOverrides:
  claude.suggestion: "Use @file to reference relevant files in your prompts so Claude Code can see the relevant code context."
  claude.description: "{{pct}} of Claude Code requests have no file references. Claude gives better answers with file context."
  pi.suggestion: "Use @file to reference relevant files in your prompts so Pi can see the relevant code context."
  pi.description: "{{pct}} of Pi requests have no file references. Pi gives better answers with file context."
  gemini.description: "{{pct}} of Gemini Code Assist requests have no file references. Gemini gives better answers with file context."
thresholds:
  maxNoContextRate: 0.7
  minSample: 10
---

# Description
Detects requests that have no file references, meaning Copilot cannot see the relevant code context.

# When Triggered
{{pct}} of requests have no file references. Copilot gives better answers with file context.

# How to Improve
Reference relevant files in your prompts — use @file (Claude, Pi), #file (Copilot), or just open files in the editor so your AI assistant can use them as context.

# Examples
"{{message}}..."

# Detection Logic
```detect
scan: requests
match: referencedFiles.length == 0 AND editedFiles.length == 0
aggregate: ratio
check: ratio > thresholds.maxNoContextRate AND count > thresholds.minSample
examples: "{{messageText | clip:80}}"
```
