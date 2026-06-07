/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sensitive data redaction utility.
 * Scans strings for common secret patterns (API keys, tokens, passwords)
 * and replaces them with `[REDACTED]`. Used to prevent accidental exposure
 * of sensitive data in the extension UI.
 *
 * Usage:
 *   import { redactSensitive } from './redact';
 *   const safe = redactSensitive(userPrompt);
 */

export interface RedactConfig {
  /** Whether to apply redaction (default: true). */
  enabled?: boolean;
  /** Additional regex patterns to redact. Each must have the global flag. */
  additionalPatterns?: RegExp[];
  /**
   * Max characters to scan. Longer strings are truncated before scanning
   * for performance. The tail segment after `maxScanLen` is left untouched
   * (it's unlikely to contain secrets if the first N chars didn't).
   * Default: 10 000.
   */
  maxScanLen?: number;
}

// ---------------------------------------------------------------------------
// Default redaction patterns
// ---------------------------------------------------------------------------

/** Regex that matches private key headers (multiline). */
const PRIVATE_KEY_RE =
  /-----BEGIN\s+(RSA|OPENSSH|EC|DSA|PGP)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|OPENSSH|EC|DSA|PGP)\s+PRIVATE\s+KEY-----/g;

/** Key-value pairs where the key looks like a secret. */
const SECRET_KV_RE =
  /(api[_-]?key|apikey|secret|password|passwd|token|credential|auth[_-]?token|access[_-]?key|private[_-]?key)\s*[:=]\s*['"]?\S+/gi;

/** GitHub Personal Access Tokens: ghp_ followed by 36 alphanumeric chars. */
const GH_PAT_RE = /ghp_[A-Za-z0-9]{36}/g;

/** GitHub fine-grained PATs: github_pat_ followed by 4+4+4+4+12 alnum+underscore. */
const GH_FINE_PAT_RE = /github_pat_[A-Za-z0-9_]{28,}/g;

/** OpenAI / typical API keys: sk- followed by 20+ alphanumeric. */
const OPENAI_KEY_RE = /sk-[A-Za-z0-9]{20,}/g;

/** AWS Access Key ID: AKIA + 16 uppercase letters/digits. */
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;

/** AWS Secret Access Key (base64-ish, 40 chars). */
const AWS_SECRET_RE = /(?:aws[_-]?)?secret[_-]?access[_-]?key['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}['"]?/gi;

/** Generic high-entropy hex strings ≥32 chars (looks like hash / key). */
const LONG_HEX_RE = /\b[0-9a-fA-F]{32,}\b/g;

/** Generic base64 strings ≥40 chars preceded by a secret-like label. */
const SECRET_BASE64_RE =
  /(?:token|key|secret|password|credential)\s*[:=]\s*['"]?[A-Za-z0-9+/=]{40,}['"]?/gi;

/** Email addresses. */
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Connection strings / URLs with credentials. */
const CONNECTION_STR_RE =
  /(?:postgres|mysql|mongodb|redis|amqp|http|https):\/\/[^\s:@]+:[^\s:@]+@[^\s]+/g;

// ---------------------------------------------------------------------------
// Default pattern list
// ---------------------------------------------------------------------------

const DEFAULT_PATTERNS: RegExp[] = [
  PRIVATE_KEY_RE,        // must come first (multiline, large blocks)
  CONNECTION_STR_RE,     // URLs with embedded credentials
  SECRET_KV_RE,
  SECRET_BASE64_RE,
  AWS_KEY_RE,
  AWS_SECRET_RE,
  GH_PAT_RE,
  GH_FINE_PAT_RE,
  OPENAI_KEY_RE,
  LONG_HEX_RE,
  EMAIL_RE,
];

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = '[REDACTED]';

/**
 * Replace all occurrences of sensitive patterns in `text` with `[REDACTED]`.
 *
 * Patterns are applied in a fixed order. Multi-line patterns (private keys)
 * are applied first to ensure they match before per-line patterns.
 * Returns the original string unchanged if `config.enabled === false`.
 *
 * @param text  The string to scan.
 * @param config  Optional configuration.
 */
export function redactSensitive(text: string, config?: RedactConfig): string {
  if (config?.enabled === false) return text;

  const maxLen = config?.maxScanLen ?? 10_000;
  const patterns = [
    ...DEFAULT_PATTERNS,
    ...(config?.additionalPatterns ?? []),
  ];

  let result = text;
  for (const re of patterns) {
    if (result.length <= maxLen) {
      // Entire string fits — scan all of it
      result = result.replace(re, REDACTED);
    } else {
      // Scan only the first N chars; reassemble with tail
      const head = result.slice(0, maxLen);
      const tail = result.slice(maxLen);
      result = head.replace(re, REDACTED) + tail;
    }
  }

  return result;
}

/**
 * Redact sensitive data in an array of strings (e.g. correction requests).
 */
export function redactStrings(strings: string[], config?: RedactConfig): string[] {
  return strings.map(s => redactSensitive(s, config));
}

/**
 * Create a copy of `obj` with all string properties in `keys` redacted.
 * Returns the original object if no redaction is needed.
 */
export function redactFields<T extends object>(
  obj: T,
  keys: (keyof T)[],
  config?: RedactConfig,
): T {
  if (config?.enabled === false) return obj;

  let modified = false;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k as keyof T) && typeof v === 'string') {
      const redacted = redactSensitive(v, config);
      result[k] = redacted;
      if (redacted !== v) modified = true;
    } else if (keys.includes(k as keyof T) && Array.isArray(v) && v.every((e): e is string => typeof e === 'string')) {
      const redactedArr = redactStrings(v, config);
      result[k] = redactedArr;
      if (redactedArr.some((r, i) => r !== v[i])) modified = true;
    } else {
      result[k] = v;
    }
  }
  return (modified ? result : obj) as T;
}
