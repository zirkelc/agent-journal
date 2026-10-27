# Eval: journal tools or files

This eval compares two ways for an agent to use the journal:

- **tools**: the agent writes and reads the journal with the journal's own tools (in Pi `journal_write`, `journal_list` and `journal_read`, in Claude Code `write`, `list` and `read` of the plugin).
- **files**: the agent writes each entry as a file and reads the journal with its usual tools, such as `ls`, `grep`, `cat` and a file read.

The dataset and the grader do not depend on an agent. A runner for one agent starts the sessions and gives the grader what each session left behind. The Pi runner is in [`pi/`](pi/), the Claude Code runner in [`claude-code/`](claude-code/), and what both share in [`runner.ts`](runner.ts).

## Dataset

- [`dataset/generate.ts`](dataset/generate.ts): the journal, about 6,000 entries over three years in 10 projects, with more entries per day in the recent months, as the use of a journal grows. It has worktree directories, agents with the models of their time, and one busy day of 40 long entries. An entry has no date. It has a day relative to the day of the run (`0` is today, `-1` is yesterday), or a day of a month relative to the month of the run, and a local time. The runner makes the files with UTC ids in the time zone of the run, so questions such as "what did we do yesterday" stay correct on each day the eval runs. The 38 key entries that the cases ask about are written by hand. A seeded generator gives each filler entry its slot (day, time, project, agent), and the text of the slots comes from the content folder. The rules in the same file keep one right answer for each case: for example, no entry names JWT before the switch to JWT, and none names Kubernetes. The build stops when a filler entry breaks a rule. `node eval/dataset/generate.ts` prints the size.
- [`dataset/content/`](dataset/content): for each project, a description (`<project>.md`: what it is, its stack, its timeline in days and the near misses it must have) and the text of its filler (`<project>.jsonl`, one entry per line, in time order). A model wrote the text once from the description, so the entries of a project tell one story over the years, with topics that go on over several entries and entries that are near a key entry but are not the answer. The n-th slot of a project gets the n-th line.
- [`dataset/write.ts`](dataset/write.ts): writes the content files again, through Pi, when the schedule or a description changes. `node eval/dataset/write.ts --pilot --only nebula` writes and prints the first batch of one project. The full run writes about 6,000 entries with Sonnet in about an hour and costs about $40. A finished batch is kept in `eval/results/write-cache`, so a run that stops goes on where it stopped. A change to the schedule moves the text to other slots, so it needs a new full run.
- [`dataset/check.ts`](dataset/check.ts): finds filler entries that do a key change before the day of its key entry, and writes them again. Before that day, an entry may plan the change but never do it, or a case such as "when did we switch" gets two answers. A model reads the filler of each project with its key entries, 40 entries at a time, and each entry it names is written again from its neighbours. Run it after `write.ts`, and again with `--dry` until it finds nothing. A pass over all projects costs about $10.
- [`dataset/cases.json`](dataset/cases.json): 27 cases. Each case has a working directory, the messages of the user, what a correct result must contain, and why the case is there.

The cases:

| case                      | what it tests                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `recall-yesterday`        | yesterday in local time. One entry of yesterday has the UTC date of the day before, and one entry of today has yesterday's UTC date |
| `recall-project-week`     | a project and a date range together                                                                                                 |
| `recall-last-time`        | a text search, and the newest of two matches                                                                                        |
| `recall-latest-full`      | the newest entry, with its body                                                                                                     |
| `recall-counts`           | the number of entries for each project over 14 days                                                                                 |
| `recall-needle`           | a fact that is only in one body                                                                                                     |
| `recall-failures`         | five entries of the last 60 days that use different words for failure, among about 300 entries of one project                       |
| `recall-busy-day`         | one day of 40 long entries                                                                                                          |
| `recall-first`            | the oldest of about 400 entries of a project, more than two years ago                                                               |
| `recall-evolution`        | three entries over three years that tell one story, and the date of the first                                                       |
| `recall-old-needle`       | a decision of about two years ago that is only in a body                                                                            |
| `recall-old-month`        | one month of a project more than a year ago                                                                                         |
| `recall-nothing`          | a question that nothing in the journal answers                                                                                      |
| `recall-dates-of-steps`   | the day of each of three changes, among many entries about the same topic that are not changes                                      |
| `recall-redis-dropped`    | three attempts that were dropped, among about 70 entries on one topic, many of which say that something else "dropped"              |
| `recall-root-cause`       | a cause and a fix that are only in the body, under a summary that names neither                                                     |
| `recall-current-state`    | the current cache of a project, where the later entry that changed it does not name the cache in its summary                        |
| `recall-dates-of-backups` | the day of each of three changes that only the bodies name, among about 100 entries on backups of other things                      |
| `write-milestone`         | an entry with every field right, at a milestone and at the end of the session                                                       |
| `write-no-project`        | an entry from a directory that is not a repository, so it has no project                                                            |
| `write-nothing`           | a session with nothing to remember, so no entry                                                                                     |
| `write-small-fix`         | a small fix still gets an entry                                                                                                     |
| `write-decision`          | a decision without a code change gets an entry                                                                                      |
| `write-lookup-then-work`  | a look into the journal gives no entry, and the work after it gives one                                                             |
| `write-two-milestones`    | two separate results in one session give two entries                                                                                |
| `write-nothing-lookup`    | only a look into the journal, then an end of session, so no entry                                                                   |
| `write-nothing-general`   | a general question, then an end of session, so no entry                                                                             |

## Grading

[`grade.ts`](grade.ts) sees only what a user sees: the last answer of the agent, and the entry files that the session wrote. Each case gives checks, and the score is the share of checks that passed.

| `expect` field | check                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `all`          | each regex must match the answer, ignoring case. One check each                                                                    |
| `none`         | no regex may match the answer. One check                                                                                           |
| `date_of`      | the answer names the local day of that entry (`2026-10-12`, `October 12`, `12 Oct` or `12 days ago`)                               |
| `counts`       | for each project, a line of the answer has the project and its exact number of entries in those local days. One check each project |
| `negative`     | the start of the answer says that nothing matches                                                                                  |
| `entries`      | the session writes this many new entries                                                                                           |
| `project`      | every new entry has this project, or no project for `null`                                                                         |
| `body`         | a new entry matches each regex                                                                                                     |

Each write case also checks every field of each new entry: the file name, the date and the file name are the same instant within the session, and `cwd`, `host`, `user`, `agent` and `session_id` are the values of the session. A recall case also reports whether the session wrote an entry. That check has no score, because it says nothing about the recall.

## Run it in Pi

Pi needs credentials for the model, from `pi /login` or an API key in the Pi agent folder. Then:

```sh
node eval/pi/run.ts --repeat 3                       # every case, both modes, 3 times each
node eval/pi/run.ts --cases recall-needle --modes files
node eval/pi/run.ts --model anthropic/claude-haiku-5-5
node eval/report.ts eval/results/<run> [<run> ...]   # the tables, per model and mode, and per case
```

The report gives each score a 95% interval of the noise from running each case again, from the spread of the repeats, and each case the standard deviation of its repeats. With 3 repeats one session of a case moves its score by a third, so a difference between the modes counts only when its interval in the table "Difference tools − files" does not include 0. Run the cases that differ with `--repeat 5` or more. The report also counts the calls that only load a deferred tool (`ToolSearch` in Claude Code) and the calls that a permission check refused.

Each session gets its own home directory with a fresh copy of the journal, its own config and its own Pi agent folder, so nothing from this machine gets in and nothing gets to the real journal. Only `auth.json` comes from the real Pi agent folder, as a link. The `PATH` of the session has no folder with the `agent-journal` CLI, so the agent without the tools cannot use the CLI either. The extension turns its tools off with `AGENT_JOURNAL_TOOLS=off`, and then gives the rules for files.

One JSON record per session goes into `eval/results/<run>/` (not in git): the score and the checks, the answer, the new entries, every tool call with its arguments and the length of its output, the tokens, the cost and the time. A session that passed every check deletes its temporary folder, because the folder holds a copy of the whole journal (up to 70 MB). A session with an error or a failed check keeps it, with the full event stream in `events.jsonl`, and its record names the folder as `workdir`. A check also finds entry files that the session wrote to another folder than the journal, which a model that copies a long path wrong can do: every new file with the name of an entry in the session's folder, and every file that a write or edit tool put elsewhere. It counts in the write cases, also in those that want no entry, and has no score in the recall cases. A session with no scored check keeps its folder too.

## Run it in Claude Code

Claude Code must be logged in, or have `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` set. The flags are the same as in Pi, and the model is a Claude model id:

```sh
node eval/claude-code/run.ts --model claude-haiku-5-5 --repeat 3
node eval/claude-code/run.ts --cases recall-needle,write-milestone --model claude-sonnet-5-5
```

Each session loads only the plugin in [`claude-code/`](../claude-code/), with `--setting-sources project,local`, `--strict-mcp-config` and without CLAUDE.md files or memory, so the user's settings, plugins and MCP servers do not get in. All messages of a case go into one session, as stream JSON. The differences from the Pi runner:

- **Home**: Claude Code finds its login on macOS by the path of its config, so a session with another `HOME` is not logged in. The folder of each session is in the real home, as `~/.aj-eval-XXXX`, with the journal, the config (through `XDG_CONFIG_HOME`) and the working directory. The rules give the model the working directory as a path from `~`, as a user's rules do.
- **Without the tools**: a deny rule removes the three tools, as a person can do too, and the plugin then gives the rules for files.
- **Permissions**: Pi asks for no approval. Here the sessions run in `acceptEdits`, which allows a file write in the working directory and in the journal (`--add-dir`), with an allow list of the read tools and of the read-only shell commands that the rules for files use. A session without a UI refuses any other call, and the report counts those calls. The journal tools get no permission check at all at the moment (anthropics/claude-code#104217), so the tools mode never has a refused call.
- **Deferred tools**: the plugin's `list` and `read` are deferred, so a session loads them with `ToolSearch` before it calls them. Pi's tools are always loaded.

The eval runs at any time of day. A key entry of today is at 00:30, which is on yesterday's UTC date in all three zones, also in Berlin's winter time (UTC+1). The newest entry is 20 minutes before the run, so the runner takes the first of `Europe/Berlin`, `Asia/Dubai` and `Asia/Tokyo` where it is now between 03:00 and 22:59. All three are east of UTC, so a local day starts on the UTC date before it, which is what the cases about yesterday test. The record of each session names its time zone.
