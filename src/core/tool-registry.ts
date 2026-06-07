/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Shared tool registry — unifies tool names across all harnesses into
 * standardized groups for the Tool Proficiency Score (Spec 14). */

export type ToolGroup = 'file-write' | 'file-read' | 'search' | 'execute' | 'planning' | 'review' | 'other';

export interface ToolDef {
  /** Canonical name shown in the UI */
  name: string;
  /** Tool group it belongs to */
  group: ToolGroup;
  /** All known aliases across harnesses (lowercase) */
  aliases: string[];
  /** Harnesses that expose this tool */
  harnesses: string[];
  /** Whether this is a critical tool for effective usage */
  importance: 'critical' | 'recommended' | 'optional';
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: 'write_file', group: 'file-write', importance: 'critical',
    aliases: ['write', 'write_file', 'create_file', 'create', 'overwrite', 'Write', 'WriteFile'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI', 'Gemini Code Assist'],
  },
  {
    name: 'edit_file', group: 'file-write', importance: 'critical',
    aliases: ['edit', 'edit_file', 'patch', 'apply_diff', 'multi_edit', 'MultiEditTool', 'Edit', 'ApplyDiff', 'Patch'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI', 'Gemini Code Assist'],
  },
  {
    name: 'read_file', group: 'file-read', importance: 'critical',
    aliases: ['read', 'read_file', 'view', 'Read', 'View', 'ReadFile'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI', 'Gemini Code Assist'],
  },
  {
    name: 'list_dir', group: 'file-read', importance: 'recommended',
    aliases: ['list', 'ls', 'list_directory', 'List', 'LS', 'Glob'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI'],
  },
  {
    name: 'grep_search', group: 'search', importance: 'critical',
    aliases: ['grep', 'grep_search', 'search', 'find', 'Find', 'Grep', 'Search'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI', 'Gemini Code Assist'],
  },
  {
    name: 'glob', group: 'search', importance: 'recommended',
    aliases: ['glob', 'Glob'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode'],
  },
  {
    name: 'execute_command', group: 'execute', importance: 'critical',
    aliases: ['execute_command', 'run', 'bash', 'execute', 'Run', 'Bash', 'ExecuteCommand', 'run_terminal_command', 'terminal'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Codex', 'OpenCode', 'Gemini CLI'],
  },
  {
    name: 'plan', group: 'planning', importance: 'recommended',
    aliases: ['plan', 'think', 'question', 'Plan', 'Think', 'Question'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude', 'Gemini CLI', 'Gemini Code Assist'],
  },
  {
    name: 'review', group: 'review', importance: 'optional',
    aliases: ['review', 'lint', 'check', 'explain', 'Review', 'Lint', 'Check', 'Explain'],
    harnesses: ['GitHub Copilot', 'Local Agent', 'Claude'],
  },
];

/** Map lowercase alias → normalized tool name */
const aliasMap = new Map<string, string>();
for (const def of TOOL_DEFS) {
  for (const alias of def.aliases) {
    aliasMap.set(alias.toLowerCase(), def.name);
  }
}

/** Resolve any tool string to its canonical name, or null if unknown. */
export function resolveToolName(raw: string): string | null {
  return aliasMap.get(raw.toLowerCase()) ?? null;
}

/** Get all tool definitions. */
export function getToolDefs(): ToolDef[] {
  return TOOL_DEFS;
}

/** Get tools grouped by category. */
export function getToolsByGroup(): Map<ToolGroup, ToolDef[]> {
  const groups = new Map<ToolGroup, ToolDef[]>();
  for (const def of TOOL_DEFS) {
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group)!.push(def);
  }
  return groups;
}

/** Get benchmark usage rates (calls per session) per harness per group. */
export function getBenchmarkRates(): Record<string, Record<ToolGroup, number>> {
  return {
    'GitHub Copilot': {
      'file-write': 4, 'file-read': 3, 'search': 2, 'execute': 1.5, 'planning': 0.5, 'review': 0.3, 'other': 0,
    },
    'Local Agent': {
      'file-write': 5, 'file-read': 4, 'search': 3, 'execute': 2, 'planning': 1, 'review': 0.5, 'other': 0,
    },
    'Claude': {
      'file-write': 3, 'file-read': 3, 'search': 2, 'execute': 2, 'planning': 0.5, 'review': 0.3, 'other': 0,
    },
    'Codex': {
      'file-write': 4, 'file-read': 2, 'search': 1, 'execute': 3, 'planning': 0, 'review': 0, 'other': 0,
    },
    'OpenCode': {
      'file-write': 3, 'file-read': 2, 'search': 1, 'execute': 2, 'planning': 0, 'review': 0, 'other': 0,
    },
    'Gemini CLI': {
      'file-write': 3, 'file-read': 3, 'search': 1.5, 'execute': 1, 'planning': 0.5, 'review': 0, 'other': 0,
    },
    'Gemini Code Assist': {
      'file-write': 3, 'file-read': 3, 'search': 1.5, 'execute': 1, 'planning': 0.5, 'review': 0, 'other': 0,
    },
  };
}

/** Example usage strings for each tool, per common work type. */
export function getToolExample(toolName: string, workType: string): string {
  const examples: Record<string, Record<string, string>> = {
    write_file: {
      feature: 'Create a new file: "Create src/api/users.ts with CRUD endpoints"',
      default: 'Write a complete file with the full implementation.',
    },
    edit_file: {
      feature: 'Edit an existing function: "Edit the validate() method in src/models/user.ts to add email format checking"',
      refactor: 'Make a targeted edit: "Replace the sort implementation with merge sort"',
      debugging: 'Fix a specific line: "Fix the off-by-one error on line 42"',
      default: 'Make a surgical edit to a specific section of a file.',
    },
    read_file: {
      review: 'Read a file for review: "Read src/api/handler.ts to understand the current routing logic"',
      debugging: 'Read a file to find a bug: "Read src/utils/parser.ts to trace the error"',
      default: 'Read the contents of a file to understand existing code.',
    },
    grep_search: {
      debugging: 'Search across files: "Grep for all places where we call validate()"',
      refactor: 'Find usages: "Search for uses of the deprecated getToken() function"',
      default: 'Search across the codebase for specific patterns.',
    },
    execute_command: {
      feature: 'Run a build: "Run npm test to verify the changes"',
      debugging: 'Debug: "Run the failing test with --verbose flag"',
      default: 'Execute a terminal command to build, test, or inspect.',
    },
    list_dir: {
      planning: 'Explore a directory: "List the files in src/components to see the structure"',
      default: 'List files in a directory to discover the project structure.',
    },
    glob: {
      planning: 'Find files by pattern: "Find all test files matching *.test.ts"',
      default: 'Match files using glob patterns.',
    },
  };

  return examples[toolName]?.[workType] || examples[toolName]?.default || `Use the ${toolName} tool for better precision.`;
}

/** Expected benefit strings per tool. */
export function getToolBenefit(toolName: string): string {
  const benefits: Record<string, string> = {
    write_file: 'Safer than asking for inline code — reduces hallucination risk in existing files',
    edit_file: 'Reduces correction turns by 40% compared to rewrite cycles — pins changes exactly where needed',
    read_file: 'Essential for context — without it the model guesses file contents',
    grep_search: 'Finds code 10x faster than manual search — critical for large codebases',
    execute_command: 'Closes the feedback loop — running tests catches regressions the model would miss',
    list_dir: 'Helps the model understand project structure without guessing',
    glob: 'Finds files across the project — more precise than listing directories',
    plan: 'Breaks down complex tasks into manageable steps, reducing scope creep',
    review: 'Catches issues before code is written by having the model analyze existing code first',
  };
  return benefits[toolName] || 'Improves AI output quality and reduces iterations.';
}
