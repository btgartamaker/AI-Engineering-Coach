/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* LLM schemas and request helpers for the dashboard panel. */

import * as vscode from 'vscode';
import { runtimeDebug } from '../core/runtime-debug';

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

function structuredOutputOptions(spec: JsonSchemaSpec): Record<string, unknown> {
  return {
    response_format: {
      type: 'json_schema',
      json_schema: { name: spec.name, strict: true, schema: spec.schema },
    },
  };
}

export const SCHEMA_QUIZ: JsonSchemaSpec = {
  name: 'quiz_questions',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            correctIndex: { type: 'number' },
            explanation: { type: 'string' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            topic: { type: 'string' },
          },
          required: ['question', 'choices', 'correctIndex', 'explanation', 'difficulty', 'topic'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_CODE_REVIEW: JsonSchemaSpec = {
  name: 'code_comparison_rounds',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            snippetA: { type: 'string' },
            snippetB: { type: 'string' },
            betterSnippet: { type: 'string', enum: ['A', 'B'] },
            title: { type: 'string' },
            category: { type: 'string', enum: ['performance', 'safety', 'readability', 'correctness', 'security'] },
            explanation: { type: 'string' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            language: { type: 'string' },
          },
          required: ['snippetA', 'snippetB', 'betterSnippet', 'title', 'category', 'explanation', 'difficulty', 'language'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_DID_YOU_KNOW: JsonSchemaSpec = {
  name: 'did_you_know_facts',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fact: { type: 'string' },
            project: { type: 'string' },
            category: { type: 'string', enum: ['performance', 'api', 'pitfall', 'config', 'debug'] },
          },
          required: ['fact', 'project', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_RESOURCES: JsonSchemaSpec = {
  name: 'learning_resources',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            type: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['title', 'url', 'type', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_TRIAGE: JsonSchemaSpec = {
  name: 'skill_triage',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The cluster id this verdict refers to, copied from the input.' },
            verdict: { type: 'string', enum: ['strong', 'maybe', 'skip'], description: 'Whether the cluster is a strong, maybe, or skip candidate for a skill file.' },
            reason: { type: 'string', description: 'One sentence explaining the verdict.' },
            suggestedSkillName: { type: 'string', description: 'Short kebab-case skill name, or an empty string when no skill is suggested.' },
          },
          required: ['id', 'verdict', 'reason', 'suggestedSkillName'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_CATALOG_PICKS: JsonSchemaSpec = {
  name: 'catalog_picks',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['id', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

export const SCHEMA_CONTEXT_REVIEW: JsonSchemaSpec = {
  name: 'context_file_review',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            workspaceId: { type: 'string' },
            overallScore: { type: 'number' },
            categoryScores: { type: 'object', additionalProperties: { type: 'number' } },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  severity: { type: 'string', enum: ['good', 'warning', 'critical'] },
                  file: { type: 'string' },
                  finding: { type: 'string' },
                  suggestion: { type: 'string' },
                },
                required: ['category', 'severity', 'file', 'finding', 'suggestion'],
                additionalProperties: false,
              },
            },
            missingFiles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  reason: { type: 'string' },
                  impact: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['filename', 'reason', 'impact'],
                additionalProperties: false,
              },
            },
            summary: { type: 'string' },
          },
          required: ['workspaceId', 'overallScore', 'categoryScores', 'findings', 'missingFiles', 'summary'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

function parseLlmJson<T>(text: string): T {
  let cleaned = text.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replaceAll(/^```(?:json|jsonc|jsonl)?\s*/gm, '').replaceAll(/```\s*$/gm, '').trim();

  // Strip single-line JS comments that LLMs sometimes insert
  cleaned = cleaned.replaceAll(/^\s*\/\/[^\n]*$/gm, '');

  // Handle JSONL: if the text has multiple top-level JSON objects on separate lines, wrap in array
  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every(l => l.startsWith('{') && l.endsWith('}'))) {
    const jsonlArray = '[' + lines.join(',') + ']';
    try { return JSON.parse(jsonlArray) as T; } catch { /* fall through */ }
  }

  // Locate the outermost JSON boundary
  const arrStart = cleaned.indexOf('[');
  const objStart = cleaned.indexOf('{');
  if (arrStart === -1 && objStart === -1) throw new Error('No JSON structure found in LLM response');

  let start: number;
  if (arrStart === -1) start = objStart;
  else if (objStart === -1) start = arrStart;
  else start = Math.min(arrStart, objStart);

  const openChar = cleaned[start];
  const closeChar = openChar === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(closeChar);
  if (end <= start) throw new Error('Malformed JSON structure in LLM response');

  cleaned = cleaned.slice(start, end + 1);

  // Attempt 1: direct parse
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }

  // Attempt 2: fix common LLM quirks
  let fixed = cleaned;
  // Remove trailing commas before closing brackets/braces
  fixed = fixed.replaceAll(/,\s*([}\]])/g, '$1');
  // Replace smart/curly quotes with straight ones
  fixed = fixed.replaceAll(/[\u201C\u201D\u2033]/g, '"').replaceAll(/[\u2018\u2019\u2032]/g, "'");
  // Fix single-quoted strings to double-quoted (simple heuristic for keys/values)
  fixed = fixed.replaceAll(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // Remove control characters except \n \r \t
  // eslint-disable-next-line no-control-regex
  fixed = fixed.replaceAll(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  try { return JSON.parse(fixed) as T; } catch { /* fall through */ }

  // Attempt 3: close a truncated response by balancing unclosed strings and
  // brackets in the correct order, then dropping any dangling trailing comma.
  const balanced = balanceTruncatedJson(fixed).replaceAll(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(balanced) as T; } catch { /* fall through */ }

  throw new Error('Failed to parse JSON from LLM response');
}

/**
 * Repair JSON that was cut off mid-stream (e.g. when the model hit its output
 * token limit). Walks the text tracking string state and a stack of open
 * brackets, then appends the closers needed to make it parseable. Works for
 * both array-root and object-wrapped payloads.
 */
function balanceTruncatedJson(input: string): string {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of input) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') closers.push('}');
    else if (char === '[') closers.push(']');
    else if (char === '}' || char === ']') closers.pop();
  }

  let result = input;
  if (inString) result += '"';
  for (let i = closers.length - 1; i >= 0; i--) result += closers[i];
  return result;
}

const LLM_MAX_RETRIES = 2;
const LLM_FAMILY = 'gpt-5.4-mini';
/** Hard cap for a single LLM streaming request (ms). Prevents the UI from
 *  spinning forever when the model hangs or the user never grants consent. */
const LLM_REQUEST_TIMEOUT_MS = 90_000;

/**
 * Configuration keys for custom LLM provider settings.
 */
const CFG_PROVIDER = 'aiEngineerCoach.llmProvider';
const CFG_CUSTOM_ENDPOINT = 'aiEngineerCoach.llmCustomEndpoint';
const CFG_CUSTOM_MODEL = 'aiEngineerCoach.llmCustomModel';
const CFG_CUSTOM_API_KEY = 'aiEngineerCoach.llmCustomApiKey';
const CFG_CUSTOM_TIMEOUT = 'aiEngineerCoach.llmCustomTimeout';

/**
 * Read a string setting from VS Code configuration, returning the default if unset.
 */
function getSetting<T>(key: string, fallback: T): T {
  try {
    const config = vscode.workspace.getConfiguration();
    return config.get<T>(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Call a custom OpenAI-compatible API (Ollama, LM Studio, OpenRouter, etc.)
 * and return the response text. Falls back to Copilot on network errors.
 */
async function callCustomProvider(messages: { role: string; content: string }[], jsonMode?: boolean): Promise<string> {
  const endpoint = getSetting<string>(CFG_CUSTOM_ENDPOINT, 'http://127.0.0.1:11434/v1');
  const model = getSetting<string>(CFG_CUSTOM_MODEL, '');
  const apiKey = getSetting<string>(CFG_CUSTOM_API_KEY, '');
  const timeoutSec = getSetting<number>(CFG_CUSTOM_TIMEOUT, 120);

  if (!endpoint) throw new Error('Custom LLM endpoint not configured. Set aiEngineerCoach.llmCustomEndpoint in settings.');

  // Most local models don't support response_format (JSON mode), so we
  // inject a system message asking for JSON output instead.
  const finalMessages = [...messages];
  if (jsonMode) {
    // Check if there's already a system message; if not, prepend one
    const hasSystem = finalMessages.some(m => m.role === 'system');
    if (!hasSystem) {
      finalMessages.unshift({ role: 'system', content: 'You are a helpful assistant. ALWAYS respond with valid JSON only. No markdown fences, no explanation, no commentary.' });
    } else {
      // Append instruction to existing system message
      finalMessages[0].content += '\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no explanation, no commentary.';
    }
  }

  const body: Record<string, unknown> = {
    model: model || undefined,
    messages: finalMessages,
    stream: false,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Custom provider returned ${response.status}: ${errorText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) {
      throw new Error('Custom provider returned no choices');
    }
    const message = choices[0].message as Record<string, unknown> | undefined;
    const content = message?.content as string | undefined;
    if (!content) {
      throw new Error('Custom provider returned empty response');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pick a Copilot chat model. Tries the preferred family first, then a short
 * fallback list, then any available model. Throws a descriptive error when
 * nothing is available so callers can surface a useful message.
 */
async function selectModel(): Promise<vscode.LanguageModelChat> {
  const families = [LLM_FAMILY, 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4.1'];
  for (const family of families) {
    const models = await vscode.lm.selectChatModels({ family });
    if (models.length > 0) return models[0];
  }
  const any = await vscode.lm.selectChatModels({});
  if (any.length > 0) return any[0];
  throw new Error('No language model available. Make sure GitHub Copilot is installed and signed in.');
}

/**
 * Check if a custom LLM provider is configured in VS Code settings.
 */
function isCustomProviderEnabled(): boolean {
  return getSetting<string>(CFG_PROVIDER, 'copilot') === 'custom';
}

/**
 * Extract plain text content from a LanguageModelChatMessage.
 * The content can be a string or an array of parts.
 */
function extractMessageContent(m: vscode.LanguageModelChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.map((part: unknown) => {
    if (part && typeof part === 'object') {
      const p = part as Record<string, unknown>;
      return typeof p.value === 'string' ? p.value
        : typeof p.text === 'string' ? p.text
        : typeof p.content === 'string' ? p.content
        : '';
    }
    return String(part);
  }).join('\n');
}

/** Race a promise against a timeout. Rejects with a clear message on timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => {
      clearTimeout(t);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

export async function callLlm(messages: vscode.LanguageModelChatMessage[]): Promise<string> {
  if (isCustomProviderEnabled()) {
    const plainMessages = messages.map(m => ({
      role: String(m.role ?? 'user'),
      content: extractMessageContent(m),
    }));
    return await callCustomProvider(plainMessages, false);
  }

  const model = await selectModel();

  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const cts = new vscode.CancellationTokenSource();
    try {
      const streamText = async () => {
        const response = await model.sendRequest(messages, {}, cts.token);
        let text = '';
        for await (const chunk of response.text) text += chunk;
        return text;
      };
      return await withTimeout(streamText(), LLM_REQUEST_TIMEOUT_MS, 'LLM request');
    } catch (err) {
      cts.cancel();
      lastError = err;
      if (err instanceof vscode.CancellationError) throw err;
    } finally {
      cts.dispose();
    }
  }
  throw lastError;
}

export async function callLlmJson<T>(messages: vscode.LanguageModelChatMessage[], jsonSchema?: JsonSchemaSpec): Promise<T> {
  if (isCustomProviderEnabled()) {
    const plainMessages = messages.map(m => ({
      role: String(m.role ?? 'user'),
      content: extractMessageContent(m),
    }));
    const text = await callCustomProvider(plainMessages, !!jsonSchema);
    if (!text.trim()) {
      throw new Error('Custom provider returned empty response. Check that your model is running and responding.');
    }
    try {
      return JSON.parse(text.trim()) as T;
    } catch {
      try {
        return parseLlmJson<T>(text);
      } catch (parseErr) {
        // Show a helpful snippet of what the model returned
        const snippet = text.length > 200 ? text.slice(0, 200) + '...' : text;
        throw new Error(`Custom model didn't return valid JSON. Response was: "${snippet.replaceAll(/\n/g, ' ')}". Try a different model or check that your endpoint is reachable.`);
      }
    }
  }

  const model = await selectModel();

  const options: vscode.LanguageModelChatRequestOptions = jsonSchema
    ? { modelOptions: structuredOutputOptions(jsonSchema) }
    : {};

  let lastError: unknown;
  let parseFailures = 0;
  const retryMessages = [...messages];

  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const cts = new vscode.CancellationTokenSource();
    let text = '';
    try {
      const response = await model.sendRequest(retryMessages, options, cts.token);
      for await (const chunk of response.text) text += chunk;
      try {
        return JSON.parse(text.trim()) as T;
      } catch {
        return parseLlmJson<T>(text);
      }
    } catch (err) {
      lastError = err;
      const schemaName = jsonSchema?.name ?? 'none';
      runtimeDebug('panel-llm', 'call-failed',
        `schema=${schemaName} attempt=${attempt + 1} structured=${options.modelOptions !== undefined} ` +
        `model=${model.id} textLen=${text.length} error=${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof vscode.CancellationError) { cts.dispose(); throw err; }
      // Drop structured output so later attempts can recover in plain mode.
      if (jsonSchema && options.modelOptions && lastError instanceof Error &&
          /response_format|modelOptions|not supported|JSON|parse/i.test(lastError.message)) {
        options.modelOptions = undefined;
      }
      // On parse failures, nudge the model to return valid JSON on the next attempt
      if (lastError instanceof Error && /JSON|parse/i.test(lastError.message)) {
        parseFailures++;
        if (retryMessages.length === messages.length) {
          retryMessages.push(vscode.LanguageModelChatMessage.User(
            'Your previous response was not valid JSON. Please respond ONLY with a valid JSON object or array, no markdown fences, no commentary.'
          ));
        }
      }
    } finally {
      cts.dispose();
    }
  }

  const label = parseFailures > 0
    ? `LLM returned invalid JSON after ${LLM_MAX_RETRIES + 1} attempts. Please try again.`
    : (lastError instanceof Error ? lastError.message : 'LLM request failed after retries');
  throw new Error(label);
}