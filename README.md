<div align='center'>
  <h1>Agent Journal</h1>
  <p align="center">A journal written by your agent. Autonomously.</p>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/session-dark.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/session-light.png" />
    <img src="assets/session-light.png" alt="A session where the agent writes a journal entry on its own" />
  </picture>
</div>

## Why

Your agent sessions do the work, then disappear. A week later you cannot answer simple questions:

- What did we work on last week?
- Where did we fix that bug?
- Why did we do it that way?
- What was that idea again?

Agent Journal makes the model record its work along the way: one small markdown file per milestone, written on its own, in a format that's easy to read and scan. A year later, the answer is one question to your agent, or one `grep`, away.

## Privacy-first

Nothing leaves your machine.

- **No server, no account, no API requests.** The plugin runs locally. It makes no network requests.
- **No hidden tool calls.** Entries are written by the model's own file-writing tool, in your session, in front of you. Nothing runs in the background and nothing runs between sessions.
- **Your own files.** Entries are plain markdown in a directory you choose. Delete one and it is gone.

Everything stays between you and your model.

## How

At the start of a session, the plugin injects [`INSTRUCTIONS.md`](INSTRUCTIONS.md) into the context. It contains the journalling rules and the resolved values for your current project, working directory and session.

The model then records important events in a new markdown file inside `~/agent-journal/`. It does so on its own, without being asked and without interrupting you.

## Format

Each journal entry is a new markdown file. The filename is the current UTC timestamp in `YYYY-MM-DDTHHMMSSZ` format:

```
~/agent-journal/2026-01-11T143000Z.md
```

The file starts with frontmatter metadata, for a quick search across many files. The body contains the actual event:

```markdown
---
date: 2026-01-11T14:30:00Z
project: my-awesome-lib
summary: "Shipped the v1.2 sync path on prepared statements, with rollback when a batch fails. Not deployed, waiting on Monday's validation."
cwd: ~/Developer/my-awesome-lib
session_id: 4eb89b17-6f7f-4264-95d4-ea5313ef277e
---

Replaced the string-interpolated SQL in the sync path with prepare(). Added a rollback so a
failed batch leaves nothing half-written, which is what caused Thursday's partial state.
```

## Install

### Claude Code

Install the plugin:

```
/plugin marketplace add zirkelc/claude-plugins
/plugin install agent-journal@claude-plugins
```

It works on defaults immediately. Nothing else is required.

Without the plugin system, clone the repository and merge this into `"hooks"` in
`~/.claude/settings.json`:

```json
"SessionStart": [
  {
    "matcher": "startup|clear|compact",
    "hooks": [
      { "type": "command", "command": "/path/to/agent-journal/adapters/claude-code/session-start.sh", "timeout": 10 }
    ]
  }
]
```

### Other agents

Not yet. Codex is next, and adding one is a directory with a small script in it:
see [`adapters/README.md`](adapters/README.md).

## Recall

Filenames are UTC timestamps, so a glob is a date range and `ls` is already chronological:

```sh
# the most recent entries
ls ~/agent-journal | tail -20

# one dated line per entry, for a month
grep '^summary:' ~/agent-journal/2026-01-*.md

# every entry for one project
grep -rl '^project: nebula$' ~/agent-journal
```

The agent can recall entries on its own, just ask "What did we work on last week?" to try it.

## Configuration

The default directory for journal entries is `~/agent-journal`. 

The config lives in `~/.config/agent-journal/config` as flat `key=value` pairs:

```
# agent-journal config

# journal_dir=<directory>
journal_dir=~/agent-journal
```

Run `/agent-journal:config` in your agent to change it or update the config manually.

## License

MIT
