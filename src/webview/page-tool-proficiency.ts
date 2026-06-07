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

  render(html`
    <div class="page-header">
      <h2>Tool &amp; Skill Proficiency</h2>
      <p style="color:var(--text-muted);margin:0;font-size:13px;">
        How effectively you use each skill area. Scores compare your tool usage patterns against benchmarks for your harness.
      </p>
    </div>

    <div class="tool-proficiency-layout" style="padding:0 16px 24px 16px;max-width:960px;">

      <!-- Score ring + suggestions -->
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div class="card" style="flex:0 0 160px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
          ${ringHtml(data.overallScore, scoreColor(data.overallScore), 100)}
          <div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Skill Score</div>
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
        <h3 style="margin:0 0 12px 0;font-size:14px;">Skill Areas</h3>
        <p style="color:var(--text-muted);font-size:12px;margin:0 0 12px 0;">
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

      <!-- Growth summary -->
      <div class="card" style="padding:16px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Skill Growth</h3>
        ${data.weeklyTrend.labels.length >= 2
          ? html`<div style="display:flex;gap:16px;font-size:13px;">
              <div style="flex:1;text-align:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-size:24px;font-weight:600;color:${COLORS.blue};">${data.groups.filter(g => g.gap >= 0).length}/${data.groups.length}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Skills at or above benchmark</div>
              </div>
              <div style="flex:1;text-align:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-size:24px;font-weight:600;color:${COLORS.green};">${data.toolsUsed.length}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Different tools used</div>
              </div>
              <div style="flex:1;text-align:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-size:24px;font-weight:600;color:${COLORS.yellow};">${data.blindSpots.length}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Blind spots to explore</div>
              </div>
            </div>`
          : html`<p style="color:var(--text-muted);font-size:13px;">Not enough data yet. Keep using AI tools and check back for growth trends.</p>`}
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

/* ── Trend Chart ──────────────────────────────────────────────────── */


