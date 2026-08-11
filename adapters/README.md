# Adapters

One directory per agent. Everything specific to a given agent lives in its own
directory. `bin/agent-journal` contains nothing agent-specific.

| directory | agent | status |
|---|---|---|
| `claude-code/` | Claude Code | built |
| `codex/` | Codex | not built |

## What an adapter does

Runs the core and delivers its output to the model at the start of every session,
and again whenever the agent discards the context it was put into.

```sh
bin/agent-journal context --cwd <session directory> --session-id <session id>
```

Both flags are optional:

| flag | omitted |
|---|---|
| `--cwd` | the process's own working directory is used |
| `--session-id` | the id is left out of the instructions, and entries omit the field |

The output is plain UTF-8 text on stdout. It is already framed as a standing
instruction and already carries the resolved journal directory, project, working
directory and session id. Empty output means there is nothing to inject.

An adapter does not parse, reformat, extend or truncate that text. It encodes it
for one agent and does nothing else.

## Requirements

| requirement | reason |
|---|---|
| Exit 0 on every path, including a missing core, a missing `INSTRUCTIONS.md`, and input it cannot parse | a failed adapter must not fail the session |
| Write nothing to the user | the instructions are for the model; a banner about the user's own configuration at every session start is noise |
| Read `journal_dir` only through `bin/agent-journal config` | one config file serves every agent, so the same machine journals to one place |
| Preserve the text byte for byte through whatever encoding the agent needs | it contains quotes, backslashes and tabs |

## Delivery is not the same for every agent

| agent | mechanism | runs |
|---|---|---|
| Claude Code | `SessionStart` hook, JSON on stdout | at `startup`, `clear` and `compact` |
| Codex | writes the text into an `AGENTS.md` | at install, and whenever the config changes |

Claude Code pulls at session start. Codex has no session event, so its adapter
pushes the same text into a file ahead of time. The core is unchanged either way,
which is why the contract is "text out, delivered somehow" rather than "return
JSON from a hook".

## Adding an adapter

1. Create the directory, for example `codex/`.
2. Call the core as shown above, passing the session's working directory and id
   if the agent supplies them.
3. Encode the output for that agent and deliver it.
4. Exit 0 on every path.
5. Register it where that agent looks. For a Claude Code plugin that means
   `.claude-plugin/plugin.json`, which points at `hooks.json` and the command
   file by path.
6. Add tests under `test/`, covering at minimum:
   - the output is well formed for that agent
   - the instructions survive its encoding unchanged
   - broken or empty input still exits 0

## Files in `claude-code/`

| file | |
|---|---|
| `hooks.json` | registers the hook: `SessionStart`, matcher `startup\|clear\|compact` |
| `session-start.sh` | reads the hook payload, runs the core, prints JSON |
| `config.md` | the `/agent-journal:config` command |
