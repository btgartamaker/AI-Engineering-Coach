/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tool Proficiency Score page (Spec 14) */

import type { DateFilter, ToolProficiencyData } from '../core/types';
import { rpc, createChart, COLORS, scoreColor, ringHtml, withErrorBoundary, formatNum } from './shared';
import { html, render } from './render';

const GROUP_LABELS: Record<string, string> = {
  'file-write': 'File Writing',
  'file-read': 'File Reading',
  search: 'Search',
  execute: 'Execution',
  planning: 'Planning',
  review: 'Review',
};

const GROUP_COLORS: Record<string, string> = {
  'file-write': '#f0883e',
  'file-read': '#58a6ff',
  search: '#3fb950',
  execute: '#d29922',
  planning: '#bc8cff',
  review: '#f85149',
};

export function renderToolProficiency(container: HTMLElement, filter: DateFilter): void {
  withErrorBoundary('ToolProficiency', container, () => renderAsync(container, filter));
}

async function renderAsync(container: HTMLElement, filter: DateFilter): Promise<void> {
  render(html`<div class="page-loading">Loading tool proficiency...</div>`, container);

  const data = await rpc<ToolProficiencyData>('getToolProficiency', filter as Record<string, unknown>);

  render(html`
    <div class="page-header">
      <h2>Tool Proficiency Score</h2>
      <p style="color:var(--text-muted);margin:0;font-size:13px;">
        Measure your tool diversity and discover tools that can improve your workflow.
      </p>
    </div>

    <div class="tool-proficiency-layout" style="padding:0 16px 24px 16px;max-width:960px;">

      <!-- Score ring + suggestions -->
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div class="card" style="flex:0 0 160px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
          ${ringHtml(data.overallScore, scoreColor(data.overallScore), 100)}
          <div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Tool Proficiency</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${data.toolsUsed.length} tools used</div>
        </div>
        <div class="card" style="flex:1;padding:16px;">
          <h3 style="margin:0 0 8px 0;font-size:13px;">Suggestions</h3>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${data.topSuggestions.map(s => html`
              <div style="display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.4;">
                <span style="color:${COLORS.blue};flex-shrink:0;">▸</span>
                <span>${s}</span>
              </div>
            `)}
          </div>
          ${data.topSuggestions.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">Not enough data yet.</p>` : ''}
        </div>
      </div>

      <!-- Group scores chart -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Tool Usage by Group</h3>
        <p style="color:var(--text-muted);font-size:12px;margin:0 0 12px 0;">
          Bars show your usage rate (calls per session) vs. the benchmark for your harness.
        </p>
        <canvas id="toolGroupChart" width="600" height="220" style="width:100%;height:220px;"></canvas>
      </div>

      <!-- Blind spots -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Blind Spots</h3>
        ${data.blindSpots.length === 0
          ? html`<p style="color:var(--text-muted);font-size:13px;">No blind spots found — you've used all tools available for your harness!</p>`
          : html`<div style="display:flex;flex-direction:column;gap:8px;">
            ${data.blindSpots.map(b => html`
              <details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
                <summary style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
                  background:rgba(255,255,255,0.02);user-select:none;">
                  <span style="font-size:13px;font-weight:500;flex:1;">${b.toolName}</span>
                  <span style="font-size:11px;padding:2px 8px;border-radius:10px;
                    background:${COLORS.yellow}22;color:${COLORS.yellow};border:1px solid ${COLORS.yellow}44;">
                    Never used
                  </span>
                </summary>
                <div style="padding:12px 14px;">
                  <p style="margin:0 0 8px 0;font-size:12px;color:var(--text-muted);">${b.expectedBenefit}</p>
                  <div style="margin-top:8px;">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Try it:</div>
                    <pre style="margin:0;font-size:12px;line-height:1.5;color:#e6edf3;
                      background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;white-space:pre-wrap;">${b.exampleUsage}</pre>
                  </div>
                </div>
              </details>
            `)}
          </div>`}
      </div>

      <!-- Tool usage table -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">All Tools Used</h3>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Tool</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Calls</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Sessions</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Avg Tokens/Call</th>
            </tr>
          </thead>
          <tbody>
            ${data.toolsUsed.map(t => html`
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                <td style="padding:6px 8px;">${t.toolName}</td>
                <td style="padding:6px 8px;text-align:right;">${formatNum(t.callCount)}</td>
                <td style="padding:6px 8px;text-align:right;">${t.uniqueSessions}</td>
                <td style="padding:6px 8px;text-align:right;">${t.avgTokensPerCall.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${data.toolsUsed.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">No tool data available yet.</p>` : ''}
      </div>

      <!-- Weekly Trend -->
      <div class="card" style="padding:16px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Proficiency Trend</h3>
        <canvas id="toolTrendChart" width="600" height="160" style="width:100%;height:160px;"></canvas>
        ${data.weeklyTrend.labels.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">Not enough data for a trend yet.</p>` : ''}
      </div>

    </div>
  `, container);

  renderGroupChart(data);
  renderTrendChart(data);
}

/* ── Group Chart (bar) ────────────────────────────────────────────── */

function renderGroupChart(data: ToolProficiencyData): void {
  if (data.groups.length === 0) return;
  const labels = data.groups.map(g => GROUP_LABELS[g.groupName] || g.groupName);
  const usage = data.groups.map(g => g.usageRate);
  const benchmark = data.groups.map(g => g.benchmarkRate);

  createChart('toolGroupChart', 'bar', {
    labels,
    datasets: [
      {
        label: 'Your Usage',
        data: usage,
        backgroundColor: labels.map(l => GROUP_COLORS[Object.keys(GROUP_LABELS).find(k => GROUP_LABELS[k] === l) || ''] || COLORS.blue),
        borderRadius: 4,
      },
      {
        label: 'Benchmark',
        data: benchmark,
        backgroundColor: 'rgba(255,255,255,0.15)',
        borderRadius: 4,
      },
    ],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { boxWidth: 12, padding: 12, font: { size: 11 } },
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { font: { size: 10 } } },
      x: { ticks: { font: { size: 10 } } },
    },
  });
}

/* ── Trend Chart ──────────────────────────────────────────────────── */

function renderTrendChart(data: ToolProficiencyData): void {
  if (data.weeklyTrend.labels.length === 0) return;
  createChart('toolTrendChart', 'line', {
    labels: data.weeklyTrend.labels,
    datasets: [{
      label: 'Proficiency Score',
      data: data.weeklyTrend.score,
      borderColor: COLORS.green,
      backgroundColor: COLORS.green + '20',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    }],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { min: 0, max: 100, ticks: { font: { size: 10 } } },
      x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
    },
  });
}
