#!/bin/sh
#
# Copies the shared core into each plugin folder and stages the copies.
#
# Claude Code, Codex and Pi install only the plugin folder, never the rest of the
# repository, so each plugin folder has to carry its own copy of the CLI and the
# templates. The files at the repository root are the ones to edit. The copies
# are generated from them and committed, because an install takes them from git.
#
# `lib/` is not copied. It holds the `install` command, which registers a plugin
# with its agent, so it runs from the CLI checkout and never from a plugin.
#
# The copies come from the index, not from the working tree, so a commit holds
# the copies of exactly the files it commits. A shared file that is changed but
# not staged keeps its old copy until it is staged. The pre-commit hook runs
# this before every commit, and `pnpm sync` runs it by hand.

set -eu

cd "$(git rev-parse --show-toplevel)"

plugins='claude-code codex pi'
shared='bin templates LICENSE'

# Where a shared file goes in a plugin folder. The CLI goes to `scripts/`,
# because Claude Code puts a plugin's `bin/` on the Bash tool's PATH, and
# claude.ai and Cowork refuse to install a plugin that has one.
copy_of() {
  case $1 in
    bin | bin/*) printf 'scripts%s' "${1#bin}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The other way: the root file that a path in a plugin folder is a copy of.
source_of() {
  case $1 in
    scripts | scripts/*) printf 'bin%s' "${1#scripts}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# shellcheck disable=SC2086
git ls-files --stage -- $shared | while read -r mode blob _ path; do
  for plugin in $plugins; do
    copy=$plugin/$(copy_of "$path")
    git update-index --add --cacheinfo "$mode,$blob,$copy"
    git checkout-index --force -- "$copy"
  done
done

# A shared file that was deleted or renamed leaves a copy behind, which would
# still ship. Every staged copy must have a source at the root, and nothing may
# be left in a plugin's `bin/`.
for plugin in $plugins; do
  # shellcheck disable=SC2086
  git ls-files -- $(for item in $shared; do printf '%s/%s ' "$plugin" "$(copy_of "$item")"; done) "$plugin/bin" | while read -r copy; do
    source=$(source_of "${copy#"$plugin"/}")
    case $copy in
      "$plugin"/bin/*) source= ;;
    esac
    [ -n "$source" ] && [ -n "$(git ls-files -- "$source")" ] || git rm --force --quiet -- "$copy"
  done
done
