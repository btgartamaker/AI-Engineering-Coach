# Security: Sensitive Data Redaction in Prompt Display

## Classification: Medium (Information Disclosure)

**Risk:** User prompts displayed in the UI may contain sensitive data (API keys,
passwords, tokens, PII) that the user typed into their AI coding tool. While
the data is never transmitted and Preact prevents XSS, the plaintext display
violates defense-in-depth principles and may cause compliance concerns
(HIPAA, SOC2, GDPR).

**Affected Pages:**
- `/corrections` — `originalRequest` displayed via `c.originalRequest.slice(0, 500)`
- `/playbook` — `originalText` and `improvedText` in before/after example cards
- `/timeline` — `r.messageText` and `r.responseText` displayed (existing, not new)
- `/anti-patterns` — example prompts in pattern details (existing)

## Proposed Solution

### Detection: Sensitive Pattern Scanner

Add a utility module `src/core/redact.ts` that scans strings for common
sensitive patterns and replaces them with `[REDACTED]`:

```typescript
export interface RedactConfig {
  /** Whether to redact known secret patterns */
  enabled: boolean;
  /** Custom regex patterns to redact */
  additionalPatterns?: RegExp[];
}

export function redactSensitive(text: string, config?: RedactConfig): string;
```

Default redaction patterns:
- `-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----`
- `(api[_-]?key|apikey|secret|password|token|credential)[:=]\s*['"]?\S+` (key-value pairs)
- `ghp_[A-Za-z0-9]{36}` (GitHub PATs)
- `sk-[A-Za-z0-9]{20,}` (OpenAI keys)
- `AKIA[0-9A-Z]{16}` (AWS access keys)
- Email addresses (optional, configurable)

### Implementation Plan

1. **`src/core/redact.ts`** — standalone redaction utility with no dependencies
   - `redactSensitive()` function with configurable patterns
   - `withRedaction()` wrapper that creates a display-safe version of prompt text
   - Performance: O(n) scan, capped at first N chars for very long prompts

2. **Integrate into Analyzer Layer** — add a `redactedSnippet` field or
   apply redaction in the analyzer before returning data:
   - `CorrectionsAnalyzer`: redact `originalRequest` and `correctionRequests`
   - `PlaybookAnalyzer`: redact `originalText` and `improvedText`

3. **UI Layer** — display redacted versions with a visual indicator:
   - Show `[REDACTED]` in place of sensitive values
   - Add a toggle: "Show raw prompts" (default: off)
   - Tooltip explaining: "Sensitive data like passwords and API keys are
     automatically hidden. This data never leaves your machine."

4. **Configuration** — add extension setting to disable redaction:
   - `aiEngineerCoach.security.redactPrompts` (default: `true`)
   - `aiEngineerCoach.security.redactPatterns` (advanced, for custom patterns)

## Success Criteria
- [ ] Known secret patterns (API keys, tokens, passwords) are redacted in all
      prompt-displaying views
- [ ] Redaction is applied before data reaches the webview (no plaintext transit)
- [ ] Users can toggle redaction on/off via settings
- [ ] Toggle applies without losing data (raw data cached, redaction is display-only)
- [ ] Performance impact is negligible (<1ms for typical prompt lengths)

## Future Enhancements
- **Entropy-based detection** — flag high-entropy strings that look like secrets
  even if they don't match known patterns
- **Context-aware redaction** — skip redaction in obvious code snippets
  (e.g., test data, example passwords in documentation)
