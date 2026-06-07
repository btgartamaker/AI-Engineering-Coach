/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tool Proficiency Score analyzer (Spec 14) — measures tool diversity,
 * flags blind spots, and benchmarks against harness-specific profiles. */

import { Session, SessionRequest, DateFilter, ToolStat, ToolGroupScore, ToolProficiencyData } from './types';
import { isoWeek } from './helpers';
import { AnalyzerBase } from './analyzer-base';
import {
  resolveToolName, getToolDefs, getToolsByGroup, getBenchmarkRates,
  getToolExample, getToolBenefit, ToolGroup,
} from './tool-registry';

const TOOL_GROUPS: ToolGroup[] = ['file-write', 'file-read', 'search', 'execute', 'planning', 'review'];

export class ToolAnalyzer extends AnalyzerBase {

  getToolProficiency(filter?: DateFilter): ToolProficiencyData {
    const sessions = this.filteredSessions(filter);

    if (sessions.length === 0) {
      return {
        overallScore: 0,
        toolsUsed: [],
        groups: [],
        blindSpots: [],
        weeklyTrend: { labels: [], score: [] },
        topSuggestions: ['Use an AI coding tool to generate data for this analysis.'],
      };
    }

    // Aggregate tool usage
    const toolCalls = new Map<string, { count: number; sessions: Set<string>; successes: number; tokens: number[] }>();
    const sessionToolMap = new Map<string, Set<string>>();  // sessionId -> tools used

    for (const session of sessions) {
      const toolsInSession = new Set<string>();
      for (const req of session.requests) {
        for (const rawTool of req.toolsUsed) {
          const name = resolveToolName(rawTool);
          if (!name) continue;

          if (!toolCalls.has(name)) toolCalls.set(name, { count: 0, sessions: new Set(), successes: 0, tokens: [] });
          const stat = toolCalls.get(name)!;
          stat.count++;
          stat.sessions.add(session.sessionId);
          toolsInSession.add(name);

          // Use prompt tokens as cost proxy
          if (req.promptTokens != null) stat.tokens.push(req.promptTokens);
        }
      }
      sessionToolMap.set(session.sessionId, toolsInSession);
    }

    // Compute per-token stats
    const toolsUsed: ToolStat[] = Array.from(toolCalls.entries())
      .map(([name, data]) => ({
        toolName: name,
        callCount: data.count,
        uniqueSessions: data.sessions.size,
        successRate: 1,  // default — we don't have endState data per tool call
        avgTokensPerCall: data.tokens.length > 0
          ? Math.round(data.tokens.reduce((a, b) => a + b, 0) / data.tokens.length)
          : 0,
      }))
      .sort((a, b) => b.callCount - a.callCount);

    // Group scores
    const totalSessions = sessions.length;
    const totalToolCalls = toolCalls.size;
    const benchmarks = getBenchmarkRates();
    const harnessCounts = new Map<string, number>();
    for (const s of sessions) {
      harnessCounts.set(s.harness, (harnessCounts.get(s.harness) || 0) + 1);
    }
    const primaryHarness = Array.from(harnessCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'GitHub Copilot';
    const benchmark = benchmarks[primaryHarness] || benchmarks['GitHub Copilot'];

    const groupsByCat = getToolsByGroup();
    const groups: ToolGroupScore[] = TOOL_GROUPS.map(group => {
      const defs = groupsByCat.get(group) || [];
      const groupTools = defs.map(d => d.name);
      const groupCalls = Array.from(toolCalls.entries())
        .filter(([name]) => groupTools.includes(name))
        .reduce((s, [, data]) => s + data.count, 0);
      const usageRate = totalSessions > 0 ? groupCalls / totalSessions : 0;
      const benchmarkRate = benchmark[group] || 0;
      const gap = usageRate - benchmarkRate;
      const importance = defs.some(d => d.importance === 'critical') ? 'critical'
        : defs.some(d => d.importance === 'recommended') ? 'recommended' : 'optional';

      return {
        groupName: group,
        tools: groupTools,
        usageRate: Math.round(usageRate * 10) / 10,
        benchmarkRate,
        gap: Math.round(gap * 10) / 10,
        importance,
      };
    });

    // Blind spots: tools never used but available for the user's harness
    const allToolsDefs = getToolDefs();
    const usedToolNames = new Set(toolCalls.keys());
    const blindSpots = allToolsDefs
      .filter(d => !usedToolNames.has(d.name) && d.harnesses.includes(primaryHarness))
      .map(d => {
        const workTypes = this.getCommonWorkTypes(sessions);
        return {
          toolName: d.name,
          harness: primaryHarness,
          applicableWorkTypes: workTypes.slice(0, 3),
          exampleUsage: getToolExample(d.name, workTypes[0] || 'default'),
          expectedBenefit: getToolBenefit(d.name),
        };
      });

    // Overall score (0-100)
    const groupScores = groups.map(g => {
      if (g.benchmarkRate === 0) return g.importance === 'critical' ? 70 : 100;
      const ratio = Math.min(g.usageRate / g.benchmarkRate, 1.5);
      return Math.round(Math.min(ratio, 1) * 100);
    });
    const overallScore = groupScores.length > 0
      ? Math.round(groupScores.reduce((a, b) => a + b, 0) / groupScores.length)
      : 0;

    // Weekly trend
    const weekScores = new Map<string, number[]>();
    for (const session of sessions) {
      const ts = session.lastMessageDate || session.creationDate;
      if (!ts) continue;
      const week = isoWeek(new Date(ts));
      if (!weekScores.has(week)) weekScores.set(week, []);
      const toolsInSession = sessionToolMap.get(session.sessionId);
      weekScores.get(week)!.push(toolsInSession ? Math.min(toolsInSession.size * 15, 100) : 0);
    }
    const sortedWeeks = Array.from(weekScores.keys()).sort();
    const weeklyScores = sortedWeeks.map(w => {
      const vals = weekScores.get(w)!;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });

    // Top suggestions
    const topSuggestions = this.generateSuggestions(groups, blindSpots, overallScore);

    return {
      overallScore,
      toolsUsed,
      groups,
      blindSpots,
      weeklyTrend: { labels: sortedWeeks, score: weeklyScores },
      topSuggestions,
    };
  }

  private getCommonWorkTypes(sessions: Session[]): string[] {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      for (const r of s.requests) {
        const wt = r.workType || '';
        if (wt) counts.set(wt, (counts.get(wt) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([wt]) => wt);
  }

  private generateSuggestions(
    groups: ToolGroupScore[],
    blindSpots: ToolProficiencyData['blindSpots'],
    overallScore: number,
  ): string[] {
    const suggestions: string[] = [];

    // Underused critical groups
    const criticalGaps = groups.filter(g => g.importance === 'critical' && g.gap < -1);
    for (const g of criticalGaps) {
      const tool = g.tools[0];
      suggestions.push(`Try using "${tool}" more — it's a critical tool and you're using it below the recommended rate for your harness.`);
    }

    // Blind spots
    if (blindSpots.length > 0) {
      const topBlind = blindSpots.slice(0, 2);
      for (const b of topBlind) {
        suggestions.push(`You haven't used "${b.toolName}" yet. ${b.expectedBenefit}`);
      }
    }

    // Overall encouragement
    if (overallScore >= 80) {
      suggestions.push('Great tool diversity! You\'re using a well-rounded toolkit.');
    } else if (overallScore >= 50) {
      suggestions.push('Good foundation — expanding your tool use to include more search and planning tools will further improve your efficiency.');
    } else {
      suggestions.push('Start by incorporating at least one tool from each critical group (file-write, file-read, search, execute) into your regular workflow.');
    }

    return suggestions.slice(0, 5);
  }
}
