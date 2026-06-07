# Issue 4: ROI Cost Model Source and Accuracy

## Problem
The ROI Dashboard shows cost estimates (`$0.02`, `$1.50`, etc.) and time-saved estimates without explaining where these numbers come from or how accurate they are. The user questions the cost model's source and reliability.

Currently the page shows:
- "Estimated Cost: $X.XX"
- "Estimated Time Saved: ~Xh Ym"
- Per-model breakdown with LoC/$ and correction rates

But there's no explanation of:
- Which token pricing rates are used
- Whether these are list prices or actual costs
- How time savings are calculated
- What assumptions underpin the model

## Root Cause
The `ROIAnalyzer` in `analyzer-roi.ts` uses `MODEL_TOKEN_RATES` from `constants.ts` with a fallback to GPT-4.1 rates for unknown models. The time savings use fixed heuristics (0.1 min/LoC, 0.5 min/file read, etc.) without validation against real developer data.

## Proposed Solution
### Add a Methodology Disclosure
Add a collapsible "How this is calculated" section at the bottom of the ROI page that explains:
1. **Cost estimation**: "Token costs use published API pricing from each provider. Unknown models default to GPT-4.1 rates ($2/M input, $8/M output). Actual costs may vary based on caching, discounts, and tier."
2. **Time savings**: "Based on research-backed estimates: ~0.1 min per AI-generated line, ~0.5 min per file read. Actual time saved depends on task complexity."
3. **Model matching**: "Model IDs are matched by partial name. If your model isn't found, rates default to GPT-4.1."

### Add Confidence Indicators
- Show a confidence badge next to each model's cost: "Estimated" (matched by name), "Defaulted" (fallback used), "Unknown" (no match)
- Add a disclaimer: "All figures are estimates. Review your actual billing for precise costs."

### Fix Null Model Name
Handle empty/unknown model IDs with a clearer label (e.g., "Session (model unknown)") rather than just "unknown."

## Success Criteria
- [ ] "How this is calculated" disclosure section added
- [ ] Model confidence indicators shown (estimated/defaulted/unknown)
- [ ] Empty model IDs show a clearer label
- [ ] Disclaimer about estimates is visible
