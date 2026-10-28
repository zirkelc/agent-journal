# agent-journal

A journal that the agent writes itself, with one adapter for each agent harness (`claude-code/`, `codex/`, `pi/`). The README describes what it does.

## Checks

After each change, run `pnpm test`, `pnpm lint` and `pnpm format:check`. Run `pnpm test:integration` too when a change touches how an adapter starts the CLI.

## Test in a live session

The tests do not show what a model does with the rules and the tools. After a change to the CLI, the templates or an adapter, test it in a live session of the harness that the change is for.

1. Update the plugin folders. The shared files are in `shared/`: the CLI in `shared/bin/`, the templates in `shared/templates/`, and the TypeScript of the journal tools in `shared/lib/`. Each adapter carries its own copy of the CLI (as `scripts/`) and the templates, and Claude Code and Pi also of `lib/`. `pnpm sync` makes the copies from the staged files, not from the working tree. So stage the changed shared files first, then run `pnpm sync`.

2. Use a temporary journal. The real journal can sync with git, and a test entry must not get there. Make a temporary config folder whose `agent-journal/config` has only `journal_dir=<a temporary folder>`, and start the harness with `XDG_CONFIG_HOME` set to that config folder. Without a `sync` key, the test journal does not sync. This also hides the other configs in `~/.config` (for example `git/` and `gh/`) from that session. Give the temporary folders a short, plain path (for example from `mktemp -d`). A model can copy a long path wrong, for example a path with `-Users-name-Developer-` in it, and then the test shows that error instead of the change.

3. Open a new terminal that runs the harness with the adapter loaded from the folder you work in, so that it uses the files as they are there, also changes that are not committed:

   | Harness     | Command                                                                        |
   | ----------- | ------------------------------------------------------------------------------ |
   | Claude Code | `claude --plugin-dir <this folder>/claude-code`                                |
   | Pi          | `pnpm exec pi --no-extensions -e <this folder>/pi/extensions/agent-journal.ts` |
   | Codex       | no option loads a plugin from a folder: see below                              |
   - For another harness, find its option that loads a plugin or an extension from a local folder.
   - Make sure that an installed version of the same adapter does not load too. In Pi, `--no-extensions` stops it. In Claude Code, the list of plugins at the start of the session (`/plugin`) shows each one with its path.
   - Pi gives the rules and the tools only to a session with a UI. Use the interactive `pi`, never `pi -p`, because a print or JSON session counts as a subagent and gets neither. To test the rules for files instead of the tools, start it with `AGENT_JOURNAL_TOOLS=off`.
   - Codex installs a copy from a marketplace. Set `CODEX_HOME` to a temporary folder with a link to `~/.codex/auth.json`, so the real Codex config gets no test marketplace. Then `codex plugin marketplace add <this folder>` adds this checkout as one (its `.agents/plugins/marketplace.json`), and `codex plugin add agent-journal@zirkelc` installs from it. After each change, install it again.

4. Tell the user that the terminal is open, what to do in it, and what to look at, for example the new files in the temporary journal.

To check a change without the user, run the harness without a UI and read what it wrote to the temporary journal:

- Claude Code: `claude -p` with `--add-dir <the temporary journal>`, because the journal is outside the working folder and a session without a UI cannot ask for the write. `--add-dir` takes several folders, so give the prompt on stdin.
- Pi: `--mode rpc`, which counts as a session with a UI. `eval/pi/run.ts` shows how to send a prompt and wait for its end.
- Codex: `codex exec` with `--add-dir <the temporary journal>`.

## Release

Never raise a version by hand. Release Please keeps a release PR open on `main`, which raises the version in `package.json` and in each plugin manifest from the conventional commits since the last release. Merging that PR releases the Claude Code and Codex plugins (they install from `main`) and publishes the Pi package to npm (`.github/workflows/release.yml`). A new manifest must go into `extra-files` in `release-please-config.json`; a test checks that.
