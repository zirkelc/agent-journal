# Agent Journal for Pi

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zirkelc/agent-journal/main/assets/pi-session-dark.gif" />
  <img src="https://raw.githubusercontent.com/zirkelc/agent-journal/main/assets/pi-session-light.gif" alt="Pi changes a function and writes a journal entry with its journal_write tool. Then a new Pi session finds an older entry with journal_list and journal_read, and answers why an older decision was made" />
</picture>

[Agent Journal](https://github.com/zirkelc/agent-journal) is a journal that your agent writes itself: one small markdown file for each milestone, written while the work happens, in a format that is easy to read and to search with `grep`. This package is the extension for [Pi](https://pi.dev). It gives each session three tools that write and read the journal, and the rules for using them. It syncs the journal with git when you turn sync on.

> **More information:** this page describes only the Pi extension. For the entry format, the configuration, git sync and the CLI, see the [main README](https://github.com/zirkelc/agent-journal#readme).

## Install

Install the package from npm:

```sh
pi install npm:pi-agent-journal
```

Then open a new session and ask Pi to write a journal entry. By default, it writes to the directory `~/agent-journal/`. To use a different directory, see [Configuration](https://github.com/zirkelc/agent-journal#configuration).

## Update

```sh
pi update npm:pi-agent-journal
```

Then restart Pi or run `/reload` to load the new version.

## Tools

| Tool            | What it does                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `journal_write` | Writes one new entry from a `summary` and a `body`, and answers with the entry's ID.                                                                                           |
| `journal_list`  | Lists entries, one line each with ID, project and summary. With `terms`, it searches the summaries and bodies, and adds the body line that matched. With `by`, it counts them. |
| `journal_read`  | Gives entries in full: the latest, one or more by ID, or every entry of a day, a month or a year.                                                                              |

The model gives only the summary and the body. `journal_write` sets the other fields itself: the date from the clock, the project and the directory from the session's working directory, the host, the user, the agent with its model (for example `pi/claude-opus-5-5`) and the session ID.

`journal_list` takes the same filters as [`aj list`](https://github.com/zirkelc/agent-journal/blob/main/docs/cli.md#aj-list): `date`, `since`, `until`, `project`, `limit` and `offset`. Each search term is an extended regex that ignores case, and an entry must match every term. `fixed` reads the terms as plain text. The tool gives 50 entries when the model does not set `limit`, and 200 at most. When the limit leaves older matches out, the last line says which `offset` gives them. With `by` (`project`, `date`, `host`, `user` or `agent`), it lists no entries but counts every match for each value of that field, with a total, as `aj list --by` does. It then takes no `limit` or `offset`.

`journal_read` takes `latest`, IDs, or one period (`today`, `yesterday`, `2026`, `2026-10` or `2026-10-22`), as [`aj read`](https://github.com/zirkelc/agent-journal/blob/main/docs/cli.md#aj-read) does. For a period, it also takes `project`, `limit` and `offset`, and the last line names the `offset` that gives the older entries. A tool result holds at most 40,000 characters. When the entries of a period are longer, `journal_read` gives their summaries instead, and the model reads the ones it needs by ID.

A result longer than 40,000 characters is cut, with a note that tells the model to narrow the filters.

## Permissions

Pi does not ask for approval before a tool call, so the tools run without a prompt. If you use a permission extension, it can decide from the tools' annotations: the three read tools are read-only, and `journal_write` is not read-only, not destructive (it only adds a file) and does not reach the network.

## Rules

The extension adds the rules for the tools to the system prompt of each run, as a section named `agent_journal`. On a Pi version before 1.0, which has no sections, it adds them to the end of the system prompt. Pi builds the system prompt again for each run, so the rules stay after a compaction, `/new`, `/resume` and `/fork`.

Only a session with a UI gets the rules and the tools: the terminal UI and RPC mode. A session in print mode (`pi -p`) or JSON mode gets neither. This prevents a subagent that runs as a `pi` process from writing entries, because only the main conversation writes entries.

The tools read the config each time they run, so a new `journal_dir` takes effect at the next tool call. The extension reads the `sync` setting once a session, so a change to it takes effect in the next session.

## Git sync

When sync is on (see [Git sync](https://github.com/zirkelc/agent-journal#git-sync) for the setup), the extension runs a sync when the session starts and after each entry that `journal_write` makes. The sync at the start pulls the entries of your other machines. These syncs run in the background, so the session and the turn do not wait for the network. A session without a UI, for example a subagent in print mode, does not sync at the start.

When the session ends, the extension runs one more sync, also for entries that were written another way, for example with `bash`. The exit waits for this sync for at most 5 seconds. A push that it stops is made by the next sync.

When a sync fails, the footer shows `journal sync failed:` and the reason. The next sync that does not fail removes it.

## What the extension runs, reads and sends

- **Programs:** The extension runs one program, its own [`scripts/agent-journal`](https://github.com/zirkelc/agent-journal/blob/main/pi/scripts/agent-journal). This is a readable POSIX shell script, not a compiled program. The extension finds it in its own package and never runs an `agent-journal` from your `PATH`. The extension runs the script with one of these subcommands:
  - `context` makes the journal rules for the session.
  - `config` reads the settings.
  - `write`, `list` and `read` do the work of the three tools.
  - `sync` runs git sync: `git add`, `git commit`, `git pull --rebase` and `git push`. A push to an SSH remote makes git start `ssh` in batch mode, so it never asks for a password. Git uses your own git setup to reach the remote (your SSH key or your credential helper). The extension itself reads no credential and sends none anywhere.

  The script uses standard shell tools (such as `awk`, `grep` and `ls`) and `git`. It runs `git rev-parse` to find the project of a directory.

- **Reads:** The extension does not read the conversation. It reads the session ID, the working directory and the model ID from Pi. Through the script, it reads `~/.config/agent-journal/config` and the journal folder.
- **Sends:** The extension sends no text from the conversation anywhere. The rules go into your own session's system prompt. Entries leave your machine only through git sync, to the remote that you set. Git sync is off until you turn it on.
- **Hooks:** The extension watches no tool call and changes no tool result.
- **Tools and commands:** The extension registers the three journal tools, or none when they are turned off, and no command. A tool gets only the parameters that the model gives it.
