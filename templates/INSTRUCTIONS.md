<!--
The entire text injected into the model's context at the start of every session, by whichever adapter is installed. Edit this file to change it; nothing needs to be copied anywhere.

This comment is stripped before injection. `__JOURNAL_DIR__`, `__PROJECT__`, `__CWD__`, `__SESSION_ID__` and `__AGENT__` are replaced with what the session resolved to, so every path and command below is runnable as written. A line whose placeholder resolves to nothing is dropped whole, which is how an agent with no session id produces no line claiming one.

The opening paragraph is framing rather than instruction: `additionalContext` and its equivalents arrive as ambient information, so without being told otherwise the model reads all of this as background material about journaling rather than as a requirement to journal. An agent that takes its instructions some other way can prepend its own framing instead.

Headings start at H2 on purpose. This text is injected standalone into one agent and appended into a larger instructions file for another, and an H1 arriving in the middle of someone else's document competes with that document's own title.

The text comes in two variants, marked by lines that are an HTML comment on their own: `without tools` opens a block printed only by plain `context`, which writes and reads entries as files, and `with tools` opens a block printed only by `context --tools PREFIX`, for an agent that has the journal's own tools. `end` closes either block. (The markers cannot be quoted whole here, since this comment would end at the first one.) Everything outside a block is shared by both, so what an entry is for and when to write one is said once. `__TOOLS__` is the PREFIX: the tool names are the agent's to give, never this file's.

Keep it agent-neutral: no product names, and no tool names beyond the file writing one, which every agent has.
-->

The following is a standing instruction for this session, injected by `agent-journal` from the user's configuration.

## Journal

Every session, you should write at least one journal entry. Write it without asking permission. Only the main conversation writes entries; sub-agents never do.

### When to write

When the session contains important context that is worth remembering:

- At each significant milestone (bug fixed, feature done, refactor complete)
- At each a-ha moment or pivotal decision
- At the end of session (e.g. departure signals like "good night", "we're done", "I'm off"; "thanks", "ok", "done" are acknowledgment, NOT end of session)

Once there is something worth remebering, a little noise is better than missed episodes. Multiple entries per session is normal.

### When NOT to write

Some sessions contain nothing worth remembering: greetings, a question answered from what you already knew, a couple of commands that changed nothing. Do note write an entry and do not announce it.

Never write an entry about the entry: "Created the required journal entry for this session" and "Session opened, no task has been requested yet" tell a future reader only that a session happened. If a summary would mean nothing to someone reading it in a year, there is nothing to write yet.

### Writing an entry

<!-- with tools -->

Write each entry with the `__TOOLS__write` tool. It takes two things, `summary` and `body`, and sets everything else itself: the date from the clock, the project and the directory from where this session works, the agent and the session id. It answers with the new entry's id. One call is one entry. Never create an entry file any other way, and never edit a past one unless explicitly asked.

The `summary` is one line, 200 characters at most, without double quotes. This is what makes a directory of entries scannable, so it has to stand on its own: what happened and what it means, never a topic tag. "Fixed the auth bug" is a tag. "Token refresh raced the retry and logged users out, so it is serialized behind a mutex now" is a summary.
<!-- end -->
<!-- without tools -->

`__JOURNAL_DIR__/YYYY-MM-DDTHHMMSSZ.md`

One file per entry. Never append to an existing entry, and never edit a past one unless explicitly asked. Read the clock once at write time, never from memory, and use that one instant for both the filename and the `date` field:

    date -u +%Y-%m-%dT%H:%M:%SZ

That output is the `date` field verbatim. Remove the colons for the filename, so `2026-01-11T14:30:00Z` becomes `2026-01-11T143000Z.md`. Reading the clock twice can straddle a second and leave the two disagreeing.

Use the `Write` tool to create the file, rather than a shell redirect. Writing a file is usually permitted outright, while running a shell command is what stops to ask.

```markdown
---
date: 2026-01-11T14:30:00Z
project: my-lib
summary: "Shipped the v1.2 sync path on prepared statements, with rollback when a batch fails. Not deployed, waiting on Monday's validation."
cwd: ~/Developer/oss/my-lib
agent: my-agent/my-model
session_id: 4eb89b17-6f7f-4264-95d4-ea5313ef277e
---

Replaced the string-interpolated SQL in the sync path with prepare(). Added a rollback so a failed batch leaves nothing half-written, which is what caused Thursday's partial state.

Considered doing the same to the reporting queries and decided against it for now: they are read-only and the rewrite is large enough to want its own session. Not deployed. Validation is Monday, and the flag stays off until then.
```

Exactly these fields, in this order, on every entry:

- `date`: the same instant as the filename, full ISO 8601 with colons. Leave it unquoted, so it parses as a timestamp rather than as a string.
- `project`: the repository the work belongs to, named after its main checkout so that every worktree of it files under one name. Omit the field when none is given below, which means the session is not in a repository at all; a bare directory is not a project, and `cwd` still records where the work happened.
- `summary`: one line, always double-quoted, 200 characters at most. This is what makes a directory of entries scannable, so it has to stand on its own: what happened and what it means, never a topic tag. "Fixed the auth bug" is a tag. "Token refresh raced the retry and logged users out, so it is serialized behind a mutex now" is a summary.
- `cwd`: the directory the session is working in, written with `~` for home. This is the only place a worktree is recorded, since `project` deliberately collapses them.
- `agent`: which agent wrote the entry, and which model it was running as. Together with `session_id` this is what says where the work can be picked back up, since a session id is only meaningful to the tool that issued it. Omit the field if none is given below.
- `session_id`: the session this entry came from, which is what joins it back to the full transcript. Omit the field if no id is given below.

### Current session

- `project`: `__PROJECT__`
- `cwd`: `__CWD__`
- `agent`: `__AGENT__`
- `session_id`: `__SESSION_ID__`

Copy those verbatim. They are already resolved, so do not derive them again. If the work happened in a different repository than the one above, or in one when no `project` is listed at all, name that repository by its main checkout, never by a worktree's own directory.

Double-quote any value containing a colon, otherwise the frontmatter parses wrong and does so silently.
<!-- end -->

The body is the detail the summary had to leave out: what was decided, what was rejected and why, what is still open. As long as the session earned, no longer. If the material is large, write it into the project as a proper document and keep the entry to its summary plus a pointer.

Never record a secret, token, key or credential in an entry. The journal is a plain file and is often committed.

### Recalling entries

Read the journal when the user asks about past work. Not otherwise, and never at session start.

<!-- with tools -->

Read it with the journal's own tools, never with a shell or a file read of the journal folder:

- `__TOOLS__list` lists entries by date and project, one line each with the id, the project and the summary
- `__TOOLS__search` finds a text in the summaries and bodies, one line each in the same form
- `__TOOLS__read` returns one entry in full, by its id

Load them by these names first if they are not loaded yet. `project` `.` is the current project. The date filters take days in the user's time zone (`2026-01-11`, `today`, `7d`), so a day the user names goes in as it is. Narrow with the summaries first and read whole entries only once they point somewhere.
<!-- end -->
<!-- without tools -->

    grep '^summary:' __JOURNAL_DIR__/2026-01-*.md     # one dated line per entry, for a month
    ls __JOURNAL_DIR__ | tail -20                     # the most recent entries
    grep -rl '^project: nebula$' __JOURNAL_DIR__      # every entry for one project

Filenames are UTC timestamps, so a glob is a range of UTC dates and `ls` is already chronological. A day the user names is a day in their time zone, which can start on the UTC date before it or end on the UTC date after it, so take the neighbouring date into the glob and judge by the times in the names. `grep` prefixes each match with the filename, which is the date. Narrow with the summaries first and open whole entries only once they point somewhere.
<!-- end -->
