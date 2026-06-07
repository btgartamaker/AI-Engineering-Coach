# Issue: Workspace Names Not Consolidated — Duplicates in Dropdown

## Problem
The workspace filter dropdown now shows duplicate entries for the same workspace — one with the normalized short name and one with the full filesystem path. The normalization pass in `getWorkspaces()` only affects the display `name` field, but workspaces are still keyed by the raw `workspaceName`, so both the old path-keyed entry and the new normalized-name entry appear separately.

### Example
```
my-project                      ← normalized name
/Users/name/projects/my-project ← raw workspaceName (separate entry, different key)
```

The same issue appears across the extension wherever workspace name is used as a grouping key:
- **Dashboard** — workspace cards show both names
- **Timeline** — session rows show both workspace names
- **Output** — workspace breakdown splits counts across both entries
- **Context Health** — per-workspace views show duplicates

## Root Cause
Each session stores its `workspaceName` as set by the parser. Different parsers (and even different runs of the same parser) may populate this field with:
- A short directory name (e.g., `my-project`)
- A full filesystem path (e.g., `/Users/name/projects/my-project`)
- A `.code-workspace` file path (e.g., `/Users/name/projects/my-project/code.workspace`)

The `getWorkspaces()` method groups by the raw `workspaceName` string. Since `my-project` and `/Users/name/projects/my-project` are different strings, they become separate groups even though they represent the same workspace.

The current `AnalyzerBase.displayWorkspaceName()` normalization only affects the display `name` output, not the grouping `key`.

## Proposed Solution

### Option A: Normalize the Key (Recommended)
In `getWorkspaces()` in `analyzer-dashboard.ts`, normalize the grouping key before deduplication:

```typescript
const normalizedKey = AnalyzerBase.displayWorkspaceName(s.workspaceName);
// Use normalizedKey for grouping but keep original workspaceName in session data
```

This way, sessions with `workspaceName = "my-project"` and `workspaceName = "/Users/name/projects/my-project"` both map to the same normalized key `"my-project"` and are merged into one dropdown entry.

### Option B: Data Migration
During parsing, normalize all `workspaceName` values to their display form so the raw data is consistent. This is more invasive (changes parsers) but fixes the issue everywhere.

### Required Changes
1. **`src/core/analyzer-dashboard.ts`** — normalize the grouping key in `getWorkspaces()`
2. **`src/core/analyzer-production.ts`** — normalize workspace name in workspace-level aggregations (`getWorkspaceBreakdown`, `getCodeProduction`, etc.)
3. **`src/core/analyzer-insights.ts`** — check if workspace name is used as a key
4. **Sidebar/Filter** — `app.ts` uses the workspace `id` (which is the raw key) to set the filter. The filter must use the normalized key as well.

### Risk
Changing the grouping key will change which sessions are counted under which workspace. Sessions previously grouped under the full path will move to the normalized name. This is the desired behavior (consolidation), but it will shift historical numbers.

## Handoff
Priority order:
1. `analyzer-dashboard.ts` — fix `getWorkspaces()` grouping
2. `analyzer-production.ts` — fix workspace aggregations
3. `app.ts` — ensure filter uses normalized workspace IDs
4. Verify all other views use consistent workspace names
