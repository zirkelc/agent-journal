# The `install` command. Sourced by `bin/agent-journal`, and only when that is
# the command, so nothing here is read by the hook that runs at every session
# start.
#
# What it does is wire one agent up to the journal. What that means differs per
# agent and is nobody else's business: each one is a name, a way to tell whether
# it is on this machine, and the commands that register the plugin with it.
#
# Detection never runs an agent. A `command -v` and a directory test are enough
# to tell, and shelling out to four binaries to ask them about themselves would
# put seconds in front of a command whose whole job is to print two lines.

# Every agent that can be wired up, in the order they are offered.
journal_harnesses='claude codex'

journal_harness_label() {
  case $1 in
    claude) printf 'Claude Code' ;;
    codex) printf 'Codex' ;;
    *) printf '%s' "$1" ;;
  esac
}

# True when the agent looks installed. The directory test matters as much as the
# binary: Codex keeps its configuration in `$CODEX_HOME` when that is set, and
# an agent whose launcher is not on this shell's PATH is still installed.
journal_harness_present() {
  case $1 in
    claude)
      command -v claude >/dev/null 2>&1 && return 0
      [ -d "$HOME/.claude" ]
      ;;
    codex)
      command -v codex >/dev/null 2>&1 && return 0
      [ -d "${CODEX_HOME:-$HOME/.codex}" ]
      ;;
    *) return 1 ;;
  esac
}

# The commands that register the plugin, one per line.
#
# Both agents own their own plugin system, so this hands the work to them rather
# than writing into their configuration. Both are built to be scripted: neither
# needs a terminal, and re-running either is a no-op that still exits 0.
journal_harness_steps() {
  case $1 in
    claude)
      printf '%s\n' \
        'claude plugin marketplace add zirkelc/agent-plugins' \
        'claude plugin install -y agent-journal@zirkelc'
      ;;
    codex)
      printf '%s\n' \
        'codex plugin marketplace add zirkelc/agent-journal' \
        'codex plugin add agent-journal@zirkelc'
      ;;
  esac
}

# The same wiring, done by hand. Worth printing next to the command that does it,
# because a person who does not want a script touching their agent should not
# have to go and find the documentation for it.
journal_harness_manual() {
  case $1 in
    claude)
      printf '%s\n' \
        '/plugin marketplace add zirkelc/agent-plugins' \
        '/plugin install agent-journal@zirkelc'
      ;;
    codex)
      journal_harness_steps codex
      ;;
  esac
}

# What is left for the person to do once the plugin is registered.
journal_harness_note() {
  case $1 in
    claude)
      printf '%s\n' 'Start a new session and ask it to write a journal entry.'
      ;;
    codex)
      # Codex will not run a hook it has not been shown. This is the one step
      # an installer must not do on the user's behalf: the review exists so
      # that nothing can quietly arrange to run a command at every session
      # start, and writing the trust record would defeat the thing it guards.
      printf '%s\n' \
        'Codex reviews a hook before it runs it. Start codex, run /hooks,' \
        'and trust agent-journal. Then ask it to write a journal entry.'
      ;;
  esac
}

journal_install_usage() {
  printf 'usage: agent-journal install [%s] [--all] [--dry-run]\n' "$(
    printf '%s' "$journal_harnesses" | tr ' ' '|'
  )" >&2
  exit 2
}

# ---------------------------------------------------------------- output

install_cyan=
install_command_style=
install_dim=
install_reset=
install_colour=0
install_tick=
install_cross=
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  install_cyan=$(printf '\033[36m')
  # A command is the only thing on screen that has to be typed somewhere else,
  # so it gets a colour of its own rather than bold, which a terminal renders
  # too close to ordinary text to pick out.
  install_command_style=$(printf '\033[1;33m')
  install_dim=$(printf '\033[2m')
  install_reset=$(printf '\033[0m')
  install_colour=1
  install_tick=$(printf '\033[32m✔\033[0m ')
  install_cross=$(printf '\033[31m✗\033[0m ')
fi

# The colour each agent is known by, as the numeric part of an SGR escape.
# 256-colour 173 is the closest a terminal gets to Claude Code's orange, and 36
# is close to the teal OpenAI uses.
journal_harness_colour() {
  case $1 in
    claude) printf '38;5;173' ;;
    codex) printf '38;5;36' ;;
    *) printf '36' ;;
  esac
}

# One mark per agent, in that agent's own colour, so the eye finds the block it
# came for rather than reading two headings to tell them apart. Decoration only:
# with no terminal a log file gets the sentence and no glyph nothing coloured.
# The asterisk is the one Claude Code shows while it is thinking.
journal_harness_mark() {
  [ "$install_colour" = 1 ] || return 0
  case $1 in
    claude) printf '\033[%sm✻\033[0m ' "$(journal_harness_colour claude)" ;;
    codex) printf '\033[%sm◆\033[0m ' "$(journal_harness_colour codex)" ;;
  esac
}

# The agent's name, bold and in its own colour, which is the line a reader is
# looking for when several agents are listed at once.
journal_harness_heading() {
  if [ "$install_colour" = 1 ]; then
    printf '\033[1;%sm%s\033[0m' "$(journal_harness_colour "$1")" "$(journal_harness_label "$1")"
  else
    journal_harness_label "$1"
  fi
}

# The same two rows the shell installer opens with. Printed by every form of this
# command, so `agent-journal install codex` looks like part of the same thing as
# the installer that suggested it.
#
# `install.sh` has already printed it by the time it calls this, and sets
# AGENT_JOURNAL_HEADER=0 so it is not printed twice in the one run.
journal_install_header() {
  if [ "${AGENT_JOURNAL_HEADER:-1}" != 0 ]; then
    printf '%s\n' \
      "" \
      "${install_cyan}█▀█ █▀▀ █▀▀ █▄░█ ▀█▀   ░░█ █▀█ █░█ █▀█ █▄░█ █▀█ █░░${install_reset}" \
      "${install_cyan}█▀█ █▄█ ██▄ █░▀█ ░█░   █▄█ █▄█ █▄█ █▀▄ █░▀█ █▀█ █▄▄${install_reset}" \
      ""
  fi
}

# What is on this machine and what to type for it. `install.sh` prints this by
# running it, rather than carrying its own copy, so the two can never drift.
journal_install_report() {
  found=0
  for harness in $journal_harnesses; do
    journal_harness_present "$harness" || continue
    [ "$found" = 0 ] || printf '\n'
    found=$((found + 1))

    printf '%s%s detected\n\n' "$(journal_harness_mark "$harness")" "$(journal_harness_heading "$harness")"
    printf '  %s%s%s\n\n' "$install_command_style" "agent-journal install $harness" "$install_reset"

    printf '  %sOr by hand:%s\n' "$install_dim" "$install_reset"
    journal_harness_manual "$harness" | while IFS= read -r step; do
      printf '    %s%s%s\n' "$install_command_style" "$step" "$install_reset"
    done
    printf '\n'

    journal_harness_note "$harness" | while IFS= read -r line; do
      printf '  %s%s%s\n' "$install_dim" "$line" "$install_reset"
    done

    # Only Claude Code stops to ask before writing a file, so only Claude Code
    # needs to be told that this directory is allowed. It is worth having
    # whichever way the plugin was installed, so it sits outside the steps.
    if [ "$harness" = claude ]; then
      # It has to be Edit(): a Write() path rule is accepted, warned about at
      # startup and never consulted, since Edit covers every file-editing tool.
      # A single leading slash would anchor at the settings file rather than at
      # the filesystem root, hence ~ or //.
      case $journal_dir in
        "$HOME"/*) allow_rule="Edit(~/${journal_dir#"$HOME"/}/**)" ;;
        *) allow_rule="Edit(//${journal_dir#/}/**)" ;;
      esac
      printf '\n'
      printf '  %sTo stop it asking before each entry, add to %s:%s\n' \
        "$install_dim" "$HOME/.claude/settings.json" "$install_reset"
      printf '    %s{ "permissions": { "allow": ["%s"] } }%s\n' \
        "$install_dim" "$allow_rule" "$install_reset"
    fi
  done

  if [ "$found" = 0 ]; then
    printf 'No agent detected. agent-journal knows how to wire up: %s\n' "$journal_harnesses"
    printf 'The journal works without one. Write an entry yourself with: %s\n' 'agent-journal write'
  fi
}

# ---------------------------------------------------------------- run

# How long one spinner frame stays on screen. POSIX `sleep` only promises whole
# seconds, and a one second frame is not a spinner, so this asks once whether
# this machine's `sleep` takes a fraction and remembers the answer.
journal_frame_delay() {
  if [ -z "${journal_delay:-}" ]; then
    if sleep 0.08 2>/dev/null; then journal_delay=0.08; else journal_delay=1; fi
  fi
  printf '%s' "$journal_delay"
}

# Runs one step, with the command on a line of its own and whatever it printed
# indented underneath.
#
# The output is shown rather than swallowed because these are somebody else's
# commands running under this one's name. Watching `codex plugin marketplace add`
# report what it added is what separates a command that is working from one that
# has hung.
#
# While it runs, the mark in front of the command is a spinner. That means the
# output cannot also be streaming, since anything printed would push the spinner
# up the screen, so it is collected and shown once the command returns. These
# commands are short enough that the wait is the part worth animating.
journal_run_step() {
  step=$1

  log_file=$(mktemp "${TMPDIR:-/tmp}/agent-journal-step-XXXXXX") || return 1
  done_file=$(mktemp "${TMPDIR:-/tmp}/agent-journal-done-XXXXXX") || return 1

  if [ "$install_colour" = 0 ]; then
    # Nothing is watching, so there is nothing to animate. The line is printed
    # once, before the command runs, so a log reads in the order things happened.
    printf '  %s\n' "$step"
    # The step is one of the fixed strings above, never anything a caller
    # supplied, so there is nothing here for a shell to be tricked by.
    sh -c "$step" > "$log_file" 2>&1
    step_status=$?
  else
    { sh -c "$step" > "$log_file" 2>&1; printf '%s' "$?" > "$done_file"; } &
    step_pid=$!

    # Waiting on the file rather than on the process: a child that has exited but
    # has not been waited for is still a process, so `kill -0` would keep
    # answering yes and the spinner would never stop.
    set -- ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
    while [ ! -s "$done_file" ]; do
      printf '\r  %s%s%s %s%s%s' "$install_cyan" "$1" "$install_reset" \
        "$install_command_style" "$step" "$install_reset"
      frame=$1
      shift
      set -- "$@" "$frame"
      sleep "$(journal_frame_delay)"
    done

    wait "$step_pid" 2>/dev/null
    step_status=$(cat "$done_file")
    [ -n "$step_status" ] || step_status=1
  fi

  rm -f "$done_file"

  # Over the top of the spinner, so the finished line reads as the same line.
  if [ "$install_colour" = 1 ]; then
    if [ "$step_status" = 0 ]; then
      printf '\r  %s%s%s%s\n' "$install_tick" "$install_command_style" "$step" "$install_reset"
    else
      printf '\r  %s%s%s%s\n' "$install_cross" "$install_command_style" "$step" "$install_reset"
    fi
  fi

  while IFS= read -r line; do
    printf '    %s%s%s\n' "$install_dim" "$line" "$install_reset"
  done < "$log_file"
  rm -f "$log_file"

  [ "$step_status" = 0 ] || {
    printf '  %sexit %s%s\n' "$install_dim" "$step_status" "$install_reset"
    return 1
  }
  return 0
}

# Runs one agent's steps in order.
#
# A failure stops everything, rather than carrying on to the next step or the
# next agent. A plugin CLI that has changed its flags needs to be noticed,
# because otherwise the install reports success while having wired up nothing,
# and that only shows up later as a journal that stays empty.
journal_install_run() {
  harness=$1

  if [ "$dry_run" = 1 ]; then
    printf '%sWould install the %s plugin\n\n' "$(journal_harness_mark "$harness")" "$(journal_harness_heading "$harness")"
  else
    printf '%sInstalling %s plugin...\n\n' "$(journal_harness_mark "$harness")" "$(journal_harness_heading "$harness")"
  fi

  # Fed by redirect rather than by a pipe, so the loop runs in this shell and a
  # failed step can stop the whole command instead of only its own subshell.
  while IFS= read -r step; do
    [ -n "$step" ] || continue

    if [ "$dry_run" = 1 ]; then
      printf '  %s%s%s\n' "$install_command_style" "$step" "$install_reset"
      continue
    fi

    journal_run_step "$step" || {
      # Named after the same thing the success line is named after, so the two
      # endings read as a pair, and carrying the command so it can be rerun.
      printf '\n%sFailed to install plugin: %s\n' "$install_cross" "$step" >&2
      return 1
    }
  done <<EOF
$(journal_harness_steps "$harness")
EOF

  printf '\n'
  if [ "$dry_run" = 1 ]; then
    printf '%s--dry-run, so nothing was run.%s\n' "$install_dim" "$install_reset"
    return 0
  fi

  printf '%s%s plugin installed!\n\n' "$install_tick" "$(journal_harness_heading "$harness")"

  journal_harness_note "$harness" | while IFS= read -r line; do
    printf '%s\n' "$line"
  done
}

# ---------------------------------------------------------------- dispatch

journal_install_header

# No argument is the question "what have I got", which is the one a person
# arrives with. Naming an agent, or --all, is the instruction to go and do it.
if [ "$argc" -eq 0 ] && [ "$all_set" = 0 ]; then
  journal_install_report
  exit 0
fi

if [ "$all_set" = 1 ]; then
  [ "$argc" -eq 0 ] || journal_install_usage

  ran=0
  for harness in $journal_harnesses; do
    journal_harness_present "$harness" || continue
    [ "$ran" = 0 ] || printf '\n'
    journal_install_run "$harness" || exit 1
    ran=$((ran + 1))
  done

  if [ "$ran" = 0 ]; then
    printf 'no agent detected to install into\n' >&2
    exit 1
  fi
  exit 0
fi

[ "$argc" -eq 1 ] || journal_install_usage

target=$arg1
case " $journal_harnesses " in
  *" $target "*) ;;
  *)
    printf '%s: not an agent this knows. Try: %s\n' "$target" "$journal_harnesses" >&2
    exit 2
    ;;
esac

# Named explicitly, so an agent this cannot see is still worth a word: the
# person may be installing it in the order they prefer.
journal_harness_present "$target" || {
  printf '%s does not look installed on this machine.\n' "$(journal_harness_label "$target")" >&2
  exit 1
}

journal_install_run "$target" || exit 1
exit 0
