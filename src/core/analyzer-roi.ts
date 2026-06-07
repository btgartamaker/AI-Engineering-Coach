/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* AI ROI Dashboard analyzer (Spec 15) — estimates cost, time saved,
 * and per-model efficiency from session data. */

import { Session, SessionRequest, DateFilter, ROIData, ModelROI } from './types';
import { isoWeek } from './helpers';
import { MODEL_TOKEN_RATES, TokenRate } from './constants';
import { AnalyzerBase } from './analyzer-base';

/** Minutes saved per LoC of AI-generated code (research-backed conservative estimate) */
const MINS_PER_AI_LOC = 0.1;  // 1 min per 10 LoC
/** Minutes saved per corrected line (correction turns still produce value, at 50%) */
const MINS_PER_CORRECTION_LOC = 0.05;
/** Minutes saved per file read via AI vs manual */
const MINS_PER_FILE_READ = 0.5;
/** Minutes saved per grep search */
const MINS_PER_GREP = 2;

function getTokenRate(modelId: string): TokenRate {
  // Try exact match first, then partial match
  const exact = MODEL_TOKEN_RATES[modelId];
  if (exact) return exact;

  const lower = modelId.toLowerCase();
  for (const [key, rate] of Object.entries(MODEL_TOKEN_RATES)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return rate;
    }
  }
  // Default: GPT-4.1 rates
  return { input: 2.00, cached: 0.50, output: 8.00 };
}

function estimateRequestCost(req: SessionRequest): number {
  const rate = getTokenRate(req.modelId || '');
  const inputCost = (req.promptTokens ?? 0) / 1_000_000 * rate.input;
  const outputCost = (req.completionTokens ?? 0) / 1_000_000 * rate.output;
  const cacheReadCost = (req.cacheReadTokens ?? 0) / 1_000_000 * (rate.cached || 0);
  const cacheWriteCost = (req.cacheWriteTokens ?? 0) / 1_000_000 * (rate.cacheWrite || 0);
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function estimateRequestTimeSaved(req: SessionRequest, isCorrection: boolean): number {
  let minutes = 0;

  // LoC contribution
  const aiLoc = req.aiCode.reduce((s, b) => s + b.loc, 0);
  if (aiLoc > 0) {
    minutes += isCorrection
      ? aiLoc * MINS_PER_CORRECTION_LOC
      : aiLoc * MINS_PER_AI_LOC;
  }

  // Tool-specific savings
  const tools = req.toolsUsed.map(t => t.toLowerCase());
  for (const tool of tools) {
    if (tool.includes('read') || tool.includes('view')) minutes += MINS_PER_FILE_READ;
    if (tool.includes('grep') || tool.includes('search')) minutes += MINS_PER_GREP;
  }

  return minutes;
}

export class ROIAnalyzer extends AnalyzerBase {

  getROI(filter?: DateFilter): ROIData {
    const sessions = this.filteredSessions(filter);

    // Determine period
    let periodStart = '';
    let periodEnd = '';
    const timestamps = sessions
      .map(s => s.lastMessageDate ?? s.creationDate)
      .filter((t): t is number => t != null);
    if (timestamps.length > 0) {
      periodStart = new Date(Math.min(...timestamps)).toISOString().split('T')[0];
      periodEnd = new Date(Math.max(...timestamps)).toISOString().split('T')[0];
    }

    // Per-model aggregation
    const modelData = new Map<string, {
      totalCost: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalRequests: number;
      totalAiLoc: number;
      correctionRequests: number;
      timeSaved: number;
    }>();

    // Weekly buckets
    const weekBuckets = new Map<string, { cost: number; timeSaved: number }>();

    let tasksCompleted = 0;
    let totalAiLoc = 0;

    for (const session of sessions) {
      const hasEdits = session.requests.some(r => r.editedFiles.length > 0);
      if (hasEdits) tasksCompleted++;

      for (let i = 0; i < session.requests.length; i++) {
        const req = session.requests[i];

        // Detect if this is a correction turn
        const isCorrection = i > 0 && this.isCorrectionMessage(req.messageText);

        const modelId = req.modelId || 'unknown';
        if (!modelData.has(modelId)) {
          modelData.set(modelId, {
            totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
            totalRequests: 0, totalAiLoc: 0, correctionRequests: 0, timeSaved: 0,
          });
        }

        const md = modelData.get(modelId)!;
        md.totalRequests++;
        md.totalInputTokens += req.promptTokens ?? 0;
        md.totalOutputTokens += req.completionTokens ?? 0;
        md.totalCost += estimateRequestCost(req);
        const aiLoc = req.aiCode.reduce((s, b) => s + b.loc, 0);
        md.totalAiLoc += aiLoc;
        totalAiLoc += aiLoc;
        if (isCorrection) md.correctionRequests++;
        md.timeSaved += estimateRequestTimeSaved(req, isCorrection);

        // Weekly
        if (req.timestamp) {
          const week = isoWeek(new Date(req.timestamp));
          if (!weekBuckets.has(week)) weekBuckets.set(week, { cost: 0, timeSaved: 0 });
          const wb = weekBuckets.get(week)!;
          wb.cost += estimateRequestCost(req);
          wb.timeSaved += estimateRequestTimeSaved(req, isCorrection);
        }
      }
    }

    // Build model ROI array
    const modelROI: ModelROI[] = Array.from(modelData.entries())
      .map(([modelId, md]) => ({
        modelId,
        totalCost: Math.round(md.totalCost * 100) / 100,
        totalInputTokens: md.totalInputTokens,
        totalOutputTokens: md.totalOutputTokens,
        totalRequests: md.totalRequests,
        avgCostPerRequest: md.totalRequests > 0
          ? Math.round((md.totalCost / md.totalRequests) * 10000) / 10000
          : 0,
        avgInputTokensPerRequest: md.totalRequests > 0
          ? Math.round(md.totalInputTokens / md.totalRequests)
          : 0,
        avgOutputTokensPerRequest: md.totalRequests > 0
          ? Math.round(md.totalOutputTokens / md.totalRequests)
          : 0,
        estimatedTimeSaved: Math.round(md.timeSaved * 10) / 10,
        loCPerDollar: md.totalCost > 0 ? Math.round(md.totalAiLoc / md.totalCost) : md.totalAiLoc,
        correctionRate: md.totalRequests > 0
          ? Math.round((md.correctionRequests / md.totalRequests) * 1000) / 1000
          : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    const totalEstimatedCost = modelROI.reduce((s, m) => s + m.totalCost, 0);
    const totalEstimatedTimeSaved = modelROI.reduce((s, m) => s + m.estimatedTimeSaved, 0);

    // Weekly trend
    const sortedWeeks = Array.from(weekBuckets.keys()).sort();
    const weeklyLabels = sortedWeeks;
    const weeklyCost = sortedWeeks.map(w => Math.round(weekBuckets.get(w)!.cost * 100) / 100);
    const weeklyTimeSaved = sortedWeeks.map(w => Math.round(weekBuckets.get(w)!.timeSaved * 10) / 10);

    return {
      periodStart,
      periodEnd,
      totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      totalEstimatedTimeSaved: Math.round(totalEstimatedTimeSaved * 10) / 10,
      tasksCompleted,
      modelROI,
      weeklyCost: { labels: weeklyLabels, cost: weeklyCost, timeSaved: weeklyTimeSaved },
      totalAiLoc,
    };
  }

  private isCorrectionMessage(msg: string): boolean {
    const correctionRe = /(that'?s not|fix (this|the|my|that)|wrong|incorrect|actually i meant|try again|redo|doesn'?t work|not what I|not correct|still (not|wrong)|didn'?t work|that'?s not right)/i;
    return correctionRe.test(msg);
  }
}
