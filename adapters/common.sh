# Shared by the session-start adapters. Sourced, never run.
#
# More than one agent happens to have settled on the same session-start contract:
# a JSON payload on stdin, and a JSON document on stdout whose `additionalContext`
# reaches the model. The parts that are the same for all of them live here, so a
# fix to one is a fix to each. What differs stays in each adapter: the variable
# naming the plugin root, the name it journals under, and any quirk of its own.
#
# Sharing this file is a convenience rather than part of the contract. An adapter
# is free to ignore it, and one written for an agent that delivers its
# instruction some other way probably will.
#
# Nothing here writes to stderr or returns non-zero. An adapter must never fail
# a session, and it cannot honour that if its helpers do not.

# Reads a hook payload on stdin and sets `cwd`, `session_id` and `model` from it.
#
# Matching a field rather than parsing the document works whether the JSON is
# pretty-printed or compact, and avoids depending on a JSON parser being
# installed.
#
# A field that is not in the payload comes back empty rather than missing, so a
# caller can test it without caring whether the agent sends it at all. `model` in
# particular is optional in more than one payload.
journal_read_payload() {
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
    mdl == "" && match($0, /"model"[ \t]*:[ \t]*"([^"\\]|\\.)*"/) {
      mdl = value(substr($0, RSTART, RLENGTH))
    }
    # Three lines always, so the split below is by position and an absent field
    # cannot shift the one after it into its place.
    END { print cwd; print sid; print mdl }
  ') || fields="

"

  journal_newline='
'

  # Command substitution strips trailing newlines, so trailing fields that are
  # empty do not arrive as empty lines: they do not arrive at all. Each split
  # therefore has to ask whether there is a separator left before taking one,
  # or a payload with no session id would hand the working directory over as it.
  case $fields in
    *"$journal_newline"*)
      cwd=${fields%%"$journal_newline"*}
      rest=${fields#*"$journal_newline"}
      ;;
    *)
      cwd=$fields
      rest=
      ;;
  esac

  case $rest in
    *"$journal_newline"*)
      session_id=${rest%%"$journal_newline"*}
      model=${rest#*"$journal_newline"}
      ;;
    *)
      session_id=$rest
      model=
      ;;
  esac
}

# `name`, or `name/model` when the payload named one. This is what tells a reader
# months later which tool to reopen the session in, so the name is the tool and
# the model records which version of it did the work.
journal_agent() {
  if [ -n "${model:-}" ]; then
    printf '%s/%s' "$1" "$model"
  else
    printf '%s' "$1"
  fi
}

# Prints the instruction on stdin as the JSON both agents read at session start.
journal_emit_context() {
  awk '
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
}
