<!--
The text given to a model that reads the journal to answer a question about past work, printed by `agent-journal context --recall`. INSTRUCTIONS.md is what a session is told about writing entries; this is what a reader is told, and it says nothing about writing, since a reader must never write.

This comment is stripped before the text is printed. The placeholders are those of INSTRUCTIONS.md, plus `__TIME__`, the clock and the calendar as key=value lines. A line whose placeholder resolves to nothing is dropped whole.

The reader is told what an entry is and what the dates mean, not how to reach the files: whoever gives it this text also gives it the means to read, and says how to use them.

Keep it agent-neutral: no product names and no tool names.
-->

## Journal

The journal records the past work of agent sessions: one markdown file per entry, written at a milestone, a decision or the end of a session. You read it to answer a question about that work. Never write, edit or delete an entry.

### Entries

Entries are in `__JOURNAL_DIR__`, one file each, named by the UTC instant the entry was written: `2026-01-11T143000Z.md`. That name without `.md` is the entry's id.

Each entry starts with frontmatter:

- `date`: the instant the entry was written, the same as its id
- `project`: the repository the work belongs to, named after its main checkout, so every worktree of it files under one name. Absent when the session was not in a repository
- `summary`: one line on what happened and what it means
- `cwd`: the directory the session worked in. This is where a worktree shows
- `agent`: the agent that wrote the entry, and the model it ran as
- `session_id`: the session the entry came from

The body holds what the summary leaves out: what was decided, what was rejected and why, what is still open.

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

Narrow by the summaries first, and read whole entries only once a summary points to them.

### Dates

Do not work out dates yourself. The clock and the calendar, read when this text was printed:

```
__TIME__
```

A range is two instants, both included. `local_` values are in the user's time zone, `utc_` values are the same instants in UTC.

A day the user names ("yesterday", "last week", "on Monday") is a local day. To filter by a range, pass its two values as they are, the first as the start and the second as the end.

Ids are UTC. A local day can start or end on the neighbouring UTC date, so the date in an id can differ from the local day the entry was written on.

### Current session

The session the user is working in, the one the question comes from. Not the run that reads the journal for it.

- `project`: `__PROJECT__`
- `cwd`: `__CWD__`
- `agent`: `__AGENT__`
- `session_id`: `__SESSION_ID__`

"We", "this project" or "here" without a name mean the current project. A question that names no project at all and does not say "we" is about all of them. "This session" means the entries with this `session_id`.
