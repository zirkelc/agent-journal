<div align='center'>
  <h1>Agent Journal</h1>
  <p align="center">A journal written by your agent. Autonomously.</p>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/session-dark.gif" />
    <img src="assets/session-light.gif" alt="Claude Code changes a function and writes a journal entry on its own. In the shell, ls, grep and cat show the entry as a plain markdown file. A new Claude session then answers why an older decision was made, from the journal" />
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

- **No server, no account, no API requests.** The plugin runs locally and makes no network requests of its own.
- **No hidden tool calls.** Entries are written by the model's own file-writing tool, in your session, in front of you.
- **A read-only hook.** At session start, a hook reads the config and resolves the dynamic values (project, agent, session, etc.).
- **Your own files.** Entries are plain markdown in a directory you choose. Delete one and it is gone.

Everything stays between you and your model.

## How

At the start of a session, the plugin injects [`INSTRUCTIONS.md`](templates/INSTRUCTIONS.md) into the context. It contains the journalling rules and the resolved values for your current project, working directory, agent and session.

The model then records each important event in a new markdown file. It does this without being asked and without interrupting you.

## Format

Each journal entry is a new markdown file. The filename is the current UTC timestamp in `YYYY-MM-DDTHHMMSSZ` format:

```
~/agent-journal/2026-10-07T142000Z.md
```

The file starts with frontmatter, so a search across many files can match single fields. The body describes what happened:

<!-- prettier-ignore -->
```markdown
---
date: 2026-10-07T14:20:00Z
project: acme-dashboard
summary: "Export timed out because the CSV was built on the main thread. Moved it to a worker."
cwd: ~/Developer/acme-dashboard
host: "macbook"
user: "chris"
agent: "claude/opus-5-5"
session_id: 743d02a3-22f3-4016-b13e-dd448ad58daf
---

Exports of 50,000 rows now finish in 1.2 s instead of timing out after 10 s.

Considered building the CSV on the server instead. Rejected for now: the filters run in the browser, so the server would need a second copy of the filter code.
```

## Recall

Filenames are UTC timestamps, so a glob is a range of UTC dates and `ls` is already chronological:

```sh
# the most recent entries
ls ~/agent-journal | tail -5

# how many entries this year
ls ~/agent-journal/2026-*.md | wc -l

# one dated line per entry, for a day or a month
grep -h '^summary:' ~/agent-journal/2026-10-*.md

# every entry for one project
grep -rl '^project: acme-dashboard$' ~/agent-journal

# anywhere in an entry, body included
grep -rli 'filter code' ~/agent-journal | tail -3

# one entry in full
cat ~/agent-journal/2026-10-07T142000Z.md
```

The agent can also recall entries on its own. To try it, ask "What was that CSV export bug again?".

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/recall-dark.gif" />
  <img src="assets/recall-light.gif" alt="Claude Code is asked about a CSV export bug in another project, searches the journal, and answers from the entry with the bug, the fix, the option that was turned down, and the session to resume" />
</picture>

## Install

### Shell

Run this command:

```sh
curl -fsSL https://raw.githubusercontent.com/zirkelc/agent-journal/main/install.sh | sh
```

It finds the agents installed on this machine and prints the steps for each one. It also symlinks the `agent-journal` CLI into `~/.local/bin`. If that directory is not on your `$PATH`, it prints the line to add to your shell profile.

### Claude

The plugin needs Claude Code 2.1.287 or later, because it is a [mod](https://code.claude.com/docs/en/plugins/mods/overview), a hooks module that Claude Code loads itself. Install the plugin:

```
/plugin marketplace add zirkelc/agent-plugins
/plugin install agent-journal@zirkelc
```

Then open a new session and ask Claude to write a journal entry. By default, it writes to the directory `~/agent-journal/`.

#### Update

Get the latest marketplace catalog, then update the plugin:

```sh
claude plugin marketplace update zirkelc
claude plugin update agent-journal@zirkelc
```

Then restart Claude Code or run `/reload-plugins` to load the new version.

#### Permissions

Depending on your permission mode, Claude asks for permission to write a journal entry. To allow all journal entries, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Edit(~/agent-journal/**)"]
  }
}
```

If you changed `journal_dir`, use that directory in the rule.

For the journal pane, how the hooks give the rules to the session, and what the plugin runs, reads and sends, see the [Claude Code plugin README](claude-code/README.md).

### Codex

Install the plugin:

```
codex plugin marketplace add zirkelc/agent-journal
codex plugin add agent-journal@zirkelc
```

Codex reviews a hook before it runs it, so one step is left. Start Codex, run `/hooks`, and trust `agent-journal`. Until you do, Codex skips the hook and shows no message.

Then open a new session and ask Codex to write a journal entry. By default, it writes to the directory `~/agent-journal/`.

#### Permissions

Codex grants write access by path rather than by tool, so the journal directory has to be a writable root. Add to `~/.codex/config.toml`:

```toml
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
writable_roots = ["/Users/you/agent-journal"]
```

Use the full path rather than `~`. `writable_roots` only applies in `workspace-write` mode; in `read-only` every entry stops to ask, and in `danger-full-access` nothing is restricted and this is unnecessary.

## CLI

> [!NOTE]
> You need to run the [shell installation](#shell) to make the CLI available.

The CLI is optional. You need it only to work with the journal from your shell. It is installed as `agent-journal` and as the short name `aj`, and it is a thin layer over `ls`, `grep` and `cat`.

| command                                | description                                                      |
| -------------------------------------- | ---------------------------------------------------------------- |
| [`aj list`](docs/cli.md#aj-list)       | list entries, search or count them                               |
| [`aj read`](docs/cli.md#aj-read)       | print entries in full, by ID or by period                        |
| [`aj write`](docs/cli.md#aj-write)     | add an entry yourself                                            |
| [`aj config`](docs/cli.md#aj-config)   | read and change the settings                                     |
| [`aj sync`](docs/cli.md#aj-sync)       | commit the journal folder and push it, see [Git sync](#git-sync) |
| [`aj install`](docs/cli.md#aj-install) | find the agents on this machine and wire each one up             |
| `aj help`                              | the usage help                                                   |

The [CLI reference](docs/cli.md) has every option, with examples and the same command without the CLI.

## Configuration

The config lives in `~/.config/agent-journal/config` and you can edit the file directly:

```
# agent-journal config

# journal_dir=<directory>
journal_dir=~/agent-journal

# sync=git
sync=git

# host=<machine name>, or empty to record none
host=macbook

# user=<account name>, or empty to record none
user=chris
```

If you have the [CLI](#cli) installed, you can change the config with `agent-journal config set <key> <value>`:

- `journal_dir`: the directory for journal entries. Default: `~/agent-journal`.
- `sync`: set it to `git` to commit and push the journal folder after each write, see [Git sync](#git-sync). Default: off.
- `host`: the machine name each entry records. If not set, the local host name on macOS, else the host name without its domain. If set to empty (`host=`), entries record no host.
- `user`: the account name each entry records. If not set, the login name. If set to empty (`user=`), entries record no user.

> [!TIP]
> With git sync, one journal can hold entries from several machines. `host` and `user` tell you where an entry was written, and so where you can resume its session. Set a stable name if the system's name changes or tells more than you want to share, for example `aj config set host macbook`. `aj config unset host` gives the system's name back.

## Git sync

agent-journal can keep the journal in a git repository. It commits each new entry, and it pushes when the branch has a remote. Sync is off by default. To turn it on:

```sh
aj sync init                                  # commit only, on this machine
aj sync init git@github.com:you/journal.git   # commit and push
```

`aj sync init` makes the journal folder a git repository if it is not one yet, adds the URL as `origin`, sets `sync=git`, and makes the first commit. If the folder is already a repository, it uses it. The journal folder must be the root of its own repository. `aj sync init` refuses a folder inside a larger repository (for example your notes or your dotfiles), because a push sends the whole branch, with your other commits too. To turn sync off, run `aj config unset sync`.

To make a new private repository on GitHub for the journal, use the [GitHub CLI](https://cli.github.com) after `aj sync init`. It adds the repository as `origin` and pushes the first commit, and every later sync pushes to it:

```sh
aj sync init
gh repo create agent-journal --private --source ~/agent-journal --remote origin --push
```

Use your own journal folder in `--source` if you changed `journal_dir`.

When sync is on, `aj sync` runs:

- in Claude Code, after each entry and when the session ends ([more](claude-code/README.md#git-sync)).
- after `aj write`.
- when you run `aj sync` yourself, for example for entries that Codex wrote.

Each sync commits every file in the journal folder. The commit names a single new entry by its ID and summary. Then it pushes the current branch. If the remote has commits that this machine does not have (another machine pushed first, or you created the repository with a README), it rebases onto them and pushes again; entries have unique file names, so this does not conflict. If the push fails (no network, no credentials), the commit stays, and the next sync pushes it. A sync commits nothing on a detached HEAD or while a merge, rebase or bisect is open.

A sync never waits for input: git does not prompt for a password, ssh runs in batch mode (also with your own `core.sshCommand`), and the journal's commits are not signed, so no passphrase dialog opens.

> [!WARNING]
> A push sends your entries to the remote. Entries describe your work, so use a private repository.

## Credits

The idea for an agent journal comes from [Malaiac's Claude Diary](https://github.com/Malaiac/claude/tree/main/templates/diary).

## License

MIT
