#!/bin/sh
#
# Copies the shared core into each plugin folder and stages the copies.
#
# Claude Code, Codex and Pi install only the plugin folder, never the rest of the
# repository, so each plugin folder has to carry its own copy of the CLI and the
# templates. The files in `shared/` are the ones to edit. The copies are
# generated from them and committed, because an install takes them from git.
#
# `shared/lib/` holds the TypeScript that the journal tools of Claude Code and Pi
# share, so only those two plugin folders get it. A Claude Code hooks module may
# import only files inside its plugin folder, and a symlink out of it does not
# count, so these are real copies too.
#
# The copies come from the index, not from the working tree, so a commit holds
# the copies of exactly the files it commits. A shared file that is changed but
# not staged keeps its old copy until it is staged. The pre-commit hook runs
# this before every commit, and `pnpm sync` runs it by hand.

set -eu

cd "$(git rev-parse --show-toplevel)"

plugins='claude-code codex pi'

# The shared items of one plugin folder.
items_of() {
  case $1 in
    claude-code | pi) printf 'shared/bin shared/templates shared/lib LICENSE' ;;
    *) printf 'shared/bin shared/templates LICENSE' ;;
  esac
}

# Where a shared file goes in a plugin folder. The CLI goes to `scripts/`,
# because Claude Code puts a plugin's `bin/` on the Bash tool's PATH, and
# claude.ai and Cowork refuse to install a plugin that has one.
copy_of() {
  case $1 in
    shared/bin | shared/bin/*) printf 'scripts%s' "${1#shared/bin}" ;;
    shared/*) printf '%s' "${1#shared/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The other way: the shared file that a path in a plugin folder is a copy of.
source_of() {
  case $1 in
    scripts | scripts/*) printf 'shared/bin%s' "${1#scripts}" ;;
    templates | templates/* | lib | lib/*) printf 'shared/%s' "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

for plugin in $plugins; do
  # shellcheck disable=SC2046
  git ls-files --stage -- $(items_of "$plugin") | while read -r mode blob _ path; do
    copy=$plugin/$(copy_of "$path")
    git update-index --add --cacheinfo "$mode,$blob,$copy"
    git checkout-index --force -- "$copy"
  done
done

# A shared file that was deleted or renamed leaves a copy behind, which would
# still ship. Every staged copy must have a source that this plugin gets, and
# nothing may be left in a plugin's `bin/`.
for plugin in $plugins; do
  git ls-files -- "$plugin/scripts" "$plugin/templates" "$plugin/lib" "$plugin/LICENSE" "$plugin/bin" | while read -r copy; do
    source=$(source_of "${copy#"$plugin"/}")
    case $copy in
      "$plugin"/bin/*) source= ;;
    esac
    # shellcheck disable=SC2046
    if [ -z "$source" ] || ! git ls-files -- $(items_of "$plugin") | grep -Fqx -- "$source"; then
      git rm --force --quiet -- "$copy"
    fi
  done
done
