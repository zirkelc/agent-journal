#!/bin/sh
#
# Claude Code SessionStart adapter.
#
# The core prints the text a session should be given. All an adapter does is
# deliver that text the way one agent reads it, which is the seam that keeps
# the rest of this project from knowing Claude Code exists. Another adapter is
# another file this size, and need not be a hook at all: Codex has no session
# event, so its adapter will write the same text into an AGENTS.md at install
# time instead of printing it at session start.
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

# The session's directory and id arrive in the hook's stdin JSON. Matching a
# line rather than parsing the document works whether the JSON is pretty-printed
# or compact, and avoids depending on a JSON parser being installed.
fields=$(awk '
  function value(s) {
    sub(/^"[a-z_]+"[ \t]*:[ \t]*"/, "", s)
    sub(/"$/, "", s)
    gsub(/\\"/, "\"", s)
    gsub(/\\\\/, "\\", s)
    return s
  }
  cwd == "" && match($0, /"cwd"[ \t]*:[ \t]*"([^"\\]|\\.)*"/) {
    cwd = value(substr($0, RSTART, RLENGTH))
  }
  sid == "" && match($0, /"session_id"[ \t]*:[ \t]*"([^"\\]|\\.)*"/) {
    sid = value(substr($0, RSTART, RLENGTH))
  }
  END { print cwd; print sid }
') || fields=

newline='
'

# Command substitution strips trailing newlines, so an absent session id leaves
# one field rather than two. Splitting unconditionally would then hand the
# working directory over as the id.
case $fields in
  *"$newline"*)
    cwd=${fields%%"$newline"*}
    session_id=${fields#*"$newline"}
    ;;
  *)
    cwd=$fields
    session_id=
    ;;
esac

[ -n "$cwd" ] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}

out=$("$root/bin/agent-journal" context --cwd "$cwd" --session-id "$session_id" 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

printf '%s\n' "$out" | awk '
  function escape(s) {
    # Backslashes first: escaping them after the quotes would escape the
    # backslashes this function just added.
    gsub(/\\/, "\\\\", s)
    gsub(/"/, "\\\"", s)
    gsub(/\t/, "\\t", s)
    gsub(/\r/, "\\r", s)
    return s
  }
  { context = (NR == 1 ? "" : context "\\n") escape($0) }
  END {
    if (context == "") exit 0
    printf "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"%s\"}}\n", context
  }
'

exit 0
