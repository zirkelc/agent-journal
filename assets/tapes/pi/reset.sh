#!/bin/sh
# Builds the demo home of the Claude Code tapes (the same journal and sample
# repository), and adds Pi's own state to it. The take runs Pi with this
# folder as HOME, so nothing of the real home shows or changes.
set -eu
TAPES=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$TAPES/../../.." && pwd)
theme=$(cat "$TAPES/.theme-name" 2>/dev/null || true)
DEMO_THEME=$theme "$TAPES/../claude-code/reset.sh"
DEMO_HOME=$(cd "${AGENT_JOURNAL_DEMO_HOME:-/tmp/agent-journal-demo}" && pwd -P)

# Pi's theme follows the terminal theme: light for a theme whose name ends in -light.
case $theme in *-light) pi_theme=light ;; *) pi_theme=dark ;; esac

# The login of the real home linked in, the model, the theme, and the
# changelog marked as seen. Pi gets the same user preference as Claude Code:
# short summaries.
mkdir -p "$DEMO_HOME/.pi/agent"
ln -s "$HOME/.pi/agent/auth.json" "$DEMO_HOME/.pi/agent/auth.json"
cat > "$DEMO_HOME/.pi/agent/settings.json" <<EOF
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-5-5",
  "theme": "$pi_theme",
  "lastChangelogVersion": "$("$REPO/node_modules/.bin/pi" --version)"
}
EOF
cp "$DEMO_HOME/.claude/CLAUDE.md" "$DEMO_HOME/.pi/agent/AGENTS.md"
