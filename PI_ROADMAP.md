# PI Session Analytics Roadmap

This document outlines the technical roadmap for integrating **Pi** session analysis into the AI Engineer Coach.

## Overview
The goal is to enable full observability of `pi` agent interactions by parsing its unique tree-structured JSONL logs, allowing all existing analytics, rules, and dashboards to provide insights into Pi usage.

---

## Phase 1: Foundation & Core Discovery (Current)
*   **Directory Discovery**: Integrate `~/.pi/agent/sessions/` into the automated scanning engine.
*   **Harness Identification**: Update the parser logic to recognize the `'pi'` harness when encounter specific directory patterns.
*   **Basic JSONL ingestion**: Implement a baseline reader that extracts high-level session metadata (ID, creation date, and total message count).

## Phase 2: Advanced Parsing & Tree Reconstruction
*   **Tree Traversal Logic**: Unlike linear logs, Pi sessions are tree-structured. This phase involves implementing logic to walk from the current active "leaf" back up to the root to reconstruct the exact conversation history for every session.
*   **Special Message Handling**: Map Pi-specific events into our internal model:
    *   `model_change`: Track when you switch models mid-session.
    *   `thinking_level_change`: Monitor changes in reasoning effort (e.g., moving from `medium` to `high`).
    *   `branch_summary`: Capture breadcrumbs left by branching operations.
*   **Complex Content Mapping**: Refine the parsing of advanced content blocks, such as embedded images and complex tool call objects.

## Phase 3: Full Feature Parity & Analytics Integration
*   **Tool & Context Extraction**: Extract rich metadata from Pi-specific messages, including expanded tool usage (name/args), file edit events, and specific token consumption.
*   **Orchestration Wiring**: Integrate the `PiParser` into the main execution pipeline so that all existing analytics, rules, and dashboards automatically benefit from the new data.
*   **Advanced Metric Support**: Enable higher-fidelity metrics such as "Thinking Effort Trends" and "Tool Switching Frequency."

## Phase 4: Validation & Optimization
*   **Data Integrity Audit**: Verify reconstructed session histories against actual `~/.pi/agent/sessions/` logs to ensure no data drift occurs during the translation.
*   **Cache Optimization**: Implement caching for Pi sessions (similar to VS Code/Claude) to ensure high-performance reloading of large history trees.
