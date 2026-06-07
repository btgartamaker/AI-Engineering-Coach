/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tool Proficiency Score page (Spec 14) */

import type { DateFilter, ToolProficiencyData } from '../core/types';
import { rpc, createChart, destroyCharts, COLORS, scoreColor, ringHtml, withErrorBoundary, formatNum } from './shared';
import { html, render, CanvasEl } from './render';

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
  destroyCharts();
  render(html`<div class="page-loading">Loading tool proficiency...</div>`, container);

  const data = await rpc<ToolProficiencyData>('getToolProficiency', filter as Record<string, unknown>);
  const scoreCol = scoreColor(data.overallScore);

  render(html`
    <div class="page-header">
      <h2>Tool &amp; Skill Proficiency</h2>
      <p class="page-subtitle">
        How effectively you use each skill area. Scores compare your tool usage patterns against benchmarks for your harness.
      </p>
    </div>

    <div class="tp-layout">

      <!-- Score ring + suggestions -->
      <div class="tp-hero">
        <div class="tp-score-card" style="--accent:${scoreCol}">
          ${ringHtml(data.overallScore, scoreCol, 100)}
          <div class="tp-score-label">Skill Score</div>
          <div class="tp-score-tools">${data.toolsUsed.length} tools used</div>
        </div>
        <div class="tp-suggest-card">
          <h3 class="tp-section-title">Suggestions</h3>
          <div class="tp-suggestions">
            ${data.topSuggestions.map(s => html`
              <div class="tp-suggestion">
                <span class="tp-suggestion-bullet">▸</span>
                <span>${s}</span>
              </div>
            `)}
          </div>
          ${data.topSuggestions.length === 0 ? html`<p class="tp-empty">Not enough data yet.</p>` : ''}
        </div>
      </div>

      <!-- Group scores chart -->
      <div class="tp-card">
        <h3 class="tp-section-title">Skill Areas</h3>
        <p class="tp-section-sub">
          Your usage rate (calls per session) vs. benchmark for each skill area.
          <br><span style="font-size:11px;">
            <strong>file-write</strong>: generating/editing code ·
            <strong>file-read</strong>: understanding existing code ·
            <strong>search</strong>: finding relevant code
          </span>
        </p>
        <${CanvasEl} id="toolGroupChart" height=${220} title="Skill Areas" />
      </div>

      <!-- Blind spots -->
      <div class="tp-card">
        <h3 class="tp-section-title">Blind Spots</h3>
        ${data.blindSpots.length === 0
          ? html`<p class="tp-empty">No blind spots found — you've used all tools available for your harness!</p>`
          : html`<div class="pb-list-col">
            ${data.blindSpots.map(b => html`
              <details class="tp-blindspot">
                <summary class="tp-blindspot-summary">
                  <span class="tp-blindspot-name">${b.toolName}</span>
                  <span class="tp-blindspot-badge" style="background:${COLORS.yellow}22;color:${COLORS.yellow};border:1px solid ${COLORS.yellow}44;">Never used</span>
                </summary>
                <div class="tp-blindspot-body">
                  <div class="tp-blindspot-body-inner">
                    <p class="tp-blindspot-desc">${b.expectedBenefit}</p>
                    <div class="tp-blindspot-example-label">Try it:</div>
                    <pre class="pb-prompt-pre">${b.exampleUsage}</pre>
                  </div>
                </div>
              </details>
            `)}
          </div>`}
      </div>

      <!-- Growth summary -->
      <div class="tp-card">
        <h3 class="tp-section-title">Skill Growth</h3>
        ${data.weeklyTrend.labels.length >= 2
          ? html`<div class="tp-growth-grid">
              <div class="tp-growth-cell">
                <div class="tp-growth-val" style="color:${COLORS.blue};">${data.groups.filter(g => g.gap >= 0).length}/${data.groups.length}</div>
                <div class="tp-growth-lbl">Skills at or above benchmark</div>
              </div>
              <div class="tp-growth-cell">
                <div class="tp-growth-val" style="color:${COLORS.green};">${data.toolsUsed.length}</div>
                <div class="tp-growth-lbl">Different tools used</div>
              </div>
              <div class="tp-growth-cell">
                <div class="tp-growth-val" style="color:${COLORS.yellow};">${data.blindSpots.length}</div>
                <div class="tp-growth-lbl">Blind spots to explore</div>
              </div>
            </div>`
          : html`<p class="tp-empty">Not enough data yet. Keep using AI tools and check back for growth trends.</p>`}
      </div>

    </div>
  `, container);

  renderGroupChart(data);
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
