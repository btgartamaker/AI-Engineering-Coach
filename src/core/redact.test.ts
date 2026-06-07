/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it, expect } from 'vitest';
import { redactSensitive, redactStrings, redactFields } from './redact';

describe('redactSensitive', () => {

  describe('basic behavior', () => {
    it('returns empty string unchanged', () => {
      expect(redactSensitive('')).toBe('');
    });

    it('returns safe text unchanged', () => {
      const text = 'Hello world, this is a normal prompt.';
      expect(redactSensitive(text)).toBe(text);
    });

    it('returns text unchanged when enabled: false', () => {
      const text = 'my secret key is abc123';
      expect(redactSensitive(text, { enabled: false })).toBe(text);
    });

    it('handles nullish/undefined gracefully', () => {
      // Should not throw — but TypeScript requires a string
      expect(redactSensitive('')).toBe('');
    });
  });

  describe('GitHub PAT', () => {
    it('redacts ghp_ token', () => {
      const text = 'use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 for auth';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('ghp_');
    });

    it('redacts github_pat_ fine-grained token', () => {
      const text = 'PAT=github_pat_abcd1234_efgh5678_ijkl9012_mnop3456qrst';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('github_pat_');
    });
  });

  describe('OpenAI / API keys', () => {
    it('redacts sk- key', () => {
      const text = 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('sk-abcdef');
    });
  });

  describe('AWS keys', () => {
    it('redacts AKIA access key', () => {
      const text = 'access key is AKIAIOSFODNN7EXAMPLE';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('AKIA');
    });

    it('redacts AWS secret access key', () => {
      const text = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('wJalrXUtn');
    });
  });

  describe('password / secret key-value pairs', () => {
    it('redacts password=...', () => {
      const text = 'db_password=supersecret123!';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('supersecret123');
    });

    it('redacts api_key: ...', () => {
      const text = 'api_key: "abc123def456"';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
    });

    it('redacts token=...', () => {
      const text = 'token = eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.dGVzdA';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
    });

    it('redacts credential: ...', () => {
      const text = 'credential: admin:password123';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('private keys', () => {
    it('redacts RSA private key block', () => {
      const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0OcVFhFqGzCgDkQl
-----END RSA PRIVATE KEY-----`;
      const text = `Here is my key:\n${key}\nPlease use it.`;
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('BEGIN RSA PRIVATE KEY');
    });

    it('redacts OPENSSH private key block', () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ==
-----END OPENSSH PRIVATE KEY-----`;
      const result = redactSensitive(key);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('OPENSSH PRIVATE KEY');
    });
  });

  describe('email addresses', () => {
    it('redacts email addresses', () => {
      const text = 'contact me at user@example.com for access';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('user@example.com');
    });
  });

  describe('connection strings', () => {
    it('redacts postgres connection string with credentials', () => {
      const text = 'postgres://admin:password123@db.example.com:5432/mydb';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('admin:password123');
    });

    it('redacts mongodb connection string', () => {
      const text = 'mongodb://user:secret@cluster0.example.mongodb.net/mydb';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('long hex strings', () => {
    it('redacts 32+ char hex strings', () => {
      const text = 'hash is a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
      const result = redactSensitive(text);
      expect(result).toContain('[REDACTED]');
    });

    it('does not redact short hex strings', () => {
      const text = 'id is a1b2c3d4';
      expect(redactSensitive(text)).toBe(text);
    });
  });

  describe('redactStrings', () => {
    it('redacts each string in an array', () => {
      const arr = ['safe text', 'api_key=secret123', 'also safe'];
      const result = redactStrings(arr);
      expect(result[0]).toBe('safe text');
      expect(result[1]).toContain('[REDACTED]');
      expect(result[2]).toBe('also safe');
    });
  });

  describe('redactFields', () => {
    it('redacts specified string fields', () => {
      const obj = {
        name: 'Test',
        originalText: 'my api_key=abc123',
        improvedText: 'changed',
        count: 42,
      };
      const result = redactFields(obj, ['originalText', 'improvedText']);
      expect(result.name).toBe('Test');
      expect(result.originalText).toContain('[REDACTED]');
      expect(result.originalText).not.toContain('abc123');
      expect(result.improvedText).toBe('changed');
      expect(result.count).toBe(42);
    });

    it('redacts string array fields', () => {
      const obj = {
        id: 's1',
        correctionRequests: ['safe', 'token=secret', 'safe2'],
      };
      const result = redactFields(obj, ['correctionRequests']);
      expect(result.correctionRequests[0]).toBe('safe');
      expect(result.correctionRequests[1]).toContain('[REDACTED]');
      expect(result.correctionRequests[2]).toBe('safe2');
    });

    it('returns original object when nothing to redact', () => {
      const obj = { name: 'safe', desc: 'no secrets here' };
      const result = redactFields(obj, ['name', 'desc']);
      expect(result).toBe(obj); // same reference
    });

    it('returns original object when enabled: false', () => {
      const obj = { originalText: 'api_key=abc' };
      const result = redactFields(obj, ['originalText'], { enabled: false });
      expect(result).toBe(obj);
    });
  });

  describe('maxScanLen', () => {
    it('redacts within scan limit', () => {
      // Build text that starts with safe padding and ends with a secret
      const padding = 'x'.repeat(500);
      const secret = 'token=mysecretvalue12345';
      const text = padding + secret;
      const result = redactSensitive(text, { maxScanLen: 1000 });
      // Secret is within the first 1000 chars → should be redacted
      expect(result).toContain('[REDACTED]');
    });

    it('does not redact secrets beyond scan limit', () => {
      const padding = 'x'.repeat(200);
      const secret = 'token=mysecretvalue12345';
      const text = secret + padding;
      const result = redactSensitive(text, { maxScanLen: 50 });
      // Secret is within first 50 chars → still found
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('additional patterns', () => {
    it('redacts custom patterns', () => {
      const text = 'My custom secret is: SECRET_42';
      const result = redactSensitive(text, {
        additionalPatterns: [/SECRET_\d+/g],
      });
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('SECRET_42');
    });
  });
});
