# AI ROI Dashboard

## Motivation

Engineering leaders and individual developers alike need to answer: *Is the
investment in AI coding tools paying off?* Current analytics measure *activity*
(requests, sessions, LoC) but not *efficiency* (time saved, cost per task,
defect rate). An ROI dashboard translates raw activity into business value
metrics that justify tool adoption and guide model selection.

## Problem

1. **No cost-per-request tracking** — users using paid models (Claude Pro,
   Copilot Pro, Gemini Advanced) have no visibility into costs.
2. **No time-saved estimation** — the extension knows what the AI produced
   but can't estimate how long it would have taken manually.
3. **No model comparison** — users who switch between models have no data on
   which model gives the best quality-per-token for their specific tasks.
4. **No value-per-session metric** — a 5-turn session that completes a feature
   is more valuable than a 50-turn debugging slog, but both count as one session.

## Proposed Solution

### Data Model (new types in `analytics-types.ts`)

```typescript
export interface ModelCostConfig {
  modelId: string;
  inputCostPer1K: number;    // $ per 1K input tokens
  outputCostPer1K: number;   // $ per 1K output tokens
  cacheReadCostPer1K: number;
  cacheWriteCostPer1K: number;
  currency: string;
}

export interface ModelROI {
  modelId: string;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  avgInputTokensPerRequest: number;
  avgOutputTokensPerRequest: number;
  estimatedTimeSaved: number;    // minutes
  loCPerDollar: number;          // efficiency metric
  correctionRate: number;        // % of requests that were corrections
}

export interface ROIData {
  /** Time period for the analysis */
  periodStart: string;
  periodEnd: string;

  /** Aggregate */
  totalEstimatedCost: number;
  totalEstimatedTimeSaved: number;   // minutes
  netTimeSaved: number;              // total - time spent writing prompts
  tasksCompleted: number;            // sessions that produced a file change

  /** Per-model breakdown */
  modelROI: ModelROI[];

  /** If user has >1 model, show comparative efficiency */
  modelComparison?: {
    bestValueModel: string;     // best LoC per dollar
    fastestModel: string;       // lowest avg response time (proxy: lowest tokens per request)
    mostAccurateModel: string;  // lowest correction rate
  };

  /** Weekly trend */
  weeklyCost: { labels: string[]; cost: number[]; timeSaved: number[] };

  /** Configuration — user can override default cost assumptions */
  costConfig: ModelCostConfig[];
}
```

### Estimation Logic (new analyzer: `analyzer-roi.ts`)

1. **Cost calculation** — use a built-in price table (or user-configurable
   costs) for known models. Estimate cost per request from
   `promptTokens` × input rate + `completionTokens` × output rate.
   Default pricing for public models is maintained in a config file.
2. **Time saved estimation** — use research-backed estimates:
   - A generated code block of N LoC would take ~N/10 minutes manually (TDD).
   - A `grep_search` result saves ~2 minutes vs. manual search.
   - A file read via AI saves ~30 seconds vs. opening and scrolling.
   - Correction turns are counted at 50% of the time value (some value remains).
3. **Model comparison** — for users with multi-model sessions (detected via
   `modelId` variance), compute per-model efficiency metrics.
4. **Weekly trends** — track cost and time-saved over time to show
   accelerating returns as users improve their prompting.

### New UI Page: `/roi`

- **Hero section**: two large numbers — "Estimated Cost: $X.XX" and
  "Estimated Time Saved: Xh Ym". A net "ROI" badge showing cost vs value.
- **Model breakdown**: table of models used with cost, LoC/dollar, correction
  rate, and time saved per model. Sortable and filterable.
- **Efficiency over time**: dual-axis line chart (cost on left, time saved on
  right) showing the weekly trend.
- **Model comparison panel** (if >1 model used): highlights which model gives
  the best value, speed, and accuracy for the user's task mix.
- **Cost configuration**: inline editor for pricing assumptions (with sensible
  defaults pre-populated).
- **What-if scenario**: slider to adjust "my hourly rate" and see how the ROI
  changes (e.g. "If I value my time at $100/hr, AI saved me $X this month").

### Dashboard Integration

- An "ROI" stat card in the hero section showing estimated time saved this
  period and estimated cost.
- A "Best Value Model" badge if model comparison detects a clear winner.

## Success Criteria

- [ ] Users can see estimated dollar cost and time saved for any date range.
- [ ] Model-specific cost breakdown is accurate to within ±20% of actual
  billing (based on published API pricing).
- [ ] Time-saved estimates are conservative but plausible.
- [ ] Users with multiple models see a comparison card.
- [ ] Weekly ROI trend is visible and actionable.

## Ethical Considerations

- **Always label as "estimated"** — costs are based on published pricing and
  per-request token data, not actual invoices.
- **Do not store billing data** — all cost config is local to the user's
  machine and never transmitted.
- **Default costs are opt-in estimates** — users must explicitly configure
  custom pricing if they want accuracy for non-public models.

## Future Enhancements

- **Invoice correlation** — let users upload a CSV of their actual billing
  to calibrate estimates.
- **Team ROI rollup** — aggregate ROI across a team if using the enterprise
  extension distribution.
- **Payback calculator** — "At your current usage rate, Copilot pays for itself
  in X days."
