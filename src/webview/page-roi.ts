/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* AI ROI Dashboard page (Spec 15) — cost estimation, time saved, model comparison */

import type { DateFilter, ROIData } from '../core/types';
import { rpc, createChart, COLORS, withErrorBoundary, formatNum } from './shared';
import { html, render } from './render';

export function renderROI(container: HTMLElement, filter: DateFilter): void {
  withErrorBoundary('ROI', container, () => renderAsync(container, filter));
}

async function renderAsync(container: HTMLElement, filter: DateFilter): Promise<void> {
  render(html`<div class="page-loading">Calculating ROI...</div>`, container);

  const data = await rpc<ROIData>('getROI', filter as Record<string, unknown>);

  const hoursSaved = Math.floor(data.totalEstimatedTimeSaved / 60);
  const minsSaved = Math.round(data.totalEstimatedTimeSaved % 60);
  const timeLabel = hoursSaved > 0 ? `${hoursSaved}h ${minsSaved}m` : `${minsSaved}m`;

  render(html`
    <div class="page-header">
      <h2>AI ROI Dashboard</h2>
      <p style="color:var(--text-muted);margin:0;font-size:13px;">
        Estimated cost, time saved, and model efficiency based on your session data.
        All figures are estimates.
      </p>
    </div>

    <div class="roi-layout" style="padding:0 16px 24px 16px;max-width:960px;">

      <!-- Hero cards -->
      <div style="display:flex;gap:16px;margin-bottom:20px;">
        <div class="card" style="flex:1;padding:20px;text-align:center;">
          <div style="font-size:28px;font-weight:600;color:${COLORS.green};">~${timeLabel}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Estimated Time Saved</div>
          <div style="font-size:11px;color:var(--text-muted);">Based on ${formatNum(data.totalAiLoc)} LoC generated</div>
        </div>
        <div class="card" style="flex:1;padding:20px;text-align:center;">
          <div style="font-size:28px;font-weight:600;color:${data.totalEstimatedCost > 10 ? COLORS.yellow : COLORS.green};">$${data.totalEstimatedCost.toFixed(2)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Estimated Cost</div>
          <div style="font-size:11px;color:var(--text-muted);">${formatNum(data.modelROI.length)} model(s) used</div>
        </div>
        <div class="card" style="flex:1;padding:20px;text-align:center;">
          <div style="font-size:28px;font-weight:600;">${formatNum(data.tasksCompleted)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Tasks Completed</div>
          <div style="font-size:11px;color:var(--text-muted);">Sessions with file edits</div>
        </div>
      </div>

      <!-- Weekly trend -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Weekly Cost &amp; Time Saved</h3>
        <canvas id="roiTrendChart" width="600" height="200" style="width:100%;height:200px;"></canvas>
        ${data.weeklyCost.labels.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">Not enough weekly data yet.</p>` : ''}
      </div>

      <!-- Model breakdown table -->
      <div class="card" style="padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;">Per-Model Breakdown</h3>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Model</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Cost</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Requests</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">LoC/$</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Corr. Rate</th>
              <th style="text-align:right;padding:6px 8px;color:var(--text-muted);font-weight:500;">Time Saved</th>
            </tr>
          </thead>
          <tbody>
            ${data.modelROI.map(m => html`
              <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                <td style="padding:6px 8px;font-weight:500;">${m.modelId}</td>
                <td style="padding:6px 8px;text-align:right;">$${m.totalCost.toFixed(2)}</td>
                <td style="padding:6px 8px;text-align:right;">${formatNum(m.totalRequests)}</td>
                <td style="padding:6px 8px;text-align:right;">${formatNum(m.loCPerDollar)}</td>
                <td style="padding:6px 8px;text-align:right;color:${m.correctionRate > 0.2 ? COLORS.red : m.correctionRate > 0.1 ? COLORS.yellow : COLORS.green};">${(m.correctionRate * 100).toFixed(1)}%</td>
                <td style="padding:6px 8px;text-align:right;">${m.estimatedTimeSaved.toFixed(1)}m</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${data.modelROI.length === 0 ? html`<p style="color:var(--text-muted);font-size:13px;">No model cost data available yet.</p>` : ''}
      </div>

      <!-- Efficiency insight -->
      <div class="card" style="padding:16px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;">Efficiency Insight</h3>
        <p style="font-size:13px;color:var(--text-muted);margin:0;line-height:1.5;">
          ${data.totalEstimatedCost > 0 && data.totalEstimatedTimeSaved > 0
            ? html`At a developer hourly rate of $100/hr, the estimated time saved (${timeLabel}, value ~$${Math.round(data.totalEstimatedTimeSaved / 60 * 100)}) versus tool cost ($${data.totalEstimatedCost.toFixed(2)}) yields a <strong style="color:${COLORS.green};">${Math.round((data.totalEstimatedTimeSaved / 60 * 100) / data.totalEstimatedCost)}x ROI</strong>.`
            : html`Not enough data to calculate ROI yet. Keep using AI coding tools and check back!`
          }
        </p>
        ${data.modelROI.length > 1 ? html`
          <div style="margin-top:12px;padding:10px;background:rgba(59,185,80,0.06);border-radius:6px;font-size:12px;">
            <strong>Model comparison:</strong> You've used ${data.modelROI.length} different models.
            ${renderModelComparison(data)}
          </div>
        ` : ''}
      </div>

    </div>
  `, container);

  renderTrendChart(data);
}

function renderModelComparison(data: ROIData): string {
  if (data.modelROI.length < 2) return '';

  const sortedByLocPerDollar = [...data.modelROI].sort((a, b) => b.loCPerDollar - a.loCPerDollar);
  const sortedByCost = [...data.modelROI].sort((a, b) => a.avgCostPerRequest - b.avgCostPerRequest);
  const sortedByAccuracy = [...data.modelROI].sort((a, b) => a.correctionRate - b.correctionRate);

  return html`
    <div style="margin-top:8px;">
      <div style="margin-bottom:4px;">Best value: <strong>${sortedByLocPerDollar[0].modelId}</strong> (${formatNum(sortedByLocPerDollar[0].loCPerDollar)} LoC/$)</div>
      <div style="margin-bottom:4px;">Most affordable: <strong>${sortedByCost[0].modelId}</strong> ($${(sortedByCost[0].avgCostPerRequest * 1000).toFixed(2)}/K requests)</div>
      <div>Most accurate: <strong>${sortedByAccuracy[0].modelId}</strong> (${(sortedByAccuracy[0].correctionRate * 100).toFixed(1)}% correction rate)</div>
    </div>
  `.toString();
}

function renderTrendChart(data: ROIData): void {
  if (data.weeklyCost.labels.length === 0) return;
  createChart('roiTrendChart', 'bar', {
    labels: data.weeklyCost.labels,
    datasets: [
      {
        label: 'Cost ($)',
        data: data.weeklyCost.cost,
        backgroundColor: COLORS.blue + '60',
        borderRadius: 4,
        yAxisID: 'y',
      },
    ],
  }, {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
    },
    scales: {
      y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 }, callback: (v: unknown) => `$${v}` } },
      x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
    },
  });
}
