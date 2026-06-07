# Issue: Practice and Playbook Overlap

## Problem
The Playbook page (prompt improvement) and Practice page (deliberate practice exercises) have significant thematic overlap:

### Playbook page
- Prompt scoring across 5 dimensions
- Before/after improved prompt examples
- Prompt pattern library (12 patterns)
- Quick wins suggestions

### Practice page
- 7 skill area proficiency scores
- Personalized exercise recommendations
- Level tracking (Unaware → Mentoring)

### Overlap
| Concept | Playbook | Practice |
|---|---|---|
| Prompt quality | Scores prompts, shows improvements | Exercises for prompt-specificity |
| Constraints | Scores constraint dimension | Exercises for constraint-writing |
| Context | Scores context provision | Exercises for context-provision |
| Tools | Quick wins mention tool use | Tool-selection skill area |
| Weak areas | Highlights weakest dimension | Recommends exercises for weak skills |

Both pages analyze the user's weaknesses and suggest improvements, just at different granularity (Playbook = prompt-level, Practice = skill-level).

## Proposed Solution: Merge into "Improve" Page

Combine both into a single **Improve** page with two tabs or sections:

### Section 1: "Your Profile" (top)
- Skill radar chart (from Practice)
- Overall grade + weakest dimension (from Playbook)
- Practice level summary (Unaware/Mentoring)
- Quick wins (from Playbook)

### Section 2: "Improve Your Prompts" (middle)
- Before/after prompt examples (from Playbook)
- Pattern library (from Playbook)

### Section 3: "Practice Exercises" (bottom)
- Filterable/sortable exercise cards (from Practice)
- Show only exercises relevant to the user's weak areas

### Sidebar Changes
- Remove "Practice" sidebar link
- Rename "Playbook" → "Improve" (or keep "Playbook" and include exercises)
- Update page route: `playbook` serves the combined page

### Data Flow
- `PlaybookAnalyzer.getPlaybook()` already returns `PlaybookData`
- `PracticeAnalyzer.getPracticePlan()` returns `PracticePlanData`
- A new combined RPC `getImproveData()` would call both and merge
- Or the page can make two RPC calls (`getPlaybook` + `getPracticePlan`)

## Handoff
Files to change:
- `src/webview/page-playbook.ts` — add practice exercises section
- `src/webview/page-practice.ts` — can be retired (or keep as fallback)
- `src/webview/panel-html.ts` — update sidebar
- `src/webview/app.ts` — update route handlers
- `src/webview/panel-rpc.ts` — may need combined RPC handler
