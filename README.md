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

Working with agents is fast-paced: you work on multiple projects in parallel, make decisions on every turn, generate ideas and build new things.
Your agents do the work, then disappear. A week later you cannot answer simple questions:

- What did we do last week?
- Why did we build it this way?
- What did we try that did not work?

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
summary: "Shipped the v1.2 sync path on prepared statements, with rollback when a batch fails."
cwd: ~/Developer/my-awesome-lib
agent: claude/opus-5
session_id: 4eb89b17-6f7f-4264-95d4-ea5313ef277e
---

Replaced the string-interpolated SQL in the sync path with prepare(). Added a rollback so a
failed batch leaves nothing half-written, which is what caused Thursday's partial state.
```

## Recall

Filenames are UTC timestamps, so a glob is a date range and `ls` is already chronological:

```sh
# the most recent entries
ls ~/agent-journal | tail -5

# how many entries this year
ls ~/agent-journal/2026-*.md | wc -l

# one dated line per entry, for a day or a month
grep -h '^summary:' ~/agent-journal/2026-01-11*.md

# every entry for one project
grep -rl '^project: foo$' ~/agent-journal

# anywhere in an entry, body included
grep -rl 'rate limit' ~/agent-journal | tail -3

# one entry in full
cat ~/agent-journal/2026-01-11T143000Z.md
```

The agent can recall entries on its own, just ask "What did we work on last week?" to try it.

## Install

### Shell

Run this command:

```sh
curl -fsSL https://raw.githubusercontent.com/zirkelc/agent-journal/main/install.sh | sh
```

It will detect your installed agents and provide specific instructions. It also symlinks the `agent-journal` CLI into `~/.local/bin`. If that directory is not on your `$PATH`, it prints the line to add to your shell profile.

### Claude 

Install the plugin:

```
/plugin marketplace add zirkelc/agent-plugins
/plugin install agent-journal@zirkelc
```

Then open a new session and ask Claude to write a journal entry.
By default, it will write to the directory `~/agent-journal/`.

#### Permissions

Depending on your permission mode, Claude will ask for permission to write a journal entry. To allow journal entries in general, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Edit(~/agent-journal/**)"]
  }
}
```

### Codex

Install the plugin:

```
codex plugin marketplace add zirkelc/agent-journal
codex plugin add agent-journal@zirkelc
```

Codex reviews a hook before it runs it, so one step is left. Start Codex, run `/hooks`, and trust `agent-journal`. Until you do, the hook is skipped without a word.

Then open a new session and ask Codex to write a journal entry.
By default, it will write to the directory `~/agent-journal/`.

#### Permissions

Codex grants write access by path rather than by tool, so the journal directory has to be a writable root. Add to `~/.codex/config.toml`:

```toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
writable_roots = ["/Users/you/agent-journal"]
```

Use the full path rather than `~`. `writable_roots` only applies in `workspace-write` mode; in `read-only` every entry stops to ask, and in `danger-full-access` nothing is restricted and this is unnecessary.

### CLI

> [!NOTE] 
> You need to run the [shell installation](#shell) to make the CLI available.

The CLI is optional and only required if you want to interact with `agent-journal` manually from your shell. 
It provides a thin interface over `ls` and `grep` for common commands:

| command | same as | description |
| --- | --- | --- |
| `aj list` | `ls ~/agent-journal \| tail -20` | the most recent entries, one line each |
| `aj search TEXT` | `grep -rli 'rate limit' ~/agent-journal` | summaries and bodies, ignoring case |
| `aj read ID` | `cat "$(ls ~/agent-journal/*.md \| tail -1)"` | one entry in full |
| `aj write` | `$EDITOR ~/agent-journal/$(date -u +%Y-%m-%dT%H%M%SZ).md` | add an entry yourself |
| `aj config` | `cat ~/.config/agent-journal/config` | read and change the settings |
| `aj install` | | which agents are on this machine, and how to wire each one up |
| `aj context` | | the instruction an adapter injects at session start |
| `aj help` | | every command and option |

`list` is the default command if not given, so `aj` and `aj list` are the same. 

Entries are listed oldest first, so the newest is nearest the prompt.

`list` and `search` take the same filters:

| filter | value | description |
| --- | --- | --- |
| `--date` | `2026`, `2026-01`, `2026-01-11`, `2026-01-11T143000Z` | a prefix of the timestamp, at any granularity |
| `--since` | `2026-01-11`, `today`, `7d` | from this day on |
| `--until` | same forms | up to this day |
| `--project` | a project name | entries filed under one project, across all its worktrees |
| `--cwd` | a directory, or `.` for here | one directory and everything under it |
| `--limit` | a number, default `20` | how many of the most recent to print |
| `--all` | | no limit |

`aj install` with no agent named lists the ones found on this machine, with the command to wire up each. Naming one (`aj install codex`) runs that agent's own plugin commands for you. It writes nothing into any agent's configuration.

Run `aj help` for the usage help.

## Configuration

The config lives in `~/.config/agent-journal/config` and you can edit the file directly:

```
# agent-journal config

# journal_dir=<directory>
journal_dir=~/agent-journal
```

If you have the [`agent-journal`](#cli) installed, you can change the config through `agent-journal config set <key> <value>`:

| key | default | description |
| --- | --- | --- |
| `journal_dir` | `~/agent-journal` | default directory for journal entries |

## Credits

The idea for an agent journal is inspired by [Malaiac's Claude Diary](https://github.com/Malaiac/claude/tree/main/templates/diary).

## License

MIT
