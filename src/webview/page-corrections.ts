/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Correction Turn & Error Analysis page — shows wasted iteration loops,
 * error categories, and the cost of corrections.
 *
 * See docs/specs/11-CORRECTION-TURN-ANALYSIS.md
 */

import { DateFilter, CorrectionAnalysisData, CorrectionCategory } from '../core/types';
import { rpc, createChart, formatNum, COLORS } from './shared';
import { html, render, CanvasEl } from './render';

const CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  'output-quality': 'Output Quality',
  'misalignment': 'Misalignment',
  'missing-context': 'Missing Context',
  'syntax-error': 'Syntax / Runtime Error',
  'scope-creep': 'Scope Creep',
  'tool-misfire': 'Tool Misfire',
  'unknown': 'Unknown',
};

const CATEGORY_COLORS: Record<CorrectionCategory, string> = {
  'output-quality': '#d29922',
  'misalignment': '#f85149',
  'missing-context': '#58a6ff',
  'syntax-error': '#da3633',
  'scope-creep': '#bc8cff',
  'tool-misfire': '#3fb950',
  'unknown': '#8b949e',
};

export async function renderCorrections(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  render(html`<div class="loading-screen"><div class="loading-spinner"></div><div class="loading-text">Analyzing correction patterns\u2026</div></div>`, container);

  let data: CorrectionAnalysisData;
  try {
    data = await rpc<CorrectionAnalysisData>('getCorrections', currentFilter as Record<string, unknown>);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load correction analysis';
    render(html`<p class="sk-error">Error: ${msg}</p>`, container);
    return;
  }

  const totalReqs = data.totalCorrectionTurns > 0 && data.correctionRate > 0
    ? Math.round(data.totalCorrectionTurns / data.correctionRate)
    : 0;

  render(html`
    <div class="corr-header">
      <h1>Correction Turn Analysis</h1>
      <p class="corr-subtitle">Identify back-and-forth loops where you had to correct the AI — and learn which areas waste the most time and tokens.</p>
    </div>

    <div class="corr-summary-grid">
      <div class="corr-stat-card">
        <div class="corr-stat-val" style="color:${data.correctionRate > 0.15 ? COLORS.red : data.correctionRate > 0.08 ? COLORS.yellow : COLORS.green}">${(data.correctionRate * 100).toFixed(1)}%</div>
        <div class="corr-stat-lbl">Correction Rate</div>
        <div class="corr-stat-sub">${data.totalCorrectionTurns} corrections in ${totalReqs} total turns</div>
      </div>
      <div class="corr-stat-card">
        <div class="corr-stat-val">${formatNum(data.wastedTokens)}</div>
        <div class="corr-stat-lbl">Tokens Wasted</div>
        <div class="corr-stat-sub">on corrected output</div>
      </div>
      <div class="corr-stat-card">
        <div class="corr-stat-val">$${data.wastedCost.toFixed(2)}</div>
        <div class="corr-stat-lbl">Estimated Cost</div>
        <div class="corr-stat-sub">at blended ~$3/M tokens</div>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:16px;">
      <${CanvasEl} id="corrCategoryChart" height=${180} title="Corrections by Category" />
      <${CanvasEl} id="corrTrendChart" height=${180} title="Correction Rate Over Time" />
    </div>

    <div class="corr-section">
      <h2 class="corr-section-title">Top Correction Triggers</h2>
      ${data.topCorrectionTriggers.length > 0 ? html`
      <table class="corr-table">
        <thead><tr><th>Trigger Pattern</th><th>Count</th></tr></thead>
        <tbody>
          ${data.topCorrectionTriggers.map(t => html`
            <tr><td class="corr-trigger-cell">${t.pattern}</td><td>${t.count}</td></tr>
          `)}
        </tbody>
      </table>` : html`<p class="corr-empty">No correction triggers identified.</p>`}
    </div>

    <div class="corr-section">
      <h2 class="corr-section-title">Recent Corrections</h2>
      ${data.recentCorrections.length > 0 ? html`
        <div class="corr-list">
          ${data.recentCorrections.slice(-20).reverse().map(c => html`
            <details class="corr-card">
              <summary class="corr-card-summary">
                <span class="corr-category-badge" style="background:${CATEGORY_COLORS[c.category] || '#8b949e'}">${CATEGORY_LABELS[c.category] || c.category}</span>
                <span class="corr-card-count">${c.correctionCount} turn${c.correctionCount !== 1 ? 's' : ''}</span>
                <span class="corr-card-tokens">${formatNum(c.wastedTokens)} tokens</span>
              </summary>
              <div class="corr-card-body">
                <div class="corr-card-field">
                  <div class="corr-card-label">Original prompt:</div>
                  <div class="corr-card-value">${c.originalRequest ? html`<pre>${c.originalRequest.slice(0, 500)}</pre>` : html`<em>(first response)</em>`}</div>
                </div>
                <div class="corr-card-field">
                  <div class="corr-card-label">What the model produced first:</div>
                  <div class="corr-card-value">${c.firstResponseSnippet ? html`<pre>${c.firstResponseSnippet}</pre>` : html`<em>N/A</em>`}</div>
                </div>
                ${c.correctionRequests.length > 0 ? html`
                <div class="corr-card-field">
                  <div class="corr-card-label">Correction message${c.correctionRequests.length > 1 ? 's' : ''}:</div>
                  <div class="corr-card-value">${c.correctionRequests.map(msg => html`<pre>${msg.slice(0, 300)}</pre>`)}</div>
                </div>` : null}
              </div>
            </details>
          `)}
        </div>` : html`<p class="corr-empty">No correction loops detected. Your prompts are efficient!</p>`}
    </div>
  `, container);

  // Render charts
  renderCategoryChart(data);
  renderTrendChart(data);
}

/* ── Charts ──────────────────────────────────────────────────────────── */

function renderCategoryChart(data: CorrectionAnalysisData): void {
  createChart('corrCategoryChart', 'bar', {
    labels: (Object.keys(data.byCategory) as CorrectionCategory[]).map(k => CATEGORY_LABELS[k]),
    datasets: [{
      label: 'Corrections',
      values: (Object.keys(data.byCategory) as CorrectionCategory[]).map(k => data.byCategory[k]),
      backgroundColor: (Object.keys(data.byCategory) as CorrectionCategory[]).map(k => CATEGORY_COLORS[k] || '#8b949e'),
    }],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { ticks: { maxRotation: 45 } },
    },
  });
}

function renderTrendChart(data: CorrectionAnalysisData): void {
  createChart('corrTrendChart', 'line', {
    labels: data.weeklyTrend.labels,
    datasets: [{
      label: 'Correction Rate',
      values: data.weeklyTrend.correctionRate.map(r => +(r * 100).toFixed(1)),
      borderColor: COLORS.red,
      backgroundColor: COLORS.red + '20',
    }],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => `${ctx.parsed.y}%` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (v: unknown) => `${v}%` } },
    },
  });
}
