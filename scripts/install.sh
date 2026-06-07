#!/usr/bin/env bash
#------------------------------------------------------------------------------
# Install the AI Engineering Coach VS Code extension from the latest local build.
#
# Usage:
#   ./scripts/install.sh             # build + install
#   ./scripts/install.sh --skip-build  # skip rebuild, install existing .vsix
#
# Requires:
#   - Node.js >= 18
#   - `npm` and `npx` (from Node.js)
#   - `code` CLI (VS Code shell command: Cmd+Shift+P → "Shell Command: Install 'code' command in PATH")
#------------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
VSIX_FILE="$REPO_DIR/ai-engineer-coach-*.vsix"

cd "$REPO_DIR"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> Building extension..."
  npm run build
  echo "==> Packaging VSIX..."
  npx vsce package
fi

# Find the .vsix (take the newest one)
VSIX=$(ls -t ai-engineer-coach-*.vsix 2>/dev/null | head -1)
if [[ -z "$VSIX" ]]; then
  echo "ERROR: No .vsix file found. Run without --skip-build first." >&2
  exit 1
fi

echo "==> Installing $VSIX..."
code --install-extension "$VSIX"

echo ""
echo "✅ Done. Restart VS Code or reload the window to activate the updated extension."
