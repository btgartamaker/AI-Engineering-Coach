/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Deliberate Practice Plan page (Spec 16) */

import type { DateFilter, PracticePlanData, SkillArea } from '../core/types';
import { rpc, createChart, destroyCharts, COLORS, scoreColor, ringHtml, withErrorBoundary } from './shared';
import { html, render } from './render';

const SKILL_LABELS: Record<SkillArea, string> = {
  'prompt-specificity': 'Prompt Specificity',
  'constraint-writing': 'Constraint Writing',
  'context-provision': 'Context Provision',
  'tool-selection': 'Tool Selection',
  'session-hygiene': 'Session Hygiene',
  'error-recovery': 'Error Recovery',
  'task-decomposition': 'Task Decomposition',
};

const SKILL_COLORS: Record<SkillArea, string> = {
  'prompt-specificity': '#f0883e',
  'constraint-writing': '#d29922',
  'context-provision': '#58a6ff',
  'tool-selection': '#3fb950',
  'session-hygiene': '#bc8cff',
  'error-recovery': '#f85149',
  'task-decomposition': '#8b949e',
};

const LEVEL_LABELS: Record<string, string> = {
  unaware: 'Unaware',
  aware: 'Aware',
  practicing: 'Practicing',
  proficient: 'Proficient',
  mentoring: 'Mentoring',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: COLORS.green,
  intermediate: COLORS.yellow,
  advanced: COLORS.red,
};

export function renderPractice(container: HTMLElement, filter: DateFilter): void {
  withErrorBoundary('Practice', container, () => renderAsync(container, filter));
}

async function renderAsync(container: HTMLElement, filter: DateFilter): Promise<void> {
  destroyCharts();
  render(html`<div class="page-loading">Building your practice plan...</div>`, container);

  // Load anti-pattern data for skill assessment
  const [data, antiPatterns] = await Promise.all([
    rpc<PracticePlanData>('getPracticePlan', { filter } as Record<string, unknown>).catch(() => null),
    rpc<import('../core/types').AntiPatternData>('getAntiPatterns', filter as Record<string, unknown>).catch(() => null),
  ]);

  // If initial load didn't include anti-pattern data, reload with it
  let plan = data;
  if (plan && antiPatterns) {
    plan = await rpc<PracticePlanData>('getPracticePlan', {
      filter,
      antiPatternData: antiPatterns,
    } as Record<string, unknown>).catch(() => plan);
  }

  if (!plan) {
    render(html`<div class="page-loading">Could not load practice data.</div>`, container);
    return;
  }

  render(html`
    <div class="page-header">
      <h2>Deliberate Practice Plan</h2>
      <p style="color:var(--text-muted);margin:0;font-size:13px;">
        Personalized exercises targeting your weak areas. Practice makes proficient.
      </p>
    </div>

    <div class="practice-layout" style="padding:0 16px 24px 16px;max-width:960px;">

      <!-- Skill Profile Radar -->
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div class="card" style="flex:1;padding:16px;">
          <h3 style="margin:0 0 12px 0;font-size:14px;">Skill Profile</h3>
          <p style="color:var(--text-muted);font-size:12px;margin:0 0 8px 0;">
            Your proficiency across 7 skill areas. Red = needs work, Green = strong.
          </p>
          <canvas id="practiceRadarChart" width="300" height="260" style="width:100%;height:260px;"></canvas>
        </div>
        <div class="card" style="flex:0 0 240px;padding:16px;">
          <h3 style="margin:0 0 12px 0;font-size:14px;">Levels</h3>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${(Object.entries(plan.levels) as [SkillArea, string][]).map(([area, level]) => html`
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${SKILL_COLORS[area] || '#8b949e'};flex-shrink:0;"></span>
                <span style="flex:1;color:var(--text-muted);">${SKILL_LABELS[area]}</span>
                <span style="color:${COLORS.blue};">${LEVEL_LABELS[level] || level}</span>
              </div>
            `)}
          </div>
          <div style="margin-top:16px;padding:10px;background:rgba(255,255,255,0.03);border-radius:6px;text-align:center;">
            <div style="font-size:24px;font-weight:600;">${plan.currentStreak}</div>
            <div style="font-size:11px;color:var(--text-muted);">Day Streak</div>
          </div>
        </div>
      </div>

      <!-- Recommended Exercises -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Recommended Exercises</h3>
        ${plan.recommendedExercises.length === 0
          ? html`<p style="color:var(--text-muted);font-size:13px;">No exercises match your current profile. Try more tasks to get personalized recommendations.</p>`
          : html`<div style="display:flex;flex-direction:column;gap:10px;">
            ${plan.recommendedExercises.map(ex => renderExerciseCard(ex))}
          </div>`}
      </div>

    </div>
  `, container);

  renderRadarChart(plan);
}

function renderExerciseCard(ex: import('../core/types').PracticeExercise): any {
  return html`
    <details style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
      <summary style="padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;
        background:rgba(255,255,255,0.02);user-select:none;">
        <span style="font-size:13px;font-weight:500;flex:1;">${ex.title}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;
          background:${DIFFICULTY_COLORS[ex.difficulty]}22;color:${DIFFICULTY_COLORS[ex.difficulty]};
          border:1px solid ${DIFFICULTY_COLORS[ex.difficulty]}44;">${ex.difficulty}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;
          background:${SKILL_COLORS[ex.skillArea]}22;color:${SKILL_COLORS[ex.skillArea]};
          border:1px solid ${SKILL_COLORS[ex.skillArea]}44;">${SKILL_LABELS[ex.skillArea]}</span>
        <span style="font-size:11px;color:var(--text-muted);">${ex.estimatedMinutes}m</span>
      </summary>
      <div style="padding:12px 14px;">
        <p style="margin:0 0 10px 0;font-size:12px;color:var(--text-muted);">${ex.description}</p>
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Exercise:</div>
          <pre style="margin:0;font-size:12px;line-height:1.5;color:#e6edf3;
            background:rgba(255,255,255,0.04);padding:10px;border-radius:4px;white-space:pre-wrap;">${ex.exercisePrompt}</pre>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Success Criteria:</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:${COLORS.green};line-height:1.6;">
            ${ex.successCriteria.map(c => html`<li>${c}</li>`)}
          </ul>
        </div>
      </div>
    </details>
  `;
}

function renderRadarChart(data: PracticePlanData): void {
  const labels = data.skills.map(s => SKILL_LABELS[s.area]);
  const scores = data.skills.map(s => s.score);
  const benchmarks = data.skills.map(s => s.benchmark);

  createChart('practiceRadarChart', 'radar', {
    labels,
    datasets: [
      {
        label: 'Your Score',
        data: scores,
        backgroundColor: 'rgba(88, 166, 255, 0.15)',
        borderColor: '#58a6ff',
        pointBackgroundColor: scores.map((s: number, i: number) =>
          s >= 70 ? COLORS.green : s >= 45 ? COLORS.yellow : COLORS.red
        ),
        pointRadius: 4,
      },
      {
        label: 'Benchmark',
        data: benchmarks,
        backgroundColor: 'transparent',
        borderColor: 'rgba(255,255,255,0.2)',
        borderDash: [4, 4],
        pointRadius: 0,
      },
    ],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { display: false },
        grid: { color: 'rgba(255,255,255,0.06)' },
        angleLines: { color: 'rgba(255,255,255,0.06)' },
        pointLabels: { font: { size: 10 }, padding: 8 },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: { boxWidth: 12, padding: 12, font: { size: 11 } },
      },
    },
  });
}
