#!/bin/sh
# Starts Pi in the sample repository of the demo home, with the extension from
# this checkout and no other extension, skill or MCP server. Run reset.sh first.
TAPES=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$TAPES/../../.." && pwd)
DEMO_HOME=$(cd "${AGENT_JOURNAL_DEMO_HOME:-/tmp/agent-journal-demo}" && pwd -P) || exit 1

cd "$DEMO_HOME/Developer/my-awesome-lib" || exit 1
clear
exec env -i HOME="$DEMO_HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TERM="$TERM" \
  LANG=en_US.UTF-8 SHELL=/bin/zsh TMPDIR="$TMPDIR" \
  "$REPO/node_modules/.bin/pi" --no-extensions -e "$REPO/pi/extensions/agent-journal.ts" \
    --no-skills --no-mcp "$@"
