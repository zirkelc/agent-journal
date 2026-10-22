#!/bin/sh
#
# Copies the shared core into each plugin folder and stages the copies.
#
# Claude Code and Codex install only the plugin folder, never the rest of the
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

plugins='claude-code codex'
shared='bin templates LICENSE'

# shellcheck disable=SC2086
git ls-files --stage -- $shared | while read -r mode blob _ path; do
  for plugin in $plugins; do
    git update-index --add --cacheinfo "$mode,$blob,$plugin/$path"
    git checkout-index --force -- "$plugin/$path"
  done
done

# A shared file that was deleted or renamed leaves a copy behind, which would
# still ship. Every staged copy must have a source at the root.
for plugin in $plugins; do
  # shellcheck disable=SC2086
  git ls-files -- $(for item in $shared; do printf '%s/%s ' "$plugin" "$item"; done) | while read -r copy; do
    source=${copy#"$plugin"/}
    [ -n "$(git ls-files -- "$source")" ] || git rm --force --quiet -- "$copy"
  done
done
