#!/bin/sh
#
# Claude Code SessionStart adapter.
#
# The core prints the text a session should be given. All an adapter does is
# deliver that text the way one agent reads it, which is the seam that keeps the
# rest of this project from knowing Claude Code exists.
#
# Claude Code reads JSON on stdout. Only `additionalContext` is used, and it
# reaches the model alone; the user is deliberately not shown a banner about
# their own configuration at every session start.
#
# Nothing here is worth failing a session over, so every path exits 0.

set -u

self=$0
case $self in
  */*) ;;
  *) self=./$self ;;
esac
root=${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$self")/../.." 2>/dev/null && pwd)}

[ -n "$root" ] || exit 0
[ -x "$root/bin/agent-journal" ] || exit 0
[ -r "$root/adapters/common.sh" ] || exit 0

. "$root/adapters/common.sh"

journal_read_payload

[ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}

# The payload may carry the model, and is documented not to promise it, so the
# entry records whatever arrived and nothing when nothing did.
#
# Model ids here already begin with the product name, and `claude/claude-opus-5`
# says it twice. Dropping the prefix leaves `claude/opus-5`, which is the same
# information and reads like a version of the tool rather than a separate thing.
case $model in
  claude-*) model=${model#claude-} ;;
esac

out=$("$root/bin/agent-journal" context \
  --cwd "$cwd" \
  --session-id "$session_id" \
  --agent "$(journal_agent claude)" 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

printf '%s\n' "$out" | journal_emit_context

exit 0
