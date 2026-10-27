# CLI reference

The CLI is installed as `agent-journal` and as the short name `aj` by the [shell installation](../README.md#shell). The journal is only a folder of Markdown files, so in each example the comment line under the description shows how to get the same result with `ls`, `grep`, `cat` or `git`.

| command                     | description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| [`aj list`](#aj-list)       | list entries, search or count them                                           |
| [`aj read`](#aj-read)       | print entries in full, by ID or by period                                    |
| [`aj write`](#aj-write)     | add an entry yourself                                                        |
| [`aj config`](#aj-config)   | read and change the settings                                                 |
| [`aj sync`](#aj-sync)       | commit the journal folder and push it, see [Git sync](../README.md#git-sync) |
| [`aj install`](#aj-install) | find the agents on this machine and wire each one up                         |
| `aj help`                   | the usage help                                                               |

The commands exit with `0` on success, `1` when nothing matches the ID or the period that `read` was given, and `2` for a usage error. `list` with no match exits with `0` and prints nothing.

## `aj list`

```
aj list [TERM...] [--fixed] [--by FIELD] [filters]
```

Lists the entries that match the [filters](#filters), one line each. `list` is the default command, so `aj` and `aj list` are the same. Without a limit, it prints the 20 most recent entries.

| option       | description                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TERM...`    | search the summaries and the bodies. Each term is an extended regex, matched within one line and ignoring case. An entry must match every term |
| `--fixed`    | read the terms as plain text, not as a regex. A fixed term also matches when a line break splits it                                            |
| `--by FIELD` | count the matches for each value of a field, and do not list them. FIELD is `project`, `date`, `host`, `user` or `agent`                       |
| filters      | see [Filters](#filters)                                                                                                                        |

In the output, entries are listed oldest first, so the newest is nearest the prompt. Each line starts with the entry ID, which `aj read` takes as it is. In a terminal the columns are aligned. When the limit leaves older matches out, a last line on stderr says so, and which `--offset` shows the next ones. To find this out, the CLI reads only one match more than it shows:

```console
$ aj list --limit 3
2026-10-07T142000Z  acme-dashboard  Fixed the CSV export timeout for large tables.
2026-10-08T100500Z  billing-api     Upgraded the Stripe SDK to v17.
2026-10-09T163000Z  acme-dashboard  Added a loading state to the export button.
matches 1 to 3, counted from the newest; --offset 3 for older ones
```

With search terms, each entry also shows the part of the body line that matched, on a line of its own under the entry. This part is empty when the summary matched, because the summary is already in the line. Here the first entry matched `timeout` in its summary, and the second matched `worker` in its body:

```console
$ aj list 'worker|timeout|idempotent' --limit 2
2026-10-07T142000Z  acme-dashboard  Fixed the CSV export timeout for large tables.
2026-10-09T163000Z  acme-dashboard  Added a loading state to the export button.
    The button shows a spinner while the CSV is built in the worker.
matches 1 to 2, counted from the newest; --offset 2 for older ones
```

A term that is not a valid regex (for example `foo(`) is refused before the search starts. Add `--fixed` to look for it as plain text.

Down a pipe, the columns are separated by one tab each: ID, project and summary, and with terms the matching body line as a fourth column. An entry with no project has an empty field. The note stays on stderr, so it does not get into the pipe:

```console
$ aj list 'worker|timeout|idempotent' --limit 2 2>/dev/null | tr '\t' '|'
2026-10-07T142000Z|acme-dashboard|Fixed the CSV export timeout for large tables.|
2026-10-09T163000Z|acme-dashboard|Added a loading state to the export button.|The button shows a spinner while the CSV is built in the worker.
```

With `--by FIELD`, the output is one line for each value of the field: the count, a tab and the value. The largest count comes first, and equal counts sort by the value. `--by date` counts by the local day and gives the days in order. The last line is the total. An entry without the field counts as `(none)`, so the total is always the number of matches. All filters and terms apply before the count. The count includes every match, so `--by` takes no `--limit` or `--offset`. When nothing matches, the output is `total` and 0:

```console
$ aj list --by project
3	acme-dashboard
2	api-gateway
2	my-awesome-lib
total	7
```

For most other tasks, use a pipe: the CLI has no option for what a pipe can do with its output. Without terms, the columns down a pipe are ID, project and summary, so `grep` on them searches the summaries (and the project names), and `cut -f1` gives the IDs for `aj read`. The examples below show these pipes.

Examples:

```sh
# the 20 most recent entries
# grep -H '^summary:' $(ls ~/agent-journal/*.md | tail -20)
aj list

# the 5 most recent entries of one project
# grep -l '^project: acme-dashboard$' ~/agent-journal/*.md | tail -5
aj list --project acme-dashboard --limit 5

# the 5 entries before those
# grep -l '^project: acme-dashboard$' ~/agent-journal/*.md | tail -10 | head -5
aj list --project acme-dashboard --limit 5 --offset 5

# every entry of one week
# ls ~/agent-journal/2026-10-1[2-8]T*.md
aj list --since 2026-10-12 --until 2026-10-18 --all

# entries with either word
# grep -liE 'csv|export' ~/agent-journal/*.md
aj list 'csv|export'

# entries with both words, anywhere in the entry
# grep -liE 'timeout' $(grep -liE 'csv' ~/agent-journal/*.md)
aj list csv timeout

# a search in the summaries only
# grep -liE '^summary:.*(revert|rolled back|ruled out)' ~/agent-journal/*.md
aj list --all | grep -iE 'revert|rolled back|ruled out'

# the text as it is, with no regex characters
# grep -liF 'retry(3)' ~/agent-journal/*.md
aj list --fixed 'retry(3)'

# the projects of October, with the number of entries each
# grep -h '^project:' ~/agent-journal/2026-10-*.md | sort | uniq -c | sort -rn
aj list --date 2026-10 --by project

# the number of entries for each local day of October (the days of the IDs are UTC)
# ls ~/agent-journal/2026-10-*.md | xargs -n1 basename | cut -c1-10 | uniq -c
aj list --date 2026-10 --by date

# every entry that matches, in full
# cat $(grep -liE 'csv' ~/agent-journal/*.md)
aj read $(aj list csv --all | cut -f1)
```

The file names are UTC, so a glob such as `2026-10-*` selects UTC days. The CLI uses local days, see [Filters](#filters). The CLI also does what is difficult with `grep` alone: it gives the summary and the matching line together, keeps the output to the limit, tells you when it left older matches out, and counts by the local day.

## `aj read`

```
aj read latest | ID... | PERIOD [filters]
```

Prints entries in full.

| argument | description                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `latest` | the most recent entry                                                                                                                                                                            |
| `ID...`  | one or more IDs, each whole or a prefix that matches one entry. The entries are printed in the order given                                                                                       |
| `PERIOD` | every entry of a period, oldest first: `today`, `yesterday`, `2026`, `2026-10` or `2026-10-22`. It takes the [filters](#filters), and prints every entry of the period unless `--limit` is given |

`read` needs one of these. With no argument it is a usage error, so that `aj read $(aj list csv | cut -f1)` prints nothing when nothing matched. Two entries are separated by one blank line. A prefix that matches several entries is an error, and `read` then lists those entries so that you can select one. When one of several IDs is not found, `read` prints nothing and exits with `1`. You can give a period or IDs, but not the two together, and IDs take no filters: an ID names its entry, so a filter could only hide it.

Examples:

```sh
# the most recent entry
# cat "$(ls ~/agent-journal/*.md | tail -1)"
aj read latest

# one entry, by its whole ID
# cat ~/agent-journal/2026-10-07T142000Z.md
aj read 2026-10-07T142000Z

# one entry, by a prefix
# cat ~/agent-journal/2026-10-07T14*.md
aj read 2026-10-07T14

# several entries
# cat "$(ls ~/agent-journal/*.md | tail -1)" ~/agent-journal/2026-10-07T14*.md
aj read latest 2026-10-07T14

# every entry of yesterday (here the UTC day 2026-10-22)
# cat ~/agent-journal/2026-10-22T*.md
aj read yesterday

# one project's entries of one week
# cat $(grep -l '^project: acme-dashboard$' ~/agent-journal/2026-10-1[2-8]T*.md)
aj read --since 2026-10-12 --until 2026-10-18 --project acme-dashboard

# the 3 most recent entries of October
# cat $(ls ~/agent-journal/2026-10-*.md | tail -3)
aj read 2026-10 --limit 3
```

## Filters

`aj list` and `aj read` with a period take these filters. Two or more filters together select the entries that match all of them.

| filter      | value                                                    | description                                                                                                                                                                           |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--date`    | `2026`, `2026-01`, `2026-01-11`, `today`, `yesterday`    | one year, month or day                                                                                                                                                                |
| `--since`   | `2026-01-11`, `today`, `7d`, `2026-01-11T14:30:00+01:00` | from this day or time on                                                                                                                                                              |
| `--until`   | same forms                                               | up to and including this day or time                                                                                                                                                  |
| `--project` | a project name or a pattern, or `.` for here             | entries filed under one project, across all its worktrees. `.` names the repository of the current directory the same way the session-start hook does, and fails outside a repository |
| `--cwd`     | a directory or a pattern, or `.` for here                | one directory and every directory under it                                                                                                                                            |
| `--host`    | a machine name or a pattern                              | entries written on one machine, as the `host` field records it                                                                                                                        |
| `--user`    | an account name or a pattern                             | entries written by one account, as the `user` field records it                                                                                                                        |
| `--agent`   | `claude`, `opus-*` or `claude/opus-5-5`                  | entries of one agent, of one model, or of both. A value without a slash matches the agent name or the model, so `claude` and `opus-*` both work                                       |
| `--limit`   | a number, default `20`                                   | how many of the most recent to print                                                                                                                                                  |
| `--offset`  | a number, default `0`                                    | skip this many of the most recent first, to page back through older entries                                                                                                           |
| `--all`     |                                                          | no limit                                                                                                                                                                              |

For patterns, the values of `--project`, `--cwd`, `--host`, `--user` and `--agent` can have wildcards, as in a shell glob: `*` is any text, and `?` is one character. All other characters, also `.`, stand for themselves, and the pattern must match the whole value. In `--cwd`, `*` and `?` stay within one name of the path, and the pattern also matches every directory under it, for example `'~/Developer/worktrees/*/fix-*'`. Put a pattern in quotes, so that the shell does not expand it first. There are no bracket expressions such as `[abc]`.

Days are local days, in the time zone of the machine. The IDs stay UTC, so an entry written just after local midnight can carry the date before: in Berlin in winter, `--date 2026-01-11` includes `2026-01-10T231500Z`. A time takes an offset (`+01:00`) or `Z`, and without one it is local time. `--until` with a time includes an entry written in that second. For one exact entry, use `aj read` with its ID.

Examples:

```sh
# entries of one month (with grep, a UTC month)
# ls ~/agent-journal/2026-10-*.md
aj list --date 2026-10

# entries of one project
# grep -l '^project: acme-dashboard$' ~/agent-journal/*.md
aj list --project acme-dashboard

# entries from one directory and every directory under it
# grep -lE '^cwd: ~/Developer/acme-dashboard(/|$)' ~/agent-journal/*.md
aj list --cwd ~/Developer/acme-dashboard

# entries from every worktree of one project
# grep -l '^cwd: ~/Developer/worktrees/acme-dashboard/' ~/agent-journal/*.md
aj list --cwd '~/Developer/worktrees/acme-dashboard/*'

# entries written on one machine
# grep -l '^host: "macbook"$' ~/agent-journal/*.md
aj list --host macbook

# entries written by one account on one machine
# grep -l '^user: "chris"$' $(grep -l '^host: "cookiebox"$' ~/agent-journal/*.md)
aj list --host cookiebox --user chris

# entries of one model, with any agent
# grep -lE '^agent: "?[^/]*/opus-' ~/agent-journal/*.md
aj list --agent 'opus-*'

# entries of every project whose name starts the same
# grep -l '^project: acme-' ~/agent-journal/*.md
aj list --project 'acme-*'

# entries of one session (no filter, the field is in the files only)
grep -l '^session_id: 3f2a' ~/agent-journal/*.md
```

## `aj write`

```
aj write [--summary S] [--body B] [--project P] [--cwd DIR] [--agent A] [--session-id ID]
```

Adds an entry. The file name and the `date` field come from the same clock reading, in UTC.

| option            | description                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--summary S`     | the summary line. Without it, `write` opens `$EDITOR` on a template                                                               |
| `--body B`        | the body. Text piped into `write` is also the body                                                                                |
| `--project P`     | the project to file the entry under. By default, the repository of `--cwd`. `.` also names that repository, and fails outside one |
| `--cwd DIR`       | the directory the entry records. By default, the current directory                                                                |
| `--agent A`       | the agent and model, for example `claude/opus-5-5`                                                                                |
| `--session-id ID` | the session the entry comes from                                                                                                  |

The summary cannot contain a quote or a newline. The project, the agent and the session ID also cannot contain a colon or a tab. The entry also records the `host` and the `user` from the [configuration](../README.md#configuration). When [Git sync](../README.md#git-sync) is on, `write` runs `aj sync` after it writes the entry.

Without the CLI, you must write the frontmatter yourself, with the same instant in the `date` field as in the file name. See [Format](../README.md#format).

Examples:

```sh
# open the editor on a template
# $EDITOR ~/agent-journal/$(date -u +%Y-%m-%dT%H%M%SZ).md
aj write

# a summary and a body as flags
aj write --summary "Fixed the CSV export timeout" --body "Moved the export into a worker."

# the body from a pipe
git log -1 --format=%B | aj write --summary "Released 2.1.0"
```

## `aj config`

```
aj config
aj config set KEY VALUE
aj config unset KEY
```

With no argument, `config` prints the settings that are in effect, as `key=value` lines, also the ones that have their default value. `set` writes a key into the config file, and `unset` removes it. The keys are `journal_dir`, `sync`, `host` and `user`, see [Configuration](../README.md#configuration).

Examples:

```sh
# the settings in effect
# cat ~/.config/agent-journal/config
aj config

# a stable machine name for each entry
# set host=macbook in ~/.config/agent-journal/config
aj config set host macbook

# record no machine name
aj config set host ''

# the name of the system again
aj config unset host
```

## `aj sync`

```
aj sync
aj sync init [URL]
```

`sync` commits every file in the journal folder and pushes the current branch, when the branch has a remote. `sync init` makes the journal folder a git repository, adds `URL` as `origin`, sets `sync=git`, and makes the first commit. See [Git sync](../README.md#git-sync) for the details.

Examples:

```sh
# commit only, on this machine
# git -C ~/agent-journal init
aj sync init

# commit and push
# git -C ~/agent-journal init && git -C ~/agent-journal remote add origin git@github.com:you/journal.git
aj sync init git@github.com:you/journal.git

# commit and push now, for example after Codex wrote entries
# git -C ~/agent-journal add -A && git -C ~/agent-journal commit -m journal && git -C ~/agent-journal push
aj sync
```

## `aj install`

```
aj install [claude|codex] [--all] [--dry-run]
```

With no agent named, `install` lists the agents it finds on this machine, with the command to wire up each one. When you name an agent, `install` runs that agent's own plugin commands for you. It writes nothing into the configuration of an agent. Without the CLI, run the commands from [Claude](../README.md#claude) and [Codex](../README.md#codex) yourself.

| option      | description                                               |
| ----------- | --------------------------------------------------------- |
| `claude`    | install the Claude Code plugin                            |
| `codex`     | install the Codex plugin                                  |
| `--all`     | install the plugin into every agent found on this machine |
| `--dry-run` | show the commands, but do not run them                    |

Examples:

```sh
# which agents are on this machine
aj install

# the commands for Codex, not run
aj install codex --dry-run

# every agent found
aj install --all
```
