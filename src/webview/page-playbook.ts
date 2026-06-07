/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Prompt Engineering Playbook page (Spec 12) */

import type { DateFilter, PlaybookData, PromptExample, PromptPattern, PracticePlanData, SkillArea } from '../core/types';
import { rpc, createChart, destroyCharts, COLORS, scoreColor, ringHtml, withErrorBoundary, formatNum } from './shared';
import { html, render, CanvasEl } from './render';

const DIMMED_COLORS: Record<string, string> = {
  constraints: '#58a6ff',
  'success criteria': '#d29922',
  'verification steps': '#3fb950',
  'context provision': '#bc8cff',
  specificity: '#f0883e',
};

const WIN_IMPACT_ACCENTS: Record<string, string> = {
  high: COLORS.red,
  medium: COLORS.yellow,
  low: COLORS.blue,
};

export function renderPlaybook(container: HTMLElement, filter: DateFilter): void {
  withErrorBoundary('Playbook', container, () => renderPlaybookAsync(container, filter));
}

/** Redact sensitive data in prompt examples (default: on) */
let redactEnabled = true;

const SKILL_LABELS: Record<SkillArea, string> = {
  'prompt-specificity': 'Prompt Specificity',
  'constraint-writing': 'Constraint Writing',
  'context-provision': 'Context Provision',
  'tool-selection': 'Tool Selection',
  'session-hygiene': 'Session Hygiene',
  'error-recovery': 'Error Recovery',
  'task-decomposition': 'Task Decomposition',
};

const SKILL_COLORS: Record<string, string> = {
  'prompt-specificity': '#f0883e',
  'constraint-writing': '#d29922',
  'context-provision': '#58a6ff',
  'tool-selection': '#3fb950',
  'session-hygiene': '#bc8cff',
  'error-recovery': '#f85149',
  'task-decomposition': '#8b949e',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: COLORS.green,
  intermediate: COLORS.yellow,
  advanced: COLORS.red,
};

const LEVEL_LABELS: Record<string, string> = {
  unaware: 'Unaware',
  aware: 'Aware',
  practicing: 'Practicing',
  proficient: 'Proficient',
  mentoring: 'Mentoring',
};

async function renderPlaybookAsync(container: HTMLElement, filter: DateFilter): Promise<void> {
  destroyCharts();
  render(html`<div class="page-loading">Loading your prompt playbook...</div>`, container);

  const [data, practiceData] = await Promise.all([
    rpc<PlaybookData>('getPlaybook', { ...filter, redact: redactEnabled } as Record<string, unknown>),
    rpc<PracticePlanData>('getPracticePlan', { filter } as Record<string, unknown>).catch(() => null),
  ]);

  const grade = data.overallGrade;
  const gradeNum = gradeScore(grade);
  const gradeCol = scoreColor(gradeNum);

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
      <p class="page-subtitle">
        Personalized prompt patterns and improvements based on your data.
        Your overall grade: <strong style="color:${gradeCol}">${grade}</strong>
        · Weakest area: <strong>${data.weakestDimension}</strong>
      </p>
    </div>

    <div class="pb-layout">

      <!-- Grade + Radar -->
      <div class="pb-hero">
        <div class="pb-grade-card" style="--accent:${gradeCol}">
          ${ringHtml(gradeNum, gradeCol, 100)}
          <div class="pb-grade-label">Overall Grade</div>
        </div>
        <div class="pb-radar-card">
          <${CanvasEl} id="playbookRadarChart" height=${200} title="Prompt Dimensions" />
        </div>
      </div>

      <!-- Quick Wins -->
      <div class="pb-card">
        <h3 class="pb-section-title">Quick Wins</h3>
        <div class="pb-wins">
          ${data.quickWins.map(qw => html`
            <div class="pb-win" style="--win-accent:${WIN_IMPACT_ACCENTS[qw.impact] || COLORS.blue}">
              <span class="pb-win-icon">${qw.impact === 'high' ? '\u{1F525}' : qw.impact === 'medium' ? '\u{1F4A1}' : '\u{1F4CC}'}</span>
              <span class="pb-win-text">${qw.suggestion}</span>
              <span class="pb-win-impact">${qw.impact}</span>
            </div>
          `)}
        </div>
      </div>

      <!-- Trend -->
      <div class="pb-card">
        <h3 class="pb-section-title">Prompt Maturity Trend</h3>
        <${CanvasEl} id="playbookTrendChart" height=${160} title="Prompt Maturity Trend" />
        ${data.weeklyTrend.labels.length === 0 ? html`<p class="pb-empty">Not enough data for a trend yet. Keep coding!</p>` : ''}
      </div>

      <!-- Before/After -->
      <div class="pb-card">
        <h3 class="pb-section-title">Before &amp; After — Your Prompts, Improved</h3>
        ${data.personalExamples.length === 0
          ? html`<p class="pb-empty">Not enough prompt data to generate examples yet. Start prompting and check back!</p>`
          : html`<div class="pb-list-col">
            ${data.personalExamples.map((ex, i) => playbookExampleCard(ex, i))}
          </div>`}
      </div>

      <!-- Pattern Library -->
      <div class="pb-card">
        <h3 class="pb-section-title">Prompt Pattern Library</h3>
        <p class="pb-section-sub">Patterns relevant to your common work types. Click to expand.</p>
        <div class="pb-list-col">
          ${data.relevantPatterns.map(p => playbookPatternCard(p))}
        </div>
      </div>

      <!-- Practice Exercises -->
      ${practiceData && practiceData.recommendedExercises.length > 0 ? html`
      <div class="pb-practice-card">
        <h3 class="pb-section-title">Practice Exercises</h3>
        <p class="pb-section-sub">Targeted exercises to strengthen your weakest skill areas.</p>
        <div class="pb-list-col">
          ${practiceData.recommendedExercises.map(ex => practiceExerciseCard(ex))}
        </div>
      </div>
      ` : ''}

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
  if (ex.tokenSavings != null && ex.tokenSavings > 0) savingsParts.push(`~${ex.tokenSavings} tokens saved per prompt`);
  if (ex.correctionSavings != null && ex.correctionSavings > 0) savingsParts.push(`~${ex.correctionSavings} fewer correction turns`);
  const savings = savingsParts.length > 0 ? savingsParts.join(' · ') : '';

  return html`
    <details class="pb-details">
      <summary class="pb-details-summary">
        <span class="pb-details-title">Example ${idx + 1}</span>
        <span class="pb-details-badge" style="background:${dimColor}22;color:${dimColor};border:1px solid ${dimColor}44;">${ex.weakness}</span>
      </summary>
      <div class="pb-details-body">
        <div class="pb-details-body-inner">
          <div class="pb-prompt-label">Original prompt</div>
          <pre class="pb-prompt-pre">${ex.originalText}</pre>

          <div class="pb-prompt-label">Improved prompt</div>
          <pre class="pb-improved-pre">${ex.improvedText}</pre>

          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <span class="pb-improved-note">${ex.improvementNote}</span>
            ${savings ? html`<span class="pb-saving-text">${savings}</span>` : ''}
          </div>
        </div>
      </div>
    </details>
  `;
}

/* ── Pattern Card ─────────────────────────────────────────────────── */

function playbookPatternCard(p: PromptPattern): any {
  const isUsed = !!p.userPromptExample && !p.userPromptExample.includes("You haven't used this pattern yet");
  return html`
    <details class="pb-details">
      <summary class="pb-details-summary">
        <span class="pb-details-title">${p.name}</span>
        <span class="pb-details-badge" style="background:${COLORS.blue}22;color:${COLORS.blue};border:1px solid ${COLORS.blue}44;">${p.technique}</span>
        ${isUsed ? '' : html`<span class="pb-details-new">New</span>`}
      </summary>
      <div class="pb-details-body">
        <div class="pb-details-body-inner">
          <p class="pb-pattern-desc">${p.description}</p>
          <div class="pb-pattern-meta">Applies to: ${p.appliesTo.join(', ')}</div>
          ${p.technique ? html`<div class="pb-pattern-meta">Technique: ${p.technique}</div>` : ''}
          <div class="pb-prompt-label" style="margin-top:8px;">Example:</div>
          <pre class="pb-prompt-pre">${p.userPromptExample}</pre>
        </div>
      </div>
    </details>
  `;
}

/* ── Practice Exercise Card ───────────────────────────────────────── */

function practiceExerciseCard(ex: import('../core/types').PracticeExercise): any {
  const diffColor = DIFFICULTY_COLORS[ex.difficulty];
  const skillColor = (SKILL_COLORS as Record<string, string>)[ex.skillArea];
  return html`
    <details class="pb-details">
      <summary class="pb-details-summary">
        <span class="pb-details-title">${ex.title}</span>
        <span class="pb-details-badge" style="background:${diffColor}22;color:${diffColor};border:1px solid ${diffColor}44;">${ex.difficulty}</span>
        <span class="pb-details-badge" style="background:${skillColor}22;color:${skillColor};border:1px solid ${skillColor}44;">${SKILL_LABELS[ex.skillArea]}</span>
        <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${ex.estimatedMinutes}m</span>
      </summary>
      <div class="pb-details-body">
        <div class="pb-details-body-inner">
          <p class="pb-pattern-desc">${ex.description}</p>
          ${ex.impactStatement ? html`
            <div class="pb-practice-impact">
              <div class="pb-practice-impact-label">Why this matters:</div>
              <div class="pb-practice-impact-text">${ex.impactStatement}</div>
            </div>
          ` : ''}
          <div class="pb-prompt-label">Exercise:</div>
          <pre class="pb-prompt-pre">${ex.exercisePrompt}</pre>
          <div class="pb-prompt-label">Success Criteria:</div>
          <ul class="pb-criteria-list">
            ${ex.successCriteria.map(c => html`<li>${c}</li>`)}
          </ul>
        </div>
      </div>
    </details>
  `;
}
