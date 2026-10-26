# Eval: journal tools or files

This eval compares two ways for an agent to use the journal:

- **tools**: the agent writes and reads the journal with the journal's own tools (`journal_write`, `journal_list`, `journal_read`).
- **files**: the agent writes each entry as a file and reads the journal with its usual tools, such as `ls`, `grep`, `cat` and a file read.

The dataset and the grader do not depend on an agent. A runner for one agent starts the sessions and gives the grader what each session left behind. The Pi runner is in [`pi/`](pi/).

## Dataset

- [`dataset/generate.ts`](dataset/generate.ts): the journal, about 6,000 entries over three years in 10 projects, with more entries per day in the recent months, as the use of a journal grows. It has worktree directories, agents with the models of their time, and one busy day of 40 long entries. An entry has no date. It has a day relative to the day of the run (`0` is today, `-1` is yesterday), or a day of a month relative to the month of the run, and a local time. The runner makes the files with UTC ids in the time zone of the run, so questions such as "what did we do yesterday" stay correct on each day the eval runs. The 32 key entries that the cases ask about are written by hand. A seeded generator gives each filler entry its slot (day, time, project, agent), and the text of the slots comes from the content folder. The rules in the same file keep one right answer for each case: for example, no entry names JWT before the switch to JWT, and none names Kubernetes. The build stops when a filler entry breaks a rule. `node eval/dataset/generate.ts` prints the size.
- [`dataset/content/`](dataset/content): for each project, a description (`<project>.md`: what it is, its stack, its timeline in days and the near misses it must have) and the text of its filler (`<project>.jsonl`, one entry per line, in time order). A model wrote the text once from the description, so the entries of a project tell one story over the years, with topics that go on over several entries and entries that are near a key entry but are not the answer. The n-th slot of a project gets the n-th line.
- [`dataset/write.ts`](dataset/write.ts): writes the content files again, through Pi, when the schedule or a description changes. `node eval/dataset/write.ts --pilot --only nebula` writes and prints the first batch of one project. The full run writes about 6,000 entries with Sonnet in about an hour and costs about $40. A finished batch is kept in `eval/results/write-cache`, so a run that stops goes on where it stopped. A change to the schedule moves the text to other slots, so it needs a new full run.
- [`dataset/cases.json`](dataset/cases.json): 16 cases. Each case has a working directory, the messages of the user, what a correct result must contain, and why the case is there.

The cases:

| case                  | what it tests                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `recall-yesterday`    | yesterday in local time. One entry of yesterday has the UTC date of the day before, and one entry of today has yesterday's UTC date |
| `recall-project-week` | a project and a date range together                                                                                                 |
| `recall-last-time`    | a text search, and the newest of two matches                                                                                        |
| `recall-latest-full`  | the newest entry, with its body                                                                                                     |
| `recall-counts`       | the number of entries for each project over 14 days                                                                                 |
| `recall-needle`       | a fact that is only in one body                                                                                                     |
| `recall-failures`     | five entries of the last 60 days that use different words for failure, among about 300 entries of one project                       |
| `recall-busy-day`     | one day of 40 long entries                                                                                                          |
| `recall-first`        | the oldest of about 400 entries of a project, more than two years ago                                                               |
| `recall-evolution`    | three entries over three years that tell one story, and the date of the first                                                       |
| `recall-old-needle`   | a decision of about two years ago that is only in a body                                                                            |
| `recall-old-month`    | one month of a project more than a year ago                                                                                         |
| `recall-nothing`      | a question that nothing in the journal answers                                                                                      |
| `write-milestone`     | an entry with every field right, at a milestone and at the end of the session                                                       |
| `write-no-project`    | an entry from a directory that is not a repository, so it has no project                                                            |
| `write-nothing`       | a session with nothing to remember, so no entry                                                                                     |

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

Each session gets its own home directory with a fresh copy of the journal, its own config and its own Pi agent folder, so nothing from this machine gets in and nothing gets to the real journal. Only `auth.json` comes from the real Pi agent folder, as a link. The `PATH` of the session has no folder with the `agent-journal` CLI, so the agent without the tools cannot use the CLI either. The extension turns its tools off with `AGENT_JOURNAL_TOOLS=off`, and then gives the rules for files.

One JSON record per session goes into `eval/results/<run>/` (not in git): the score and the checks, the answer, the new entries, every tool call with its arguments and the length of its output, the tokens, the cost and the time. The full event stream of a session stays in its temporary folder, named as `workdir` in the record.

The eval runs at any time of day. Two key entries of today are at 01:10, and the newest entry is 20 minutes before the run, so the runner takes the first of `Europe/Berlin`, `Asia/Dubai` and `Asia/Tokyo` where it is now between 03:00 and 22:59. All three are east of UTC, so a local day starts on the UTC date before it, which is what the cases about yesterday test. The record of each session names its time zone.
