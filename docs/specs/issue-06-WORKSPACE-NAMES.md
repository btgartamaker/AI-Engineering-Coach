# Issue 6: Workspace Names Inconsistency

## Problem
Workspace names are displayed inconsistently across the extension — sometimes as a short friendly name (e.g., `my-project`), sometimes as a full filesystem path (e.g., `/Users/name/projects/my-project`), and occasionally as a VS Code workspace file path (e.g., `/Users/name/projects/my-project/code.workspace`).

This inconsistency makes filters, badges, and dashboard cards confusing.

## Root Cause
Workspace names come from multiple sources in the session data:
1. **VS Code sessions**: The workspace name is the folder name (`my-project`) or the `.code-workspace` filename
2. **CLI tool sessions** (Copilot CLI, Claude Code): The working directory path at session start
3. **Gemini sessions**: The project name from `projects.json` mapping or the directory name
4. **Codex sessions**: The workspace root path from the session file

The `workspaceName` field in sessions is populated differently by each parser, and the normalization in `resolveWorkspaceNames` only handles some cases.

## Proposed Solution
### Normalize at Parse Time
In the parser harnesses or a normalization pass:
1. Strip the user's home directory prefix (`/Users/name` → `~`)
2. If the result starts with `~`, use the last 1-2 path segments as the display name
3. If it's already a short name (no slashes), keep it
4. Strip `.code-workspace` and `.vscode` extensions

### Add `workspaceDisplayName` Field
Add a `workspaceDisplayName: string` field to workspaces that:
- Uses the last path segment for full paths
- Keeps short names as-is
- Falls back to `workspaceName` if display name is empty

### Update UI
- Workspace filter dropdown should show the display name with the full path as a tooltip
- Dashboard workspace cards should use display name
- Timeline session rows should use display name

## Success Criteria
- [ ] Workspace names are consistently short across all views
- [ ] Full path is available as tooltip/subtitle
- [ ] No bare filesystem paths shown in filters or cards
- [ ] `.code-workspace` extension is stripped
