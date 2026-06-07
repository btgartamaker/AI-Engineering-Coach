/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Skill Finder page — reframed for human-in-the-loop value.
 * Shows recurring prompt patterns as coaching insights rather than
 * infrastructure to install.
 */

import { DateFilter, WorkflowCluster, WorkflowOptimizationData, SkillTriageResult, TriagedCluster, CatalogItem, CatalogDiscoverResult, CatalogTriageResult } from '../core/types';
import { rpc, COLORS } from './shared';
import { html, render } from './render';
import { consumeNavHint, updateNavBadge } from './app';
import { getSkillCache, setSkillCache } from './skill-cache';

const CATALOG_BASE = 'https://awesome-copilot.github.com';

/** Cached results so re-render can use existing data */
let lastTriaged: TriagedCluster[] = [];
let lastClusters: WorkflowCluster[] = [];

/** Current page-level filter for cache scoping */
let activeFilter: DateFilter = {};

export async function renderSkills(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  activeFilter = currentFilter;
  const workspaces = await rpc<{ id: string; name: string }[]>('getWorkspaces');

  const filterWsId = currentFilter.workspaceId
    ? (workspaces.find(w => w.id === currentFilter.workspaceId)?.id || '')
    : '';

  render(html`
    <div class="sk-header">
      <h1>Skill Finder</h1>
      <p class="sk-subtitle">Discover recurring patterns in your prompts and get actionable coaching tips.</p>
    </div>

    <div class="sk-toolbar">
      <div class="sk-toolbar-row">
        <label class="sk-lookback">
          <span>Workspace</span>
          <select id="skWorkspaceSelect" class="sk-select">
            <option value="">All workspaces</option>
            ${workspaces.map(ws => html`<option value="${ws.id}" selected="${ws.id === filterWsId || undefined}">${ws.name}</option>`)}
          </select>
        </label>
        <label class="sk-lookback">
          <span>Look back</span>
          <select id="lookbackSelect" class="sk-select">
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6" selected>6 months</option>
            <option value="12">12 months</option>
            <option value="0">All time</option>
          </select>
        </label>
        <button id="analyzeBtn" class="sk-btn sk-btn-primary">Find Patterns</button>
        <span id="analyzeStatus" class="sk-status"></span>
      </div>
    </div>

    <section class="sk-section" id="customSection">
      <h2 class="sk-section-title">Recurring Patterns</h2>
      <div id="customResults">
        <p class="sk-empty">Select a workspace and click Find Patterns to see your repeating prompt habits.</p>
      </div>
    </section>

    <section class="sk-section" id="catalogSection">
      <details>
        <summary class="sk-section-title" style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;">
          <span>Community Catalog</span>
          <span style="font-size:11px;color:var(--text-muted);font-weight:400;">(optional)</span>
        </summary>
        <p class="sk-section-desc">
          Matching picks from <a href="${CATALOG_BASE}/" target="_blank">awesome-copilot</a> based on your repeated activities.
        </p>
        <div id="catalogResults">
          <p class="sk-empty">Run the analysis to get personalized community recommendations.</p>
        </div>
      </details>
    </section>
  `, container);

  document.getElementById('analyzeBtn')!.addEventListener('click', triggerRunAnalysis);

  // Check for cached results from dashboard scan
  const cached = getSkillCache(currentFilter);
  if (cached && cached.clusters.length > 0) {
    renderCachedResults(cached.clusters, cached.triaged, cached.catalogMatches);
    return;
  }

  // Auto-run if navigated from dashboard with hint
  const hint = consumeNavHint();
  if (hint === 'auto-run') {
    setTimeout(triggerRunAnalysis, 100);
  }
}

/* ── Render cached results from dashboard ─────────────────────────── */

function renderCachedResults(clusters: WorkflowCluster[], triaged: TriagedCluster[], catalogMatches: CatalogItem[]): void {
  const statusEl = document.getElementById('analyzeStatus')!;
  const customEl = document.getElementById('customResults')!;
  const catalogEl = document.getElementById('catalogResults')!;

  const strong = triaged.filter(t => t.verdict === 'strong').slice(0, 10);
  lastTriaged = strong;
  lastClusters = clusters;

  if (strong.length === 0) {
    statusEl.textContent = `Found ${clusters.length} patterns — no strong coaching opportunities.`;
    render(html`<p class="sk-empty">No repeating prompt patterns detected.</p>`, customEl);
  } else {
    statusEl.textContent = `${strong.length} coaching ${strong.length === 1 ? 'insight' : 'insights'} found (from dashboard scan)`;
    renderTriageResults(customEl, strong, clusters);
  }

  if (catalogMatches.length > 0) {
    renderCatalogList(catalogEl, catalogMatches, catalogMatches.length);
  } else {
    render(html`<p class="sk-empty">No community matches from dashboard scan.</p>`, catalogEl);
  }

  updateNavBadge('badge-skills', strong.length + catalogMatches.length);
}

/* ── Analysis Flow ────────────────────────────────────────────────── */

async function runAnalysis(): Promise<void> {
  const btn = document.getElementById('analyzeBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('analyzeStatus')!;
  const customEl = document.getElementById('customResults')!;
  const catalogEl = document.getElementById('catalogResults')!;

  const workspaceId = (document.getElementById('skWorkspaceSelect') as HTMLSelectElement).value;
  const workspaceName = workspaceId
    ? ((document.getElementById('skWorkspaceSelect') as HTMLSelectElement).selectedOptions[0]?.textContent || workspaceId)
    : undefined;
  const lookback = Number.parseInt((document.getElementById('lookbackSelect') as HTMLSelectElement).value, 10);

  btn.disabled = true;
  btn.textContent = 'Analyzing...';
  statusEl.textContent = '';
  render(html`<p class="sk-loading">Scanning for repeated prompts...</p>`, customEl);
  render(html`<p class="sk-loading">Loading community catalog...</p>`, catalogEl);

  // Build filter
  const filter: Record<string, unknown> = {};
  if (lookback > 0) {
    const d = new Date();
    d.setMonth(d.getMonth() - lookback);
    filter.fromDate = d.toISOString().slice(0, 10);
  }
  if (workspaceId) filter.workspaceId = workspaceId;

  let clusters: WorkflowCluster[] = [];

  try {
    const data = await rpc<WorkflowOptimizationData>('getWorkflowOptimization', filter);
    clusters = data.clusters || [];

    if (clusters.length === 0) {
      render(html`<p class="sk-empty">No repeated patterns found. Try extending the lookback period or selecting a different workspace.</p>`, customEl);
      render(html`<p class="sk-empty">No patterns to match against.</p>`, catalogEl);
      return;
    }

    const top20 = clusters.slice(0, 20);
    statusEl.textContent = `Found ${clusters.length} patterns — sending top ${top20.length} to AI triage...`;

    const result = await rpc<SkillTriageResult>('triageSkills', {
      clusters: top20.map(c => ({
        id: c.id, label: c.label, occurrences: c.occurrences,
        sessions: c.sessions, cancelRate: c.cancelRate,
        avgCorrectionTurns: c.avgCorrectionTurns,
        workspaces: c.workspaces,
        examples: c.examples.slice(0, 5),
      })),
      workspace: workspaceName,
    } as Record<string, unknown>);

    const strong = (result.triaged || []).filter(t => t.verdict === 'strong').slice(0, 10);
    lastTriaged = strong;
    lastClusters = clusters;

    if (strong.length === 0) {
      statusEl.textContent = 'No strong coaching insights found.';
      render(html`<p class="sk-empty">No repeating prompt patterns detected. Your prompts may already be well-served or too diverse.</p>`, customEl);
    } else {
      statusEl.textContent = `${strong.length} coaching ${strong.length === 1 ? 'insight' : 'insights'} found`;
      renderTriageResults(customEl, strong, clusters);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed';
    render(html`<p class="sk-error">Error: ${msg}</p>`, customEl);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Patterns';
  }

  // Load community catalog after custom analysis and write to shared cache
  const catalogMatches = await loadCatalog(catalogEl, clusters, workspaceName);
  setSkillCache({ clusters, triaged: lastTriaged, catalogMatches, timestamp: Date.now() }, activeFilter);
  updateNavBadge('badge-skills', lastTriaged.length + catalogMatches.length);
}

function triggerRunAnalysis(): void {
  void runAnalysis();
}

/* ── Triage Results (Coaching Insights) ───────────────────────────── */

function renderTriageResults(container: HTMLElement, triaged: TriagedCluster[], clusters: WorkflowCluster[]): void {
  render(html`<div class="sk-grid">${triaged.map((t, i) => {
    const cluster = clusters.find(c => c.id === t.id);
    const hasExamples = cluster && cluster.examples.length > 0;
    return html`
      <div class="sk-card" data-idx="${i}" data-id="${t.id}">
        <div class="sk-card-header">
          <span class="sk-rank">${i + 1}</span>
          <div class="sk-card-title">${t.suggestedSkillName || t.label}</div>
        </div>
        <div class="sk-card-body">
          <p class="sk-card-reason">${t.reason}</p>
          ${cluster ? html`
            <div class="sk-card-meta">
              <span>${cluster.occurrences} repetitions</span>
              <span>${cluster.sessions} sessions</span>
              ${cluster.cancelRate > 0 ? html`<span>${cluster.cancelRate}% cancelled</span>` : null}
            </div>
            ${hasExamples ? html`
              <details class="sk-examples-details">
                <summary class="sk-examples-summary">View ${cluster.examples.length} example${cluster.examples.length !== 1 ? 's' : ''}</summary>
                <div class="sk-examples-body">
                  <div class="sk-examples-body-inner">
                    ${cluster.examples.slice(0, 5).map(ex => html`
                      <div class="sk-card-example">${ex.length > 200 ? ex.slice(0, 197) + '...' : ex}</div>
                    `)}
                  </div>
                </div>
              </details>
            ` : null}
            <div class="sk-card-actions" style="margin-top:10px;">
              <button class="sk-btn sk-btn-secondary sk-btn-generate" data-cluster-idx="${i}">Generate Skill</button>
              <div class="sk-card-preview" data-cluster-idx="${i}"></div>
            </div>` : null}
        </div>
      </div>`;
  })}</div>`, container);

  // Generate Skill buttons (secondary action)
  for (const btn of container.querySelectorAll('.sk-btn-generate')) {
    btn.addEventListener('click', (e) => {
      void (async () => {
        const el = e.currentTarget as HTMLButtonElement;
        const idx = Number.parseInt(el.dataset.clusterIdx || '0', 10);
        const t = triaged[idx];
        if (!t) return;
        const cluster = clusters.find(c => c.id === t.id);
        if (!cluster) return;

        el.disabled = true;
        el.textContent = 'Generating...';

        try {
          const res = await rpc<{ content: string; filename: string }>('generateSkillContent', {
            label: t.suggestedSkillName || t.label,
            pattern: cluster.label,
            occurrences: cluster.occurrences,
            sessions: cluster.sessions,
            examples: cluster.examples.slice(0, 5),
            skillDraft: cluster.skillDraft,
          } as Record<string, unknown>);

          const previewEl = el.parentElement?.querySelector<HTMLElement>('.sk-card-preview');
          if (previewEl) {
            render(html`
              <details class="sk-preview-details" open>
                <summary>Preview: ${res.filename}</summary>
                <pre class="sk-preview-code">${res.content}</pre>
                <div class="sk-preview-actions">
                  <button class="sk-btn sk-btn-confirm">Save & Install</button>
                  <button class="sk-btn sk-btn-secondary sk-btn-cancel">Cancel</button>
                </div>
              </details>`, previewEl);

            previewEl.querySelector<HTMLElement>('.sk-btn-confirm')?.addEventListener('click', () => {
              void (async () => {
                try {
                  await rpc<{ ok: boolean }>('installSkill', { filename: res.filename, content: res.content } as Record<string, unknown>);
                  el.textContent = 'Installed';
                  el.classList.add('sk-btn-done');
                  render(html`<span class="sk-installed-msg">Skill installed to ~/.agents/skills/</span>`, previewEl);
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : 'Install failed';
                  render(html`<span class="sk-error">${msg}</span>`, previewEl);
                }
              })();
            });

            previewEl.querySelector<HTMLElement>('.sk-btn-cancel')?.addEventListener('click', () => {
              render(null, previewEl);
              el.disabled = false;
              el.textContent = 'Generate Skill';
            });
          }

          el.textContent = 'Review Below';
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Generation failed';
          el.textContent = 'Generate Skill';
          el.disabled = false;
          const previewEl = el.parentElement?.querySelector<HTMLElement>('.sk-card-preview');
          if (previewEl) render(html`<span class="sk-error">${msg}</span>`, previewEl);
        }
      })();
    });
  }
}

/* ── Community Catalog ────────────────────────────────────────────── */

const kindIcons: Record<string, string> = {
  skill: 'S', agent: 'A', instruction: 'I', hook: 'H',
};
const kindColors: Record<string, string> = {
  skill: COLORS.green, agent: COLORS.purple,
  instruction: COLORS.blue, hook: COLORS.yellow,
};

async function loadCatalog(container: HTMLElement, clusters: WorkflowCluster[], workspace?: string): Promise<CatalogItem[]> {
  try {
    const result = await rpc<CatalogDiscoverResult>('discoverCatalog', {} as Record<string, unknown>);
    if (!result.items || result.items.length === 0) {
      render(html`<p class="sk-empty">No items found in the community catalog.</p>`, container);
      return [];
    }

    render(html`<p class="sk-loading">AI is reviewing all ${result.items.length} catalog items against your patterns...</p>`, container);

    const topClusters = clusters
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 20)
      .map(c => ({ label: c.label, occurrences: c.occurrences, workspaces: c.workspaces, examples: c.examples.slice(0, 3) }));

    try {
      const triaged = await rpc<CatalogTriageResult>('triageCatalog', {
        items: result.items,
        clusters: topClusters,
        workspace: workspace || undefined,
      } as Record<string, unknown>);

      const items = triaged.items && triaged.items.length > 0 ? triaged.items : [];
      if (items.length === 0) {
        render(html`<p class="sk-empty">No community items matched your workflow patterns (${result.totalScanned} reviewed).</p>`, container);
      } else {
        renderCatalogList(container, items, result.totalScanned);
      }
      return items;
    } catch {
      render(html`<p class="sk-empty">AI triage failed. Try again later.</p>`, container);
      return [];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to load catalog';
    render(html`<p class="sk-error">Catalog error: ${msg}</p>`, container);
    return [];
  }
}

function renderCatalogList(container: HTMLElement, items: CatalogItem[], totalScanned: number): void {
  render(html`
    <p class="sk-section-count">${items.length} curated from ${totalScanned} catalog items</p>
    <div class="sk-grid">${items.map(item => renderCatalogCard(item))}</div>
  `, container);

  for (const btn of container.querySelectorAll('.sk-btn-install-catalog')) {
    btn.addEventListener('click', (e) => {
      void (async () => {
        const el = e.currentTarget as HTMLButtonElement;
        const path = el.dataset.path || '';
        const kind = el.dataset.kind || 'skill';
        const title = el.dataset.title || '';
        if (!path) return;

        el.disabled = true;
        el.textContent = 'Fetching...';

        try {
          const res = await rpc<{ content: string; filename: string }>('installCatalogItem', {
            path, kind, title,
          } as Record<string, unknown>);

          el.textContent = 'Installed';
          el.classList.add('sk-btn-done');
          const parent = el.closest('.sk-card');
          const msgEl = parent?.querySelector<HTMLElement>('.sk-install-msg');
          if (msgEl) msgEl.textContent = `Installed as ${res.filename}`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Install failed';
          el.textContent = 'Install';
          el.disabled = false;
          const parent = el.closest('.sk-card');
          const msgEl = parent?.querySelector<HTMLElement>('.sk-install-msg');
          if (msgEl) { msgEl.textContent = msg; msgEl.classList.add('sk-error'); }
        }
      })();
    });
  }
}

function renderCatalogCard(item: CatalogItem): ReturnType<typeof html> {
  const color = kindColors[item.kind] || COLORS.blue;
  const icon = kindIcons[item.kind] || '?';
  const kindLabel = item.kind.charAt(0).toUpperCase() + item.kind.slice(1);
  const ghUrl = `https://github.com/github/awesome-copilot/blob/main/${encodeURI(item.path)}`;

  return html`
    <div class="sk-card sk-card-catalog">
      <div class="sk-card-header">
        <span class="sk-kind-icon" style="background:${color}">${icon}</span>
        <div>
          <div class="sk-card-title">
            <a href="${ghUrl}" target="_blank">${item.title}</a>
          </div>
          <div class="sk-card-badges">
            <span class="sk-badge" style="color:${color}">${kindLabel}</span>
            ${item.category ? html`<span class="sk-badge">${item.category}</span>` : null}
          </div>
        </div>
      </div>
      <div class="sk-card-body">
        <p class="sk-card-desc">${item.description.length > 200 ? item.description.slice(0, 200) + '...' : item.description}</p>
        ${item.matchReasons.length > 0 ? html`
          <div class="sk-card-reasons">
            ${item.matchReasons.map(r => html`<span class="sk-reason">${r}</span>`)}
          </div>` : null}
        <div class="sk-card-actions">
          <button class="sk-btn sk-btn-install-catalog" data-path="${item.path}" data-kind="${item.kind}" data-title="${item.title}">Install</button>
          <span class="sk-install-msg"></span>
        </div>
      </div>
    </div>`;
}
