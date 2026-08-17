#!/bin/sh
#
# Codex SessionStart adapter.
#
# The core prints the text a session should be given. All an adapter does is
# deliver that text the way one agent reads it, which is the seam that keeps the
# rest of this project from knowing Codex exists.
#
# Codex reads JSON on stdout and uses `additionalContext`, which reaches the
# model alone. Plain text on stdout is accepted too and means the same thing;
# the JSON is written out in full because an explicit event name is worth more
# than the lines it costs.
#
# Codex will not run a hook it has not been shown. Hooks are recorded as trusted
# against a hash, and a new or changed one is skipped in silence until the person
# runs `/hooks` and trusts it. A first install therefore looks as though this
# script does nothing, which is why the installer mentions the extra step.
#
# The `resume` event is deliberately not matched in hooks.json: a resumed session
# still carries the instruction it was given, so a second copy would only spend
# context. If Codex turns out to drop developer context when it restores a
# session, that matcher is the one place to change.
#
# Nothing here is worth failing a session over, so every path exits 0.

set -u

self=$0
case $self in
  */*) ;;
  *) self=./$self ;;
esac
root=${PLUGIN_ROOT:-$(cd "$(dirname "$self")/../.." 2>/dev/null && pwd)}

[ -n "$root" ] || exit 0
[ -x "$root/bin/agent-journal" ] || exit 0
[ -r "$root/adapters/common.sh" ] || exit 0

. "$root/adapters/common.sh"

journal_read_payload

[ -n "$cwd" ] || cwd=$PWD

out=$("$root/bin/agent-journal" context \
  --cwd "$cwd" \
  --session-id "$session_id" \
  --agent "$(journal_agent codex)" 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

printf '%s\n' "$out" | journal_emit_context

exit 0
