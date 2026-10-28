#!/bin/sh
# Builds the demo home from the fixture. The takes run Claude Code with this
# folder as HOME, so ~/agent-journal and ~/Developer/my-awesome-lib in the
# recordings are demo folders, and nothing of the real home shows or changes.
set -eu
TAPES=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$TAPES/../../.." && pwd)
DEMO_HOME=${AGENT_JOURNAL_DEMO_HOME:-/tmp/agent-journal-demo}

# What the last take left goes to the trash where there is one.
if [ -e "$DEMO_HOME" ]; then
  if command -v trash >/dev/null 2>&1; then trash "$DEMO_HOME"; else rm -rf "$DEMO_HOME"; fi
fi
mkdir -p "$DEMO_HOME"
# The physical path, so Claude Code and the shell agree on it (on macOS, /tmp is /private/tmp).
DEMO_HOME=$(cd "$DEMO_HOME" && pwd -P)
LIB="$DEMO_HOME/Developer/my-awesome-lib"
GATEWAY="$DEMO_HOME/Developer/api-gateway"

# The login: on macOS, Claude Code reads it from the login keychain, which it
# finds under ~/Library. Elsewhere it is in ~/.claude/.credentials.json.
if [ -d "$HOME/Library/Keychains" ]; then
  mkdir -p "$DEMO_HOME/Library"
  ln -s "$HOME/Library/Keychains" "$DEMO_HOME/Library/Keychains"
fi
mkdir -p "$DEMO_HOME/.claude"
if [ -f "$HOME/.claude/.credentials.json" ]; then
  ln -s "$HOME/.claude/.credentials.json" "$DEMO_HOME/.claude/.credentials.json"
fi

# Claude Code's own state: onboarding done, the sample repository trusted, a
# pane width that leaves room for the chat, and every notice, hint and upsell
# marked as seen, so the start screen shows only the header.
# Claude Code's own theme follows the terminal theme: light for a theme in
# settings/ whose name ends in -light (record.sh writes the name to .theme-name,
# and the tapes of another folder pass it as DEMO_THEME).
case ${DEMO_THEME:-$(cat "$TAPES/.theme-name" 2>/dev/null)} in *-light) claude_theme=light ;; *) claude_theme=dark ;; esac
version=$(claude --version | cut -d' ' -f1)
cat > "$DEMO_HOME/.claude.json" <<EOF
{
  "hasCompletedOnboarding": true,
  "lastOnboardingVersion": "$version",
  "lastReleaseNotesSeen": "$version",
  "theme": "$claude_theme",
  "autoUpdates": false,
  "fullscreenUpsellSeenCount": 3,
  "autoPermissionsNotificationCount": 3,
  "hasSeenAutoDefaultNotice": true,
  "promoStartupSeenCount": 3,
  "effortCalloutV2Dismissed": true,
  "passesUpsellSeenCount": 4,
  "passesLastSeenRemaining": 3,
  "remoteControlUpsellSeenCount": 3,
  "remoteDialogSeen": true,
  "pushNotifUpsellSeenCount": 3,
  "rcLongTurnNudgeSeenCount": 5,
  "rcLongTurnNudgeSeenKey": "v1",
  "hasSeenTasksHint": true,
  "ideHintShownCount": 5,
  "lspRecommendationIgnoredCount": 2,
  "hasSeenAutoModeEntryWarning": true,
  "numStartups": 100,
  "lastClawdEntranceVersion": "$version",
  "announcementImpressions": { "opus-5-5-launch": 10, "opus-5-5-update": 3, "fable-5-1-launch": 5 },
  "projects": { "$LIB": { "hasTrustDialogAccepted": true }, "$GATEWAY": { "hasTrustDialogAccepted": true } },
  "pluginPanes": { "dockColumns": 70 }
}
EOF
# The fullscreen renderer puts a plugin pane beside the chat. The auto mode
# prompt counts as accepted.
cat > "$DEMO_HOME/.claude/settings.json" <<'EOF'
{
  "tui": "fullscreen",
  "skipAutoPermissionPrompt": true,
  "promptSuggestionEnabled": false
}
EOF

# A user preference, as anyone can set in their own CLAUDE.md: summaries short
# enough that each grep line in the takes fits on one line of the terminal.
cat > "$DEMO_HOME/.claude/CLAUDE.md" <<'EOF2'
Keep the summary of each journal entry under 80 characters.
EOF2

# The journal: the sample entries, and demo values for the machine and the account.
mkdir -p "$DEMO_HOME/agent-journal"
cp -p "$TAPES"/fixture/agent-journal/*.md "$DEMO_HOME/agent-journal/"
HOME="$DEMO_HOME" "$REPO/shared/bin/agent-journal" config set host macbook >/dev/null
HOME="$DEMO_HOME" "$REPO/shared/bin/agent-journal" config set user chris >/dev/null

# The sample repository, with one commit so the model sees a clean tree.
mkdir -p "$LIB"
cp -R "$TAPES/fixture/my-awesome-lib/." "$LIB/"
git -C "$LIB" init -q -b main
git -C "$LIB" add -A
GIT_AUTHOR_DATE=2026-09-22T09:00:00Z GIT_COMMITTER_DATE=2026-09-22T09:00:00Z \
  git -C "$LIB" -c user.name=Demo -c user.email=demo@example.com commit -q -m 'feat: retry helper'

# The session of one sample entry, so `claude --resume <session_id>` in its
# folder opens that conversation. Claude Code keeps the sessions of a folder
# under ~/.claude/projects, in a folder named after the path.
mkdir -p "$GATEWAY"
sessions="$DEMO_HOME/.claude/projects/$(printf '%s' "$GATEWAY" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$sessions"
for jsonl in "$TAPES"/fixture/sessions/*.jsonl; do
  sed "s|__CWD__|$GATEWAY|g" "$jsonl" > "$sessions/$(basename "$jsonl")"
done
