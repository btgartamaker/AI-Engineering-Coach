---
title: "Supported Tools"
weight: 20
description: "AI coding tools that AI Engineer Coach can analyze"
---

# Supported Tools

AI Engineer Coach reads local log files from the following AI coding assistants. No network requests are made; all data stays on your machine.

## Local Agent (VS Code and VS Code Insiders)

The primary harness. AI Engineer Coach parses the chat panel logs that GitHub Copilot writes to the VS Code extension host log directory. This captures every request, response, model used, token counts, tool calls, file references, and terminal commands.

When VS Code connects through Remote-WSL, Remote-SSH, or a Dev Container, the logs live on the remote host under `~/.vscode-server/data/User/workspaceStorage/` (or `~/.vscode-server-insiders/data/User/workspaceStorage/` for Insiders) and appear in the dashboard as `Local Agent (Server)` or `Local Agent (Server Insiders)`.

**What is tracked:**
- Requests and responses with timestamps
- Model selection (e.g., `claude-opus-4.6`, `gpt-5.4`, `auto`)
- Tool calls and slash commands used
- File context references (`#file`, open editor tabs)
- Terminal command execution
- Turn-by-turn conversation structure

## Claude

Parses session files from Anthropic's Claude CLI tool. Each session is read as a structured conversation with tool use, file edits, and terminal commands.

## Codex

Reads session history from OpenAI's Codex terminal agent. Captures prompts, completions, and tool interactions.

## OpenCode

Parses session logs from the open-source OpenCode terminal tool that supports multiple LLM backends.

## GitHub Copilot for Xcode

Reads Copilot Chat conversation logs from Apple's Xcode IDE. Sessions are parsed from SQLite databases stored in the GitHub Copilot configuration directory.

## Gemini Code Assist

Parses session files from Google's Gemini Code Assist VS Code extension. Sessions are stored at `~/.gemini/tmp/<project>/chats/` and capture every request, response, tool call, and file reference.

## Gemini CLI

Parses session files from Google's standalone [Gemini CLI](https://github.com/google-gemini/gemini-cli) terminal agent. Sessions are read from the same `~/.gemini/tmp/<project>/chats/` directory as Gemini Code Assist, using automatic format detection. The parser extracts per-message token counts, model selection, structured tool calls with status, reasoning/thinking blocks, and session-level per-model token totals.

**What is tracked:**
- Requests and responses with timestamps
- Model selection (e.g., `gemini-2.5-pro`, `gemini-3-pro`)
- Tool calls with success/error status and file paths
- Token usage (input, output, cached) per request
- Reasoning / thinking blocks
- File context references
- Session-level per-model token totals

## GitHub Copilot CLI

Parses session state and history files from the GitHub Copilot CLI terminal agent. Captures prompts, completions, model usage, and per-model token metrics reported at session shutdown.

## Workspace Filtering

You can filter analytics to a single workspace or view aggregated data across all workspaces. The bottom-left panel in the UI provides workspace and harness selectors.
