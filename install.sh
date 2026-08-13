#!/bin/sh
#
# agent-journal installer.
#
#   curl -fsSL https://raw.githubusercontent.com/zirkelc/agent-journal/main/install.sh | sh
#
# Puts a checkout somewhere stable and links `agent-journal` and `aj` onto PATH.
# Running it again updates in place, so it is also the updater.
#
# It asks nothing and changes nothing else. Where entries go and whether Claude
# Code journals on its own are both one command away, and both are printed at the
# end rather than decided here: an installer that is piped into a shell is the
# worst place to hold a conversation, and the plugin system already owns
# installing plugins.

set -eu

REPO_URL=https://github.com/zirkelc/agent-journal.git
TARBALL_URL=https://codeload.github.com/zirkelc/agent-journal/tar.gz/refs/heads/main

prefix=
source_dir=
journal_dir=

# Spelled out rather than read back out of this file: piped into `sh`, the script
# has no path to read itself from and `$0` is the shell.
usage() {
  cat >&2 <<'EOF'
usage: install.sh [--prefix DIR] [--dir DIR] [--source DIR]

  --prefix DIR   install under DIR instead of ~/.local
  --dir DIR      where journal entries go, instead of the default
  --source DIR   install from a local checkout instead of cloning
EOF
  exit 2
}

while [ $# -gt 0 ]; do
  case $1 in
    --prefix) [ $# -ge 2 ] || usage; prefix=$2; shift 2 ;;
    --prefix=*) prefix=${1#--prefix=}; shift ;;
    --dir) [ $# -ge 2 ] || usage; journal_dir=$2; shift 2 ;;
    --dir=*) journal_dir=${1#--dir=}; shift ;;
    --source) [ $# -ge 2 ] || usage; source_dir=$2; shift 2 ;;
    --source=*) source_dir=${1#--source=}; shift ;;
    -h | --help) usage ;;
    *) usage ;;
  esac
done

# ---------------------------------------------------------------- style

# Colour only for a terminal, and never when NO_COLOR is set, so a log or a pipe
# reads as plain text. Built with printf rather than written as escapes, so no
# assumption is made about which `echo` this shell has.
#
# Under `curl … | sh` it is stdin that is the pipe, not stdout, so this is on in
# exactly the case the installer is usually run in.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  cyan=$(printf '\033[36m')
  # A command is the only thing on screen that has to be typed somewhere else,
  # so it gets a colour of its own rather than bold, which a terminal renders
  # too close to ordinary text to pick out.
  command_style=$(printf '\033[1;33m')
  # 256-colour 173 is the closest terminals get to Claude's orange, and it is
  # used for nothing else here, so the word always means the same product.
  orange=$(printf '\033[38;5;173m')
  dim=$(printf '\033[2m')
  reset=$(printf '\033[0m')
  # The marks are decoration, so a log file gets the sentence alone rather than a
  # glyph nothing coloured. The asterisk is the one Claude Code shows while it
  # is thinking, which is what makes it read as that product rather than a bullet.
  tick=$(printf '\033[32m✔\033[0m ')
  claude_mark=$(printf '\033[38;5;173m✻\033[0m ')
else
  cyan=
  command_style=
  orange=
  dim=
  reset=
  tick=
  claude_mark=
fi

# Two rows rather than the six a full figlet alphabet needs, because an
# installer that is piped into a shell should not open by taking the screen.
# Skipped entirely when nothing is watching.
if [ -t 1 ]; then
  printf '%s\n' \
    "" \
    "${cyan}█▀█ █▀▀ █▀▀ █▄░█ ▀█▀   ░░█ █▀█ █░█ █▀█ █▄░█ █▀█ █░░${reset}" \
    "${cyan}█▀█ █▄█ ██▄ █░▀█ ░█░   █▄█ █▄█ █▄█ █▀▄ █░▀█ █▀█ █▄▄${reset}" \
    ""
fi

# A prefix covers both halves, which is what makes an install into a scratch
# directory a single flag. Without one, the XDG defaults apply.
if [ -n "$prefix" ]; then
  data_dir=$prefix/share/agent-journal
  bin_dir=$prefix/bin
else
  data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/agent-journal
  bin_dir=$HOME/.local/bin
fi

# ---------------------------------------------------------------- fetch

if [ -n "$source_dir" ]; then
  [ -f "$source_dir/bin/agent-journal" ] || {
    echo "no agent-journal checkout at $source_dir" >&2
    exit 1
  }
  mkdir -p "$data_dir"
  # Named rather than copied wholesale, so a developer's node_modules and .git
  # do not become part of an install.
  for item in bin INSTRUCTIONS.md adapters .claude-plugin README.md LICENSE; do
    [ -e "$source_dir/$item" ] || continue
    cp -R "$source_dir/$item" "$data_dir/"
  done
elif command -v git > /dev/null 2>&1; then
  if [ -d "$data_dir/.git" ]; then
    git -C "$data_dir" pull --ff-only -q
  else
    mkdir -p "$(dirname "$data_dir")"
    git clone -q --depth 1 "$REPO_URL" "$data_dir"
  fi
else
  # No git is a normal state on a fresh machine, and a tarball needs nothing that
  # curl-piping this script did not already need.
  mkdir -p "$data_dir"
  curl -fsSL "$TARBALL_URL" | tar xz -C "$data_dir" --strip-components=1
fi

chmod +x "$data_dir/bin/agent-journal"

# ---------------------------------------------------------------- link

mkdir -p "$bin_dir"
ln -sf "$data_dir/bin/agent-journal" "$bin_dir/agent-journal"
ln -sf "$data_dir/bin/agent-journal" "$bin_dir/aj"

# Whatever is already configured, or the default, unless --dir said otherwise. A
# re-install therefore leaves a directory somebody chose alone.
installed=$data_dir/bin/agent-journal
journal_dir=${journal_dir:-$("$installed" config | sed -n 's/^journal_dir=//p')}

# `config set` owns the file format and creates the directory, so the installer
# never has to know either. Handed the default it writes no key at all and only
# makes the directory, which is what keeps the default free to change later.
"$installed" config set journal_dir "$journal_dir"

# ---------------------------------------------------------------- report

# Paths in cyan, commands to run in their own colour, and anything that is only
# there to be read in dim. Three roles, so the eye can find the line it has to
# act on.
echo "${tick}agent-journal is installed at ${cyan}${data_dir}${reset}"
echo "${tick}agent-journal and aj are linked into ${cyan}${bin_dir}${reset}"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    echo
    echo "${cyan}${bin_dir}${reset} is not on your PATH. Add this to your shell profile:"
    echo
    echo "    ${command_style}export PATH=\"${bin_dir}:\$PATH\"${reset}"
    ;;
esac

echo
echo "Entries live in ${cyan}${journal_dir}${reset}"
echo "Change that with: ${command_style}agent-journal config set journal_dir${reset} ${dim}<path>${reset}"

if command -v claude > /dev/null 2>&1; then
  echo
  echo "${claude_mark}${orange}Claude Code${reset} detected"
  echo "  To have Claude journal on its own, install the plugin:"
  echo
  echo "    ${command_style}/plugin marketplace add zirkelc/agent-plugins${reset}"
  echo "    ${command_style}/plugin install agent-journal@zirkelc${reset}"
  echo
  echo "  Or, without the plugin system, merge this into ${cyan}~/.claude/settings.json${reset}:"
  echo
  # The whole file rather than the fragment, because a fragment has to be placed
  # and this can be pasted. Anyone who already has settings merges the one key.
  printf '%s' "$dim"
  cat <<EOF
    {
      "hooks": {
        "SessionStart": [
          {
            "matcher": "startup|clear|compact",
            "hooks": [
              { "type": "command", "command": "$data_dir/adapters/claude-code/session-start.sh", "timeout": 10 }
            ]
          }
        ]
      }
    }
EOF
  printf '%s' "$reset"
fi

echo
echo "Try: ${command_style}aj${reset}"
