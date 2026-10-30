# Agent Journal for Pi

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zirkelc/agent-journal/main/assets/pi-session-dark.gif" />
  <img src="https://raw.githubusercontent.com/zirkelc/agent-journal/main/assets/pi-session-light.gif" alt="Pi changes a function and writes a journal entry with its write tool. Then a new Pi session finds an older entry with its list and read tools, and answers why an older decision was made" />
</picture>

[Agent Journal](https://github.com/zirkelc/agent-journal) is a journal that your agent writes itself: one small markdown file for each milestone, in a format that is easy to read and to search with `grep`. This package is the extension for [Pi](https://pi.dev). It gives each session the rules for the journal and three tools to read and write it, and syncs the journal with git when you turn sync on.

> **Note:** this page describes only the Pi extension. For the entry format, the configuration, git sync and the CLI, see the [main README](https://github.com/zirkelc/agent-journal#readme).

## Install

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

The model reads and writes the journal with three tools of the extension:

- `agent_journal_list` lists entries by project, date, directory, host, user or agent, searches the summaries and bodies with regex terms, and counts the matches per project, day, host, user or agent.
- `agent_journal_read` returns entries in full: the latest, one or more by ID, or all the entries of a day, a month or a year.
- `agent_journal_write` adds one entry. The model gives only the summary and the body. The tool sets the date, the project, the directory, the host, the user, the agent and the session.

Only a session with a UI (the terminal UI or RPC mode) gets the tools and the rules. A session in print mode (`pi -p`) or JSON mode gets neither, so a subagent that runs as a `pi` process does not write entries.

## Permissions

Pi does not ask for approval before a tool call, so there is no permission step. A permission extension can decide from the tools' annotations: `agent_journal_list` and `agent_journal_read` are read-only, and `agent_journal_write` only adds a file and does not reach the network.

## Rules

The extension adds the rules for the journal to the system prompt of each run. Pi builds the system prompt again for each run, so the rules stay after a compaction, `/new`, `/resume` and `/fork`.

## Git sync

When sync is on (see [Git sync](https://github.com/zirkelc/agent-journal#git-sync) for the setup), the extension runs a sync when the session starts, after each entry that `agent_journal_write` makes, and when the session ends. The sync at the start pulls the entries of your other machines. The sync runs in the background, so the session and the turn do not wait for the network. When a sync fails, the footer shows the reason.

## What the extension runs, reads and sends

- **Programs.** The extension runs one program, its own [`scripts/agent-journal`](https://github.com/zirkelc/agent-journal/blob/main/pi/scripts/agent-journal). This is a readable POSIX shell script, not a compiled program. The extension finds it in its own package and never runs an `agent-journal` from your `PATH`. The script uses standard shell tools (such as `awk`, `grep` and `ls`) and `git`. For git sync, it runs `git add`, `git commit`, `git pull --rebase` and `git push` with your own git setup (your SSH key or your credential helper), and never asks for a password.
- **Reads.** The extension does not read the conversation. It reads the session ID, the working directory and the model ID from Pi. Through the script, it reads `~/.config/agent-journal/config` and the journal folder.
- **Sends.** The extension sends no text from the conversation anywhere. The rules go into your own session's system prompt. Entries leave your machine only through git sync, to the remote that you set. Git sync is off until you turn it on.
- **Hooks.** The extension watches no tool call and changes no tool result.
- **Tools and commands.** The extension registers the three journal tools and no command. A tool gets only the parameters that the model gives it.
