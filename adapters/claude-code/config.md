---
description: Show or change where agent-journal writes journal entries.
argument-hint: "optional, e.g. 'use ~/notes/journal', 'where do entries go?'"
---

Configure `agent-journal`. Everything works without this, so treat it as adjusting a
setting rather than as a required install step.

## 1. Read the current state

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/agent-journal" config
```

| key | |
|---|---|
| `journal_dir` | where entries are written. Default `$HOME/agent-journal` |
| `journal_dir_from` | `config` if it is set in the file, `default` if nothing is set |
| `config_file` | the file itself |

`journal_dir_from=default` means nothing is written anywhere. That is the normal state and
not something to fix.

## 2. Ask

If the instruction already says what to change, skip to writing it. If invoked bare, report
the current directory and ask whether to change it.

The directory holds one markdown file per entry, named by UTC timestamp, for every project.
It is a good candidate for its own git repository, since it is small, append-only and worth
keeping.

## 3. Write it

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/agent-journal" config set journal_dir ~/notes/journal
"${CLAUDE_PLUGIN_ROOT}/bin/agent-journal" config unset journal_dir
```

**Never edit the config file directly.** `config set` is the only thing that knows the
format. It drops a key whose value is the default, so accepting a default never pins it, it
creates the directory it just pointed at, and it leaves every other line alone, including
comments and any key a newer version has added.

## 4. Report

What changed and what it now resolves to, in two lines.

The new directory takes effect for the next session, since the rules are injected once at
session start and name the directory that was current then. Say so, otherwise the first
entry lands somewhere unexpected.

If entries already exist under the old directory, say so and offer to move them. Nothing
follows the old path on its own.
