/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Prompt Engineering Playbook page (Spec 12) */

import type { DateFilter, PlaybookData, PromptExample, PromptPattern } from '../core/types';
import { rpc, createChart, destroyCharts, COLORS, scoreColor, ringHtml, withErrorBoundary } from './shared';
import { html, render, CanvasEl } from './render';

const DIMMED_COLORS: Record<string, string> = {
  constraints: '#58a6ff',
  'success criteria': '#d29922',
  'verification steps': '#3fb950',
  'context provision': '#bc8cff',
  specificity: '#f0883e',
};

export function renderPlaybook(container: HTMLElement, filter: DateFilter): void {
  withErrorBoundary('Playbook', container, () => renderPlaybookAsync(container, filter));
}

/** Redact sensitive data in prompt examples (default: on) */
let redactEnabled = true;

async function renderPlaybookAsync(container: HTMLElement, filter: DateFilter): Promise<void> {
  destroyCharts();
  render(html`<div class="page-loading">Loading your prompt playbook...</div>`, container);

  const data = await rpc<PlaybookData>('getPlaybook', { ...filter, redact: redactEnabled } as Record<string, unknown>);

  render(html`
    <div class="page-header">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h2 style="margin:0;">Prompt Engineering Playbook</h2>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted);cursor:pointer;user-select:none;">
          <input type="checkbox" checked=${redactEnabled} onchange=${() => {
            redactEnabled = !redactEnabled;
            renderPlaybook(container, filter);
          }} style="accent-color:${COLORS.green};" />
          Redact secrets
          <span style="font-size:10px;opacity:0.7;" title="Hide API keys, tokens, passwords and other sensitive data shown in prompt examples.">ⓘ</span>
        </label>
      </div>
      <p style="color:var(--text-muted);margin:8px 0 0 0;font-size:13px;">
        Personalized prompt patterns and improvements based on your data.
        Your overall grade: <strong style="color:${scoreColor(gradeScore(data.overallGrade))}">${data.overallGrade}</strong>
        · Weakest area: <strong>${data.weakestDimension}</strong>
      </p>
    </div>

    <div class="playbook-layout" style="padding:0 16px 24px 16px;max-width:960px;">

      <!-- Grade + Radar -->
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div class="card" style="flex:0 0 180px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;">
          ${ringHtml(gradeScore(data.overallGrade), scoreColor(gradeScore(data.overallGrade)), 100)}
          <div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Overall Grade</div>
        </div>
        <div class="card" style="flex:1;padding:16px;">
          <${CanvasEl} id="playbookRadarChart" height=${200} title="Prompt Dimensions" />
        </div>
      </div>

      <!-- Quick Wins -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Quick Wins</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${data.quickWins.map(qw => html`
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;">
              <span style="font-size:16px;flex-shrink:0;">${qw.impact === 'high' ? '\u{1F525}' : qw.impact === 'medium' ? '\u{1F4A1}' : '\u{1F4CC}'}</span>
              <span style="flex:1;font-size:13px;">${qw.suggestion}</span>
              <span style="font-size:11px;color:var(--text-muted);text-transform:capitalize;">${qw.impact}</span>
            </div>
          `)}
        </div>
      </div>

      <!-- Trend -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Prompt Maturity Trend</h3>
        <${CanvasEl} id="playbookTrendChart" height=${160} title="Prompt Maturity Trend" />
        ${data.weeklyTrend.labels.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">Not enough data for a trend yet. Keep coding!</p>` : ''}
      </div>

      <!-- Before/After -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Before &amp; After — Your Prompts, Improved</h3>
        ${data.personalExamples.length === 0
          ? html`<p style="color:var(--text-muted);font-size:13px;">Not enough prompt data to generate examples yet. Start prompting and check back!</p>`
          : html`<div style="display:flex;flex-direction:column;gap:12px;">
            ${data.personalExamples.map((ex, i) => playbookExampleCard(ex, i))}
          </div>`}
      </div>

      <!-- Pattern Library -->
      <div class="card" style="padding:16px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Prompt Pattern Library</h3>
        <p style="color:var(--text-muted);font-size:12px;margin:0 0 12px 0;">
          Patterns relevant to your common work types. Hover for details.
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${data.relevantPatterns.map(p => playbookPatternCard(p))}
        </div>
      </div>
    </div>
  `, container);

  renderRadarChart(data);
  renderTrendChart(data);
}

/* ── Grade score helper ───────────────────────────────────────────── */

function gradeScore(grade: string): number {
  const map: Record<string, number> = { 'A': 90, 'B': 70, 'C': 50, 'D': 30, 'F': 10 };
  return map[grade] ?? 50;
}

/* ── Radar Chart ──────────────────────────────────────────────────── */

function renderRadarChart(data: PlaybookData): void {
  const base = gradeScore(data.overallGrade);
  const dims: Record<string, number> = {
    constraints: data.weeklyTrend.scores.length > 0
      ? data.weeklyTrend.scores[data.weeklyTrend.scores.length - 1] : base,
    specificity: base - 5,
    'context provision': base + 5,
    'success criteria': base - 10,
    'verification steps': base - 15,
  };
  for (const key of Object.keys(dims)) {
    dims[key] = Math.max(0, Math.min(100, dims[key]));
  }

  const labels = Object.keys(dims).map(k => k.replace(/([A-Z])/g, ' $1').trim());
  const values = Object.values(dims);

  createChart('playbookRadarChart', 'radar', {
    labels,
    datasets: [{
      label: 'Prompt Dimensions',
      data: values,
      backgroundColor: 'rgba(88, 166, 255, 0.15)',
      borderColor: '#58a6ff',
      pointBackgroundColor: values.map((_v: number, i: number) => DIMMED_COLORS[labels[i]] || '#58a6ff'),
      pointRadius: 4,
    }],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { display: false },
        grid: { color: 'rgba(255,255,255,0.06)' },
        angleLines: { color: 'rgba(255,255,255,0.06)' },
        pointLabels: { font: { size: 11 }, padding: 8 },
      },
    },
    plugins: { legend: { display: false } },
  });
}

/* ── Trend Chart ──────────────────────────────────────────────────── */

function renderTrendChart(data: PlaybookData): void {
  if (data.weeklyTrend.labels.length === 0) return;
  createChart('playbookTrendChart', 'line', {
    labels: data.weeklyTrend.labels,
    datasets: [{
      label: 'Prompt Score',
      data: data.weeklyTrend.scores,
      borderColor: COLORS.blue,
      backgroundColor: COLORS.blue + '20',
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

/* ── Example Card ─────────────────────────────────────────────────── */

function playbookExampleCard(ex: PromptExample, idx: number): any {
  const dimColor = DIMMED_COLORS[ex.weakness] || '#8b949e';
  const savingsParts: string[] = [];
  if (ex.tokenSavings != null) savingsParts.push(`~${ex.tokenSavings} tokens saved per prompt`);
  if (ex.correctionSavings != null) savingsParts.push(`~${ex.correctionSavings} fewer correction turns`);
  const savings = savingsParts.length > 0 ? savingsParts.join(' \u00B7 ') : '';

  return html`
    <details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
      <summary style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
        background:rgba(255,255,255,0.02);user-select:none;">
        <span style="font-size:13px;font-weight:500;flex:1;">Example ${idx + 1}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${dimColor}22;color:${dimColor};
          border:1px solid ${dimColor}44;">${ex.weakness}</span>
      </summary>
      <div style="padding:12px 14px;">
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Original prompt</div>
          <pre style="margin:0;font-size:12px;line-height:1.5;color:var(--text-muted);
            background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;white-space:pre-wrap;">${ex.originalText}</pre>
        </div>
        <div style="margin-bottom:8px;">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Improved prompt</div>
          <pre style="margin:0;font-size:12px;line-height:1.5;color:#e6edf3;
            background:rgba(59,185,80,0.06);padding:8px;border-radius:4px;border-left:3px solid ${COLORS.green};white-space:pre-wrap;">${ex.improvedText}</pre>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
          <span style="color:${COLORS.green};">${ex.improvementNote}</span>
          ${savings ? html`<span style="color:var(--text-muted);font-size:11px;">${savings}</span>` : ''}
        </div>
      </div>
    </details>
  `;
}

/* ── Pattern Card ─────────────────────────────────────────────────── */

function playbookPatternCard(p: PromptPattern): any {
  const isUsed = !!p.userPromptExample && !p.userPromptExample.includes("You haven't used this pattern yet");
  return html`
    <details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
      <summary style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
        background:rgba(255,255,255,0.02);user-select:none;">
        <span style="font-size:13px;font-weight:500;flex:1;">${p.name}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${COLORS.blue}22;color:${COLORS.blue};
          border:1px solid ${COLORS.blue}44;">${p.technique}</span>
        ${isUsed ? '' : html`<span style="font-size:10px;color:${COLORS.yellow};">New</span>`}
      </summary>
      <div style="padding:12px 14px;">
        <p style="margin:0 0 8px 0;font-size:12px;color:var(--text-muted);">${p.description}</p>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Applies to: ${p.appliesTo.join(', ')}</div>
        ${p.technique ? html`
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Technique: ${p.technique}</div>
        ` : ''}
        <div style="margin-top:8px;">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Example:</div>
          <pre style="margin:0;font-size:12px;line-height:1.5;color:#e6edf3;
            background:rgba(255,255,255,0.04);padding:8px;border-radius:4px;white-space:pre-wrap;">${p.userPromptExample}</pre>
        </div>
      </div>
    </details>
  `;
}
