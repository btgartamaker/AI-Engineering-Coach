/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Correction Turn & Error Analysis — detects back-and-forth correction loops,
 * categorizes them, and computes waste metrics.
 *
 * See docs/specs/11-CORRECTION-TURN-ANALYSIS.md
 */

import {
  Session, SessionRequest, DateFilter, CorrectionCategory, CorrectionTurn, CorrectionAnalysisData,
} from './types';
import { AnalyzerBase } from './analyzer-base';
import { isoWeek } from './helpers';

/* ════════════════════════════════════════════════════════════════════
   Correction detection regexes
   ════════════════════════════════════════════════════════════════════ */

/** Signals a user is correcting the model's output. */
const CORRECTION_RE = /(that'?s not|fix (this|the|my|that)|wrong|incorrect|actually i meant|try again|redo|this doesn'?t work|not what I|not correct|still (not|wrong)|didn'?t work|that'?s not right|no[.,]\s+(that|this|it)|please fix|try a different|also add|while you'?re at it|one more thing|additionally|could you also)/i;

/** Category keyword classifiers (tested against the user's correction message). */
const CATEGORY_CLASSIFIERS: Array<{ re: RegExp; category: CorrectionCategory }> = [
  // Most specific first
  { re: /(wrong (file|path|location|function|method)|not the right|wrote to|should have been in|put it in the wrong)/i, category: 'tool-misfire' },
  { re: /(also add|while you'?re at it|and also|one more thing|additionally|could you also|while you are)/i, category: 'scope-creep' },
  { re: /(doesn'?t work|error|exception|bug|crash|fail|compile|build|syntax|type|undefined|null|broken)/i, category: 'syntax-error' },
  { re: /(missing|you forgot|didn'?t include|not enough|need more|need also|you omitted|without)/i, category: 'missing-context' },
  { re: /(not what I asked|I meant|that'?s not what|misunderstood|not the|actually I meant|incorrect)/i, category: 'misalignment' },
  { re: /(quality|style|format|readability|messy|ugly|not great|poor|could be better)/i, category: 'output-quality' },
];

const DEFAULT_CATEGORY: CorrectionCategory = 'output-quality';

/** Max consecutive correction turns before treating as scope creep. */
const MAX_CORRECTION_LOOP = 5;

/* ════════════════════════════════════════════════════════════════════
   Analyzer
   ════════════════════════════════════════════════════════════════════ */

export class CorrectionsAnalyzer extends AnalyzerBase {
  constructor(sessions: Session[], editLocIndex: Map<string, Map<string, number>>, sharedMap: Map<SessionRequest, Session>) {
    super(sessions, editLocIndex, sharedMap);
  }

  /**
   * Compute correction analysis for the given sessions.
   * Optionally filters by date range.
   */
  analyze(filter?: DateFilter): CorrectionAnalysisData {
    const sessions: Session[] = this.filteredSessions(filter);
    const allCorrections: CorrectionTurn[] = [];
    const weeklyBuckets = new Map<string, { corrections: number; total: number }>();

    for (const session of sessions) {
      const corrections = this.detectCorrections(session);
      allCorrections.push(...corrections);

      // Aggregate weekly stats
      const week = isoWeek(new Date(session.lastMessageDate ?? session.creationDate ?? Date.now()));
      if (!weeklyBuckets.has(week)) weeklyBuckets.set(week, { corrections: 0, total: 0 });
      const bucket = weeklyBuckets.get(week)!;
      bucket.corrections += corrections.length;
      bucket.total += Math.max(session.requestCount, 1);
    }

    // Compute aggregates
    const totalReqs = sessions.reduce((s, se) => s + Math.max(se.requestCount, 1), 0);
    const totalCorrectionTurns = allCorrections.length;
    const correctionRate = totalReqs > 0 ? totalCorrectionTurns / totalReqs : 0;
    const wastedTokens = allCorrections.reduce((s, c) => s + c.wastedTokens, 0);
    const wastedCost = wastedTokens * 0.000003; // ~$3/1M tokens blended estimate

    // By category
    const byCategory: Record<CorrectionCategory, number> = {
      'output-quality': 0, 'misalignment': 0, 'missing-context': 0,
      'syntax-error': 0, 'scope-creep': 0, 'tool-misfire': 0, 'unknown': 0,
    };
    for (const c of allCorrections) byCategory[c.category]++;

    // Top triggers (substring patterns that appear in correction messages)
    const triggerCounts = new Map<string, number>();
    for (const c of allCorrections) {
      for (const msg of c.correctionRequests) {
        const trigger = extractTrigger(msg);
        if (trigger) triggerCounts.set(trigger, (triggerCounts.get(trigger) || 0) + 1);
      }
    }
    const topCorrectionTriggers = [...triggerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // Weekly trend
    const sortedWeeks = [...weeklyBuckets.keys()].sort();
    const weeklyTrend = {
      labels: sortedWeeks,
      correctionRate: sortedWeeks.map(w => {
        const b = weeklyBuckets.get(w)!;
        return b.total > 0 ? b.corrections / b.total : 0;
      }),
    };

    return {
      totalCorrectionTurns,
      correctionRate,
      wastedTokens,
      wastedCost,
      byCategory,
      topCorrectionTriggers,
      weeklyTrend,
      recentCorrections: allCorrections.slice(-50), // last 50
    };
  }

  /**
   * Walk a session's requests and detect correction loops.
   */
  private detectCorrections(session: Session): CorrectionTurn[] {
    const corrections: CorrectionTurn[] = [];
    const reqs = session.requests;
    let i = 0;

    while (i < reqs.length - 1) {
      // Look for correction start: user message after an assistant response
      if (reqs[i].responseText && i + 1 < reqs.length && reqs[i + 1].messageText) {
        const userMsg = reqs[i + 1].messageText;
        if (CORRECTION_RE.test(userMsg)) {
          const correction = this.traceCorrectionLoop(reqs, i + 1, session.sessionId);
          if (correction) {
            corrections.push(correction);
            i = correction.requestIndex + correction.correctionCount + 1;
            continue;
          }
        }
      }
      i++;
    }

    return corrections;
  }

  /**
   * Trace a correction loop starting from a user correction message.
   * Returns null if no valid correction loop is found.
   */
  private traceCorrectionLoop(
    reqs: Session['requests'],
    startIdx: number,
    sessionId: string,
  ): CorrectionTurn | null {
    // Find the original user prompt that started this exchange
    const originalRequest = findOriginalPrompt(reqs, startIdx);
    const firstResponseSnippet = originalRequest.slice(0, 500);

    let correctionCount = 0;
    let i = startIdx;
    const correctionRequests: string[] = [];
    let trackedFiles = new Set<string>();

    // Get the files touched by the assistant response just before the correction
    if (startIdx > 0) {
      for (const f of reqs[startIdx - 1].editedFiles) trackedFiles.add(f);
    }

    while (i < reqs.length) {
      const msg = reqs[i];
      // Must be a user message that looks like a correction
      if (!msg.messageText || !CORRECTION_RE.test(msg.messageText)) break;

      correctionRequests.push(msg.messageText);
      correctionCount++;

      // Check if same files are edited in the subsequent assistant response
      if (i + 1 < reqs.length) {
        const asst = reqs[i + 1];
        // Track new files being edited
        for (const f of asst.editedFiles) trackedFiles.add(f);

        // Check if correction continues after assistant responds
        if (i + 2 < reqs.length && CORRECTION_RE.test(reqs[i + 2].messageText)) {
          i += 2;
          continue;
        }
      }

      break;
    }

    if (correctionCount === 0) return null;

    // Categorize
    const category = this.classifyCorrection(correctionRequests);

    // Estimate wasted tokens
    let wastedTokens = 0;
    for (let j = startIdx; j < Math.min(startIdx + correctionCount * 2, reqs.length); j++) {
      wastedTokens += (reqs[j].promptTokens ?? 0) + (reqs[j].completionTokens ?? 0);
    }

    return {
      sessionId,
      requestIndex: startIdx,
      correctionCount,
      category,
      wastedTokens,
      originalRequest: originalRequest.slice(0, 1000),
      correctionRequests,
      firstResponseSnippet,
    };
  }

  /**
   * Classify a correction into a category based on keyword matching.
   */
  private classifyCorrection(messages: string[]): CorrectionCategory {
    const combined = messages.join(' ');
    for (const { re, category } of CATEGORY_CLASSIFIERS) {
      if (re.test(combined)) return category;
    }
    return DEFAULT_CATEGORY;
  }
}

/**
 * Walk backwards from the correction to find the original user prompt.
 */
function findOriginalPrompt(reqs: SessionRequest[], correctionIdx: number): string {
  for (let i = correctionIdx - 1; i >= 0; i--) {
    const msg = reqs[i].messageText;
    // A user message that doesn't look like a correction
    if (msg && !CORRECTION_RE.test(msg)) return msg.slice(0, 1000);
  }
  return '';
}

/**
 * Extract a short trigger phrase from a correction message.
 */
function extractTrigger(msg: string): string | null {
  const patterns = [
    /(add|missing|need|without|forgot)\s+(the\s+)?([a-zA-Z]+)/i,
    /(not|wrong|incorrect)\s+(the\s+)?([a-zA-Z]+)/i,
    /(doesn'?t|didn'?t)\s+(work|compile|run)/i,
    /(error|exception|bug|crash)\s+(in|at|with)\s+([a-zA-Z./]+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(msg);
    if (m) return m[0].toLowerCase().slice(0, 60);
  }
  return null;
}
