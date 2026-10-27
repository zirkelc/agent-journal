# agent-journal

agent-journal is an open source tool by the user: coding agents (Claude Code, Codex, Pi) write a short journal entry after each piece of work, as a Markdown file in a folder, and read the journal when the user asks about past work. A POSIX shell CLI does the work, and a plugin for each agent adds the rules and the hooks. The user works on it alone, with some issues and pull requests from other people.

## Stack

A POSIX sh CLI (bin/agent-journal) with awk for parsing, plugins for Claude Code, Codex and Pi, tests with Vitest that run the CLI, oxlint and oxfmt, GitHub Actions for CI.

## Timeline (days relative to today, negative is the past)

- -220 to -150: the first version. The entry format (front matter with date, project, summary, cwd, host, user, agent, session), the install script, the rules that the agent gets at session start, the list command, the help text, the test fixtures.
- -150 to -80: the Claude Code plugin with its hooks, the sync command that pushes the journal to a git remote, the config command, the journal pane that shows the latest entries, time zones in the list command.
- -80 to -40: the Codex plugin, the Pi extension, recall (search with terms, reading by period), the README rewrite. The user wants animated pictures of the CLI for the README.
- Day -40: the first attempt at README GIFs with asciinema (already written). Between days -40 and -12, entries may talk about the plan for better README pictures, test vhs for other things, or make screenshots, but no GIF is recorded again.
- Day -12: the README GIFs are recorded again with vhs tapes (already written). After this, no entry mentions GIFs, vhs or tapes.
- -12 to -2: bug fixes in the CLI, the help text, a release, an eval of the recall rules.

## Near misses to include

- The README is a frequent topic: its text, its badges, the install section, screenshots.

## Branches

None. Every session runs in the main checkout.
